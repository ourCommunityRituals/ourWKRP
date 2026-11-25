/** Body schemas for the skin editor (PUT /api/profile/layout) and the add-on grant. */
import { describe, expect, it } from 'vitest';
import { layoutBodySchema, grantSkinsBodySchema } from '../../src/lib/schemas';

const ID = '11111111-1111-4111-8111-111111111111';

describe('layoutBodySchema', () => {
  it('accepts the skin file as text, up to 8192 characters', () => {
    expect(layoutBodySchema.parse({ markdown: '---\n' })).toEqual({ markdown: '---\n' });
    expect(layoutBodySchema.parse({ markdown: 'x'.repeat(8192) }).markdown).toHaveLength(8192);
  });

  it('refuses a missing or non-text file, with a plain message', () => {
    for (const body of [{}, { markdown: 5 }, { markdown: null }]) {
      const r = layoutBodySchema.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('markdown must be the skin file as text');
    }
  });

  it('refuses a file over 8192 characters', () => {
    const r = layoutBodySchema.safeParse({ markdown: 'x'.repeat(8193) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('The skin file must be at most 8192 bytes');
  });
});

describe('grantSkinsBodySchema', () => {
  it('accepts a contributor id and on or off', () => {
    expect(grantSkinsBodySchema.parse({ contributorId: ID, on: true })).toEqual({ contributorId: ID, on: true });
    expect(grantSkinsBodySchema.parse({ contributorId: ID, on: false })).toEqual({ contributorId: ID, on: false });
  });

  it('refuses a value for on that is not true or false', () => {
    for (const on of [undefined, 'yes', 1, null]) {
      const r = grantSkinsBodySchema.safeParse({ contributorId: ID, on });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('on must be true or false');
    }
  });

  it('refuses an id that is not a UUID', () => {
    const r = grantSkinsBodySchema.safeParse({ contributorId: 'not-an-id', on: true });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['contributorId']);
  });
});
