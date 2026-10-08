import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { insightsReportSchema, type InsightsReport } from './schema'
import {
  excludeIncompleteDays,
  groupByWeek,
  summarizeReports,
  type DailySummary,
  type HistoryPoint
} from './summarize'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
}

const MAX_REPORT_BYTES = 32 * 1024
const REPORT_RETENTION_DAYS = 90
/** Days re-summarized on every run, so a late report still lands in its day. */
const SUMMARIZE_LOOKBACK_DAYS = 3
/** Window of the live "today" point */
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Short, so the dashboard follows new reports; the live query is cheap at this scale */
const LIVE_CACHE_SECONDS = 300

const RANGES = {
  '30d': { days: 30, weekly: false },
  '90d': { days: 90, weekly: false },
  '1y': { days: 365, weekly: true },
  all: { days: null, weekly: true }
} as const

type Range = keyof typeof RANGES

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number, from = new Date()): string {
  const date = new Date(from)
  date.setUTCDate(date.getUTCDate() - days)
  return utcDay(date)
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', c => c.text('Tagr Insights. Dashboard: https://tagr.xavirincon.com/insights/'))

app.get('/healthz', c => c.text('ok'))

app.post('/collect', async c => {
  const declaredLength = Number(c.req.header('content-length') ?? 0)
  if (declaredLength > MAX_REPORT_BYTES) return c.body(null, 413)

  const body = await c.req.text()
  if (body.length > MAX_REPORT_BYTES) return c.body(null, 413)

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return c.body(null, 400)
  }

  const parsed = insightsReportSchema.safeParse(json)
  if (!parsed.success) return c.body(null, 400)

  const now = new Date()
  // No IP, no headers: only the validated report is stored.
  await c.env.DB.prepare(
    `INSERT INTO reports (instance_id, day, received_at, data) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (instance_id, day) DO UPDATE SET received_at = excluded.received_at, data = excluded.data`
  )
    .bind(parsed.data.id, utcDay(now), now.toISOString(), JSON.stringify(parsed.data))
    .run()

  return c.body(null, 204)
})

app.use('/summary.json', async (c, next) => {
  const origins = c.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  return cors({ origin: origins, allowMethods: ['GET'] })(c, next)
})

app.get('/summary.json', async c => {
  const rangeParam = c.req.query('range') ?? '90d'
  const range: Range = rangeParam in RANGES ? (rangeParam as Range) : '90d'
  const { days, weekly } = RANGES[range]

  const query =
    days === null
      ? c.env.DB.prepare('SELECT day, data FROM daily_summaries ORDER BY day')
      : c.env.DB.prepare('SELECT day, data FROM daily_summaries WHERE day >= ?1 ORDER BY day').bind(daysAgo(days))

  const now = new Date()
  const [{ results }, live] = await Promise.all([
    query.all<{ day: string; data: string }>(),
    summarizeLive(c.env.DB, now)
  ])

  // The live point stands for today and replaces the stored row, which only exists if a late
  // re-summary wrote one. It is complete by construction, so it skips the incomplete-day check.
  const today = utcDay(now)
  const closed: HistoryPoint[] = excludeIncompleteDays(
    results
      .filter(row => row.day !== today)
      .map(row => ({ day: row.day, summary: JSON.parse(row.data) as DailySummary }))
  )
  const daily = live ? [...closed, { day: today, summary: live }] : closed
  const history = weekly ? groupByWeek(daily) : daily
  const latest = daily.at(-1)

  c.header('Cache-Control', `public, max-age=${LIVE_CACHE_SECONDS}`)
  return c.json({
    range,
    granularity: weekly ? 'week' : 'day',
    updatedAt: latest ? now.toISOString() : null,
    totalInstances: latest?.summary.instances ?? 0,
    history
  })
})

/**
 * Today's point, computed on every request: the latest report of each instance received in the
 * last 24 hours. Instances report every 24 hours, so this window holds each active instance
 * exactly once, whereas "since midnight" would start near zero and climb all day.
 */
export async function summarizeLive(db: D1Database, now = new Date()): Promise<DailySummary | null> {
  const since = new Date(now.getTime() - LIVE_WINDOW_MS).toISOString()
  const { results } = await db
    .prepare(
      `SELECT data FROM reports r
       WHERE received_at >= ?1
         AND received_at = (SELECT MAX(received_at) FROM reports WHERE instance_id = r.instance_id)`
    )
    .bind(since)
    .all<{ data: string }>()

  if (results.length === 0) return null
  return summarizeReports(results.map(row => JSON.parse(row.data) as InsightsReport))
}

export async function summarizeDay(db: D1Database, day: string): Promise<boolean> {
  const { results } = await db.prepare('SELECT data FROM reports WHERE day = ?1').bind(day).all<{ data: string }>()
  if (results.length === 0) return false

  const reports = results.map(row => JSON.parse(row.data) as InsightsReport)
  const summary = summarizeReports(reports)

  await db
    .prepare(
      `INSERT INTO daily_summaries (day, data) VALUES (?1, ?2)
       ON CONFLICT (day) DO UPDATE SET data = excluded.data`
    )
    .bind(day, JSON.stringify(summary))
    .run()
  return true
}

export async function runDailyJob(db: D1Database, now = new Date()): Promise<void> {
  // Only days that already closed: today is still collecting.
  for (let offset = SUMMARIZE_LOOKBACK_DAYS; offset >= 1; offset--) {
    await summarizeDay(db, daysAgo(offset, now))
  }

  await db.prepare('DELETE FROM reports WHERE day < ?1').bind(daysAgo(REPORT_RETENTION_DAYS, now)).run()
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyJob(env.DB))
  }
} satisfies ExportedHandler<Env>
