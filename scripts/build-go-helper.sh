#!/usr/bin/env bash
set -euo pipefail

# Cross-compile Go helper binary for major platforms
# Usage: ./scripts/build-go-helper.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GO_HELPER_DIR="$PROJECT_DIR/src/analyzer/go/go-helper"
OUTPUT_DIR="$PROJECT_DIR/dist/go-helper"

mkdir -p "$OUTPUT_DIR"

echo "Building Go helper from $GO_HELPER_DIR..."
cd "$GO_HELPER_DIR"

# Build targets: OS/ARCH
TARGETS=(
  "darwin/arm64"
  "darwin/amd64"
  "linux/amd64"
  "linux/arm64"
  "windows/amd64"
)

for target in "${TARGETS[@]}"; do
  IFS='/' read -r goos goarch <<< "$target"
  output_name="go-helper-${goos}-${goarch}"
  if [ "$goos" = "windows" ]; then
    output_name="${output_name}.exe"
  fi

  echo "  Building ${goos}/${goarch}..."
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -ldflags="-s -w" -o "$OUTPUT_DIR/$output_name" .
done

echo ""
echo "Built binaries:"
ls -la "$OUTPUT_DIR/"
echo ""
echo "Done! Binaries are in $OUTPUT_DIR/"
