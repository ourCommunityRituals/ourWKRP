/**
 * Page handler — serves HTML templates
 *
 * GET /         → connect.html (or redirect to catalog if session cookie)
 * GET /catalog  → catalog.html
 * GET /create   → create.html
 */

import type { Env } from '../types';
import { log } from '../lib/logger';

// HTML templates imported as text via wrangler.toml [[rules]]
import connectHtml from '../templates/connect.html';
import catalogHtml from '../templates/catalog.html';
import createHtml from '../templates/create.html';

const HTML_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

export async function handlePages(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  log('PAGE_SERVE', { path });

  switch (path) {
    case '/':
      // If session param exists, let connect.html JS handle redirect
      return new Response(connectHtml, { headers: HTML_HEADERS });

    case '/catalog':
      return new Response(catalogHtml, { headers: HTML_HEADERS });

    case '/create':
      return new Response(createHtml, { headers: HTML_HEADERS });

    default:
      return Response.json(
        { ok: false, status: 404, error: 'Page not found' },
        { status: 404 },
      );
  }
}
