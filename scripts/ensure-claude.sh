#!/bin/bash
# ensure-claude.sh — Ensures Claude Code CLI is available in PATH after workspace restart
# 2026-04-13: Created for persistent Claude Code availability in Replit workspace

CLAUDE_VERSIONS_DIR="/home/runner/workspace/.local/share/claude/versions"
CLAUDE_SYMLINK="/home/runner/.local/bin/claude"

# Find the latest installed version
if [ -d "$CLAUDE_VERSIONS_DIR" ]; then
    LATEST_VERSION=$(ls "$CLAUDE_VERSIONS_DIR" | sort -V | tail -1)
    CLAUDE_BINARY="$CLAUDE_VERSIONS_DIR/$LATEST_VERSION"

    if [ -x "$CLAUDE_BINARY" ]; then
        # Ensure ~/.local/bin exists
        mkdir -p "$(dirname "$CLAUDE_SYMLINK")"

        # Create/update symlink if needed
        if [ ! -L "$CLAUDE_SYMLINK" ] || [ "$(readlink "$CLAUDE_SYMLINK")" != "$CLAUDE_BINARY" ]; then
            ln -sf "$CLAUDE_BINARY" "$CLAUDE_SYMLINK"
            echo "Claude Code linked: $LATEST_VERSION"
        fi
    fi
fi

# Ensure ~/.local/bin is in PATH
if [[ ":$PATH:" != *":/home/runner/.local/bin:"* ]]; then
    export PATH="/home/runner/.local/bin:$PATH"
fi
