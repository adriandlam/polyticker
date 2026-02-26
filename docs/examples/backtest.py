"""
Example backtest: download per-interval archives, replay all intervals, and compute
basic P&L for a naive "always bet Up" strategy.

Usage:
    python backtest.py https://polyticker.example.com 2026-02-25

Requires: requests (pip install requests)
"""

import io
import json
import sys
import tarfile
from datetime import UTC, datetime

import requests

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "https://polyticker.example.com"
DATE = sys.argv[2] if len(sys.argv) > 2 else "2026-02-25"


def main():
    # Convert date to epoch range
    dt = datetime.strptime(DATE, "%Y-%m-%d").replace(tzinfo=UTC)
    day_start = int(dt.timestamp())
    day_end = day_start + 86400 - 300  # last interval of the day

    # Get archive list for the day
    list_url = f"{BASE_URL}/btc-updown-5m/?from={day_start}&to={day_end}"
    print(f"Fetching archive list: {list_url}")
    resp = requests.get(list_url, headers={"Accept": "application/gzip"})
    resp.raise_for_status()
    archive_list = resp.json()["archives"]
    print(f"Found {len(archive_list)} intervals")

    results = []

    for entry in archive_list:
        epoch = entry["epoch"]
        archive_url = f"{BASE_URL}{entry['url']}"
        resp = requests.get(archive_url)
        resp.raise_for_status()

        archive = tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz")
        files = {
            m.name: archive.extractfile(m).read()
            for m in archive.getmembers()
            if m.isfile()
        }

        event = json.loads(files.get("event.json", "{}"))
        if not event:
            continue

        meta = json.loads(files.get("meta.json", "{}"))
        if not meta.get("complete", False):
            continue

        events = []
        for key in ("chainlink.jsonl", "binance.jsonl", "market.jsonl"):
            raw = files.get(key, b"")
            for line in raw.decode().strip().split("\n"):
                if line:
                    events.append(json.loads(line))

        events.sort(key=lambda e: int(e.get("timestamp", 0)))

        resolution = None
        for e in events:
            if e.get("event_type") == "market_resolved":
                resolution = e.get("winning_outcome")
                break

        market = event.get("markets", [{}])[0]
        prices = json.loads(market.get("outcomePrices", "[]"))
        if len(prices) < 1:
            continue

        buy_price = float(prices[0])
        pnl = (1.0 - buy_price) if resolution == "Up" else -buy_price

        results.append(
            {
                "epoch": epoch,
                "buy_price": buy_price,
                "resolution": resolution,
                "pnl": round(pnl, 4),
            }
        )

    total_pnl = sum(r["pnl"] for r in results)
    wins = sum(1 for r in results if r["pnl"] > 0)
    total = len(results)

    print(f"\n{'=' * 50}")
    print(f"Date: {DATE}")
    print(f"Intervals: {total}")
    if total:
        print(f"Wins: {wins}/{total} ({100 * wins / total:.1f}%)")
    else:
        print("No data")
    print(f"Total P&L: {total_pnl:+.4f}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
