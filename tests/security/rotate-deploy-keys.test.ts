/**
 * OW-154 — scripts/ops/rotate-deploy-keys.mjs sets up and rotates the deploy secrets.
 *
 * It runs against a local Doppler stand-in and a stub `gh`, with no network.
 * The tests lock what makes it safe to run:
 *   - the deploy configs are root environments (stg_deploy, prd_deploy), made
 *     only when missing, and only CLOUDFLARE_API_TOKEN_OW is written to them;
 *   - the service token is read-only, goes from Doppler to `gh secret set` on
 *     stdin, and neither it nor the Cloudflare token is ever printed;
 *   - older github-actions-* tokens are revoked only after GitHub took the new
 *     one; when GitHub refuses, the new token is revoked and the old ones stay;
 *   - --dry-run writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts/ops/rotate-deploy-keys.mjs");
const CF = "cf-secret-value-123";

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
}

let server: Server;
let api = "";
let calls: Call[] = [];
let envs: Set<string>;
let tokens: Record<string, { name: string; slug: string }[]>;
let dir = "";
let n = 0;

function startDoppler(): Promise<void> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      const query = Object.fromEntries(url.searchParams);
      calls.push({ method: req.method ?? "", path: url.pathname, query, body });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const key = `${req.method} ${url.pathname}`;
      if (key === "GET /v3/me") return send(200, { workplace: { name: "t" } });
      if (key === "GET /v3/environments/environment")
        return envs.has(query.environment) ? send(200, { environment: { id: query.environment } }) : send(404, { messages: ["not found"] });
      if (key === "POST /v3/environments") {
        envs.add(body.slug);
        return send(200, { environment: { id: body.slug } });
      }
      if (key === "GET /v3/configs/config/tokens") return send(200, { tokens: tokens[query.config] ?? [] });
      if (key === "POST /v3/configs/config/secrets") return send(200, { secrets: body.secrets });
      if (key === "POST /v3/configs/config/tokens") {
        const slug = `slug-new-${++n}`;
        (tokens[body.config] ??= []).push({ name: body.name, slug });
        return send(200, { token: { name: body.name, slug, key: `dp.st.${body.config}.KEY${n}` } });
      }
      if (key === "DELETE /v3/configs/config/tokens/token") {
        tokens[body.config] = (tokens[body.config] ?? []).filter((t) => t.slug !== body.slug);
        return send(200, { success: true });
      }
      send(500, { messages: [`unexpected ${key}`] });
    });
  });
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () => {
      api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      r();
    }),
  );
}

/** A stub gh: logs each call (args + stdin), answers `secret list` from a file. */
function writeGh(opts: { failSecretSet?: boolean; repoSecrets?: string[] }) {
  writeFileSync(join(dir, "repo-secrets.json"), JSON.stringify((opts.repoSecrets ?? []).map((name) => ({ name }))));
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
in="$(cat)"
printf '%s\\t%s\\n' "$*" "$in" >> "${dir}/gh.log"
case "$1 $2" in
  "auth status") exit 0 ;;
  "secret list")
    case " $* " in *" --env "*) echo '[{"name":"DOPPLER_TOKEN_STG"}]' ;; *) cat "${dir}/repo-secrets.json" ;; esac ;;
  "secret set") ${opts.failSecretSet ? 'echo "HTTP 403" >&2; exit 1' : "exit 0"} ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
}

function runScript(args: string[], stdin = CF): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        DOPPLER_API_URL: api,
        DOPPLER_ADMIN_TOKEN: "dp.pt.admin",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.stdin.end(stdin);
  });
}

const ghLog = () => (existsSync(join(dir, "gh.log")) ? readFileSync(join(dir, "gh.log"), "utf-8") : "");
const writes = () => calls.filter((c) => c.method !== "GET");

