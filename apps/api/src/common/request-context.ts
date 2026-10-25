import { AsyncLocalStorage } from 'async_hooks';

// Per-request facts that services deep in the call chain need but that
// aren't worth threading through every signature. Opened by a middleware in
// main.ts for each HTTP request; filled in by the auth guards.
export interface RequestContext {
  // The workspace API key the request authenticated with, if any.
  apiKey?: { id: string; name: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run: <T>(callback: () => T): T => storage.run({}, callback),
  get: (): RequestContext | undefined => storage.getStore(),
};
