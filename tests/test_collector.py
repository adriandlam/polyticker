import json
import time

from collector import write_meta
from websocket import GapTracker


def test_write_meta_complete(tmp_path):
    rtds_gaps = GapTracker()
    market_gaps = GapTracker()
    rtds_gaps.on_connect()
    market_gaps.on_connect()

    interval_epoch = 1771982700
    start_ms = interval_epoch * 1000
    end_ms = start_ms + 300_000

    write_meta(tmp_path, interval_epoch, start_ms, end_ms, rtds_gaps, market_gaps)

    meta = json.loads((tmp_path / "meta.json").read_text())
    assert meta["complete"] is True
    assert meta["interval_epoch"] == interval_epoch
    assert meta["rtds_gaps"] == []
    assert meta["market_channel_gaps"] == []


def test_write_meta_with_gaps(tmp_path):
    rtds_gaps = GapTracker()
    rtds_gaps.on_connect()
    rtds_gaps.on_disconnect()
    time.sleep(0.01)
    rtds_gaps.on_connect()

    market_gaps = GapTracker()
    market_gaps.on_connect()

    interval_epoch = 1771982700
    start_ms = 0
    end_ms = int(time.time() * 1000) + 10000

    write_meta(tmp_path, interval_epoch, start_ms, end_ms, rtds_gaps, market_gaps)

    meta = json.loads((tmp_path / "meta.json").read_text())
    assert meta["complete"] is False
    assert len(meta["rtds_gaps"]) == 1
