import json

from websocket import MarketChannel

MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"


def test_market_channel_writes_events(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    mc = MarketChannel(MARKET_WS, raw_dir, ["token_a", "token_b"])

    # Simulate event messages
    mc.on_message({"event_type": "price_change", "asset_id": "token_a", "price": 0.48})
    mc.on_message(
        {"event_type": "last_trade_price", "asset_id": "token_a", "price": 0.49}
    )

    lines = (raw_dir / "market.jsonl").read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["event_type"] == "price_change"


def test_market_channel_skips_non_events(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    mc = MarketChannel(MARKET_WS, raw_dir, ["token_a", "token_b"])

    # Non-event messages (no event_type) should be skipped
    mc.on_message({"type": "heartbeat"})
    mc.on_message([])
    mc.on_message("ping")

    assert not (raw_dir / "market.jsonl").exists()


def test_market_channel_writes_resolution_event(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    mc = MarketChannel(MARKET_WS, raw_dir, ["token_a", "token_b"])

    mc.on_message(
        {
            "event_type": "market_resolved",
            "asset_id": "token_a",
            "winning_outcome": "Up",
        }
    )

    lines = (raw_dir / "market.jsonl").read_text().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["event_type"] == "market_resolved"
