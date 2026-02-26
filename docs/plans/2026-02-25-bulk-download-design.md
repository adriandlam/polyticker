# Bulk Download Endpoint Design

## Problem

Downloading data for backtesting requires many individual HTTP requests (one per interval or per daily archive). We need a single-request bulk download that returns a tar.gz of all intervals in an epoch range.

## Endpoint

```
GET /archives/{market}/bulk?from={epoch}&to={epoch}
```

### Example

```
GET /archives/btc-updown-5m/bulk?from=1771995300&to=1771996200
```

Returns a `.tar.gz` containing:

```
1771995300/
  event.json
  meta.json
  raw/chainlink.jsonl
  raw/binance.jsonl
  raw/market.jsonl
1771995600/
  event.json
  meta.json
  raw/...
1771995900/
  ...
```

## Behavior

1. Validate `from` and `to` are numeric, `from <= to`
2. List R2 objects under `{market}/` prefix, filter intervals where `from <= epoch <= to`
3. If matching intervals > 288, return `413` error (safety cap ~1 day of data)
4. For each matching interval, fetch all files (`event.json`, `meta.json`, `raw/*.jsonl`)
5. Build tar.gz in memory using existing `createTarGz()` utility
6. Return as response

## Response

### Success

- `Content-Type: application/gzip`
- `Content-Disposition: attachment; filename="{market}_{from}_{to}.tar.gz"`
- `Cache-Control: public, max-age=86400`
- Body: tar.gz binary

### Errors

| Condition | Status | Error key |
|-----------|--------|-----------|
| Missing `from` or `to` | 400 | `bad_request` |
| Non-numeric `from`/`to` | 400 | `bad_request` |
| `from` > `to` | 400 | `bad_request` |
| Intervals > 288 | 413 | `range_too_large` |
| No intervals found | 404 | `not_found` |

### Error response format

```json
{
  "error": "range_too_large",
  "message": "Range contains 2000 intervals, max is 288. Narrow your from/to range.",
  "status": 413
}
```

## Constraints

- Max 288 intervals per request (~1 day of 5-minute intervals)
- Built in-memory (bounded by interval cap, worst case ~17 MB uncompressed, ~5 MB compressed)
- Uses existing `createTarGz()` from `tar.ts`

## Client usage

```python
import httpx, tarfile, io

resp = httpx.get(
    f"{BASE}/archives/btc-updown-5m/bulk",
    params={"from": 1771995300, "to": 1771996200},
)
archive = tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz")

for member in archive.getmembers():
    if member.isfile():
        print(member.name)
```

```bash
curl -o data.tar.gz "https://polyticker.example.com/archives/btc-updown-5m/bulk?from=1771995300&to=1771996200"
tar xzf data.tar.gz
```
