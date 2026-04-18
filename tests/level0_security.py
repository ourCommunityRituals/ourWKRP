#!/usr/bin/env python3
"""
Level 0 — SECURITY (ourWKRP pyramid)
=====================================
Runs FIRST. Gate: blocks every other level on failure.
Imports baseline checks from OCR-docs/shared/security_gate.py and adds
WKRP-specific checks (npm audit critical, gitleaks if installed, src/ scan).
"""
import shutil
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).parent
WKRP_REPO = THIS_DIR.parent
SHARED = (WKRP_REPO.parent / 'OCR-docs' / 'shared').resolve()

sys.path.insert(0, str(SHARED))
try:
    import security_gate
except ImportError as e:
    print('[FAIL]  shared security_gate.py not importable from OCR-docs/shared/')
    print(f'        looked at: {SHARED}')
    print(f'        error: {e}')
    print('        SECURITY GATE FAILS CLOSED — fix the shared module path before continuing.')
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


fails = security_gate.run_baseline(
    WKRP_REPO,
    allowlist_names=('security_gate.py', 'level0_security.py', 'package-lock.json'),
    prod_code_dirs=('src',),
)
results.extend(fails)
baseline_check_names = ('secret_scan', 'pii_scan', 'forbidden_url_scan')
for n in baseline_check_names:
    if not any(r[0] == n and r[1] == 'FAIL' for r in fails):
        check(n, True, 'clean')

if (WKRP_REPO / 'package.json').exists() and shutil.which('npm'):
    try:
        r = subprocess.run(['npm', 'audit', '--audit-level=critical', '--json'],
                           cwd=str(WKRP_REPO), capture_output=True, text=True, timeout=60,
                           shell=(sys.platform == 'win32'))
        ok = r.returncode == 0
        check('npm_audit_critical', ok, 'no critical vulns' if ok else 'critical vulnerabilities present')
    except subprocess.TimeoutExpired:
        check('npm_audit_critical', False, 'npm audit timeout after 60s')

if shutil.which('gitleaks'):
    try:
        r = subprocess.run(['gitleaks', 'detect', '--source', str(WKRP_REPO), '--no-banner', '--no-git'],
                           capture_output=True, text=True, timeout=120,
                           shell=(sys.platform == 'win32'))
        ok = r.returncode == 0
        check('gitleaks_scan', ok, 'clean' if ok else 'gitleaks detected secrets')
    except subprocess.TimeoutExpired:
        check('gitleaks_scan', False, 'gitleaks timeout after 120s')

src = WKRP_REPO / 'src'
if src.exists():
    for ts_file in src.rglob('*.ts'):
        text = ts_file.read_text(encoding='utf-8', errors='ignore')
        if '\n' in text:
            for ln, line in enumerate(text.splitlines(), 1):
                if 'eval(' in line and not line.strip().startswith('//'):
                    rel = ts_file.relative_to(WKRP_REPO)
                    check(f'no_eval:{rel}:{ln}', False, 'eval() in TypeScript source')

security_gate.report_and_exit(results, passed, header='LEVEL 0 — SECURITY (ourWKRP)')
