import * as assert from "assert";
import { DatabasesApi, Database, TableInfo } from "../../../../src/api/endpoints/databases";

function createMockClient() {
  const calls: { path: string; params?: any }[] = [];
  return {
    calls,
    get: async <T>(path: string, params?: any): Promise<T> => {
      calls.push({ path, params });
      if (path === "/api/v1/database/") {
        return { result: [{ id: 1, database_name: "Snowflake", backend: "snowflake" }] } as T;
      }
      if (path.includes("/schemas/")) {
        return { result: ["PUBLIC", "RAW"] } as T;
      }
      if (path.includes("/tables/")) {
        return {
          result: [
            { value: "ADHOC_LOG", type: "table" },
            { value: "STG_ADHOC_LOG", type: "view" },
          ],
        } as T;
      }
      if (path.includes("/table/")) {
        return {
          columns: [
            { name: "id", type: "INTEGER", nullable: false },
            { name: "requester", type: "VARCHAR", nullable: true },
          ],
        } as T;
      }
      return {} as T;
    },
  };
}

suite("DatabasesApi", () => {
  test("list returns databases", async () => {
    const client = createMockClient();
    const api = new DatabasesApi(client as any);
    const dbs = await api.list();
    assert.strictEqual(dbs.length, 1);
    assert.strictEqual(dbs[0].database_name, "Snowflake");
  });

  test("schemas returns schema names", async () => {
    const client = createMockClient();
    const api = new DatabasesApi(client as any);
    const schemas = await api.schemas(1);
    assert.deepStrictEqual(schemas, ["PUBLIC", "RAW"]);
  });

  test("tables returns table info", async () => {
    const client = createMockClient();
    const api = new DatabasesApi(client as any);
    const tables = await api.tables(1, "PUBLIC");
    assert.strictEqual(tables.length, 2);
    assert.strictEqual(tables[0].value, "ADHOC_LOG");
  });

  test("columns returns column info", async () => {
    const client = createMockClient();
    const api = new DatabasesApi(client as any);
    const cols = await api.columns(1, "ADHOC_LOG", "PUBLIC");
    assert.strictEqual(cols.length, 2);
    assert.strictEqual(cols[0].name, "id");
  });
});
