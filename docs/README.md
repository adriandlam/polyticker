# Polyticker Data Archive

Historical [Polymarket](https://polymarket.com) BTC up/down 5-minute prediction market data. Raw WebSocket payloads — nothing normalized, nothing derived.

## Download archives

Per-interval tar.gz archives are available via the REST API:

```bash
# List all available archives (returns JSON with epoch, url, size)
curl -s -H "Accept: application/gzip" https://polyticker.adriandlam.com/btc-updown-5m/ | jq .

# Filter by epoch range
curl -s -H "Accept: application/gzip" "https://polyticker.adriandlam.com/btc-updown-5m/?from=1771995300&to=1772081400" | jq .

# Download a single interval
curl -O https://polyticker.adriandlam.com/btc-updown-5m/1771995300.tar.gz

# Check interval metadata (without downloading the archive)
curl -s https://polyticker.adriandlam.com/btc-updown-5m/1771995300.meta.json | jq .
```

Each archive contains one 5-minute interval (flattened):

```
1771995300.tar.gz
├── event.json          # Market metadata (Gamma API)
├── chainlink.jsonl     # Chainlink BTC/USD oracle prices
├── binance.jsonl       # Binance BTCUSDT prices
└── market.jsonl        # CLOB order book events
```

Sidecar `{epoch}.meta.json` contains collection health (completeness, gaps).

## REST API

```bash
# List available markets
curl -s https://polyticker.adriandlam.com/ | jq .

# List archives with sizes
curl -s -H "Accept: application/gzip" https://polyticker.adriandlam.com/btc-updown-5m/ | jq .

# Download an archive
curl -O https://polyticker.adriandlam.com/btc-updown-5m/1771995300.tar.gz

# Fetch metadata
curl -s https://polyticker.adriandlam.com/btc-updown-5m/1771995300.meta.json | jq .
```

All endpoints return JSON by default. Add `Accept: text/html` for browser-friendly directory listings. CORS is enabled (`*`).

## Data schema

See the [main README](../README.md#data-schema) for full schema documentation covering `event.json`, `meta.json`, and all JSONL formats.

## Backtest example

See [`examples/backtest.py`](examples/backtest.py) for a complete example that downloads archives, replays intervals chronologically, and computes basic P&L.