beforeEach(async () => {
  calls = [];
  n = 0;
  envs = new Set(["stg"]);
  tokens = { stg_deploy: [{ name: "github-actions-old", slug: "slug-old" }, { name: "laptop", slug: "slug-laptop" }] };
  dir = mkdtempSync(join(tmpdir(), "deploy-keys-"));
  await startDoppler();
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("OW-154 | rotate-deploy-keys.mjs", () => {
  it("makes the root deploy environments, stores only the Cloudflare token, saves read-only service tokens", async () => {
    writeGh({ repoSecrets: ["DOPPLER_TOKEN_STG", "LINEAR_API_KEY"] });
    const r = await runScript([]);
    expect(r.code, r.out).toBe(0);

    const made = calls.filter((c) => c.method === "POST" && c.path === "/v3/environments");
    expect(made.map((c) => [c.query.project, c.body.slug])).toEqual([
      ["ourwkrp", "stg_deploy"],
      ["ourwkrp", "prd_deploy"],
    ]);

    const secrets = calls.filter((c) => c.path === "/v3/configs/config/secrets");
    expect(secrets.map((c) => [c.body.project, c.body.config, c.body.secrets])).toEqual([
      ["ourwkrp", "stg_deploy", { CLOUDFLARE_API_TOKEN_OW: CF }],
      ["ourwkrp", "prd_deploy", { CLOUDFLARE_API_TOKEN_OW: CF }],
    ]);

    const made_tokens = calls.filter((c) => c.method === "POST" && c.path === "/v3/configs/config/tokens");
    expect(made_tokens.map((c) => [c.body.config, c.body.access])).toEqual([
      ["stg_deploy", "read"],
      ["prd_deploy", "read"],
    ]);

    const log = ghLog();
    expect(log).toContain("secret set DOPPLER_TOKEN_STG --env staging --repo ourCommunityRituals/ourWKRP\tdp.st.stg_deploy.KEY1");
    expect(log).toContain("secret set DOPPLER_TOKEN_PRD --env production --repo ourCommunityRituals/ourWKRP\tdp.st.prd_deploy.KEY2");
    expect(log).toContain("api --method PUT repos/ourCommunityRituals/ourWKRP/environments/production --silent");
  });

  it("never prints the Cloudflare token or a service token", async () => {
    writeGh({});
    const r = await runScript([]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(CF);
    expect(r.out).not.toMatch(/dp\.st\./);
    expect(r.out).not.toContain("dp.pt.admin");
  });

  it("rotation: revokes only older github-actions-* tokens, and the repository-level secret", async () => {
    writeGh({ repoSecrets: ["DOPPLER_TOKEN_STG"] });
    const r = await runScript(["--env", "staging"]);
    expect(r.code, r.out).toBe(0);
    const revoked = calls.filter((c) => c.method === "DELETE").map((c) => c.body.slug);
    expect(revoked).toEqual(["slug-old"]);
    expect(tokens.stg_deploy.map((t) => t.slug).sort()).toEqual(["slug-laptop", "slug-new-1"]);
    expect(ghLog()).toContain("secret delete DOPPLER_TOKEN_STG --repo ourCommunityRituals/ourWKRP");
  });

  it("when GitHub refuses the new token, revokes it and keeps the old ones", async () => {
    writeGh({ failSecretSet: true, repoSecrets: ["DOPPLER_TOKEN_STG"] });
    const r = await runScript(["--env", "staging"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("gh secret set");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.body.slug)).toEqual(["slug-new-1"]);
    expect(tokens.stg_deploy.map((t) => t.slug)).toContain("slug-old");
    expect(ghLog()).not.toContain("secret delete");
  });

  it("--dry-run writes nothing and asks for no Cloudflare token", async () => {
    writeGh({ repoSecrets: ["DOPPLER_TOKEN_STG"] });
    const r = await runScript(["--dry-run"], "");
    expect(r.code, r.out).toBe(0);
    expect(writes()).toEqual([]);
    expect(ghLog()).not.toMatch(/secret (set|delete)|--method PUT/);
    expect(r.out).toContain("would create it");
  });

  it("refuses without a Cloudflare token, before any write", async () => {
    writeGh({});
    const r = await runScript([], "");
    expect(r.code).toBe(2);
    expect(writes()).toEqual([]);
  });

  it("refuses an unknown --env", async () => {
    writeGh({});
    const r = await runScript(["--env", "prd"]);
    expect(r.code).toBe(2);
    expect(calls).toEqual([]);
  });
});
