import time

from websocket import GapTracker


def test_gap_tracker_records_disconnect():
    gt = GapTracker()
    gt.on_connect()
    time.sleep(0.01)
    gt.on_disconnect()
    time.sleep(0.01)
    gt.on_connect()

    gaps = gt.gaps_in_range(0, int(time.time() * 1000) + 1000)
    assert len(gaps) == 1
    assert "from" in gaps[0] and "to" in gaps[0]
    assert gaps[0]["to"] > gaps[0]["from"]


def test_gap_tracker_no_gaps_when_connected():
    gt = GapTracker()
    gt.on_connect()
    gaps = gt.gaps_in_range(0, int(time.time() * 1000) + 1000)
    assert gaps == []


def test_gap_tracker_filters_by_range():
    gt = GapTracker()
    gt.on_connect()
    gt.on_disconnect()
    disconnect_time = int(time.time() * 1000)
    time.sleep(0.01)
    gt.on_connect()

    # Query a range entirely before the gap
    gaps = gt.gaps_in_range(0, disconnect_time - 10000)
    assert gaps == []
