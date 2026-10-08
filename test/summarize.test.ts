import { describe, expect, it } from 'vitest'
import { insightsReportSchema, type InsightsReport } from '../src/schema'
import {
  excludeIncompleteDays,
  groupByWeek,
  libraryBin,
  minorVersion,
  summarizeReports,
  weekStart,
  type DailySummary
} from '../src/summarize'

function report(overrides: Partial<InsightsReport> = {}): InsightsReport {
  return {
    schema: 1,
    id: crypto.randomUUID(),
    version: '1.4.2',
    uptime: 3600,
    os: { platform: 'linux', arch: 'x64', containerized: true, nodeVersion: '22.12.0' },
    library: { songs: 5000, musicFolders: 1, fileExtensions: { flac: 4000, mp3: 1000 } },
    users: { total: 1, listeners7d: 1 },
    usage7d: { metadataEdits: 0, editedSongs: 0, listens: 10 },
    features: { smartPlaylists: 0, savedFilters: 0, sharedLinks: 0, scrobbleAccounts: {} },
    ...overrides
  }
}

function point(day: string, instances: number) {
  return { day, summary: { instances } as DailySummary }
}

describe('insightsReportSchema', () => {
  it('accepts a report from Tagr and strips unknown keys', () => {
    const parsed = insightsReportSchema.parse({ ...report(), ip: '1.2.3.4' })
    expect(parsed).not.toHaveProperty('ip')
  })

  it('rejects a report without a valid id', () => {
    expect(insightsReportSchema.safeParse({ ...report(), id: 'nope' }).success).toBe(false)
  })

  it('rejects negative counts', () => {
    const bad = report({ library: { songs: -1, musicFolders: 1, fileExtensions: {} } })
    expect(insightsReportSchema.safeParse(bad).success).toBe(false)
  })
})

describe('summarizeReports', () => {
  it('aggregates instances, versions, platforms and features', () => {
    const summary = summarizeReports([
      report({ version: '1.4.2' }),
      report({
        version: '1.3.0',
        os: { platform: 'linux', arch: 'arm64', containerized: false, nodeVersion: '22' },
        library: { songs: 60_000, musicFolders: 2, fileExtensions: { FLAC: 60_000 } },
        users: { total: 3, listeners7d: 2 },
        usage7d: { metadataEdits: 40, editedSongs: 12, listens: 0 },
        features: { smartPlaylists: 2, savedFilters: 1, sharedLinks: 0, scrobbleAccounts: { listenbrainz: 1 } }
      })
    ])

    expect(summary.instances).toBe(2)
    expect(summary.versions).toEqual({ '1.4': 1, '1.3': 1 })
    expect(summary.platforms).toEqual({ 'linux/x64': 1, 'linux/arm64': 1 })
    expect(summary.containerized).toEqual({ docker: 1, bare: 1 })
    expect(summary.librarySizes['1k-10k']).toBe(1)
    expect(summary.librarySizes['50k-100k']).toBe(1)
    expect(summary.fileExtensions).toEqual({ flac: 64_000, mp3: 1000 })
    expect(summary.features).toEqual({
      smartPlaylists: 1,
      savedFilters: 1,
      sharedLinks: 0,
      scrobbling: 1,
      multiUser: 1,
      metadataEditing: 1
    })
    expect(summary.totals).toEqual({ songs: 65_000, users: 4, metadataEdits7d: 40, listens7d: 10 })
  })
})

describe('helpers', () => {
  it.each([
    [0, '0'],
    [1, '1-1k'],
    [1000, '1-1k'],
    [1001, '1k-10k'],
    [250_000, '100k+']
  ])('bins %i songs as %s', (songs, label) => {
    expect(libraryBin(songs)).toBe(label)
  })

  it('reduces versions to major.minor', () => {
    expect(minorVersion('v1.10.3-beta.1')).toBe('1.10')
    expect(minorVersion('dev')).toBe('unknown')
  })

  it('finds the Monday of the week', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
  })

  it('keeps the last day of each week', () => {
    const weeks = groupByWeek([point('2026-10-05', 1), point('2026-10-11', 3), point('2026-10-12', 4)])
    expect(weeks.map(week => [week.day, week.summary.instances])).toEqual([
      ['2026-10-05', 3],
      ['2026-10-12', 4]
    ])
  })

  it('drops trailing days that fell more than 20%', () => {
    const kept = excludeIncompleteDays([point('a', 100), point('b', 100), point('c', 50)])
    expect(kept.map(p => p.day)).toEqual(['a', 'b'])
  })

  it('keeps a normal dip', () => {
    const kept = excludeIncompleteDays([point('a', 100), point('b', 85)])
    expect(kept).toHaveLength(2)
  })
})
