/**
 * Mobile Workability Audit
 *
 * Enforces .ocr-standards/standards/OCR_STANDARD_mobileWorkability.md: every
 * customer-facing surface must be usable at a 375x812 viewport (iPhone 13 Mini
 * baseline). Five contracts, one violation reported per (surface, contract):
 *
 *   c1 — no horizontal scroll
 *   c2 — touch targets >= 44x44 px (WCAG 2.5.5; inline text-flow links exempt)
 *   c3 — input font-size >= 16 px (smaller triggers iOS pinch-zoom on focus)
 *   c4 — primary CTA visible above the fold
 *   c5 — viewport meta is mobile-correct and does not disable zoom
 *
 * Per the standard this audit is informational on PR and blocking on the
 * nightly schedule (see .github/workflows/mobile-workability.yml).
 */
import { test, expect } from '@playwright/test';

// OCR baseline viewport — overrides the device projects' viewports.
test.use({ viewport: { width: 375, height: 812 } });

interface Surface {
  name: string;
  path: string; // ':id' is replaced with a freshly registered DJ id
  auth: boolean; // gated page — register a DJ in the page context, expect no redirect
  cta: string[]; // data-testids; any one above the fold satisfies c4 (empty = c4 N/A)
}

const SURFACES: Surface[] = [
  { name: 'Landing (/)', path: '/', auth: false, cta: ['btn-bring', 'btn-browse', 'btn-connect'] },
  { name: 'Catalog', path: '/catalog', auth: false, cta: ['search-input'] },
  { name: 'Stats', path: '/stats', auth: false, cta: [] },
  { name: 'Create playlist', path: '/create', auth: true, cta: ['btn-create'] },
  { name: 'Import', path: '/import', auth: true, cta: ['upload-btn'] },
  { name: 'DJ dashboard', path: '/dashboard', auth: true, cta: ['start-set-btn'] },
  { name: 'Contributor profile', path: '/contributor/:id', auth: false, cta: [] },
  { name: 'DJ live set', path: '/dj/:id', auth: false, cta: [] },
  { name: 'DJ QR poster', path: '/dj/:id/poster', auth: false, cta: [] },
];

/** Measures all five contracts against the live DOM. Runs in the browser. */
function auditContracts(ctaTestids: string[]): string[] {
  const issues: string[] = [];
  const docEl = document.documentElement;

  // c1 — no horizontal scroll
  if (docEl.scrollWidth > docEl.clientWidth) {
    issues.push(`[c1] horizontal scroll: scrollWidth ${docEl.scrollWidth} > clientWidth ${docEl.clientWidth}`);
  }

  const idOf = (el: Element) =>
    el.getAttribute('data-testid') || (el as HTMLElement).id || el.tagName.toLowerCase();

  // c2 — touch targets >= 44x44 px
  const textFlow = new Set(['P', 'LI', 'DT', 'DD', 'SPAN', 'EM', 'STRONG', 'LABEL']);
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // not rendered / ancestor-hidden
    // WCAG 2.5.5 exemption: inline anchors inside text flow are not size-constrained.
    if (
      el.tagName === 'A' &&
      cs.display === 'inline' &&
      el.parentElement &&
      textFlow.has(el.parentElement.tagName)
    ) {
      continue;
    }
    if (rect.width < 44 || rect.height < 44) {
      issues.push(`[c2] touch target < 44x44: ${idOf(el)} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
    }
  }

  // c3 — input font-size >= 16 px
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const fontSize = parseFloat(cs.fontSize);
    if (fontSize < 16) {
      issues.push(`[c3] input font-size < 16px: ${idOf(el)} (${fontSize}px)`);
    }
  }

  // c4 — primary CTA visible above the fold
  if (ctaTestids.length > 0) {
    const fold = window.innerHeight;
    const ctaAboveFold = ctaTestids.some((tid) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return rect.top >= 0 && rect.top < fold;
    });
    if (!ctaAboveFold) {
      issues.push(`[c4] primary CTA not visible above the fold (looked for: ${ctaTestids.join(', ')})`);
    }
  }

  // c5 — viewport meta is mobile-correct and does not disable zoom
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) {
    issues.push('[c5] missing <meta name="viewport"> — page renders at desktop width on mobile');
  } else {
    const content = (vp.getAttribute('content') || '').toLowerCase();
    if (!content.includes('width=device-width')) {
      issues.push('[c5] viewport meta lacks width=device-width');
    }
    if (content.includes('user-scalable=no') || /maximum-scale=1(\.0)?(\b|,|$)/.test(content)) {
      issues.push('[c5] viewport meta disables zoom — customer cannot zoom as a fallback');
    }
  }

  return issues;
}

async function registerDj(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.post('/auth/register', {
    data: { name: 'Audit DJ', role: 'dj', generation: 'founder' },
  });
  expect(res.status(), 'DJ registration for audit setup').toBe(201);
  const body = (await res.json()) as { contributor: { id: string } };
  return body.contributor.id;
}

for (const surface of SURFACES) {
  test(`${surface.name} — mobile workability (375x812)`, async ({ page }) => {
    // A DJ identity is needed for gated pages and to fill :id in profile/DJ URLs.
    let djId = '';
    if (surface.auth || surface.path.includes(':id')) {
      djId = await registerDj(page);
    }
    const path = surface.path.replace(':id', djId);

    await page.goto(path);
    await page.waitForTimeout(2000); // let session checks + async render settle

    // Gated pages bounce to / without a valid session — fail loudly if so.
    if (surface.auth) {
      expect(page.url(), `${surface.name} should render, not redirect to the connect page`)
        .toContain(path);
    }

    const violations = await page.evaluate(auditContracts, surface.cta);

    expect(
      violations,
      `${surface.name}: ${violations.length} mobile-workability violation(s)\n  ` +
        violations.join('\n  '),
    ).toEqual([]);
  });
}
