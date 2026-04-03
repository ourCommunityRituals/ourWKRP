import { describe, it, expect } from 'vitest';
import { normalizeTitle, normalizeArtist, extractReleaseYear } from '../../src/lib/normalize';

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeTitle('  Bohemian Rhapsody  ')).toBe('bohemian rhapsody');
  });

  it('strips - Remastered suffix', () => {
    expect(normalizeTitle('Come Together - Remastered 2009')).toBe('come together');
  });

  it('strips (Remastered) suffix', () => {
    expect(normalizeTitle('Stairway to Heaven (Remastered)')).toBe('stairway to heaven');
  });

  it('strips [Remastered 2015] suffix', () => {
    expect(normalizeTitle('Heroes [Remastered 2015]')).toBe('heroes');
  });

  it('strips (Deluxe Edition) suffix', () => {
    expect(normalizeTitle('Abbey Road (Deluxe Edition)')).toBe('abbey road');
  });

  it('strips (feat. Artist) from title', () => {
    expect(normalizeTitle('Slide (feat. Frank Ocean)')).toBe('slide');
  });

  it('strips feat. without parens', () => {
    expect(normalizeTitle('Monster feat. Jay-Z & Rick Ross')).toBe('monster');
  });

  it('strips (with Artist) from title', () => {
    expect(normalizeTitle('Under Pressure (with David Bowie)')).toBe('under pressure');
  });

  it('strips - Radio Edit suffix', () => {
    expect(normalizeTitle('Blinding Lights - Radio Edit')).toBe('blinding lights');
  });

  it('strips (Single Version) suffix', () => {
    expect(normalizeTitle('Hey Jude (Single Version)')).toBe('hey jude');
  });

  it('handles multiple suffixes', () => {
    expect(normalizeTitle('Come Together (feat. Someone) - Remastered 2009')).toBe('come together');
  });

  it('preserves normal titles', () => {
    expect(normalizeTitle('Paranoid Android')).toBe('paranoid android');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeTitle('Take   Me   Home')).toBe('take me home');
  });
});

describe('normalizeArtist', () => {
  it('lowercases and trims', () => {
    expect(normalizeArtist('  Radiohead  ')).toBe('radiohead');
  });

  it('splits on comma and sorts', () => {
    expect(normalizeArtist('Drake, Future')).toBe('drake, future');
  });

  it('splits on ampersand and sorts', () => {
    expect(normalizeArtist('Simon & Garfunkel')).toBe('garfunkel, simon');
  });

  it('splits on "and" and sorts', () => {
    expect(normalizeArtist('Tom and Jerry')).toBe('jerry, tom');
  });

  it('sorts multiple artists alphabetically', () => {
    expect(normalizeArtist('Kanye West, Jay-Z, Kid Cudi')).toBe('jay-z, kanye west, kid cudi');
  });

  it('handles single artist', () => {
    expect(normalizeArtist('Fela Kuti')).toBe('fela kuti');
  });

  it('handles "x" collaborations', () => {
    expect(normalizeArtist('Future x Metro Boomin')).toBe('future, metro boomin');
  });

  it('filters empty parts', () => {
    expect(normalizeArtist('Artist, , Another')).toBe('another, artist');
  });
});

describe('extractReleaseYear', () => {
  it('extracts from YYYY-MM-DD', () => {
    expect(extractReleaseYear('2024-03-15')).toBe(2024);
  });

  it('extracts from YYYY', () => {
    expect(extractReleaseYear('1969')).toBe(1969);
  });

  it('extracts from MM/DD/YYYY', () => {
    expect(extractReleaseYear('03/15/2024')).toBe(2024);
  });

  it('returns null for null input', () => {
    expect(extractReleaseYear(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractReleaseYear(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractReleaseYear('')).toBeNull();
  });

  it('returns null for nonsense', () => {
    expect(extractReleaseYear('not a date')).toBeNull();
  });

  it('rejects year out of range', () => {
    expect(extractReleaseYear('1800')).toBeNull();
  });
});
