# Polyticker

Raw data collector for [Polymarket](https://polymarket.com) BTC up/down 5-minute prediction markets. Captures all WebSocket events needed to replay markets for backtesting.

## What it collects

Every 5-minute interval, Polyticker captures:

- **Chainlink oracle prices** — the on-chain BTC/USD reference used for market resolution
- **Binance BTC/USDT prices** — exchange price feed via Polymarket's RTDS
- **CLOB market events** — order book changes, trades, and resolution events
- **Event metadata** — full Gamma API response with market parameters

All data is stored as raw WebSocket payloads in JSONL format. Nothing is normalized or derived — you get exactly what the APIs send.

## Quickstart

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/adriandlam/polyticker
cd polyticker
uv sync
uv run python main.py
```

The collector waits for the next 5-minute boundary, then starts recording. Data is written to `data/btc-updown-5m/`. Press Ctrl+C to stop.

## How it works

1. **RTDS WebSocket** connects once and stays connected, buffering Chainlink and Binance price events in memory
2. Each interval, a **Gamma API** call fetches event metadata (token IDs, market parameters)
3. A **Market Channel WebSocket** opens per interval, streaming CLOB events directly to disk
4. At interval end (+30s grace for resolution), the RTDS buffer is flushed to disk and `meta.json` is written
5. Connection gaps are tracked — `meta.json` flags whether the interval has complete data

## Tests

```bash
uv run pytest tests/ -v
```

---

# Data Schema

All raw data is stored as verbatim WebSocket payloads. Folder names are Unix seconds (interval start epoch). Each message has a source `timestamp` field (Unix ms) for chronological ordering.

## Directory structure

```
data/btc-updown-5m/
├── 1771982700/              # epoch from ticker "btc-updown-5m-1771982700"
│   ├── event.json           # Gamma API event response (write-once)
│   ├── meta.json            # collection completeness
│   └── raw/
│       ├── chainlink.jsonl  # Chainlink oracle ticks (RTDS)
│       ├── binance.jsonl    # Binance BTC price ticks (RTDS)
│       └── market.jsonl     # CLOB market channel events
├── 1771983000/              # next interval (300s later)
│   └── ...
└── ...                      # ~288 folders per day
```

Each folder is one market. Self-contained, replayable, deletable.

## `event.json`

Full Gamma API response, stored verbatim. Never rewritten.

Source: `GET https://gamma-api.polymarket.com/events?slug={ticker}`

Key fields:

| Field | Use |
|-------|-----|
| `ticker` | Extract interval epoch: `int(ticker.split("-")[-1])` |
| `markets[0].eventStartTime` | Interval start |
| `markets[0].endDate` | Interval end |
| `markets[0].clobTokenIds` | Token IDs for WS subscription |
| `markets[0].outcomePrices` | Initial implied probabilities |
| `markets[0].feeType` | Fee tier |
| `markets[0].makerBaseFee` / `takerBaseFee` | Fees in bps |

## `meta.json`

Written at end of each interval. Reports collection health.

```json
{
  "interval_epoch": 1771982700,
  "complete": true,
  "rtds_gaps": [],
  "market_channel_gaps": [],
  "collected_at": "2026-02-25T01:30:30Z"
}
```

`complete` is `true` when both RTDS and Market Channel had zero connection gaps during the interval.

## `raw/chainlink.jsonl`

Raw RTDS payloads for Chainlink BTC/USD. **Resolution source of truth** — Polymarket uses Chainlink to determine up/down outcome.

```jsonc
{"topic":"crypto_prices_chainlink","type":"update","payload":{"symbol":"btc/usd","price":"96220.30","timestamp":1771982700123},"timestamp":1771982700130}
```

Source: RTDS `crypto_prices_chainlink`, filter `btc/usd`.

## `raw/binance.jsonl`

Raw RTDS payloads for Binance BTC/USDT price updates.

```jsonc
{"topic":"crypto_prices","type":"update","payload":{"symbol":"btcusdt","price":"96233.80","change24h":"-1.23","volume24h":"45000.5"},"timestamp":1771982700089}
```

Source: RTDS `crypto_prices`, type `update`.

> **Note:** Captures price ticks only (no trades or order book). For richer Binance data, connect directly to Binance WebSocket.

## `raw/market.jsonl`

Raw CLOB market channel payloads. All events from market creation through resolution.

```jsonc
{"event_type":"price_change","asset_id":"11452395...","price":"0.48","timestamp":"1771982700100"}
{"event_type":"last_trade_price","asset_id":"11452395...","price":"0.48","timestamp":"1771982700200"}
{"event_type":"market_resolved","asset_id":"11452395...","winning_outcome":"Up","timestamp":"1771983000500"}
```

| `event_type` | Description |
|--------------|-------------|
| `price_change` | Order placed/cancelled |
| `last_trade_price` | Trade executed |
| `tick_size_change` | Tick size updated |
| `market_resolved` | Market settled |

Source: `wss://ws-subscriptions-clob.polymarket.com/ws/market` with `custom_feature_enabled: true`.

---

# Replay

```python
import json
from pathlib import Path

for folder in sorted(Path("data/btc-updown-5m").iterdir()):
    if not folder.is_dir():
        continue
    meta = json.load(open(folder / "meta.json"))
    if not meta["complete"]:
        continue

    events = []
    for raw_file in (folder / "raw").glob("*.jsonl"):
        events.extend(json.loads(line) for line in open(raw_file))
    events.sort(key=lambda e: int(e["timestamp"]))

    for event in events:
        pass  # build state, backtest your model
```

---

# WebSocket subscriptions

### CLOB Market Channel
```json
{"assets_ids": ["<YES_token_id>", "<NO_token_id>"], "type": "market", "custom_feature_enabled": true}
```
Endpoint: `wss://ws-subscriptions-clob.polymarket.com/ws/market`

### RTDS — Chainlink BTC/USD
```json
{"action": "subscribe", "subscriptions": [{"topic": "crypto_prices_chainlink", "type": "*", "filters": "{\"symbol\":\"btc/usd\"}"}]}
```

### RTDS — Binance BTCUSDT
```json
{"action": "subscribe", "subscriptions": [{"topic": "crypto_prices", "type": "update"}]}
```

Endpoint: `wss://ws-live-data.polymarket.com`

---

## License

[MIT](LICENSE)
