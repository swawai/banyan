#!/usr/bin/env sh
set -eu

EXAMPLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

cd "$EXAMPLE_DIR"

npm run dev
