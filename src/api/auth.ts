/**
 * AuthManager: handles JWT login, token refresh, CSRF token fetching,
 * and password storage via VS Code SecretStorage.
 */

import * as vscode from "vscode";
import { ConnectionConfig } from "../utils/config";

type FetchFn = typeof globalThis.fetch;

/**
 * Manages authentication state for a single Superset connection.
 *
 * Stores access/refresh tokens in memory and passwords in VS Code SecretStorage.
 * Accepts an optional `fetchFn` for dependency injection in tests.
 */
export class AuthManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private csrfToken: string | null = null;
  private readonly baseUrl: string;
  private readonly connection: ConnectionConfig;
  private readonly secrets: vscode.SecretStorage;
  private readonly fetchFn: FetchFn;

  constructor(
    connection: ConnectionConfig,
    secrets: vscode.SecretStorage,
    fetchFn?: FetchFn
  ) {
    this.connection = connection;
    this.baseUrl = connection.url.replace(/\/+$/, "");
    this.secrets = secrets;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Authenticate against Superset with the given password.
   * On success, stores access/refresh tokens and fetches a CSRF token.
   */
  async login(password: string): Promise<void> {
    const resp = await this.fetchFn(`${this.baseUrl}/api/v1/security/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.connection.username,
        password,
        provider: "db",
      }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(
        (body as any).message ?? `Login failed (HTTP ${resp.status})`
      );
    }
    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
    };
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    await this.fetchCsrfToken();
  }

  /**
   * Exchange the stored refresh token for a new access token.
   * Clears tokens on failure so the caller knows re-authentication is needed.
   */
  async refresh(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("No refresh token available");
    }
    const resp = await this.fetchFn(`${this.baseUrl}/api/v1/security/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.refreshToken}`,
      },
    });
    if (!resp.ok) {
      this.accessToken = null;
      this.refreshToken = null;
      throw new Error("Token refresh failed — please re-authenticate");
    }
    const data = (await resp.json()) as { access_token: string };
    this.accessToken = data.access_token;
  }

  /** Fetch a fresh CSRF token using the current access token. */
  private async fetchCsrfToken(): Promise<void> {
    const resp = await this.fetchFn(
      `${this.baseUrl}/api/v1/security/csrf_token/`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    if (resp.ok) {
      const data = (await resp.json()) as { result: string };
      this.csrfToken = data.result;
    }
  }

  /** Publicly refresh the CSRF token (called by SupersetClient on CSRF errors). */
  async refreshCsrfToken(): Promise<void> {
    await this.fetchCsrfToken();
  }

  /**
   * Return the current access token.
   * @throws if not authenticated
   */
  async getAccessToken(): Promise<string> {
    if (!this.accessToken) {
      throw new Error("Not authenticated");
    }
    return this.accessToken;
  }

  /** Return the current CSRF token, or null if not yet fetched. */
  getCsrfToken(): string | null {
    return this.csrfToken;
  }

  /** Return true if an access token is held in memory. */
  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /** Retrieve the stored password for this connection from SecretStorage. */
  async getPassword(): Promise<string | undefined> {
    return this.secrets.get(`superset.password.${this.connection.name}`);
  }

  /** Persist the password for this connection in SecretStorage. */
  async storePassword(password: string): Promise<void> {
    await this.secrets.store(
      `superset.password.${this.connection.name}`,
      password
    );
  }

  /** Remove the stored password for this connection from SecretStorage. */
  async clearPassword(): Promise<void> {
    await this.secrets.delete(`superset.password.${this.connection.name}`);
  }

  /** Return the human-readable name of this connection. */
  getConnectionName(): string {
    return this.connection.name;
  }

  /** Return the base URL (trailing slash stripped). */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
