# Polyticker Data Archive

Historical [Polymarket](https://polymarket.com) BTC up/down 5-minute prediction market data. Raw WebSocket payloads — nothing normalized, nothing derived.

## Download archives

Daily tar.gz archives are available via the REST API:

```bash
# List available archives
curl -s https://polyticker.example.com/archives/btc-updown-5m/ | jq .

# Download a specific day
curl -O https://polyticker.example.com/archives/btc-updown-5m/2026-02-25.tar.gz

# Filter by date range
curl -s "https://polyticker.example.com/archives/btc-updown-5m/?from=2026-02-01&to=2026-02-07" | jq .
```

Each archive contains ~288 five-minute intervals:

```
2026-02-25/
├── 1740441600/
│   ├── event.json          # Market metadata (Gamma API)
│   ├── meta.json           # Collection health
│   └── raw/
│       ├── chainlink.jsonl # Chainlink BTC/USD oracle prices
│       ├── binance.jsonl   # Binance BTCUSDT prices
│       └── market.jsonl    # CLOB order book events
├── 1740441900/
│   └── ...
└── ...
```

## REST API

Fetch individual intervals programmatically:

```bash
# List all intervals
curl -s https://polyticker.example.com/btc-updown-5m/ | jq .

# Fetch a specific interval's files
curl -s https://polyticker.example.com/btc-updown-5m/1740441600/event.json | jq .
curl -s https://polyticker.example.com/btc-updown-5m/1740441600/raw/market.jsonl
```

All endpoints return JSON by default. Add `Accept: text/html` for browser-friendly directory listings. CORS is enabled (`*`).

## Data schema

See the [main README](../README.md#data-schema) for full schema documentation covering `event.json`, `meta.json`, and all JSONL formats.

## Backtest example

See [`examples/backtest.py`](examples/backtest.py) for a complete example that downloads an archive, extracts it, replays intervals chronologically, and computes basic P&L.
