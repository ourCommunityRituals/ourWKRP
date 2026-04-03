#!/bin/bash
# Block edits to sensitive config files
# Exit 2 = block the tool call

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROTECTED_PATTERNS=(
  "wrangler.toml"
  ".env"
  ".dev.vars"
  "doppler.yaml"
  "credentials"
  "secret"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "BLOCKED: Cannot edit protected file: $FILE_PATH" >&2
    echo "Reason: This file contains infrastructure config or secrets. Edit manually." >&2
    exit 2
  fi
done

exit 0
