import json
import time
from datetime import UTC, datetime
from pathlib import Path

import requests
from loguru import logger

from websocket import GapTracker, MarketChannel

GAMMA_API = "https://gamma-api.polymarket.com/events"
MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
WINDOW = 300  # 5 minutes in seconds


def write_meta(market_dir, interval_epoch, start_ms, end_ms, rtds_gaps, market_gaps):
    r_gaps = rtds_gaps.gaps_in_range(start_ms, end_ms)
    m_gaps = market_gaps.gaps_in_range(start_ms, end_ms)
    complete = len(r_gaps) == 0 and len(m_gaps) == 0

    meta = {
        "interval_epoch": interval_epoch,
        "complete": complete,
        "rtds_gaps": r_gaps,
        "market_channel_gaps": m_gaps,
        "collected_at": datetime.now(UTC).isoformat(),
    }

    with open(market_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    logger.info(f"[meta] {interval_epoch} complete={complete}")


def fetch_event(slug, retries=6, delay=10):
    """Fetch event.json from Gamma API with retries."""
    url = f"{GAMMA_API}?slug={slug}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data:
                return data[0] if isinstance(data, list) else data
        except (requests.RequestException, ValueError) as e:
            logger.warning(f"[gamma] attempt {attempt + 1}/{retries} failed: {e}")
        if attempt < retries - 1:
            time.sleep(delay)
    return None


class Collector:
    def __init__(self, rtds, data_dir):
        self.rtds = rtds
        self.data_dir = Path(data_dir) / "btc-updown-5m"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._current_market_ch = None

    def run(self):
        """Main loop: process one interval at a time."""
        next_epoch = self._next_epoch()
        wait = next_epoch - time.time()
        if wait > 0:
            logger.info(
                f"[collector] waiting {wait:.0f}s for first interval {next_epoch}"
            )
            time.sleep(wait)

        while True:
            interval_epoch = self._current_epoch()
            self._process_interval(interval_epoch)

    def _process_interval(self, interval_epoch):
        logger.info(f"[interval] {interval_epoch}")
        slug = f"btc-updown-5m-{interval_epoch}"
        market_dir = self.data_dir / str(interval_epoch)
        raw_dir = market_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        # Fetch and save event.json
        event_data = fetch_event(slug)
        if event_data:
            with open(market_dir / "event.json", "w") as f:
                json.dump(event_data, f, indent=2)

            # Start MarketChannel
            token_ids = json.loads(event_data["markets"][0]["clobTokenIds"])
            market_ch = MarketChannel(MARKET_WS, raw_dir, token_ids)
            market_ch.start()
            self._current_market_ch = market_ch
        else:
            logger.error(f"[interval] {interval_epoch} — failed to fetch event.json")
            market_ch = None
            self._current_market_ch = None

        # Wait for interval to end + 30s grace for resolution event
        end_time = interval_epoch + WINDOW + 30
        while time.time() < end_time:
            time.sleep(1)

        # Flush RTDS buffer for this interval
        start_ms = interval_epoch * 1000
        end_ms = (interval_epoch + WINDOW) * 1000
        self.rtds.flush(raw_dir, start_ms, end_ms)

        # Write meta.json
        write_meta(
            market_dir,
            interval_epoch,
            interval_epoch * 1000,
            end_ms,
            self.rtds.gaps,
            market_ch.gaps if market_ch else GapTracker(),
        )

        # Stop MarketChannel
        if market_ch:
            market_ch.stop()

    def _current_epoch(self):
        now = time.time()
        return int(now - (now % WINDOW))

    def _next_epoch(self):
        now = time.time()
        return int(now - (now % WINDOW) + WINDOW)
