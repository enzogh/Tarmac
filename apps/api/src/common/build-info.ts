import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

let cachedVersion: string | null = null;

// Internal sentinel for "couldn't determine a real version" (no .git dir -
// e.g. inside the API's Docker image, see .dockerignore - and no
// TARMAC_CONTROL_VERSION env var set either). This must never be shown to a
// user verbatim - it's an untranslated English fallback that reads as
// broken/garbled (e.g. "réf. unknown") once dropped into a French UI string,
// and easy to misread as an actual value instead of "no data". Callers that
// expose this to the frontend should check isKnownControlPlaneVersion()
// first and substitute a real "not available" message instead.
const UNKNOWN_CONTROL_VERSION = 'unknown';

/**
 * Short git commit SHA the running API was built from. Resolved once at
 * runtime from the repository checked out on disk (or TARMAC_CONTROL_VERSION
 * as a fallback for environments without a .git directory), so it always
 * reflects the deployed commit with no manual version bump.
 */
export function getControlPlaneVersion(): string {
  if (cachedVersion) return cachedVersion;

  const envVersion = process.env.TARMAC_CONTROL_VERSION?.trim();
  const gitRoot = findGitRoot(__dirname);
  if (gitRoot) {
    try {
      const sha = execFileSync('git', ['-C', gitRoot, 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (sha) {
        cachedVersion = sha;
        return cachedVersion;
      }
    } catch {
      // fall through to env/unknown below
    }
  }

  cachedVersion = envVersion || UNKNOWN_CONTROL_VERSION;
  return cachedVersion;
}

export function isKnownControlPlaneVersion(version: string): boolean {
  return version !== UNKNOWN_CONTROL_VERSION;
}
