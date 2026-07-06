#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────
#  OpenCode Bot Creator
#  Usage: ./create-bot.sh <name> <token> <channels> <model> [traits...]
# ─────────────────────────────────────────────
BOTS_DIR="/home/snerloc/discord-bots"
REGISTRY="$BOTS_DIR/bots.json"
TEMPLATES_DIR="$BOTS_DIR/.opencode/templates"

NAME="${1:?Usage: $0 <name> <token> <channels> <model> [traits...]}"
TOKEN="${2:?Missing Discord token}"
CHANNELS="${3:?Missing comma-separated channel IDs}"
MODEL="${4:?Missing model name}"
shift 4
TRAITS="${*:-Default helpful bot personality}"

DIR="$BOTS_DIR/$NAME"
PERSONA_FILE="$DIR/personas/$NAME.txt"
SERVICE_NAME="$NAME.service"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME"
CHANNELS_JSON=$(echo "$CHANNELS" | tr ',' '\n' | sed 's/.*/"&"/' | paste -sd ',' - | sed 's/^/[/;s/$/]/')

# Create bot directory and persona
mkdir -p "$DIR/personas"
if [ ! -f "$PERSONA_FILE" ]; then
  sed -e "s/{{name}}/$NAME/g" \
      -e "s/{{traits}}/$TRAITS/g" \
      "$TEMPLATES_DIR/persona.tpl" > "$PERSONA_FILE"
  echo "Created persona: $PERSONA_FILE"
fi

# Register in bots.json
if ! jq -e ".bots[] | select(.name == \"$NAME\")" "$REGISTRY" > /dev/null 2>&1; then
  jq ".bots += [{
    \"name\": \"$NAME\",
    \"directory\": \"$NAME\",
    \"service\": \"$SERVICE_NAME\",
    \"persona\": \"$NAME/personas/$NAME.txt\",
    \"channels\": $CHANNELS_JSON,
    \"model\": \"$MODEL\"
  }]" "$REGISTRY" > "$REGISTRY.tmp" && mv "$REGISTRY.tmp" "$REGISTRY"
  echo "Registered $NAME in bots.json"
fi

# Generate systemd service
sudo sed -e "s/{{name}}/$NAME/g" \
    -e "s|{{token}}|$TOKEN|g" \
    -e "s|{{directory}}|$NAME|g" \
    -e "s|{{persona}}|$NAME/personas/$NAME.txt|g" \
    -e "s|{{model}}|$MODEL|g" \
    -e "s|{{channels}}|$CHANNELS|g" \
    "$TEMPLATES_DIR/systemd.service.tpl" | sudo tee "$SERVICE_FILE" > /dev/null

echo "Created systemd service: $SERVICE_FILE"

# Reload systemd and enable
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
echo "Service $SERVICE_NAME started."

echo "Bot $NAME created and deployed."
