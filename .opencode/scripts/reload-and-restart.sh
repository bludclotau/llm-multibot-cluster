#!/bin/bash
set -euo pipefail

REGISTRY="/home/snerloc/discord-bots/bots.json"

sudo systemctl daemon-reload

for service in $(jq -r '.bots[].service' "$REGISTRY"); do
  echo "Restarting $service..."
  sudo systemctl restart "$service"
done

echo "All bot services restarted."
