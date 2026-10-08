import type { InsightsReport } from './schema'

/** Library size buckets, by song count. Labels are what the dashboard shows. */
export const LIBRARY_BINS = [
  { label: '0', max: 0 },
  { label: '1-1k', max: 1_000 },
  { label: '1k-10k', max: 10_000 },
  { label: '10k-50k', max: 50_000 },
  { label: '50k-100k', max: 100_000 },
  { label: '100k+', max: Infinity }
] as const

export interface DailySummary {
  instances: number
  versions: Record<string, number>
  platforms: Record<string, number>
  containerized: Record<'docker' | 'bare', number>
  librarySizes: Record<string, number>
  /** Songs per file format, summed over every instance */
  fileExtensions: Record<string, number>
  /** Instances using each feature at least once */
  features: {
    smartPlaylists: number
    savedFilters: number
    sharedLinks: number
    scrobbling: number
    multiUser: number
    metadataEditing: number
  }
  totals: {
    songs: number
    users: number
    metadataEdits7d: number
    listens7d: number
  }
}

export interface HistoryPoint {
  day: string
  summary: DailySummary
}

function increment(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

export function libraryBin(songs: number): string {
  return LIBRARY_BINS.find(bin => songs <= bin.max)!.label
}

/** "1.4.2-beta.1" → "1.4": patch releases would split the chart into dozens of thin bands. */
export function minorVersion(version: string): string {
  const match = version.replace(/^v/, '').match(/^(\d+)\.(\d+)/)
  return match ? `${match[1]}.${match[2]}` : 'unknown'
}

export function summarizeReports(reports: InsightsReport[]): DailySummary {
  const summary: DailySummary = {
    instances: reports.length,
    versions: {},
    platforms: {},
    containerized: { docker: 0, bare: 0 },
    librarySizes: Object.fromEntries(LIBRARY_BINS.map(bin => [bin.label, 0])),
    fileExtensions: {},
    features: { smartPlaylists: 0, savedFilters: 0, sharedLinks: 0, scrobbling: 0, multiUser: 0, metadataEditing: 0 },
    totals: { songs: 0, users: 0, metadataEdits7d: 0, listens7d: 0 }
  }

  for (const report of reports) {
    increment(summary.versions, minorVersion(report.version))
    increment(summary.platforms, `${report.os.platform}/${report.os.arch}`)
    summary.containerized[report.os.containerized ? 'docker' : 'bare']++
    increment(summary.librarySizes, libraryBin(report.library.songs))

    for (const [extension, songs] of Object.entries(report.library.fileExtensions)) {
      increment(summary.fileExtensions, extension.toLowerCase(), songs)
    }

    const { features, usage7d } = report
    if (features.smartPlaylists > 0) summary.features.smartPlaylists++
    if (features.savedFilters > 0) summary.features.savedFilters++
    if (features.sharedLinks > 0) summary.features.sharedLinks++
    if (Object.values(features.scrobbleAccounts).some(accounts => accounts > 0)) summary.features.scrobbling++
    if (report.users.total > 1) summary.features.multiUser++
    if (usage7d.metadataEdits > 0) summary.features.metadataEditing++

    summary.totals.songs += report.library.songs
    summary.totals.users += report.users.total
    summary.totals.metadataEdits7d += usage7d.metadataEdits
    summary.totals.listens7d += usage7d.listens
  }

  return summary
}

/**
 * Drops trailing days whose instance count fell more than 20% from the day before: a day that
 * was summarized before every instance had reported reads as a sudden drop (idea from Navidrome).
 */
export function excludeIncompleteDays(points: HistoryPoint[]): HistoryPoint[] {
  const result = [...points]
  while (result.length >= 2) {
    const last = result[result.length - 1].summary.instances
    const previous = result[result.length - 2].summary.instances
    if (last >= previous * 0.8) break
    result.pop()
  }
  return result
}

/** Monday of the ISO week, as YYYY-MM-DD. */
export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

/**
 * One point per week for long ranges. Every metric is already a snapshot (instances that day,
 * 7-day rolling activity), so the week keeps its last day rather than adding days up.
 */
export function groupByWeek(points: HistoryPoint[]): HistoryPoint[] {
  const byWeek = new Map<string, HistoryPoint>()
  for (const point of points) {
    byWeek.set(weekStart(point.day), point)
  }
  return [...byWeek.entries()].map(([week, point]) => ({ day: week, summary: point.summary }))
}
