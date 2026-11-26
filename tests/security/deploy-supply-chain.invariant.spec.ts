/**
 * Deploy jobs install packages without running their install scripts, and the
 * files that control CI, agents and deploys have a named human reviewer
 * (OW-231; CCR security re-sweep 2026-11-26, findings L3 and M2).
 *
 * `npm ci` runs every dependency's install scripts. In a deploy job a later
 * step holds the Doppler token that unlocks the Cloudflare deploy token, so an
 * install script from a compromised package could change files that step runs.
 * `--ignore-scripts` stops that; wrangler needs no install script to deploy
 * (checked with `wrangler deploy --dry-run`).
 *
 * CODEOWNERS binds only when the owner turns on "Require review from Code
 * Owners" for `main`. Until then it names who should review.
 *
 * Born red: each detector is shown failing on a synthetic input first, and the
 * repo checks failed on `main` at a1dd046 before this change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "../..");
const CI = path.join(ROOT, ".github", "workflows", "ci.yml");
const CODEOWNERS = path.join(ROOT, ".github", "CODEOWNERS");

type Step = { run?: string; name?: string };
type Job = { environment?: unknown; steps?: Step[] };
type Workflow = { jobs?: Record<string, Job> };

/** Jobs bound to a deploy environment (staging or production). */
function deployJobs(wf: Workflow): [string, Job][] {
  return Object.entries(wf.jobs ?? {}).filter(([, j]) => {
    const env =
      typeof j.environment === "string"
        ? j.environment
        : (j.environment as { name?: string } | undefined)?.name;
    return env === "staging" || env === "production";
  });
}

/** `npm ci` / `npm install` lines in deploy jobs that would run install scripts. */
export function scriptedInstalls(text: string): string[] {
  const wf = (yaml.load(text) ?? {}) as Workflow;
  const out: string[] = [];
  for (const [name, job] of deployJobs(wf)) {
    for (const s of job.steps ?? []) {
      for (const line of (s.run ?? "").split("\n")) {
        if (
          /\bnpm\s+(ci|install|i)\b/.test(line) &&
          !/--ignore-scripts\b/.test(line)
        )
          out.push(`${name}: ${line.trim()}`);
      }
    }
  }
  return out;
}

/** Paths that must have an owner, and whether a CODEOWNERS text covers each. */
export const OWNED = [
  "/.github/",
  "/.claude/",
  "/CLAUDE.md",
  "/scripts/ci/",
  "/wrangler.toml",
];
export function unowned(codeowners: string): string[] {
  const rules = codeowners
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/))
    .filter(
      (parts) =>
        parts.length >= 2 && parts.slice(1).every((o) => o.startsWith("@")),
    );
  return OWNED.filter(
    (p) =>
      !rules.some(
        ([pat]) => pat === p || pat === p.replace(/\/$/, "") || pat === "*",
      ),
  );
}

describe("detectors (born red on synthetic input)", () => {
  it("flags a deploy job that runs npm ci with scripts on", () => {
    const wf = `jobs:\n  d:\n    environment: production\n    steps:\n      - run: npm ci\n  t:\n    steps:\n      - run: npm ci\n`;
    expect(scriptedInstalls(wf)).toEqual(["d: npm ci"]);
    expect(
      scriptedInstalls(
        wf.replace("run: npm ci\n  t", "run: npm ci --ignore-scripts\n  t"),
      ),
    ).toEqual([]);
  });
  it("flags missing owners", () => {
    expect(unowned("")).toEqual(OWNED);
    expect(unowned("/.github/ @someone\n")).toEqual(OWNED.slice(1));
  });
});

describe("this repo", () => {
  it("deploy jobs install with --ignore-scripts", () => {
    const text = readFileSync(CI, "utf8");
    expect(
      deployJobs(yaml.load(text) as Workflow).length,
    ).toBeGreaterThanOrEqual(2);
    expect(scriptedInstalls(text)).toEqual([]);
  });
  it("CODEOWNERS names a reviewer for CI, agent and deploy files", () => {
    expect(existsSync(CODEOWNERS)).toBe(true);
    expect(unowned(readFileSync(CODEOWNERS, "utf8"))).toEqual([]);
  });
});
