/**
 * The DJ live page shows the song playing now (OW-219).
 *
 * `GET /dj/:id/live` returns `live_set.now_playing` (the set's open playback
 * event, or null). live.html shows it above the set list in one block, and
 * this file pins that block at the unit layer; tests/e2e/dj-now-playing.spec.ts
 * drives it in a browser.
 *
 * The render function lives in the page's inline <script>, so, as in
 * template-attr-escape.test.ts, this test lifts its source out of the template
 * and runs it against a small DOM stub. The stub records every write and
 * refuses markup (innerHTML / insertAdjacentHTML), so "values go in as text"
 * and "the DOM is untouched when the id is unchanged" are both measured.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '../../src/templates/live.html'), 'utf-8');

/** The full source of `function <name>(...) { ... }`, brace-matched. */
function extractFunction(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) throw new Error(`${name} not found in live.html`);
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

type Write = { id: string; op: string; value?: string };

/** A stub element: text, attributes and a class list, with every write logged. */
function stubElement(id: string, writes: Write[], classes: string[] = []) {
  let text = '';
  const attrs = new Map<string, string>();
  const cls = new Set(classes);
  return {
    get textContent() { return text; },
    set textContent(v: string) { writes.push({ id, op: 'text', value: String(v) }); text = String(v); },
    set innerHTML(_v: string) { throw new Error(`innerHTML written on #${id}`); },
    insertAdjacentHTML() { throw new Error(`insertAdjacentHTML on #${id}`); },
    getAttribute(name: string) { return attrs.has(name) ? attrs.get(name)! : null; },
    setAttribute(name: string, v: string) { writes.push({ id, op: `attr:${name}`, value: String(v) }); attrs.set(name, String(v)); },
    removeAttribute(name: string) { writes.push({ id, op: `rmattr:${name}` }); attrs.delete(name); },
    classList: {
      add(c: string) { writes.push({ id, op: `class+${c}` }); cls.add(c); },
      remove(c: string) { writes.push({ id, op: `class-${c}` }); cls.delete(c); },
      contains(c: string) { return cls.has(c); },
    },
    attrs,
  };
}

const NP = (playbackEventId: string, name: string, artist: string) => ({
  playback_event_id: playbackEventId,
  started_at: '2026-11-18 21:04:00',
  track: { id: 'track-1', name, artist, album: 'Quiet Album', image_url: null },
});

let writes: Write[];
let els: Record<string, ReturnType<typeof stubElement>>;
let render: (np: unknown) => void;

beforeEach(() => {
  writes = [];
  els = {
    'now-playing': stubElement('now-playing', writes, ['now-playing', 'section', 'hidden']),
    'now-playing-track': stubElement('now-playing-track', writes),
    'now-playing-artist': stubElement('now-playing-artist', writes),
  };
  const document = {
    getElementById(id: string) {
      const el = els[id];
      if (!el) throw new Error(`renderNowPlaying reached an unexpected element #${id}`);
      return el;
    },
    createElement() { throw new Error('renderNowPlaying must not build markup'); },
  };
  render = new Function('document', `${extractFunction(html, 'renderNowPlaying')}\nreturn renderNowPlaying;`)(document) as (np: unknown) => void;
});

const block = () => els['now-playing']!;
const shown = () => !block().classList.contains('hidden');
const visibleText = () => shown()
  ? ['Now playing', els['now-playing-track']!.textContent, els['now-playing-artist']!.textContent].join(' ')
  : '';

