/**
 * scripts/smoke.mjs: a host it cannot reach reads differently from a failed control.
 *
 * Every smoke on main so far (run 40814266558 and the five before it) printed
 * five `fetch failed` lines as five failed controls, with fetch's real reason
 * dropped, so no log could say why (OW-181).
 *
 * Hermetic: the real script runs in a child process against a local HTTP server
 * or a closed local port, so no deployed host is touched. The server handles the
 * script's requests, so the child must not block this process's event loop.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'smoke.mjs');

const CONTROLS = [
  'rate-limiter reports a live backend (kv or durable)',
  'HTML page sets nonce CSP (no script unsafe-inline)',
  'JSON response uses default CSP script-src none',
  'cross-origin mutation is rejected (CSRF origin check)',
  'rate limiter returns 429 under burst',
];

type Run = { code: number; stdout: string; stderr: string };

const runSmoke = (base: string): Promise<Run> =>
  new Promise((resolve) => {
    // Vitest sets BASE_URL for itself, and the script reads that before its argument.
    const env = { ...process.env, BASE_URL: '' };
    execFile(process.execPath, [SCRIPT, base], { env }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code) : 0, stdout, stderr });
    });
  });

let server: Server | undefined;

const listen = (handler: RequestListener): Promise<string> =>
  new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server?.address() as AddressInfo).port}`);
    });
  });

const closedPort = async (): Promise<string> => {
  const base = await listen(() => undefined);
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
  return base;
};

afterEach(async () => {
  if (server) await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe('scripts/smoke.mjs reporting', () => {
  it('reports an unreachable host once, with the real cause, and names no control', async () => {
    const base = await closedPort();

    const { code, stdout, stderr } = await runSmoke(base);

    expect(code).toBe(1);
    expect(stderr).toContain(`could not connect to ${base}, so no control was tested`);
    expect(stderr).toContain('ECONNREFUSED');
    expect(stderr.trim().split('\n')).toHaveLength(2);
    for (const control of CONTROLS) expect(stderr).not.toContain(control);
    expect(stdout).toContain(`0/5 control checks ran against ${base}`);
  });

  it('still reports a reachable host that fails its controls as failed controls', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rate_limiter: 'none' }));
    });

    const { code, stdout, stderr } = await runSmoke(base);

    expect(code).toBe(1);
    for (const control of CONTROLS) expect(stderr).toContain(`✗ ${control}`);
    expect(stderr).not.toContain('could not connect');
    expect(stdout).toContain(`0/5 control checks passed against ${base}`);
  });

  it('marks the one check that lost its connection and leaves the others as controls', async () => {
    const base = await listen((req, res) => {
      if (req.url === '/api/tracks') {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rate_limiter: 'none' }));
    });

    const { code, stderr } = await runSmoke(base);

    expect(code).toBe(1);
    expect(stderr).not.toContain('so no control was tested');
    expect(stderr).toMatch(/✗ JSON response uses default CSP script-src none\n\s+could not connect: \S/);
    expect(stderr).toMatch(/✗ HTML page sets nonce CSP \(no script unsafe-inline\)\n\s+page CSP has no nonce/);
    expect(stderr).not.toContain('fetch failed');
  });

  it('keeps the cause, and never says could not connect, once the server has answered', async () => {
    const base = await listen((req, res) => {
      if (req.url === '/health') {
        // Headers arrive, then the body drops.
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
        res.write('{', () => req.socket.destroy());
        return;
      }
      if (req.url === '/api/tracks') {
        res.writeHead(302, { Location: '/api/tracks' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rate_limiter: 'none' }));
    });

    const { code, stderr } = await runSmoke(base);

    expect(code).toBe(1);
    expect(stderr).not.toContain('could not connect');
    expect(stderr).toMatch(/✗ rate-limiter reports a live backend \(kv or durable\)\n\s+\S+: \S/);
    expect(stderr).toMatch(/✗ JSON response uses default CSP script-src none\n\s+.*redirect count exceeded/);
  });
});
