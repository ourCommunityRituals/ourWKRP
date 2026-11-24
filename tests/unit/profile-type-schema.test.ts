/**
 * Profile type schemas (profiles-and-voting launch, story 2).
 * The integration spec drives these through the router; this pins the
 * validation itself, including the message a person sees.
 */
import { describe, it, expect } from 'vitest';
import { profileTypeSchema, registerBodySchema, setProfileTypeBodySchema } from '../../src/lib/schemas';

describe('profile type schemas', () => {
  it('accepts the launch types only, and says which they are', () => {
    expect(profileTypeSchema.parse('artist')).toBe('artist');
    expect(profileTypeSchema.parse('sports')).toBe('sports');
    const bad = profileTypeSchema.safeParse('dj');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe('Profile type must be: artist or sports');
  });

  it('a change must name a type or null; it cannot be left out', () => {
    expect(setProfileTypeBodySchema.parse({ profile_type: 'sports' })).toEqual({ profile_type: 'sports' });
    expect(setProfileTypeBodySchema.parse({ profile_type: null })).toEqual({ profile_type: null });
    expect(setProfileTypeBodySchema.safeParse({}).success).toBe(false);
    expect(setProfileTypeBodySchema.safeParse({ profile_type: 'dj' }).success).toBe(false);
  });

  it('sign-up takes an optional type', () => {
    expect(registerBodySchema.parse({ name: 'Ada', profile_type: 'artist' }).profile_type).toBe('artist');
    expect(registerBodySchema.parse({ name: 'Bo' }).profile_type).toBeUndefined();
    expect(registerBodySchema.safeParse({ name: 'Cy', profile_type: 'dj' }).success).toBe(false);
  });
});
