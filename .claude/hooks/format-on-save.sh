#!/bin/bash
# Auto-format TypeScript/HTML files after Claude edits them

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format files we care about
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.html|*.json)
    if command -v npx &> /dev/null && [ -f "node_modules/.bin/prettier" ]; then
      npx prettier --write "$FILE_PATH" 2>/dev/null
    fi
    ;;
esac

exit 0
