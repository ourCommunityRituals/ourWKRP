#!/usr/bin/env node
// Set up, or rotate, the deploy secrets for ourWKRP (OW-154 steps 2-4).
//
//   node scripts/ops/rotate-deploy-keys.mjs [--env staging|production|both] [--dry-run]
//
// Run it on your own computer, never in CI and never in a chat session: it
// handles two secrets, and neither should leave your machine except to the
// service it belongs to.
//
// For each environment it:
//   1. makes the Doppler deploy environment (stg_deploy / prd_deploy) if it is
//      missing. These are root environments, not branches of stg / prd, so they
//      inherit no runtime secret (ADR-012 §3);
//   2. stores the Cloudflare token as CLOUDFLARE_API_TOKEN_OW in that config;
//   3. makes a new read-only Doppler service token for that config, and saves
//      it as the GitHub environment secret DOPPLER_TOKEN_STG / DOPPLER_TOKEN_PRD
//      (it goes straight from Doppler to `gh`, and is never printed);
//   4. revokes the older `github-actions-*` service tokens of that config, and
//      deletes a repository-level secret of the same name, which the
//      environment secret replaces.
// Re-run it at every 90-day rotation, after making the new Cloudflare token.
//
// What it needs:
//   - DOPPLER_ADMIN_TOKEN: a Doppler personal token that can edit project
//     ourwkrp. If unset, the script asks the Doppler CLI for the token you are
//     logged in with (`doppler configure get token --plain`).
//   - `gh`, logged in as a repo admin of ourCommunityRituals/ourWKRP.
//   - The Cloudflare token (ourwkrp-ci-deploy). It is read from a hidden prompt,
//     or from stdin when piped, so it never sits in your shell history:
//       Windows PowerShell:  Get-Clipboard | node scripts/ops/rotate-deploy-keys.mjs
//       macOS:               pbpaste | node scripts/ops/rotate-deploy-keys.mjs
//
// --dry-run reads Doppler and GitHub, prints what it would change, and writes
// nothing. DOPPLER_API_URL overrides the Doppler API (tests only).
import { spawn } from "node:child_process";

const PROJECT = "ourwkrp";
const REPO = "ourCommunityRituals/ourWKRP";
const SECRET_NAME = "CLOUDFLARE_API_TOKEN_OW";
const TOKEN_PREFIX = "github-actions-";
const API = (process.env.DOPPLER_API_URL || "https://api.doppler.com").replace(/\/$/, "");

const TARGETS = {
  staging: { config: "stg_deploy", name: "Staging deploy", ghEnv: "staging", ghSecret: "DOPPLER_TOKEN_STG" },
  production: { config: "prd_deploy", name: "Production deploy", ghEnv: "production", ghSecret: "DOPPLER_TOKEN_PRD" },
};

class Stop extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const opts = { env: "both", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--env") opts.env = argv[++i];
    else if (a.startsWith("--env=")) opts.env = a.slice(6);
    else throw new Stop(`unknown argument: ${a}`, 2);
  }
  if (!["staging", "production", "both"].includes(opts.env)) {
    throw new Stop("--env must be staging, production or both", 2);
  }
  opts.targets = opts.env === "both" ? [TARGETS.staging, TARGETS.production] : [TARGETS[opts.env]];
  return opts;
}

