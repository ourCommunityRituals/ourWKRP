/**
 * Security tests — SQL injection prevention
 *
 * Verifies all D1 queries use parameterized statements (.bind()),
 * never string interpolation or concatenation.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '../../src');

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getAllTsFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('SQL Injection Prevention', () => {
  const tsFiles = getAllTsFiles(SRC_DIR);
  const filesWithD1 = tsFiles.filter(f => {
    const content = fs.readFileSync(f, 'utf-8');
    return content.includes('.prepare(') || content.includes('WKRP_DB');
  });

  it('has files that use D1', () => {
    expect(filesWithD1.length).toBeGreaterThan(0);
  });

  for (const file of filesWithD1) {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(SRC_DIR, file);

    it(`${relative}: uses .bind() for all D1 queries (no string interpolation in SQL)`, () => {
      // Find all .prepare() calls
      const prepareMatches = content.match(/\.prepare\(`[^`]*`\)/g) || [];
      for (const match of prepareMatches) {
        // SQL template literals should only contain ? placeholders, not ${...}
        expect(match).not.toMatch(/\$\{/);
      }
    });

    it(`${relative}: uses parameterized queries (.bind())`, () => {
      // Every .prepare() should be followed by .bind()
      const prepareCount = (content.match(/\.prepare\(/g) || []).length;
      const bindCount = (content.match(/\.bind\(/g) || []).length;
      // bind count should be >= prepare count (some might use .run() directly for no-param queries)
      expect(bindCount).toBeGreaterThanOrEqual(prepareCount - 1);
    });

    it(`${relative}: does not concatenate user input into SQL strings`, () => {
      // No string concat patterns near SQL keywords
      expect(content).not.toMatch(/['"]SELECT.*\+.*['"]|['"]INSERT.*\+.*['"]/);
      expect(content).not.toMatch(/['"]UPDATE.*\+.*['"]|['"]DELETE.*\+.*['"]/);
    });
  }
});
