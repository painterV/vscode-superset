import * as assert from "assert";
import { SqlLabApi } from "../../../../src/api/endpoints/sqllab";

suite("SqlLabApi", () => {
  test("execute sends correct payload", async () => {
    let capturedBody: any = null;
    const client = {
      post: async <T>(_path: string, body: unknown): Promise<T> => {
        capturedBody = body;
        return {
          status: "success",
          data: [{ id: 1, name: "alice" }],
          columns: ["id", "name"],
          selected_columns: [
            { name: "id", type: "INTEGER" },
            { name: "name", type: "VARCHAR" },
          ],
          query: { rows: 1, duration: "0.05" },
        } as T;
      },
    };

    const api = new SqlLabApi(client as any);
    const result = await api.execute(1, "SELECT * FROM users", "public");

    assert.strictEqual(capturedBody.database_id, 1);
    assert.strictEqual(capturedBody.sql, "SELECT * FROM users");
    assert.strictEqual(capturedBody.schema, "public");
    assert.strictEqual(result.data.length, 1);
  });

  test("formatSql returns formatted SQL", async () => {
    const client = {
      post: async <T>(_path: string, _body: unknown): Promise<T> => {
        return { result: "SELECT\n  *\nFROM\n  users" } as T;
      },
    };

    const api = new SqlLabApi(client as any);
    const formatted = await api.formatSql("select * from users");
    assert.strictEqual(formatted, "SELECT\n  *\nFROM\n  users");
  });
});
