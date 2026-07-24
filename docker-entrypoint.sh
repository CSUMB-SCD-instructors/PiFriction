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

if [[ -n "${PIFRICTION_OPENROUTER_API_KEY:-}" && -z "${OPENROUTER_API_KEY:-}" ]]; then
  export OPENROUTER_API_KEY="$PIFRICTION_OPENROUTER_API_KEY"
fi

if [[ -n "${PIFRICTION_BASE_URL:-}" && -z "${ANTHROPIC_BASE_URL:-}" ]]; then
  export ANTHROPIC_BASE_URL="$PIFRICTION_BASE_URL"
fi

cd /data

# Prefer OpenRouter when available, so a classroom can use its model gateway
# even when an Anthropic key is also exported. Otherwise use Anthropic directly.
# PIFRICTION_MODEL can select any configured Pi model; an explicit final
# --model argument also overrides this default.
if [[ -z "${PIFRICTION_MODEL:-}" ]]; then
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    PIFRICTION_MODEL="openrouter/~anthropic/claude-sonnet-latest"
  else
    PIFRICTION_MODEL="anthropic/claude-sonnet-4-5"
  fi
fi

# Load this package every time without relying on mutable user settings. This
# keeps the classroom extension active even if students mount a persistent .pi.
exec pi -e /opt/pifriction --model "$PIFRICTION_MODEL" "$@"
