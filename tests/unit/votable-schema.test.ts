/** "People may vote for me" body schema (profiles-and-voting launch, story 3). */
import { describe, expect, it } from 'vitest';
import { setVotableBodySchema } from '../../src/lib/schemas';

describe('setVotableBodySchema', () => {
  it('accepts true and false', () => {
    expect(setVotableBodySchema.parse({ votable: true })).toEqual({ votable: true });
    expect(setVotableBodySchema.parse({ votable: false })).toEqual({ votable: false });
  });

  it('refuses a missing or non-boolean value, with a plain message', () => {
    for (const body of [{}, { votable: 'yes' }, { votable: 1 }, { votable: null }]) {
      const r = setVotableBodySchema.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('votable must be true or false');
    }
  });
});
