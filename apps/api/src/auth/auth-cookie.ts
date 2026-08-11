// Shared by every place that sets/reads the session cookie (password login,
// SSO callback, the passport JWT strategy) so they can never drift apart.
export const AUTH_COOKIE_NAME = 'tarmac_token';
export const AUTH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}
