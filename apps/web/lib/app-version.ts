const DEFAULT_VERSION = 'dev-local';

function normalizeSha(value: string): string {
  return value.slice(0, 7);
}

export function getAppVersion(): string {
  const explicitVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }

  const gitSha = process.env.GITHUB_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (gitSha) {
    return normalizeSha(gitSha);
  }

  return DEFAULT_VERSION;
}
