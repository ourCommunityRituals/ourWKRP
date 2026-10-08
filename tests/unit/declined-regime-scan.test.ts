/**
 * L1 UNIT: the declined-regime scanners themselves. Each one has a PASS case
 * and a FAIL case fed a deliberately-broken fixture, because an absence gate
 * over a clean tree can only ever pass (see biometric-scan.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  declinedRegimeOf,
  scanSqlColumns,
  scanSchemaKeys,
  scanFormFields,
  scanDeclinedPools,
} from '../support/declined-regime-scan';

describe('declinedRegimeOf', () => {
  it.each([
    ['date_of_birth', 'COPPA'], ['dateOfBirth', 'COPPA'], ['birthYear', 'COPPA'], ['age', 'COPPA'],
    ['parental_consent', 'COPPA'], ['guardian_email', 'COPPA'],
    ['student_id', 'SOPPA'], ['school_name', 'SOPPA'], ['grade_level', 'SOPPA'],
    ['patient_id', 'HIPAA'], ['diagnosis', 'HIPAA'], ['medical_notes', 'HIPAA'],
  ])('%s is a %s field', (id, regime) => expect(declinedRegimeOf(id)).toBe(regime));

  it.each(['generation', 'page', 'storage', 'image_url', 'energy', 'tempo', 'role', 'name', 'venue_name', 'mode', 'key'])(
    '%s is not', (id) => expect(declinedRegimeOf(id)).toBeNull()
  );
});

describe('scanSqlColumns', () => {
  it('PASS: OW-shaped columns', () => {
    expect(scanSqlColumns('CREATE TABLE contributors (\n  id TEXT PRIMARY KEY,\n  generation TEXT\n);')).toEqual([]);
  });
  it('FAIL: a birthday column and an added student column', () => {
    const v = scanSqlColumns('CREATE TABLE c (\n  birthday TEXT\n);\nALTER TABLE c ADD COLUMN student_id TEXT;');
    expect(v.map((x) => x.regime)).toEqual(['COPPA', 'SOPPA']);
  });
  it('does not flag a comment', () => {
    expect(scanSqlColumns('-- we never store age TEXT here')).toEqual([]);
  });
});

describe('scanSchemaKeys', () => {
  it('PASS: the register schema', () => {
    expect(scanSchemaKeys('  name: nameSchema,\n  generation: generationSchema.default("founder"),\n  role: z.string(),')).toEqual([]);
  });
  it('FAIL: an age on a request body', () => {
    expect(scanSchemaKeys('  age: z.number().int(),')[0]?.regime).toBe('COPPA');
  });
});

describe('scanFormFields', () => {
  it('PASS: the name field', () => {
    expect(scanFormFields('<input type="text" name="name" id="contributor-name">')).toEqual([]);
  });
  it('FAIL: a field on a tag written across several lines', () => {
    const v = scanFormFields('<input\n  type="text"\n  name="guardian_email"\n  class="input"\n>');
    expect(v).toEqual([{ rule: 'declined-field', regime: 'COPPA', detail: 'form field name="guardian_email"', line: 1 }]);
  });
  it('FAIL: a school select and a birth date input', () => {
    const v = scanFormFields('<select name="school_name"></select>\n<input type="date" id="birthDate">');
    expect(v.map((x) => x.regime)).toEqual(['SOPPA', 'COPPA']);
  });
});

describe('scanDeclinedPools', () => {
  it('PASS: prose in a comment', () => {
    expect(scanDeclinedPools("// COPPA is declined: there is no 'coppa' pool")).toEqual([]);
  });
  it('FAIL: a dataset named for a declined regime', () => {
    expect(scanDeclinedPools("const DATASET = 'oureventring_coppa';")[0]?.regime).toBe('COPPA');
  });
});
