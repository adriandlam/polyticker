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
- `storage.py` — builds tar.gz archive + meta.json sidecar per interval, uploads to R2, deletes local copy
- `worker/src/index.ts` — Cloudflare Worker: REST API serving data from R2 bucket
- `worker/src/bulk.ts` — archive endpoint: serves pre-built tar.gz from R2 or returns JSON archive listing with sizes

### R2 data structure

```
btc-updown-5m/
  {epoch}.tar.gz         # flattened archive (event.json, chainlink.jsonl, binance.jsonl, market.jsonl)
  {epoch}.meta.json      # sidecar metadata (complete, gaps, collected_at)
```

### Worker API

- `GET /{market}/` — JSON directory listing (or archive list with `Accept: application/gzip`)
- `GET /{market}/?from=X&to=Y` — filtered archive list with `Accept: application/gzip`
- `GET /{market}/{epoch}.tar.gz` — serve individual archive
- `GET /{market}/{epoch}.meta.json` — serve interval metadata

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

## Deployment

Collector runs as a systemd service on VPS (`polyticker.service`), with `.env` loaded via `EnvironmentFile`.

## Gotchas

- `data/` is gitignored — all collected data lives in R2, not the repo
- Pre-commit hooks run ruff + format + uv-lock automatically; don't bypass them
- Collector sleeps until next 5-minute boundary before starting
- RTDS buffer is 10 minutes; flush must happen within that window
- Worker tests use `@cloudflare/vitest-pool-workers` (runs in workerd runtime, not Node)
- R2 boto3 client requires `region_name="auto"` for list operations
