/**
 * HTTP transport abstraction for vendor inventory clients.
 *
 * Provides a thin layer over `fetch` that allows swapping between
 * real HTTP calls and fixture-based responses. The vendor client
 * never knows which transport it's using.
 *
 * Two implementations:
 * - FetchHttpTransport: real HTTP via global `fetch`
 * - FixtureHttpTransport: returns pre-loaded fixture data matched by URL pattern
 */

/**
 * Structured HTTP response returned by the transport layer.
 */
export interface HttpResponse {
  /** HTTP status code. */
  readonly status: number;

  /** Response headers (lowercased keys). */
  readonly headers: Record<string, string>;

  /** Parsed response body (JSON-parsed if content-type is JSON, otherwise null). */
  readonly body: unknown;

  /** Raw response body as string (for raw payload logging and HTML parsing). */
  readonly rawBody: string;
}

/**
 * Transport-level error with status code and raw body for diagnostics.
 */
export class HttpTransportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Record<string, string>,
    public readonly rawBody: string
  ) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

/**
 * HTTP transport interface.
 * Vendor clients depend on this abstraction, not on `fetch` directly.
 */
export interface HttpTransport {
  /**
   * Perform an HTTP GET request.
   *
   * @param url - Full URL to request
   * @param headers - Optional request headers
   * @returns Structured HTTP response
   */
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;

  /**
   * Perform an HTTP POST request.
   *
   * @param url - Full URL to request
   * @param body - Request body (will be JSON-stringified)
   * @param headers - Optional request headers
   * @returns Structured HTTP response
   */
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse>;
}

/**
 * Real HTTP transport using the global `fetch` API.
 */
export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly timeoutMs: number = 30_000) {}

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request(url, {
      method: 'GET',
      headers: headers ?? {},
    });
  }

  async post(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  private async request(url: string, init: RequestInit): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      const rawBody = await response.text();

      // Normalize headers to lowercase keys
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      // Try to parse as JSON
      let body: unknown = null;
      const contentType = responseHeaders['content-type'] ?? '';
      if (contentType.includes('application/json') || this.looksLikeJson(rawBody)) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = null;
        }
      }

      return { status: response.status, headers: responseHeaders, body, rawBody };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error(`Request to ${url} timed out after ${this.timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }
}

/**
 * A registered fixture matched by URL pattern.
 */
export interface FixtureEntry {
  /** URL substring or regex pattern to match against the request URL. */
  readonly urlPattern: string | RegExp;

  /** The fixture response to return when the URL matches. */
  readonly response: HttpResponse;
}

/**
 * Fixture-based HTTP transport for testing and development without API keys.
 *
 * Matches request URLs against registered fixture patterns and returns
 * pre-loaded responses. If no fixture matches, throws an error.
 */
export class FixtureHttpTransport implements HttpTransport {
  private fixtures: FixtureEntry[] = [];

  /**
   * Register a fixture response for a URL pattern.
   *
   * @param urlPattern - String substring or RegExp to match against request URL
   * @param response - The response to return when matched
   */
  registerFixture(urlPattern: string | RegExp, response: HttpResponse): void {
    this.fixtures.push({ urlPattern, response });
  }

  /**
   * Register a JSON fixture response with default 200 OK headers.
   *
   * @param urlPattern - String substring or RegExp to match
   * @param body - The JSON body to return
   * @param status - HTTP status code (default: 200)
   * @param headers - Additional headers
   */
  registerJsonFixture(
    urlPattern: string | RegExp,
    body: unknown,
    status: number = 200,
    headers: Record<string, string> = {}
  ): void {
    const rawBody = JSON.stringify(body);
    this.registerFixture(urlPattern, {
      status,
      headers: { 'content-type': 'application/json', ...headers },
      body,
      rawBody,
    });
  }

  /**
   * Register an HTML fixture response.
   *
   * @param urlPattern - String substring or RegExp to match
   * @param html - The HTML string to return
   * @param status - HTTP status code (default: 200)
   */
  registerHtmlFixture(
    urlPattern: string | RegExp,
    html: string,
    status: number = 200
  ): void {
    this.registerFixture(urlPattern, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: null,
      rawBody: html,
    });
  }

  async get(url: string): Promise<HttpResponse> {
    return this.matchFixture(url);
  }

  async post(url: string): Promise<HttpResponse> {
    return this.matchFixture(url);
  }

  private matchFixture(url: string): HttpResponse {
    for (const fixture of this.fixtures) {
      if (typeof fixture.urlPattern === 'string') {
        if (url.includes(fixture.urlPattern)) {
          return fixture.response;
        }
      } else if (fixture.urlPattern.test(url)) {
        return fixture.response;
      }
    }

    throw new Error(
      `FixtureHttpTransport: no fixture registered for URL "${url}". ` +
      `Registered patterns: [${this.fixtures.map(f => String(f.urlPattern)).join(', ')}]`
    );
  }
}
