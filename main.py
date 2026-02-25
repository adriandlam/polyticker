import signal
import sys

from loguru import logger

from collector import Collector
from websocket import RTDS

RTDS_WS = "wss://ws-live-data.polymarket.com"
DATA_DIR = "data"


def main():
    rtds = RTDS(RTDS_WS)
    rtds.start()
    logger.info("[main] RTDS started")

    collector = Collector(rtds, DATA_DIR)

    def shutdown(sig, frame):
        logger.info("[main] shutting down...")
        rtds.stop()
        if collector._current_market_ch:
            collector._current_market_ch.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    collector.run()


if __name__ == "__main__":
    main()
