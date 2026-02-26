import json
import threading
import time

from loguru import logger
from websockets.sync.client import connect


class GapTracker:
    """Tracks WebSocket connection gaps as (from_ms, to_ms) intervals."""

    def __init__(self):
        self._gaps = []
        self._disconnect_ts = None
        self._lock = threading.Lock()

    def on_connect(self):
        with self._lock:
            if self._disconnect_ts is not None:
                self._gaps.append(
                    {
                        "from": self._disconnect_ts,
                        "to": int(time.time() * 1000),
                    }
                )
                self._disconnect_ts = None

    def on_disconnect(self):
        with self._lock:
            if self._disconnect_ts is None:
                self._disconnect_ts = int(time.time() * 1000)

    def gaps_in_range(self, start_ms, end_ms):
        with self._lock:
            result = [
                g for g in self._gaps if g["to"] > start_ms and g["from"] < end_ms
            ]
            # Include ongoing disconnection (never reconnected)
            if self._disconnect_ts is not None and self._disconnect_ts < end_ms:
                result.append({"from": self._disconnect_ts, "to": end_ms})
            return result


class WebSocket:
    RECONNECT_BASE = 1
    RECONNECT_MAX = 30
    PING_INTERVAL = 5  # seconds
    STALE_TIMEOUT = 60  # force reconnect if no message received in N seconds

    def __init__(self, url):
        self.url = url
        self.gaps = GapTracker()
        self._stop = threading.Event()
        self._last_message_time = 0.0

    def subscribe(self, ws):
        """Send subscription message(s). Override in subclass."""

    def on_message(self, message):
        """Handle a parsed message. Override in subclass."""

    def run(self):
        backoff = self.RECONNECT_BASE
        while not self._stop.is_set():
            try:
                with connect(self.url, ping_interval=self.PING_INTERVAL) as ws:
                    self.gaps.on_connect()
                    logger.info(f"[ws] connected to {self.url}")
                    backoff = self.RECONNECT_BASE
                    self._last_message_time = time.time()
                    self.subscribe(ws)
                    while not self._stop.is_set():
                        try:
                            raw = ws.recv(timeout=1)
                        except TimeoutError:
                            if (
                                self.STALE_TIMEOUT
                                and time.time() - self._last_message_time
                                > self.STALE_TIMEOUT
                            ):
                                logger.warning(
                                    f"[ws] no data for {self.STALE_TIMEOUT}s, "
                                    f"forcing reconnect to {self.url}"
                                )
                                break
                            continue
                        self._last_message_time = time.time()
                        try:
                            message = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        self.on_message(message)
            except Exception as e:
                self.gaps.on_disconnect()
                if self._stop.is_set():
                    break
                logger.warning(f"[ws] disconnected: {e}, reconnecting in {backoff}s")
                self._stop.wait(backoff)
                backoff = min(backoff * 2, self.RECONNECT_MAX)

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def stop(self):
        self._stop.set()


class RTDS(WebSocket):
    BUFFER_DURATION_MS = 600_000  # 10 minutes

    def __init__(self, url):
        super().__init__(url)
        self._buffer = []
        self._buffer_lock = threading.Lock()

    def subscribe(self, ws):
        ws.send(
            json.dumps(
                {
                    "action": "subscribe",
                    "subscriptions": [
                        {
                            "topic": "crypto_prices_chainlink",
                            "type": "*",
                            "filters": '{"symbol":"btc/usd"}',
                        },
                    ],
                }
            )
        )
        ws.send(
            json.dumps(
                {
                    "action": "subscribe",
                    "subscriptions": [
                        {"topic": "crypto_prices", "type": "update"},
                    ],
                }
            )
        )

    def _route(self, message):
        symbol = message.get("payload", {}).get("symbol", "")
        if "/" in symbol:
            return "chainlink.jsonl"
        if symbol == "btcusdt":
            return "binance.jsonl"
        return None

    def on_message(self, message):
        route = self._route(message)
        if route is None:
            return
        with self._buffer_lock:
            self._buffer.append(message)
            if len(self._buffer) % 50 == 1:
                logger.debug(f"[rtds] buffer={len(self._buffer)} latest={route}")

    def _prune(self, now_ms):
        cutoff = now_ms - self.BUFFER_DURATION_MS
        with self._buffer_lock:
            self._buffer = [m for m in self._buffer if m["timestamp"] >= cutoff]

    def flush(self, raw_dir, start_ms, end_ms):
        with self._buffer_lock:
            window = [m for m in self._buffer if start_ms <= m["timestamp"] <= end_ms]

        files = {}
        for msg in window:
            fname = self._route(msg)
            if fname:
                files.setdefault(fname, []).append(msg)

        for fname, messages in files.items():
            with open(raw_dir / fname, "a") as f:
                for msg in messages:
                    f.write(json.dumps(msg) + "\n")

        now_ms = int(time.time() * 1000)
        self._prune(now_ms)


class MarketChannel(WebSocket):
    STALE_TIMEOUT = 0  # disable — market activity can be bursty

    def __init__(self, url, raw_dir, token_ids):
        super().__init__(url)
        self.raw_dir = raw_dir
        self.token_ids = token_ids

    def subscribe(self, ws):
        ws.send(
            json.dumps(
                {
                    "assets_ids": self.token_ids,
                    "type": "market",
                    "custom_feature_enabled": True,
                }
            )
        )

    def on_message(self, message):
        if not isinstance(message, dict) or not message.get("event_type"):
            return
        with open(self.raw_dir / "market.jsonl", "a") as f:
            f.write(json.dumps(message) + "\n")
