/**
 * SupersetClient: HTTP client for the Superset REST API.
 *
 * Handles Authorization headers, CSRF tokens (with automatic retry on CSRF errors),
 * and Rison-encoded query parameters for GET requests.
 */

import { AuthManager } from "./auth";
import { encodeRison, RisonValue } from "../utils/rison";

type FetchFn = typeof globalThis.fetch;

/**
 * Thin HTTP wrapper around the Superset REST API.
 *
 * All methods prepend the base URL obtained from `AuthManager` and attach
 * the appropriate Authorization / X-CSRFToken headers. POST/PUT automatically
 * retry once when the server returns a CSRF-related 400 error.
 *
 * Accepts an optional `fetchFn` for dependency injection in tests.
 */
export class SupersetClient {
  private readonly auth: AuthManager;
  private readonly fetchFn: FetchFn;

  constructor(auth: AuthManager, fetchFn?: FetchFn) {
    this.auth = auth;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Issue a GET request, optionally encoding `params` as a Rison `q=` query string.
   */
  async get<T>(path: string, params?: Record<string, RisonValue>): Promise<T> {
    let url = `${this.auth.getBaseUrl()}${path}`;
    if (params && Object.keys(params).length > 0) {
      // Superset accepts Rison directly in the q parameter without percent-encoding
      url += `?q=${encodeRison(params)}`;
    }
    const resp = await this.fetchFn(url, {
      headers: await this.buildHeaders(),
    });
    return this.handleResponse<T>(resp);
  }

  /** Issue a POST request with a JSON body. Retries once on CSRF errors. */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.mutate<T>("POST", path, body);
  }

  /** Issue a PUT request with a JSON body. Retries once on CSRF errors. */
  async put<T>(path: string, body: unknown): Promise<T> {
    return this.mutate<T>("PUT", path, body);
  }

  /** Issue a DELETE request. */
  async del(path: string): Promise<void> {
    const resp = await this.fetchFn(`${this.auth.getBaseUrl()}${path}`, {
      method: "DELETE",
      headers: await this.buildHeaders(true),
    });
    if (!resp.ok) {
      await this.throwApiError(resp);
    }
  }

  /** Return true if the underlying AuthManager reports it holds an access token. */
  isConnected(): boolean {
    return this.auth.isAuthenticated();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute a mutating request (POST/PUT) and retry once if the server
   * responds with a CSRF-related 400 error.
   */
  private async mutate<T>(
    method: string,
    path: string,
    body: unknown
  ): Promise<T> {
    const doRequest = async (): Promise<Response> =>
      this.fetchFn(`${this.auth.getBaseUrl()}${path}`, {
        method,
        headers: await this.buildHeaders(true),
        body: JSON.stringify(body),
      });

    let resp = await doRequest();

    if (resp.status === 400) {
      const errBody = await resp.json().catch(() => ({}));
      const msg = String((errBody as any).message ?? "");
      if (msg.includes("CSRF")) {
        // Refresh CSRF token and retry exactly once
        await this.auth.refreshCsrfToken();
        resp = await doRequest();
      } else {
        throw new Error(msg || `Request failed (HTTP 400)`);
      }
    }

    return this.handleResponse<T>(resp);
  }

  /**
   * Build the standard request headers.
   * @param includeCsrf - when true, adds the X-CSRFToken header
   */
  private async buildHeaders(
    includeCsrf = false
  ): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (includeCsrf) {
      const csrf = this.auth.getCsrfToken();
      if (csrf) {
        headers["X-CSRFToken"] = csrf;
      }
    }
    return headers;
  }

  /** Parse a successful response as JSON, or throw on HTTP error. */
  private async handleResponse<T>(resp: Response): Promise<T> {
    if (!resp.ok) {
      await this.throwApiError(resp);
    }
    return (await resp.json()) as T;
  }

  /** Parse the error body and throw a descriptive Error. */
  private async throwApiError(resp: Response): Promise<never> {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      (body as any).message ?? `Superset API error (HTTP ${resp.status})`
    );
  }
}
