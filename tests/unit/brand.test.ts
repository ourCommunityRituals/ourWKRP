/**
 * Unit tests — Brand extraction from hostname
 */
import { describe, it, expect } from 'vitest';
import { extractBrandId } from '../../src/lib/brand';

function makeRequest(hostname: string): Request {
  return new Request(`https://${hostname}/api/tracks`);
}

describe('extractBrandId', () => {
  it('returns default brand for ourwkrp.com', () => {
    expect(extractBrandId(makeRequest('ourwkrp.com'))).toBe('wkrp');
  });

  it('returns default brand for www.ourwkrp.com', () => {
    expect(extractBrandId(makeRequest('www.ourwkrp.com'))).toBe('wkrp');
  });

  it('returns default brand for stg.ourwkrp.com', () => {
    expect(extractBrandId(makeRequest('stg.ourwkrp.com'))).toBe('wkrp');
  });

  it('returns default brand for localhost', () => {
    const req = new Request('http://localhost:8787/api/tracks');
    expect(extractBrandId(req)).toBe('wkrp');
  });

  it('returns default brand for 127.0.0.1', () => {
    const req = new Request('http://127.0.0.1:8787/api/tracks');
    expect(extractBrandId(req)).toBe('wkrp');
  });

  it('extracts brand from subdomain', () => {
    expect(extractBrandId(makeRequest('bronzeville.ourwkrp.com'))).toBe('bronzeville');
  });

  it('extracts brand with hyphens', () => {
    expect(extractBrandId(makeRequest('reckless-records.ourwkrp.com'))).toBe('reckless-records');
  });

  it('rejects subdomains with invalid characters', () => {
    expect(extractBrandId(makeRequest('BAD_BRAND.ourwkrp.com'))).toBe('wkrp');
  });
});
