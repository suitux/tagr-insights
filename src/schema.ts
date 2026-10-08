import { z } from 'zod'

/**
 * Mirrors `InsightsData` in Tagr (src/features/insights/domain.ts).
 * Unknown keys are stripped, so only what is listed here ever reaches the database.
 */

const count = z.number().int().nonnegative().max(1e9)

const countsByKey = z
  .record(z.string().min(1).max(32), count)
  .refine(value => Object.keys(value).length <= 50, 'Too many keys')

export const insightsReportSchema = z.object({
  schema: z.literal(1),
  id: z.uuid(),
  version: z.string().min(1).max(32),
  uptime: count,
  os: z.object({
    platform: z.string().max(32),
    arch: z.string().max(32),
    containerized: z.boolean(),
    nodeVersion: z.string().max(32)
  }),
  library: z.object({
    songs: count,
    musicFolders: count,
    fileExtensions: countsByKey
  }),
  users: z.object({
    total: count,
    listeners7d: count
  }),
  usage7d: z.object({
    metadataEdits: count,
    editedSongs: count,
    listens: count
  }),
  features: z.object({
    smartPlaylists: count,
    savedFilters: count,
    sharedLinks: count,
    scrobbleAccounts: countsByKey
  })
})

export type InsightsReport = z.infer<typeof insightsReportSchema>
