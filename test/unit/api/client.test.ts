import * as assert from "assert";
import { SupersetClient } from "../../../src/api/client";
import { AuthManager } from "../../../src/api/auth";

function createMockAuth(overrides?: Partial<AuthManager>): AuthManager {
  return {
    getAccessToken: async () => "token123",
    getCsrfToken: () => "csrf456",
    isAuthenticated: () => true,
    refresh: async () => {},
    refreshCsrfToken: async () => {},
    getBaseUrl: () => "http://localhost:8088",
    ...overrides,
  } as AuthManager;
}

suite("SupersetClient", () => {
  test("GET request includes auth header and rison params", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url as string;
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return { ok: true, json: async () => ({ result: [1, 2, 3] }) } as Response;
    };

    const client = new SupersetClient(createMockAuth(), mockFetch as any);
    const result = await client.get<{ result: number[] }>("/api/v1/database/", { page: 0, page_size: 25 });

    assert.deepStrictEqual(result, { result: [1, 2, 3] });
    assert.ok(capturedUrl.includes("q=(page:0,page_size:25)"));
    assert.strictEqual(capturedHeaders["authorization"], "Bearer token123");
  });

  test("POST request includes CSRF token", async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = async (_url: string, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return { ok: true, json: async () => ({ result: "ok" }) } as Response;
    };

    const client = new SupersetClient(createMockAuth(), mockFetch as any);
    await client.post("/api/v1/sqllab/execute/", { sql: "SELECT 1" });

    assert.strictEqual(capturedHeaders["x-csrftoken"], "csrf456");
  });

  test("retries on CSRF 400 error", async () => {
    let callCount = 0;
    const mockFetch = async (_url: string, _init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: "CSRF session token is missing" }),
        } as Response;
      }
      return { ok: true, json: async () => ({ result: "ok" }) } as Response;
    };

    let csrfRefreshed = false;
    const auth = createMockAuth({
      refreshCsrfToken: async () => { csrfRefreshed = true; },
    });
    const client = new SupersetClient(auth, mockFetch as any);
    await client.post("/api/v1/saved_query/", { sql: "SELECT 1" });

    assert.strictEqual(callCount, 2);
    assert.ok(csrfRefreshed);
  });
});
