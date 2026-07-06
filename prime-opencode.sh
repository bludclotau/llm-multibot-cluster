#!/usr/bin/env bash
set -e

echo "🔧 Priming directory for OpenCode…"

# Ensure we are inside a directory
if [ ! -d . ]; then
    echo "Error: Not inside a directory."
    exit 1
fi

# Create required directories
mkdir -p .opencode
mkdir -p src
mkdir -p config
mkdir -p plugins

# Create placeholder files
touch src/.keep
touch config/.keep
touch plugins/.keep
touch .opencode_sanity

# Create minimal project.json if missing
if [ ! -f .opencode/project.json ]; then
    cat > .opencode/project.json <<EOF
{
  "name": "$(basename "$PWD")",
  "version": "0.1.0",
  "description": "Primed OpenCode project scaffold"
}
EOF
fi

# Create placeholder README
if [ ! -f .opencode/README.md ]; then
    echo "# OpenCode Project Metadata" > .opencode/README.md
fi

echo "✅ Directory primed for OpenCode."
echo "You can now run: opencode init"
