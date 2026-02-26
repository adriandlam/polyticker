#!/usr/bin/env bash
# Common curl commands for the Polyticker REST API.

BASE_URL="https://polyticker.adriandlam.com"

# List available markets
curl -s "$BASE_URL/" | jq .

# List all archives with sizes
curl -s -H "Accept: application/gzip" "$BASE_URL/btc-updown-5m/" | jq .

# List archives in an epoch range
curl -s -H "Accept: application/gzip" "$BASE_URL/btc-updown-5m/?from=1771995300&to=1772081400" | jq .

# Download a single interval archive
curl -O "$BASE_URL/btc-updown-5m/1771995300.tar.gz"

# Fetch interval metadata (without downloading the archive)
curl -s "$BASE_URL/btc-updown-5m/1771995300.meta.json" | jq .
