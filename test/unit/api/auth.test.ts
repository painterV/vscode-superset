import * as assert from "assert";
import { AuthManager } from "../../../src/api/auth";

function createMockSecretStorage(): {
  storage: Map<string, string>;
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
} {
  const storage = new Map<string, string>();
  return {
    storage,
    get: async (key) => storage.get(key),
    store: async (key, value) => { storage.set(key, value); },
    delete: async (key) => { storage.delete(key); },
  };
}

suite("AuthManager", () => {
  test("login stores tokens on success", async () => {
    const secrets = createMockSecretStorage();
    const mockFetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/security/login")) {
        return {
          ok: true,
          json: async () => ({ access_token: "acc123", refresh_token: "ref456" }),
        } as Response;
      }
      if (url.endsWith("/api/v1/security/csrf_token/")) {
        return {
          ok: true,
          json: async () => ({ result: "csrf789" }),
        } as Response;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const auth = new AuthManager(
      { name: "Test", url: "http://localhost:8088", username: "admin" },
      secrets as any,
      mockFetch as any
    );

    await auth.login("password123");

    assert.strictEqual(await auth.getAccessToken(), "acc123");
    assert.strictEqual(auth.getCsrfToken(), "csrf789");
  });

  test("refresh replaces access token", async () => {
    const secrets = createMockSecretStorage();
    let callCount = 0;
    const mockFetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/security/login")) {
        return { ok: true, json: async () => ({ access_token: "old", refresh_token: "ref" }) } as Response;
      }
      if (url.endsWith("/api/v1/security/csrf_token/")) {
        return { ok: true, json: async () => ({ result: "csrf" }) } as Response;
      }
      if (url.endsWith("/api/v1/security/refresh")) {
        callCount++;
        return { ok: true, json: async () => ({ access_token: "new_token" }) } as Response;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const auth = new AuthManager(
      { name: "Test", url: "http://localhost:8088", username: "admin" },
      secrets as any,
      mockFetch as any
    );
    await auth.login("pass");
    await auth.refresh();

    assert.strictEqual(await auth.getAccessToken(), "new_token");
    assert.strictEqual(callCount, 1);
  });

  test("login throws on invalid credentials", async () => {
    const secrets = createMockSecretStorage();
    const mockFetch = async () =>
      ({ ok: false, status: 401, json: async () => ({ message: "Invalid credentials" }) }) as Response;

    const auth = new AuthManager(
      { name: "Test", url: "http://localhost:8088", username: "admin" },
      secrets as any,
      mockFetch as any
    );

    await assert.rejects(() => auth.login("wrong"), /Invalid credentials/);
  });
});