describe('live.html now-playing block: render', () => {
  it('shows the track name and the artist when a song is playing', () => {
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    expect(shown()).toBe(true);
    expect(els['now-playing-track']!.textContent).toBe('Lantern Walk');
    expect(els['now-playing-artist']!.textContent).toBe('The Quiet Hours');
    expect(block().getAttribute('data-playback-event-id')).toBe('pe-aaa');
  });

  it('stays hidden, and writes nothing, when now_playing is null', () => {
    render(null);
    render(undefined);
    expect(shown()).toBe(false);
    expect(writes).toEqual([]);
  });

  it('treats a malformed now_playing (no id, no track) as nothing playing', () => {
    render({ track: { name: 'Lantern Walk', artist: 'The Quiet Hours' } });
    render({ playback_event_id: 'pe-aaa' });
    render({ playback_event_id: 42, track: { name: 'x', artist: 'y' } });
    expect(shown()).toBe(false);
    expect(writes).toEqual([]);
  });

  it('hides again when the song ends (now_playing goes back to null)', () => {
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    render(null);
    expect(shown()).toBe(false);
    expect(block().getAttribute('data-playback-event-id')).toBeNull();
  });

  it('updates when the DJ logs the next song (a new id)', () => {
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    render(NP('pe-bbb', 'Harbor Lights', 'Paper Kites Collective'));
    expect(els['now-playing-track']!.textContent).toBe('Harbor Lights');
    expect(els['now-playing-artist']!.textContent).toBe('Paper Kites Collective');
    expect(block().getAttribute('data-playback-event-id')).toBe('pe-bbb');
  });

  it('updates when the same song is replayed: same words, new id', () => {
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    writes.length = 0;
    render(NP('pe-ccc', 'Lantern Walk', 'The Quiet Hours'));
    expect(block().getAttribute('data-playback-event-id')).toBe('pe-ccc');
    expect(writes.some((w) => w.id === 'now-playing-track' && w.op === 'text')).toBe(true);
  });

  it('touches nothing when a poll returns the same playback event', () => {
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    writes.length = 0;
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    render(NP('pe-aaa', 'Lantern Walk', 'The Quiet Hours'));
    expect(writes).toEqual([]);
  });

  it('puts API values in as text, never as markup', () => {
    // The stub throws on innerHTML, so reaching the assertions proves the
    // value went in through textContent, verbatim.
    const name = '<img src=x onerror="window.__np_xss=1">';
    const artist = '<b>Bold</b> & "quoted"';
    render(NP('pe-aaa', name, artist));
    expect(els['now-playing-track']!.textContent).toBe(name);
    expect(els['now-playing-artist']!.textContent).toBe(artist);
  });

  it('never shows the playback event id, a count or a time as text', () => {
    render(NP('pe-7f3a9c', 'Lantern Walk', 'The Quiet Hours'));
    const text = visibleText();
    expect(text).not.toContain('pe-7f3a9c');
    expect(text).not.toContain('2026-11-18');
    expect(text).not.toMatch(/\d/); // no count, no clock: the fixture words have no digits
    const textWrites = writes.filter((w) => w.op === 'text').map((w) => w.value);
    expect(textWrites).toEqual(['Lantern Walk', 'The Quiet Hours']);
  });
});

describe('live.html now-playing block: markup and wiring', () => {
  const blockHtml = html.match(/<div aria-live="polite"[^>]*>[\s\S]*?<\/section>\s*<\/div>/)?.[0] ?? '';

  it('sits above the set list, inside a polite live region', () => {
    expect(blockHtml).not.toBe('');
    expect(html.indexOf('data-testid="now-playing"')).toBeLessThan(html.indexOf('data-testid="track-list"'));
    expect(blockHtml).toContain('data-testid="now-playing-live"');
  });

  it('is a region labelled by words, and starts hidden', () => {
    expect(blockHtml).toMatch(/<section id="now-playing" class="now-playing section hidden" aria-labelledby="now-playing-label" data-testid="now-playing">/);
    expect(blockHtml).toMatch(/id="now-playing-label"[^>]*>Now playing<\/div>/);
  });

  it('uses only shared @ocr/ui classes and no inline style', () => {
    expect(blockHtml).not.toMatch(/style=/);
    expect(blockHtml).toMatch(/class="now-playing-track"/);
    expect(blockHtml).toMatch(/class="now-playing-artist"/);
  });

  it('is rendered on first load and on every poll, and hidden when the set ends', () => {
    const load = extractFunction(html, 'loadLiveSet');
    const refresh = extractFunction(html, 'refreshTracks');
    expect(load).toContain('renderNowPlaying(data.live_set.now_playing)');
    expect(refresh).toContain('renderNowPlaying(data.live_set.now_playing)');
    expect(refresh).toContain('renderNowPlaying(null)');
  });

  it('the set list no longer labels its first card as playing (the block is the one place that says so)', () => {
    const list = extractFunction(html, 'renderTracks');
    expect(list).not.toMatch(/now-playing|Now Playing/i);
  });

  it('keeps at most one <h1> on the page', () => {
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});
