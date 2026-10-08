# Tagr Insights

Collects the anonymous daily usage report sent by [Tagr](https://github.com/suitux/Tagr) instances and serves
the aggregated history behind the public dashboard at <https://tagr.xavirincon.com/insights/>.

Modelled on [Navidrome Insights](https://github.com/navidrome/insights), rebuilt as a single Cloudflare Worker
with D1 instead of a Go server writing to disk. It runs entirely on Cloudflare's free tier.

## How it works

```
Tagr instance ──POST /collect (once a day)──▶ Worker ──▶ D1: reports (one row per instance per UTC day)
                                                │
                                cron 00:05 UTC  ▼
                                    D1: daily_summaries (kept forever = the history)
                                                │
Dashboard (landing site) ──GET /summary.json?range=30d|90d|1y|all──┘
```

- **`POST /collect`**: validates the report with zod (unknown keys are dropped), rejects bodies over 32 KB and
  upserts it keyed by `(instance_id, day)`, so a restart that sends twice in a day does not count twice.
  The IP and headers are never stored.
- **Cron** (`scheduled`): re-summarizes the last 3 closed days, then deletes raw reports older than 90 days.
  Summaries are never deleted; they are the dashboard's history.
- **`GET /summary.json`**: daily points for `30d`/`90d`, weekly points for `1y`/`all`, plus `totalInstances`.
  Trailing days whose instance count dropped more than 20% are left out as incomplete. CORS is limited to
  `ALLOWED_ORIGINS`. Cached for an hour.

The report schema lives in `src/schema.ts` and mirrors `InsightsData` in Tagr
(`src/features/insights/domain.ts`). Change both together and bump `schema` when a field changes meaning.

## Development

```bash
pnpm install
pnpm db:migrate:local      # create the local D1 database
pnpm seed:local            # optional: ~14 months of fake history for the dashboard
pnpm dev                   # http://localhost:8787, with /__scheduled to trigger the cron
pnpm test
```

Point a Tagr build at it with `TAGR_INSIGHTS_DEBUG=1 TAGR_INSIGHTS_ENDPOINT=http://localhost:8787/collect`
(sends right away instead of after 30 minutes), and the landing site with
`PUBLIC_INSIGHTS_API=http://localhost:8787 pnpm dev`.

## First deployment

1. `pnpm wrangler login`
2. `pnpm wrangler d1 create tagr-insights` and paste the printed `database_id` into `wrangler.toml`.
3. `pnpm db:migrate:remote`
4. `pnpm deploy`. The custom domain `tagr-insights.xavirincon.com` is created on the `xavirincon.com` zone
   together with its certificate.
5. For deploys from GitHub Actions, add the `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1 and Workers Routes:
   edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

Shields.io badge for the Tagr README:

```
https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ftagr-insights.xavirincon.com%2Fsummary.json&query=%24.totalInstances&label=installations
```

## License

AGPL-3.0-only, like Tagr.
