/**
 * Page handler — serves HTML templates
 *
 * GET /         → connect.html (or redirect to catalog if session cookie)
 * GET /catalog  → catalog.html
 * GET /create   → create.html
 */

import type { Env } from '../types';
import { extractBrandId } from '../lib/brand';
import { buildPageCsp } from '../lib/security-headers';
import { log } from '../lib/logger';

// HTML templates imported as text via wrangler.toml [[rules]]
import connectHtml from '../templates/connect.html';
import catalogHtml from '../templates/catalog.html';
import createHtml from '../templates/create.html';
import profileHtml from '../templates/profile.html';
import importHtml from '../templates/import.html';
import liveHtml from '../templates/live.html';
import qrPosterHtml from '../templates/qr-poster.html';
import dashboardHtml from '../templates/dashboard.html';
import statsHtml from '../templates/stats.html';

const HTML_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

export async function handlePages(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const brandId = extractBrandId(request);

  log('PAGE_SERVE', { path, brand_id: brandId });

  let html: string;
  if (path === '/') {
    html = connectHtml;
  } else if (path === '/catalog') {
    html = catalogHtml;
  } else if (path === '/create') {
    html = createHtml;
  } else if (path === '/dashboard') {
    html = dashboardHtml;
  } else if (path === '/stats') {
    html = statsHtml;
  } else if (path === '/import') {
    html = importHtml;
  } else if (path.startsWith('/dj/') && path.endsWith('/poster')) {
    html = qrPosterHtml;
  } else if (path.startsWith('/dj/')) {
    html = liveHtml;
  } else if (path.startsWith('/contributor/')) {
    html = profileHtml;
  } else {
    return Response.json(
      { ok: false, status: 404, error: 'Page not found' },
      { status: 404 },
    );
  }

  // Inject brand CSS custom properties from D1
  html = await injectBrandStyles(html, brandId, env);

  // CSP nonce — every inline <script> is tagged with this request's nonce so
  // the policy can forbid all other inline script (XSS defense) without
  // 'unsafe-inline'. Templates contain only plain inline <script> blocks.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  html = html.replace(/<script>/g, `<script nonce="${nonce}">`);

  return new Response(html, {
    headers: { ...HTML_HEADERS, 'Content-Security-Policy': buildPageCsp(nonce) },
  });
}

/**
 * Load brand colors from D1 and inject as CSS custom properties.
 * Falls back to defaults if brand not found.
 */
async function injectBrandStyles(html: string, brandId: string, env: Env): Promise<string> {
  let primaryColor = '#D4954B';
  let accentColor = '#191414';
  let brandName = 'WKRP';

  try {
    const brand = await env.WKRP_DB.prepare(
      'SELECT name, primary_color, accent_color FROM brands WHERE id = ?'
    ).bind(brandId).first<{ name: string; primary_color: string; accent_color: string }>();

    if (brand) {
      primaryColor = brand.primary_color || primaryColor;
      accentColor = brand.accent_color || accentColor;
      brandName = brand.name || brandName;
    }
  } catch {
    // D1 not provisioned yet or brands table doesn't exist — use defaults
  }

  const styleBlock = `<style>:root{--brand-primary:${primaryColor};--brand-accent:${accentColor};--brand-name:"${brandName}";}</style>`;
  return html.replace('</head>', `${styleBlock}</head>`);
}
