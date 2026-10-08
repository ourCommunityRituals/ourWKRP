/**
 * Declined-regime absence scanners: OCR_STANDARD_declinedRegimes.md, named pole.
 *
 * WHY THIS EXISTS IN OW
 * HIPAA (health data), COPPA (under-13 child data, including parental-consent
 * mechanics) and SOPPA (Illinois student data) are DECLINED regimes: no OCR
 * product enters them, and there is no roadmap rung that does. OSE enforces
 * this through its pool router and clearance tiers (OSE-1220). OSE is safe by
 * construction because it tracks the item, never the person.
 *
 * OW is the named pole: it stores a contributor's name. So "we track the item"
 * does not protect it, and the refusal has to be structural here too. The
 * realistic hazard is not a decision to enter a regime. It is an innocent
 * field: a birthday for a shout-out, a school for a youth playlist, a "grade"
 * on a sign-up form. Any of them turns a general-audience music catalog into a
 * service holding a declined regime's data.
 *
 * Pure `(source) => Violation[]` functions, so the unit level can feed each a
 * deliberately-broken fixture and require a report (same pattern as
 * biometric-scan.ts): an absence gate that passes looks exactly like one that
 * is broken.
 */

export interface RegimeViolation {
  rule: 'declined-field' | 'declined-pool';
  regime: 'COPPA' | 'SOPPA' | 'HIPAA';
  detail: string;
  line?: number;
}

/** Whole identifiers (snake_case, after camelCase is folded) a regime would need. */
const DECLINED_FIELDS: Array<{ re: RegExp; regime: RegimeViolation['regime'] }> = [
  {
    regime: 'COPPA',
    re: /^(age|age_(bracket|group|range|band)|dob|date_of_birth|birth_?(date|year|day)|birthday|is_minor|is_child|under_13|(parent|parental|guardian)(_\w+)?)$/,
  },
  {
    regime: 'SOPPA',
    re: /^(student(_\w+)?|school_(id|name|district)|grade_level|grade|enrol?ment(_\w+)?|transcript|iep)$/,
  },
  {
    regime: 'HIPAA',
    re: /^(diagnosis|patient(_\w+)?|medical(_\w+)?|health_records?|mrn|insurance(_\w+)?|prescription(_\w+)?|phi|treatment(_\w+)?)$/,
  },
];

/** fooBarBaz / foo-bar → foo_bar_baz. */
export function toSnake(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

export function declinedRegimeOf(identifier: string): RegimeViolation['regime'] | null {
  const id = toSnake(identifier);
  for (const f of DECLINED_FIELDS) if (f.re.test(id)) return f.regime;
  return null;
}

function strip(line: string): string {
  return line.replace(/--.*$/, '').replace(/(?<!:)\/\/.*$/, '').replace(/^\s*\*.*$/, '');
}

/** Columns created or added by a migration. */
export function scanSqlColumns(sql: string): RegimeViolation[] {
  const out: RegimeViolation[] = [];
  sql.split('\n').forEach((raw, i) => {
    const line = strip(raw);
    const ids: string[] = [];
    const def = line.match(/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC|DATE|DATETIME|BOOLEAN|INT)\b/i);
    if (def) ids.push(def[1]);
    for (const m of line.matchAll(/ADD\s+COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)/gi)) ids.push(m[1]);
    for (const id of ids) {
      const regime = declinedRegimeOf(id);
      if (regime) out.push({ rule: 'declined-field', regime, detail: `column "${id}"`, line: i + 1 });
    }
  });
  return out;
}

/** Request-body keys a zod schema accepts. */
export function scanSchemaKeys(ts: string): RegimeViolation[] {
  const out: RegimeViolation[] = [];
  ts.split('\n').forEach((raw, i) => {
    const m = strip(raw).match(/^\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*z\./);
    const regime = m && declinedRegimeOf(m[1]);
    if (m && regime) out.push({ rule: 'declined-field', regime, detail: `schema key "${m[1]}"`, line: i + 1 });
  });
  return out;
}

/**
 * Form fields a page asks for (input, select, textarea). Scans the whole page,
 * not line by line: a tag written across several lines (as connect.html's
 * name input is) must not slip past.
 */
export function scanFormFields(html: string): RegimeViolation[] {
  const out: RegimeViolation[] = [];
  for (const tag of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const line = html.slice(0, tag.index ?? 0).split('\n').length;
    for (const attr of tag[0].matchAll(/\b(name|id)\s*=\s*["']([A-Za-z_][\w-]*)["']/gi)) {
      const regime = declinedRegimeOf(attr[2]);
      if (regime) out.push({ rule: 'declined-field', regime, detail: `form field ${attr[1]}="${attr[2]}"`, line });
    }
  }
  return out;
}

/** A pool, dataset or route named for a declined regime, in code (not comments). */
export function scanDeclinedPools(ts: string): RegimeViolation[] {
  const out: RegimeViolation[] = [];
  ts.split('\n').forEach((raw, i) => {
    // `_` is a word character, so \b would miss oureventring_coppa.
    const m = strip(raw).match(/['"`][^'"`]*?(?<![a-z])(hipaa|coppa|soppa)(?![a-z])[^'"`]*['"`]/i);
    if (m) {
      const regime = m[1].toUpperCase() as RegimeViolation['regime'];
      out.push({ rule: 'declined-pool', regime, detail: `string names ${regime}: ${m[0]}`, line: i + 1 });
    }
  });
  return out;
}
