#!/usr/bin/env bash
# Build and run PiFriction against a course/project directory.
# Usage: ./run-pifriction.sh [path-to-project]
set -euo pipefail

PROJECT_DIR="${1:-$HOME/scratch/CST334}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
IMAGE_NAME="${PIFRICTION_IMAGE:-pifriction}"

# Load local development credentials without committing them. Lines already
# exported by .env remain valid; bare KEY=value lines are exported by set -a.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${PIFRICTION_ANTHROPIC_API_KEY:-}" && -n "${ANTHROPIC_API_KEY:-}" ]]; then
  export PIFRICTION_ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
fi

if [[ -z "${PIFRICTION_ANTHROPIC_API_KEY:-}" ]]; then
  echo "Missing ANTHROPIC_API_KEY (or PIFRICTION_ANTHROPIC_API_KEY)." >&2
  echo "Export it or add it to .env, then run this script again." >&2
  exit 1
fi

docker build -t "$IMAGE_NAME" .
exec docker run -it --rm \
  -v "$PROJECT_DIR":/data \
  -e PIFRICTION_ANTHROPIC_API_KEY \
  "$IMAGE_NAME"
