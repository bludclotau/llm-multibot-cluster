#!/bin/bash
set -euo pipefail

# Thin wrapper around the paint-by-numbers deploy wizard.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WIZARD="$ROOT/scripts/deploy-wizard.js"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  exec node "$WIZARD" --help
fi

if [[ $# -ge 4 ]]; then
  NAME="$1"
  TOKEN="$2"
  CHANNELS="$3"
  MODEL="$4"
  shift 4
  TRAITS="${*:-Default helpful bot personality}"
  exec node "$WIZARD" \
    --name "$NAME" \
    --token "$TOKEN" \
    --channels "$CHANNELS" \
    --model "$MODEL" \
    --traits "$TRAITS" \
    --no-install
fi

exec node "$WIZARD" "$@"
