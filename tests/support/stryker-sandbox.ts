// Where a file under a Stryker sandbox's src/ came from (see
// tests/support/mutation-setup.ts). Kept apart from the setup file so its tests
// can import it without loading the setup's side effects.
import path from 'node:path';

/** Matches a Stryker sandbox directory and captures the project root above it. */
export const SANDBOX = /^(.*)[\\/]\.stryker-tmp[\\/]sandbox-[^\\/]+$/;

/**
 * The original path of `file` when `cwd` is a Stryker sandbox and `file` is
 * under the sandbox's src/; otherwise null.
 */
export function originalSourcePath(file: string, cwd: string): string | null {
  const match = SANDBOX.exec(cwd);
  if (!match) return null;
  const sandboxSrc = path.join(cwd, 'src') + path.sep;
  const resolved = path.resolve(cwd, file);
  if (!resolved.startsWith(sandboxSrc)) return null;
  return path.join(match[1], 'src', resolved.slice(sandboxSrc.length));
}
