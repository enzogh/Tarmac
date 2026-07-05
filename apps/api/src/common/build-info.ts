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

  cachedVersion = envVersion || 'unknown';
  return cachedVersion;
}
