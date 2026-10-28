/**
 * Client-side escape helpers in the page templates must be attribute-safe.
 *
 * Several templates build markup in inline scripts and put escaped values
 * inside double-quoted attributes (data-genre, data-id, img src). The old
 * helpers (`div.textContent = s; return div.innerHTML`) encode & < > but not
 * the quotes, so a stored value with `"` could close the attribute.
 *
 * The helpers live in inline <script> blocks, so this test lifts each helper's
 * source out of the template and runs it. A DOM stub mimics the browser's
 * innerHTML serialisation of a text node (& < > and nbsp, never quotes), so a
 * textContent-based helper is judged exactly as a browser would run it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATES_DIR = join(__dirname, '../../src/templates');
const HELPER_NAMES = ['escapeHtml', 'esc'] as const;

/** Templates whose helper output is placed inside an HTML attribute. */
const ATTRIBUTE_USERS = ['live.html', 'catalog.html', 'profile.html', 'create.html', 'dashboard.html'];

/** What a browser's innerHTML does to a text node: & < > and nbsp only. */
const documentStub = {
  createElement() {
    let text = '';
    return {
      set textContent(v: unknown) { text = v == null ? '' : String(v); },
      get innerHTML() {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
      },
    };
  },
};

/** The full source of `function <name>(...) { ... }`, brace-matched; null if absent. */
function extractFunction(src: string, name: string): string | null {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function loadHelper(fnSource: string, name: string): (s: unknown) => string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('document', `${fnSource}\nreturn ${name};`)(documentStub) as (s: unknown) => string;
}

interface Helper { file: string; name: string; source: string; fn: (s: unknown) => string }

const templateFiles = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.html')).sort();
const helpers: Helper[] = [];
for (const file of templateFiles) {
  const src = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
  for (const name of HELPER_NAMES) {
    const source = extractFunction(src, name);
    if (source) helpers.push({ file, name, source, fn: loadHelper(source, name) });
  }
}

/** Does this template put the helper's output inside a quoted attribute? */
function usedInAttribute(file: string, name: string): boolean {
  if (ATTRIBUTE_USERS.includes(file)) return true;
  const src = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
  return new RegExp(`="'\\s*\\+\\s*(?:${name}|sanitizeUrl)\\(`).test(src);
}

function read(file: string): string {
  return readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
}

describe('template escape helpers', () => {
  it('finds a helper in every template that is known to use one in an attribute', () => {
    const found = new Set(helpers.map((h) => h.file));
    for (const file of ATTRIBUTE_USERS) expect(found.has(file)).toBe(true);
  });

  for (const h of helpers) {
    it(`${h.file} ${h.name}() encodes & < >`, () => {
      expect(h.fn('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
      expect(h.fn('')).toBe('');
      expect(h.fn(null)).toBe('');
      expect(h.fn(undefined)).toBe('');
    });

    if (usedInAttribute(h.file, h.name)) {
      it(`${h.file} ${h.name}() is quote-safe (used inside an attribute)`, () => {
        const out = h.fn(`x" onmouseover="alert(1)' y`);
        expect(out).not.toContain('"');
        expect(out).not.toContain("'");
        expect(out).toMatch(/x(?:&quot;|&#34;|&#x22;) onmouseover=/);
        expect(out).toMatch(/\(1\)(?:&#39;|&#x27;|&apos;) y$/);
        expect(h.fn(`"><img src=x>`)).toBe('&quot;&gt;&lt;img src=x&gt;');
      });

      it(`${h.file} ${h.name}() encodes each character once (no double-encoding)`, () => {
        expect(h.fn(`&quot; &#39; " '`)).toBe('&amp;quot; &amp;#39; &quot; &#39;');
      });
    }
  }
});

describe('id data attributes go through the template escape helper', () => {
  it('live.html escapes data-track-id and data-dj-id', () => {
    const src = read('live.html');
    expect(src).toContain(`data-track-id="' + escapeHtml(t.id) + '"`);
    expect(src).toContain(`data-dj-id="' + escapeHtml(currentDjId) + '"`);
  });

  it('create.html escapes every data-track-id and data-id', () => {
    const src = read('create.html');
    expect(count(src, `data-track-id="' + escapeHtml(t.id) + '"`)).toBe(2);
    expect(src).toContain(`data-id="' + escapeHtml(t.id) + '"`);
  });

  it('dashboard.html escapes data-id', () => {
    expect(read('dashboard.html')).toContain(`data-id="' + esc(t.id) + '"`);
  });

  for (const file of ATTRIBUTE_USERS) {
    it(`${file} has no data-* attribute built from an unescaped value`, () => {
      const bare = [...read(file).matchAll(/data-[a-z-]+="'\s*\+\s*(?!escapeHtml\(|esc\()([^\s+]+)/g)].map((m) => m[0]);
      expect(bare).toEqual([]);
    });
  }
});

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
