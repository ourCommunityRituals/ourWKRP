#!/usr/bin/env python3
"""
Level 0 - SECURITY (ourWKRP pyramid)
=====================================
Runs FIRST. Gate: blocks every other level on failure.

Imports baseline checks from the canonical OCR-docs/shared/ modules
(vendored via tests/_shared/) and adds any OW-specific layer on top.

Matches the pattern established by:
  - ourSharedEvents/tests/level0_security.py
  - packages/flags/tests/level0_security.py
  - OCR-docs/ocr-docs-brain/tests/level0_security.py

Replaces the previous gitleaks-based secret scanning in CI (Linux-only
binary; incompatible with the self-hosted Windows runner). The
vendored security_gate.py covers the same ground (+ PII scan +
forbidden-URL scan + pragma audit) and runs uniformly across the fleet.
"""
from __future__ import annotations
import sys
from pathlib import Path

THIS_DIR = Path(__file__).parent
OW_REPO = THIS_DIR.parent
VENDORED_SHARED = THIS_DIR / '_shared'

sys.path.insert(0, str(VENDORED_SHARED))
try:
    import security_gate  # type: ignore
except ImportError as e:
    print('[FAIL]  vendored security_gate.py not importable from tests/_shared/')
    print(f'        looked at: {VENDORED_SHARED}')
    print(f'        error: {e}')
    print('        SECURITY GATE FAILS CLOSED - restore the vendored module.')
    print('        From OCR-docs: py shared/sync_to_repos.py')
    sys.exit(1)

results: list[tuple[str, str, str]] = []
passed = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global passed
    if ok:
        results.append((name, 'PASS', detail))
        passed += 1
    else:
        results.append((name, 'FAIL', detail))


# ─── Baseline (shared) ────────────────────────────────────────────────────
fails = security_gate.run_baseline(
    OW_REPO,
    allowlist_names=('security_gate.py', 'pragma_audit.py', 'level0_security.py', 'package-lock.json'),
    adjacent_ose=None,  # OW has no adjacent sec-iac suite; skip that step
    prod_code_dirs=('src',),
)
results.extend(fails)
baseline_check_names = ('secret_scan', 'pii_scan', 'forbidden_url_scan')
for n in baseline_check_names:
    if not any(r[0] == n and r[1] == 'FAIL' for r in fails):
        check(n, True, 'clean')

# ─── Pragma audit (fleet-wide policy) ────────────────────────────────────
try:
    import pragma_audit  # type: ignore
    pragma_fails = pragma_audit.run_audit(OW_REPO)
    if pragma_fails:
        for _, _, msg in pragma_fails:
            check('pragma_audit', False, msg)
    else:
        check('pragma_audit', True, 'policy clean')
except ImportError:
    check('pragma_audit', False,
          'vendored pragma_audit.py not importable from tests/_shared/ '
          '- run `cd OCR-docs && py shared/sync_to_repos.py`')

security_gate.report_and_exit(results, passed, header='LEVEL 0 - SECURITY (ourWKRP)')
