/**
 * The minimum age to make a profile is 18 (owner, 2026-11-28).
 * The privacy page and the sign-up note must both say it, and
 * neither may still carry the old 16.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '../../src/templates');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf-8');

describe('minimum age to make a profile', () => {
  it.each(['privacy.html', 'connect.html'])('%s says 18 or older and never 16', (file) => {
    const html = read(file);
    expect(html).toMatch(/18 or older/);
    expect(html).not.toMatch(/16 or older/);
  });
});
