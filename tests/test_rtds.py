import json
import time

from websocket import RTDS

RTDS_WS = "wss://ws-live-data.polymarket.com"


def test_rtds_buffer_and_flush(tmp_path):
    rtds = RTDS(RTDS_WS)

    now_ms = int(time.time() * 1000)

    # Simulate buffered messages
    rtds._buffer.append({"payload": {"symbol": "btc/usd"}, "timestamp": now_ms - 5000})
    rtds._buffer.append({"payload": {"symbol": "btcusdt"}, "timestamp": now_ms - 3000})
    rtds._buffer.append({"payload": {"symbol": "btc/usd"}, "timestamp": now_ms - 1000})
    # One outside the window
    rtds._buffer.append(
        {"payload": {"symbol": "btc/usd"}, "timestamp": now_ms - 900_001}
    )

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    rtds.flush(raw_dir, now_ms - 900_000, now_ms)

    chainlink = [
        json.loads(line)
        for line in (raw_dir / "chainlink.jsonl").read_text().splitlines()
    ]
    binance = [
        json.loads(line)
        for line in (raw_dir / "binance.jsonl").read_text().splitlines()
    ]

    assert len(chainlink) == 2  # only the two in-range btc/usd ticks
    assert len(binance) == 1


def test_rtds_flush_empty_window(tmp_path):
    rtds = RTDS(RTDS_WS)
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    now_ms = int(time.time() * 1000)
    rtds.flush(raw_dir, now_ms - 1000, now_ms)

    # Files should not be created if no data
    assert not (raw_dir / "chainlink.jsonl").exists()
    assert not (raw_dir / "binance.jsonl").exists()


def test_rtds_buffer_prune():
    rtds = RTDS(RTDS_WS)
    now_ms = int(time.time() * 1000)

    # Add old and new messages
    rtds._buffer.append(
        {"payload": {"symbol": "btc/usd"}, "timestamp": now_ms - 1_500_000}
    )
    rtds._buffer.append(
        {"payload": {"symbol": "btc/usd"}, "timestamp": now_ms - 100_000}
    )
    rtds._buffer.append({"payload": {"symbol": "btc/usd"}, "timestamp": now_ms})

    rtds._prune(now_ms)

    # Only messages within BUFFER_DURATION_MS should remain
    assert len(rtds._buffer) == 2
