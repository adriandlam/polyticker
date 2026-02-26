# Polyticker

Raw data collector for Polymarket BTC up/down 5-minute prediction markets.
Two components: Python collector (writes to R2) and Cloudflare Worker (serves from R2).

## Commands

### Python collector
```bash
uv sync                        # install deps
uv run python main.py          # run collector (waits for next 5m boundary)
uv run pytest tests/ -v        # run tests
uv run ruff check . --fix      # lint + autofix
uv run ruff format .           # format
```

### Cloudflare Worker (worker/)
```bash
cd worker
pnpm install                   # install deps
pnpm dev                       # local dev server
pnpm deploy                    # deploy to Cloudflare
pnpm test                      # run vitest tests
```

## Architecture

- `main.py` — entry point, wires RTDS + Collector + optional R2 upload
- `websocket.py` — base WebSocket class with reconnect/gap-tracking; RTDS and MarketChannel subclasses
- `collector.py` — interval loop: fetches Gamma API metadata, records CLOB events, flushes RTDS buffer, writes meta.json
- `storage.py` — R2 upload via boto3 (S3-compatible), deletes local copy after upload
- `worker/src/index.ts` — Cloudflare Worker: REST API serving data from R2 bucket
- `worker/src/bulk.ts` — bulk download endpoint (tar.gz archives)
- `worker/src/tar.ts` — tar file construction utilities

## Code style

- Python 3.12+, managed by uv
- Ruff linting: rules E, F, I, UP (errors, pyflakes, isort, pyupgrade)
- Pre-commit hooks: ruff --fix, ruff-format, uv-lock (runs on every commit)
- TypeScript: no explicit linter configured for worker

## Environment

R2 upload is optional — collector runs without it. When enabled, set in `.env`:
```
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=polyticker
```

## Gotchas

- `data/` is gitignored — all collected data lives in R2, not the repo
- Pre-commit hooks run ruff + format + uv-lock automatically; don't bypass them
- Collector sleeps until next 5-minute boundary before starting
- RTDS buffer is 10 minutes; flush must happen within that window
- Worker tests use `@cloudflare/vitest-pool-workers` (runs in workerd runtime, not Node)