/** Run a command; stdin is `input`. Output is captured, never echoed. */
function run(cmd, args, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: 127, stdout: "", stderr: String(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function gh(args, input) {
  const r = await run("gh", args, input);
  if (r.code !== 0) throw new Stop(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim() || `exit ${r.code}`}`);
  return r.stdout;
}

async function doppler(token, method, path, { query, body } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Doppler's own error text, never the response body (it can hold values). */
function dopplerError(what, r) {
  const msgs = Array.isArray(r.data?.messages) ? r.data.messages.join("; ") : "";
  return new Stop(`Doppler ${what} failed (HTTP ${r.status})${msgs ? `: ${msgs}` : ""}`);
}

async function dopplerToken() {
  const fromEnv = (process.env.DOPPLER_ADMIN_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const r = await run("doppler", ["configure", "get", "token", "--plain"]);
  const t = r.code === 0 ? r.stdout.trim() : "";
  if (!t) {
    throw new Stop(
      "No Doppler token. Set DOPPLER_ADMIN_TOKEN to a personal token that can edit project ourwkrp, or run `doppler login` first.",
      2,
    );
  }
  return t;
}

/** The Cloudflare token: a hidden prompt on a terminal, else all of stdin. */
async function readCloudflareToken() {
  const fromEnv = (process.env[SECRET_NAME] || "").trim();
  if (fromEnv) return fromEnv;
  const stdin = process.stdin;
  let value = "";
  if (stdin.isTTY) {
    process.stderr.write("Paste the Cloudflare token ourwkrp-ci-deploy (hidden), then Enter: ");
    value = await new Promise((resolve) => {
      let buf = "";
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === "\u0003") {
            stdin.setRawMode(false);
            process.stderr.write("\n");
            process.exit(130);
          } else if (ch === "\r" || ch === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stderr.write("\n");
            resolve(buf);
            return;
          } else if (ch === "\u007f" || ch === "\b") {
            buf = buf.slice(0, -1);
          } else {
            buf += ch;
          }
        }
      };
      stdin.on("data", onData);
      stdin.resume();
    });
  } else {
    for await (const chunk of stdin) value += chunk;
  }
  value = value.trim();
  if (!value) throw new Stop("No Cloudflare token was given.", 2);
  if (/\s/.test(value)) throw new Stop("The Cloudflare token has a space or line break in it; copy it again.", 2);
  return value;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

async function ensureEnvironment(token, t, dryRun) {
  const got = await doppler(token, "GET", "/v3/environments/environment", {
    query: { project: PROJECT, environment: t.config },
  });
  if (got.status === 200) {
    console.log(`  Doppler environment ${t.config}: exists`);
    return;
  }
  if (got.status !== 404) throw dopplerError(`read of environment ${t.config}`, got);
  if (dryRun) {
    console.log(`  Doppler environment ${t.config}: missing, would create it`);
    return;
  }
  const made = await doppler(token, "POST", "/v3/environments", {
    query: { project: PROJECT },
    body: { name: t.name, slug: t.config },
  });
  if (made.status !== 200 && made.status !== 201) throw dopplerError(`create of environment ${t.config}`, made);
  console.log(`  Doppler environment ${t.config}: created`);
}

async function listOurTokens(token, t) {
  const r = await doppler(token, "GET", "/v3/configs/config/tokens", {
    query: { project: PROJECT, config: t.config },
  });
  if (r.status === 404) return [];
  if (r.status !== 200) throw dopplerError(`list of service tokens in ${t.config}`, r);
  return (r.data?.tokens ?? []).filter((x) => typeof x?.name === "string" && x.name.startsWith(TOKEN_PREFIX));
}

async function revokeToken(token, t, slug) {
  const r = await doppler(token, "DELETE", "/v3/configs/config/tokens/token", {
    body: { project: PROJECT, config: t.config, slug },
  });
  if (r.status !== 200 && r.status !== 204) throw dopplerError(`revoke of service token ${slug}`, r);
}

async function repoSecretNames(args) {
  const out = await gh(["secret", "list", ...args, "--repo", REPO, "--json", "name"]);
  try {
    return new Set(JSON.parse(out || "[]").map((s) => s.name));
  } catch {
    throw new Stop("gh secret list did not return JSON");
  }
}

async function setUp(token, t, cfToken, dryRun) {
  console.log(`\n${t.ghEnv} (Doppler ${PROJECT}/${t.config} -> GitHub ${t.ghEnv}/${t.ghSecret})`);
  await ensureEnvironment(token, t, dryRun);
  const old = await listOurTokens(token, t);

  if (dryRun) {
    console.log(`  would set ${SECRET_NAME} in ${t.config}`);
    console.log(`  would make a read-only service token and save it as ${t.ghSecret} in GitHub environment ${t.ghEnv}`);
    console.log(`  would revoke ${old.length} older ${TOKEN_PREFIX}* token(s)`);
    return;
  }

  const set = await doppler(token, "POST", "/v3/configs/config/secrets", {
    body: { project: PROJECT, config: t.config, secrets: { [SECRET_NAME]: cfToken } },
  });
  if (set.status !== 200) throw dopplerError(`write of ${SECRET_NAME} to ${t.config}`, set);
  console.log(`  ${SECRET_NAME}: stored in ${t.config}`);

  const name = `${TOKEN_PREFIX}${stamp()}`;
  const made = await doppler(token, "POST", "/v3/configs/config/tokens", {
    body: { project: PROJECT, config: t.config, name, access: "read" },
  });
  const key = made.data?.token?.key ?? made.data?.key;
  const slug = made.data?.token?.slug ?? made.data?.slug;
  if (made.status !== 200 || typeof key !== "string" || !key) {
    throw dopplerError(`create of service token in ${t.config}`, made);
  }

  try {
    await gh(["api", "--method", "PUT", `repos/${REPO}/environments/${t.ghEnv}`, "--silent"]);
    await gh(["secret", "set", t.ghSecret, "--env", t.ghEnv, "--repo", REPO], key);
  } catch (err) {
    // GitHub did not take the new token: revoke it, keep the old ones working.
    if (slug) await revokeToken(token, t, slug).catch(() => {});
    throw err;
  }
  console.log(`  ${t.ghSecret}: new read-only service token ${name} saved in GitHub environment ${t.ghEnv}`);

  for (const o of old) {
    if (o.slug) {
      await revokeToken(token, t, o.slug);
      console.log(`  revoked older service token ${o.name}`);
    }
  }

  const repoLevel = await repoSecretNames([]);
  if (repoLevel.has(t.ghSecret)) {
    await gh(["secret", "delete", t.ghSecret, "--repo", REPO]);
    console.log(`  deleted the repository-level ${t.ghSecret} (the environment secret replaces it)`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const auth = await run("gh", ["auth", "status"]);
  if (auth.code !== 0) throw new Stop("gh is not logged in. Run `gh auth login` first.", 2);

  const token = await dopplerToken();
  const me = await doppler(token, "GET", "/v3/me");
  if (me.status !== 200) throw dopplerError("token check", me);

  const cfToken = opts.dryRun ? "" : await readCloudflareToken();
  for (const t of opts.targets) await setUp(token, t, cfToken, opts.dryRun);

  if (!opts.dryRun) {
    console.log("\nGitHub now holds (names only):");
    for (const t of opts.targets) {
      const names = await repoSecretNames(["--env", t.ghEnv]);
      console.log(`  ${t.ghEnv}: ${[...names].sort().join(", ") || "(none)"}`);
    }
    console.log("\nNext: re-run the deploy job. Its first step checks the token reached it.");
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Stop ? err.message : err?.message || err}`);
  process.exit(err instanceof Stop ? err.code : 1);
});
