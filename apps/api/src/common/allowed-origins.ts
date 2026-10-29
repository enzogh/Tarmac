const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'https://tarmac.casterot.com'];

// The browser origins allowed to call the API with the session cookie: CORS
// for REST, and the same list for the live WebSocket (which CORS does not
// cover, so a page on another site could otherwise open it with the cookie).
export function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  return configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}
