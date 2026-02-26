#!/usr/bin/env bash
# Common curl commands for the Polyticker REST API.
# Replace BASE_URL with your deployment URL.

BASE_URL="https://polyticker.example.com"

# List available markets
curl -s "$BASE_URL/" | jq .

# List intervals for a market
curl -s "$BASE_URL/btc-updown-5m/" | jq .

# Fetch a specific interval's event metadata
curl -s "$BASE_URL/btc-updown-5m/1740441600/event.json" | jq .

# Fetch market events for replay
curl -s "$BASE_URL/btc-updown-5m/1740441600/raw/market.jsonl"

# List available daily archives
curl -s "$BASE_URL/archives/btc-updown-5m/" | jq .

# Download a daily archive
curl -O "$BASE_URL/archives/btc-updown-5m/2026-02-25.tar.gz"

# List archives for a date range
curl -s "$BASE_URL/archives/btc-updown-5m/?from=2026-02-01&to=2026-02-07" | jq .
