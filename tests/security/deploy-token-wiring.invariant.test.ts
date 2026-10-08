/**
 * OW-152 — the deploy jobs get the Cloudflare token from a Doppler deploy config, and say so when it is missing.
 *
 * Every deploy from June to October 2026 failed at its first wrangler call:
 * each step set CLOUDFLARE_API_TOKEN from `secrets.CLOUDFLARE_API_TOKEN`, a
 * GitHub secret that was never created, and wrangler only said "non-interactive
 * environment". Secrets live in Doppler.
 *
 * ADR-012 §3 adds that a deploy key lives in its own Doppler config
 * (stg_deploy, prd_deploy), never in the runtime configs (stg, prd) that can
 * reach the Worker. Its stored name is OW's own, CLOUDFLARE_API_TOKEN_OW, and
 * scripts/ci/wrangler-ci.sh hands it to wrangler as CLOUDFLARE_API_TOKEN.
 *
 * This test locks, for both deploy jobs:
 *   1. no step sets either token name itself (Doppler is the only source);
 *   2. every step that calls wrangler runs it as
 *      `doppler run -- bash scripts/ci/wrangler-ci.sh <that job's deploy config>`;
 *   3. a named `wrangler-ci.sh <config> check` step runs before the first
 *      wrangler step;
 *   4. each Doppler step uses that job's service token (STG for staging, PRD
 *      for production).
 * The detectors run on synthetic workflows first, so they cannot pass
 * vacuously. The script itself runs against a stub npx, with no network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");
const SCRIPT_REL = "scripts/ci/wrangler-ci.sh";

const DEPLOY_JOBS: Record<string, { config: string; secret: string }> = {
  "deploy-staging": { config: "stg_deploy", secret: "DOPPLER_TOKEN_STG" },
  "deploy-production": { config: "prd_deploy", secret: "DOPPLER_TOKEN_PRD" },
};
const CHECK_NAME = /name:\s*Doppler provides the deploy token/;

/** The text of one top-level job (two-space indent under `jobs:`). */
function jobText(workflow: string, name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:[ \\t]*\\r?$`, "m"));
  if (start === -1) return "";
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:[ \t]*\r?$/m);
  return next === -1
    ? workflow.slice(start)
    : workflow.slice(start, start + 1 + next);
}

/** The job's steps, each as its own text block. */
function steps(job: string): string[] {
  return job.split(/^ {6}- /m).slice(1);
}

/** Everything wrong with how one deploy job gets its Cloudflare token. */
function auditJob(
  workflow: string,
  name: string,
  config: string,
  secret: string,
): string[] {
  const job = jobText(workflow, name);
  if (!job) return ["job not found"];
  const out: string[] = [];
  const list = steps(job);
  const viaScript = `doppler run -- bash ${SCRIPT_REL} ${config} `;

  list.forEach((s, i) => {
    if (/^\s+CLOUDFLARE_API_TOKEN(_OW)?:/m.test(s)) {
      out.push(`step ${i} sets the Cloudflare token itself`);
    }
    const run = /run:\s*(.*)/.exec(s)?.[1] ?? "";
    if (/wrangler/.test(run) && !run.startsWith(viaScript)) {
      out.push(`step ${i} calls wrangler without ${SCRIPT_REL} ${config}`);
    }
    const token = /DOPPLER_TOKEN:\s*\$\{\{\s*secrets\.(\w+)/.exec(s)?.[1];
    if (token && token !== secret) {
      out.push(`step ${i} uses ${token}, not ${secret}`);
    }
  });

  const isCheck = (s: string) =>
    (/run:\s*(.*)/.exec(s)?.[1] ?? "").trim() === `${viaScript}check`;
  const firstWrangler = list.findIndex(
    (s) => /run:.*wrangler/.test(s) && !isCheck(s),
  );
  const check = list.findIndex(isCheck);
  if (firstWrangler === -1) out.push("no wrangler step found");
  if (check === -1) out.push("no deploy token check");
  else if (!CHECK_NAME.test(list[check])) out.push("token check has no named step");
  else if (firstWrangler !== -1 && check > firstWrangler) {
    out.push("token check runs after the first wrangler step");
  }
  return out;
}

/** A minimal deploy job built from step snippets, for the detector self-tests. */
function synthetic(stepsYaml: string[]): string {
  return [
    "jobs:",
    "  deploy-staging:",
    "    steps:",
    ...stepsYaml,
    "  other:",
    "    steps: []",
  ].join("\n");
}
const audit = (w: string) =>
  auditJob(w, "deploy-staging", "stg_deploy", "DOPPLER_TOKEN_STG");

const STG = "          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN_STG }}";
const CHECK_STEP = [
  "      - name: Doppler provides the deploy token (stg_deploy)",
  `        run: doppler run -- bash ${SCRIPT_REL} stg_deploy check`,
  "        env:",
  STG,
];
const GOOD_DEPLOY = [
  "      - name: Deploy",
  `        run: doppler run -- bash ${SCRIPT_REL} stg_deploy deploy`,
  "        env:",
  STG,
];

describe("OW-152 | deploy token wiring detectors (not vacuous)", () => {
  it("a correct job has no findings", () => {
    expect(audit(synthetic([...CHECK_STEP, ...GOOD_DEPLOY]))).toEqual([]);
  });

  it("flags a step that sets the token from a GitHub secret (the June bug)", () => {
    for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_OW"]) {
      const bad = synthetic([
        ...CHECK_STEP,
        ...GOOD_DEPLOY,
        `          ${key}: \${{ secrets.${key} }}`,
      ]);
      expect(audit(bad)).toEqual(["step 1 sets the Cloudflare token itself"]);
    }
  });

  it("flags wrangler called directly, or through the script with another job's config", () => {
    for (const run of [
      "doppler run -- npx wrangler deploy",
      "npx wrangler deploy",
      `doppler run -- bash ${SCRIPT_REL} prd_deploy deploy`,
    ]) {
      const bad = synthetic([
        ...CHECK_STEP,
        "      - name: Deploy",
        `        run: ${run}`,
      ]);
      expect(audit(bad)).toEqual([
        `step 1 calls wrangler without ${SCRIPT_REL} stg_deploy`,
      ]);
    }
  });

  it("flags the production service token in the staging job", () => {
    const bad = synthetic([
      ...CHECK_STEP,
      ...GOOD_DEPLOY.slice(0, 3),
      "          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN_PRD }}",
    ]);
    expect(audit(bad)).toEqual([
      "step 1 uses DOPPLER_TOKEN_PRD, not DOPPLER_TOKEN_STG",
    ]);
  });

  it("flags a missing check, an unnamed one, and one after the first wrangler step", () => {
    expect(audit(synthetic(GOOD_DEPLOY))).toEqual(["no deploy token check"]);
    expect(
      audit(synthetic(["      - name: Check", ...CHECK_STEP.slice(1), ...GOOD_DEPLOY])),
    ).toEqual(["token check has no named step"]);
    expect(audit(synthetic([...GOOD_DEPLOY, ...CHECK_STEP]))).toEqual([
      "token check runs after the first wrangler step",
    ]);
  });
});

describe("OW-152 | ci.yml deploy jobs take the Cloudflare token from their Doppler deploy config", () => {
  for (const [name, { config, secret }] of Object.entries(DEPLOY_JOBS)) {
    it(`${name}: ${config} via ${secret}, checked before wrangler`, () => {
      expect(auditJob(ci, name, config, secret)).toEqual([]);
    });
  }
});

describe("OW-152 | wrangler-ci.sh", () => {
  let dir: string, log: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wrangler-ci-"));
    log = join(dir, "npx.log");
    // Stub npx: records its arguments and which token names it can see.
    writeFileSync(
      join(dir, "npx"),
      [
        "#!/usr/bin/env bash",
        'printf "%s | api=%s | ow=%s\\n" "$*" "${CLOUDFLARE_API_TOKEN:-unset}" "${CLOUDFLARE_API_TOKEN_OW:-unset}" >> "$STUB_LOG"',
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "npx"), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(args: string[], env: Record<string, string>) {
    const res = spawnSync("bash", [join(ROOT, SCRIPT_REL), ...args], {
      encoding: "utf-8",
      env: {
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        STUB_LOG: log,
        ...env,
      },
    });
    const calls = existsSync(log)
      ? readFileSync(log, "utf-8").trim().split("\n")
      : [];
    return { code: res.status, out: `${res.stdout}${res.stderr}`, calls };
  }
  const STG_ENV = {
    DOPPLER_PROJECT: "ourwkrp",
    DOPPLER_CONFIG: "stg_deploy",
    CLOUDFLARE_API_TOKEN_OW: "tok-test",
  };

  it("hands wrangler the token as CLOUDFLARE_API_TOKEN and nothing under the stored name", () => {
    const r = run(["stg_deploy", "d1", "migrations", "apply", "ourwkrp-staging", "--remote"], STG_ENV);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      "wrangler d1 migrations apply ourwkrp-staging --remote | api=tok-test | ow=unset",
    ]);
  });

  it("check mode confirms the token and never calls wrangler", () => {
    const r = run(["stg_deploy", "check"], STG_ENV);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Doppler ourwkrp/stg_deploy provides CLOUDFLARE_API_TOKEN_OW.");
    expect(r.calls).toEqual([]);
  });

  it("refuses a service token for a runtime config, another project, or the other deploy config", () => {
    for (const [project, config] of [
      ["ourwkrp", "stg"],
      ["ourwkrp", "prd_deploy"],
      ["oursharedevents", "stg_deploy"],
    ]) {
      const r = run(["stg_deploy", "deploy"], {
        ...STG_ENV,
        DOPPLER_PROJECT: project,
        DOPPLER_CONFIG: config,
      });
      expect(r.code).toBe(1);
      expect(r.out).toContain(
        `::error title=Wrong Doppler config::The Doppler service token reads ${project}/${config}.`,
      );
      expect(r.calls).toEqual([]);
    }
  });

  it("refuses when Doppler did not say which config it read", () => {
    const r = run(["stg_deploy", "check"], { CLOUDFLARE_API_TOKEN_OW: "tok-test" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("reads ?/?");
  });

  it("names the missing token, and does not fall back to a generic CLOUDFLARE_API_TOKEN", () => {
    const r = run(["stg_deploy", "deploy"], {
      DOPPLER_PROJECT: "ourwkrp",
      DOPPLER_CONFIG: "stg_deploy",
      CLOUDFLARE_API_TOKEN: "tok-generic",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "::error title=Deploy token missing::CLOUDFLARE_API_TOKEN_OW is not set in the Doppler stg_deploy config (project ourwkrp).",
    );
    expect(r.calls).toEqual([]);
  });

  it("rejects an unknown config and a missing command as usage errors", () => {
    expect(run(["stg", "deploy"], STG_ENV).code).toBe(2);
    expect(run(["stg_deploy"], STG_ENV).code).toBe(2);
  });

  it("is executable in git and has LF line endings", () => {
    const mode = spawnSync("git", ["ls-files", "-s", SCRIPT_REL], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(mode.stdout).toMatch(/^100755 /);
    expect(readFileSync(join(ROOT, SCRIPT_REL), "utf-8")).not.toContain("\r");
  });
});
