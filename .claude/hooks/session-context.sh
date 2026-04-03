#!/bin/bash
# Inject project context at session start

echo "=== ourWKRP Session ==="
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'not a git repo')"
echo "Last commit: $(git log --oneline -1 2>/dev/null || echo 'none')"
echo "Node modules: $([ -d node_modules ] && echo 'installed' || echo 'NOT INSTALLED — run npm install')"
echo "Doppler: $(command -v doppler &>/dev/null && echo 'available' || echo 'NOT FOUND — install doppler CLI')"
echo "========================"
