/**
 * Determinism scanners — shared by every level of the test pyramid.
 *
 * WHY THESE ARE PURE FUNCTIONS
 * A gate that is only ever run against the real source can only be shown
 * passing. Its failure path — the half that actually protects you — gets
 * demonstrated once by hand and then never again. Extracting the scan as a
 * pure `(source: string) => Violation[]` makes the failure path testable:
 * every level feeds it BOTH a conformant fixture (expect zero violations) and
 * a deliberately-broken fixture (expect the specific violation), so the
 * born-red proof runs in CI on every PR instead of living in a commit message.
 *
 * Three properties, one per class of nondeterminism:
 *   scanOrderByDeterminism  — DB layer: stable row order
 *   scanForbiddenRandomness — BE layer: no randomness outside identifier minting
 *   scanInferenceImports    — FE + BE: no model/inference call in the request path
 */

export interface Violation {
  rule: 'order-by-tiebreaker' | 'forbidden-randomness' | 'inference-import';
  detail: string;
  /** 1-indexed line within the scanned source, when locatable. */
  line?: number;
}

// ---------------------------------------------------------------------------
// Rule 1 — ORDER BY must end in a unique-by-construction sort key.
// ---------------------------------------------------------------------------
/**
 * SQLite gives no stable order among rows with equal sort keys. An unstable
 * ORDER BY returns different rows for identical data — worst when paired with
 * LIMIT, where a tie at the cutoff makes a row appear or vanish between two
 * identical requests.
 *
 * A final sort term qualifies as unique-by-construction when it is:
 *   (a) an `id` column (`id`, `t.id`, `b.id` …) — a primary key, or
 *   (b) listed in UNIQUE_BY_CONSTRUCTION below, each with a stated reason.
 *
 * The allowlist IS the documentation. Adding an entry without a reason is the
 * thing review should catch; adding one with a reason is a legitimate call.
 */
export const UNIQUE_BY_CONSTRUCTION: Record<string, string> = {
  // Grouped aggregates: the sort key IS the GROUP BY key, so it is unique per row.
  decade: 'GROUP BY decade — one row per decade',
  hour: 'GROUP BY hour — one row per hour bucket',
  genre: 'GROUP BY genre — one row per genre',
  't.genre': 'GROUP BY t.genre — one row per genre',
  source_platform: 'SELECT DISTINCT source_platform — one row per platform',
  // Ordinals that are unique within their parent row set.
  position: 'ordinal position, unique within its playlist/set',
  'pt.position': 'ordinal position, unique within its playlist',
  'st.position': 'ordinal position, unique within its set',
  // Composite key on a DISTINCT projection.
  'ct.name': 'final term of a DISTINCT projection — full tuple is unique',
  role: 'one row per (contributor, role) pair',
};

const ID_TERM = /^(?:\w+\.)?id$/i;

/** Split an ORDER BY clause body into its comma-separated terms. */
function sortTerms(clause: string): string[] {
  return clause
    .split(',')
    .map((t) => t.trim().replace(/\s+(asc|desc)$/i, '').trim())
    .filter(Boolean);
}

export function scanOrderByDeterminism(source: string): Violation[] {
  const violations: Violation[] = [];
  // Capture the ORDER BY body up to LIMIT, a closing backtick/quote, or EOL.
  const re = /ORDER\s+BY\s+([^`'"\n]+?)(?=\s+LIMIT\b|\s*`|\s*'|\s*"|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const clause = m[1].trim();
    const terms = sortTerms(clause);
    if (terms.length === 0) continue;
    const final = terms[terms.length - 1];
    const ok = ID_TERM.test(final) || final in UNIQUE_BY_CONSTRUCTION;
    if (!ok) {
      violations.push({
        rule: 'order-by-tiebreaker',
        detail:
          `ORDER BY ${clause} — final sort term "${final}" is not unique by ` +
          `construction; ties order arbitrarily. Append a unique tiebreaker ` +
          `(e.g. ", <alias>.id ASC") or document it in UNIQUE_BY_CONSTRUCTION.`,
        line: source.slice(0, m.index).split('\n').length,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Rule 2 — randomness only where an identifier is being minted.
// ---------------------------------------------------------------------------
/**
 * `crypto.randomUUID()` / `getRandomValues` are REQUIRED to be random — session
 * tokens, PKCE verifiers, contributor ids, CSP nonces. That randomness never
 * reaches a query result or a rendered list. `Math.random()` has no such
 * justification anywhere in this codebase, and randomness used to order or
 * select content is what turns a catalog into a slot machine.
 */
export function scanForbiddenRandomness(source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    if (/\bMath\.random\s*\(/.test(text)) {
      violations.push({
        rule: 'forbidden-randomness',
        detail:
          'Math.random() is not permitted — output must be a function of stored ' +
          'data. Use crypto.randomUUID() if you are minting an identifier.',
        line: i + 1,
      });
    }
    if (/ORDER\s+BY\s+RANDOM\s*\(/i.test(text)) {
      violations.push({
        rule: 'forbidden-randomness',
        detail: 'ORDER BY RANDOM() makes query results nondeterministic.',
        line: i + 1,
      });
    }
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Rule 3 — no model/inference call in the request path.
// ---------------------------------------------------------------------------
/**
 * ourWKRP's product claim is "the human answer to AI playlists. Real people.
 * Real taste. No algorithm." That claim is currently true of the code. This
 * rule is what keeps it true: a generative or embedding call anywhere in the
 * Worker or the templates makes catalog output probabilistic and the claim
 * false, and it would arrive as an ordinary-looking dependency bump.
 */
const INFERENCE_PATTERNS: Array<[RegExp, string]> = [
  [/@anthropic-ai\//, 'Anthropic SDK'],
  [/\bopenai\b/i, 'OpenAI'],
  [/@cf\/(?:meta|mistral|baai|openai)\//, 'Workers AI model binding'],
  [/\benv\.AI\b/, 'Workers AI binding'],
  [/generativelanguage\.googleapis\.com/, 'Google Generative Language API'],
  [/api\.openai\.com/, 'OpenAI API endpoint'],
  [/api\.anthropic\.com/, 'Anthropic API endpoint'],
  [/\bchat\.completions\b/, 'chat completions call'],
  [/\bcreateEmbedding\b/, 'embedding call'],
];

export function scanInferenceImports(source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    // Comments are prose, not a request path — a doc comment naming a vendor
    // is not an inference call. The (?<!:) guard keeps the scheme slashes of a
    // URL (https://…) from being mistaken for the start of a line comment,
    // which would blind this scanner to exactly the endpoints it exists to catch.
    const code = text.replace(/(?<!:)\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    for (const [re, label] of INFERENCE_PATTERNS) {
      if (re.test(code)) {
        violations.push({
          rule: 'inference-import',
          detail: `${label} referenced in the request path — output would become probabilistic.`,
          line: i + 1,
        });
      }
    }
  });
  return violations;
}

/** All three rules over one source file. */
export function scanAll(source: string): Violation[] {
  return [
    ...scanOrderByDeterminism(source),
    ...scanForbiddenRandomness(source),
    ...scanInferenceImports(source),
  ];
}
