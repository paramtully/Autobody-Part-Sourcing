/**
 * Thin helper for mocking global.fetch in Jest tests.
 * Each entry in the map is consumed in order (like jest.fn().mockResolvedValueOnce).
 */
export function mockFetchOnce(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const { status = 200, headers = { 'Content-Type': 'application/json' } } = init;
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers }),
  );
}

/**
 * Queue multiple fetch responses to be consumed in sequence.
 * Returns the spy so callers can assert call count / args.
 */
export function mockFetchSequence(responses: Array<{ body: unknown; status?: number; headers?: Record<string, string> }>) {
  const spy = jest.spyOn(global, 'fetch');
  for (const { body, status = 200, headers = { 'Content-Type': 'application/json' } } of responses) {
    spy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers }));
  }
  return spy;
}

/** Restore the real global.fetch (call in afterEach). */
export function restoreFetch() {
  jest.restoreAllMocks();
}
