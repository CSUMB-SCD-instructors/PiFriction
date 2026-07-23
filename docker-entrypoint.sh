#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/home/pifriction}"
mkdir -p "$HOME/.pi/agent"

# Convenience aliases for class-specific env vars. For production, prefer a
# proxy/token flow rather than distributing provider keys directly.
if [[ -n "${PIFRICTION_ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  export ANTHROPIC_API_KEY="$PIFRICTION_ANTHROPIC_API_KEY"
fi

if [[ -n "${PIFRICTION_OPENAI_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$PIFRICTION_OPENAI_API_KEY"
fi

if [[ -n "${PIFRICTION_BASE_URL:-}" && -z "${ANTHROPIC_BASE_URL:-}" ]]; then
  export ANTHROPIC_BASE_URL="$PIFRICTION_BASE_URL"
fi

cd /data

# Load this package every time without relying on mutable user settings. This
# keeps the classroom extension active even if students mount a persistent .pi.
exec pi -e /opt/pifriction "$@"
