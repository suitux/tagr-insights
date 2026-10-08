// Local-only: prints SQL that fills daily_summaries with ~14 months of fake, growing history,
// so the dashboard can be checked before real reports exist. Usage: pnpm seed:local
const DAYS = 420
const today = new Date()
const lines = ['DELETE FROM daily_summaries;']

for (let offset = DAYS; offset >= 1; offset--) {
  const date = new Date(today)
  date.setUTCDate(date.getUTCDate() - offset)
  const day = date.toISOString().slice(0, 10)

  const progress = (DAYS - offset) / DAYS
  const noise = 1 + (Math.sin(offset * 1.7) * 0.04)
  const instances = Math.round((20 + 480 * progress ** 1.5) * noise)
  const share = value => Math.round(instances * value)

  // A new minor release every ~90 days, adopted over a few weeks
  const releases = Math.floor((DAYS - offset) / 90)
  const daysSinceRelease = (DAYS - offset) % 90
  const adoption = Math.min(0.8, daysSinceRelease / 30)
  const versions = {}
  const current = `1.${releases}`
  const previous = `1.${releases - 1}`
  if (releases === 0) versions[current] = instances
  else {
    versions[current] = share(adoption)
    versions[previous] = share(1 - adoption) - share(0.05)
    versions[`1.${Math.max(0, releases - 2)}`] = (versions[`1.${Math.max(0, releases - 2)}`] ?? 0) + share(0.05)
  }

  const songsPerInstance = 9000 + 3000 * progress
  const summary = {
    instances,
    versions,
    platforms: { 'linux/x64': share(0.62), 'linux/arm64': share(0.3), 'darwin/arm64': share(0.05), 'win32/x64': share(0.03) },
    containerized: { docker: share(0.88), bare: share(0.12) },
    librarySizes: { '0': share(0.04), '1-1k': share(0.16), '1k-10k': share(0.42), '10k-50k': share(0.3), '50k-100k': share(0.06), '100k+': share(0.02) },
    fileExtensions: {
      flac: Math.round(instances * songsPerInstance * 0.55),
      mp3: Math.round(instances * songsPerInstance * 0.33),
      m4a: Math.round(instances * songsPerInstance * 0.08),
      opus: Math.round(instances * songsPerInstance * 0.02),
      ogg: Math.round(instances * songsPerInstance * 0.02)
    },
    features: {
      smartPlaylists: share(0.1 + 0.25 * progress),
      savedFilters: share(0.15),
      sharedLinks: share(0.07),
      scrobbling: share(progress > 0.3 ? 0.2 * (progress - 0.3) / 0.7 : 0),
      multiUser: share(0.12),
      metadataEditing: share(0.55)
    },
    totals: {
      songs: Math.round(instances * songsPerInstance),
      users: Math.round(instances * 1.3),
      metadataEdits7d: share(140 * noise),
      listens7d: share(260 * noise)
    }
  }

  lines.push(`INSERT INTO daily_summaries (day, data) VALUES ('${day}', '${JSON.stringify(summary)}');`)
}

console.log(lines.join('\n'))
