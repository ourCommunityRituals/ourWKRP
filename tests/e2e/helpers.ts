/**
 * E2E Test Helpers
 *
 * Shared utilities for Playwright E2E tests.
 * Uses real server endpoints (POST /auth/register) to get
 * authentic HttpOnly session cookies — no localStorage hacks.
 */
import { type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
import * as path from 'path';

export interface RegisterResult {
  contributorId: string;
  name: string;
  role: string;
  generation: string;
}

/**
 * Register a contributor via POST /auth/register.
 * Sets a real HttpOnly session cookie on the page's browser context.
 * Returns the contributor metadata for assertions.
 */
export async function registerUser(
  request: APIRequestContext,
  opts: {
    name: string;
    role: 'dj' | 'curator' | 'contributor' | 'listener';
    generation: 'founder' | 'gen2' | 'gen3';
  },
): Promise<RegisterResult> {
  const response = await request.post('/auth/register', {
    data: {
      name: opts.name,
      role: opts.role,
      generation: opts.generation,
    },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Registration failed (${response.status()}): ${body}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Registration returned ok=false: ${data.error}`);
  }

  return {
    contributorId: data.contributor.id,
    name: opts.name,
    role: opts.role,
    generation: opts.generation,
  };
}

/**
 * Register a user with a specific role and navigate to a page.
 * Combines registration + navigation in one call.
 */
export async function registerAndGo(
  page: Page,
  opts: {
    name: string;
    role: 'dj' | 'curator' | 'contributor' | 'listener';
    generation: 'founder' | 'gen2' | 'gen3';
    goto: string;
  },
): Promise<RegisterResult> {
  const result = await registerUser(page.request, {
    name: opts.name,
    role: opts.role,
    generation: opts.generation,
  });
  await page.goto(opts.goto);
  return result;
}

/**
 * Seed the catalog with test tracks by uploading a CSV file.
 * Requires the contributor to have an import-capable role (dj, curator, founder generation).
 */
export async function seedTracks(
  request: APIRequestContext,
  contributorId: string,
): Promise<{ tracksImported: number }> {
  const csvContent = generateTestCSV();

  const response = await request.post(`/import/${contributorId}`, {
    data: csvContent,
    headers: { 'Content-Type': 'text/csv' },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Seed tracks failed (${response.status()}): ${body}`);
  }

  const data = await response.json();
  return { tracksImported: data.import?.tracks_imported ?? 0 };
}

/**
 * Generate a small test CSV in Exportify-compatible format.
 */
function generateTestCSV(): string {
  const header = 'Track Name,Artist Name(s),Album Name,Spotify ID,ISRC';
  const rows = [
    'Blue in Green,Miles Davis,Kind of Blue,test001,USXXX0000001',
    'So What,Miles Davis,Kind of Blue,test002,USXXX0000002',
    'A Love Supreme Pt. 1,John Coltrane,A Love Supreme,test003,USXXX0000003',
    'Take Five,Dave Brubeck,Time Out,test004,USXXX0000004',
    'Maiden Voyage,Herbie Hancock,Maiden Voyage,test005,USXXX0000005',
    'Watermelon Man,Herbie Hancock,Takin Off,test006,USXXX0000006',
    'Round Midnight,Thelonious Monk,Genius of Modern Music,test007,USXXX0000007',
    'Cantaloupe Island,Herbie Hancock,Empyrean Isles,test008,USXXX0000008',
    'Summertime,Ella Fitzgerald,Porgy and Bess,test009,USXXX0000009',
    'My Favorite Things,John Coltrane,My Favorite Things,test010,USXXX0000010',
  ];
  return [header, ...rows].join('\n');
}

/**
 * Clear all cookies from the browser context.
 */
export async function clearSession(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/**
 * Wait for an API response pattern (useful for testing loading states).
 */
export async function waitForApi(
  page: Page,
  urlPattern: string | RegExp,
): Promise<void> {
  await page.waitForResponse(
    (response) =>
      typeof urlPattern === 'string'
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url()),
  );
}

/**
 * Get the path to a test fixture file.
 */
export function fixturePath(filename: string): string {
  return path.join(__dirname, 'fixtures', filename);
}
