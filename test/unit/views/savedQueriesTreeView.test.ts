import * as assert from "assert";
import { SavedQueriesTreeProvider, SavedQueryNode } from "../../../src/views/savedQueriesTreeView";

function createMockApi() {
  return {
    list: async () => [
      { id: 1, label: "Weekly summary", sql: "SELECT 1", db_id: 1, schema: "public", description: "" },
      { id: 2, label: "User activity", sql: "SELECT 2", db_id: 1, schema: "public", description: "" },
    ],
    get: async (id: number) => ({
      id,
      label: "Weekly summary",
      sql: "SELECT * FROM adhoc_log",
      db_id: 1,
      schema: "public",
      description: "Weekly report query",
    }),
  };
}

suite("SavedQueriesTreeProvider", () => {
  test("returns saved query nodes", async () => {
    const provider = new SavedQueriesTreeProvider();
    provider.setApi(createMockApi() as any);

    const children = await provider.getChildren();
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].label, "Weekly summary");
    assert.strictEqual(children[0].queryId, 1);
  });

  test("returns empty list when not connected", async () => {
    const provider = new SavedQueriesTreeProvider();
    const children = await provider.getChildren();
    assert.strictEqual(children.length, 0);
  });

  test("nodes have openSavedQuery command", async () => {
    const provider = new SavedQueriesTreeProvider();
    provider.setApi(createMockApi() as any);

    const children = await provider.getChildren();
    assert.ok(children[0].command);
    assert.strictEqual(children[0].command?.command, "superset.openSavedQuery");
  });

  test("nodes expose dbId property", async () => {
    const provider = new SavedQueriesTreeProvider();
    provider.setApi(createMockApi() as any);

    const children = await provider.getChildren();
    assert.strictEqual(children[0].dbId, 1);
  });

  test("clear() resets provider to empty", async () => {
    const provider = new SavedQueriesTreeProvider();
    provider.setApi(createMockApi() as any);

    // Verify connected
    const before = await provider.getChildren();
    assert.strictEqual(before.length, 2);

    provider.clear();
    const after = await provider.getChildren();
    assert.strictEqual(after.length, 0);
  });

  test("getTreeItem returns the same element", () => {
    const provider = new SavedQueriesTreeProvider();
    const node = new SavedQueryNode(1, "Test Query", 2);
    const item = provider.getTreeItem(node);
    assert.strictEqual(item, node);
  });
});
