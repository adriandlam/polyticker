import json
from unittest.mock import MagicMock

from storage import R2


def _make_interval(tmp_path):
    """Create a fake interval directory with sample data."""
    data_dir = tmp_path / "data"
    market_dir = data_dir / "btc-updown-5m" / "1772000000"
    raw_dir = market_dir / "raw"
    raw_dir.mkdir(parents=True)

    (market_dir / "event.json").write_text(json.dumps({"id": "test"}))
    (market_dir / "meta.json").write_text(json.dumps({"complete": True}))
    (raw_dir / "chainlink.jsonl").write_text('{"price": 100}\n')
    (raw_dir / "binance.jsonl").write_text('{"price": 99}\n')
    (raw_dir / "market.jsonl").write_text('{"event_type": "trade"}\n')

    return data_dir, market_dir


def test_upload_interval(tmp_path, monkeypatch):
    monkeypatch.setenv("R2_ENDPOINT", "https://fake.r2.dev")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET", "test-bucket")

    mock_client = MagicMock()
    monkeypatch.setattr("storage.boto3.client", lambda *a, **kw: mock_client)

    r2 = R2()
    data_dir, market_dir = _make_interval(tmp_path)

    r2.upload_interval(market_dir, data_dir)

    uploaded_keys = sorted(
        call.args[2] for call in mock_client.upload_file.call_args_list
    )
    assert uploaded_keys == [
        "btc-updown-5m/1772000000/event.json",
        "btc-updown-5m/1772000000/meta.json",
        "btc-updown-5m/1772000000/raw/binance.jsonl",
        "btc-updown-5m/1772000000/raw/chainlink.jsonl",
        "btc-updown-5m/1772000000/raw/market.jsonl",
    ]
    assert not market_dir.exists(), "local dir should be deleted after upload"


def test_upload_uses_correct_bucket(tmp_path, monkeypatch):
    monkeypatch.setenv("R2_ENDPOINT", "https://fake.r2.dev")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "my-bucket")

    mock_client = MagicMock()
    monkeypatch.setattr("storage.boto3.client", lambda *a, **kw: mock_client)

    r2 = R2()
    data_dir, market_dir = _make_interval(tmp_path)

    r2.upload_interval(market_dir, data_dir)

    for call in mock_client.upload_file.call_args_list:
        assert call.args[1] == "my-bucket"
