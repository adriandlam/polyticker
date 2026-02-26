"""
Example backtest: download a daily archive, replay all intervals, and compute
basic P&L for a naive "always bet Up" strategy.

Usage:
    python backtest.py https://polyticker.example.com 2026-02-25

Requires: requests (pip install requests)
"""

import io
import json
import sys
import tarfile

import requests

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "https://polyticker.example.com"
DATE = sys.argv[2] if len(sys.argv) > 2 else "2026-02-25"


def main():
    url = f"{BASE_URL}/archives/btc-updown-5m/{DATE}.tar.gz"
    print(f"Downloading {url}")
    resp = requests.get(url)
    resp.raise_for_status()

    archive = tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz")

    # Group files by interval epoch
    intervals: dict[str, dict[str, bytes]] = {}
    for member in archive.getmembers():
        if not member.isfile():
            continue
        parts = member.name.split("/")
        epoch = parts[1]
        filename = "/".join(parts[2:])
        intervals.setdefault(epoch, {})[filename] = archive.extractfile(member).read()

    results = []

    for epoch in sorted(intervals):
        files = intervals[epoch]

        event = json.loads(files.get("event.json", "{}"))
        if not event:
            continue

        meta = json.loads(files.get("meta.json", "{}"))
        if not meta.get("complete", False):
            continue

        events = []
        for key in ("raw/chainlink.jsonl", "raw/binance.jsonl", "raw/market.jsonl"):
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
