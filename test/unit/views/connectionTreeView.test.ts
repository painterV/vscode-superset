import * as assert from "assert";
import {
  ConnectionTreeProvider,
  ConnectionNode,
  NodeType,
} from "../../../src/views/connectionTreeView";

function createMockApis() {
  return {
    databases: {
      list: async () => [
        { id: 1, database_name: "Snowflake", backend: "snowflake" },
        { id: 2, database_name: "PostgreSQL", backend: "postgresql" },
      ],
      schemas: async (dbId: number) => {
        if (dbId === 1) return ["PUBLIC", "RAW"];
        return ["public"];
      },
      tables: async (dbId: number, schema: string) => {
        if (dbId === 1 && schema === "PUBLIC") {
          return [
            { value: "ADHOC_LOG", type: "table" },
            { value: "STG_VIEW", type: "view" },
          ];
        }
        return [];
      },
    },
  };
}

suite("ConnectionTreeProvider", () => {
  test("root children returns database nodes", async () => {
    const provider = new ConnectionTreeProvider();
    provider.setApis(createMockApis() as any);
    provider.setConnected("Production");

    const children = await provider.getChildren();
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].label, "Snowflake");
    assert.strictEqual(children[0].nodeType, NodeType.Database);
  });

  test("database children returns schema nodes", async () => {
    const provider = new ConnectionTreeProvider();
    provider.setApis(createMockApis() as any);
    provider.setConnected("Production");

    const children = await provider.getChildren();
    const dbNode = children[0];
    const schemas = await provider.getChildren(dbNode);
    assert.strictEqual(schemas.length, 2);
    assert.strictEqual(schemas[0].label, "PUBLIC");
    assert.strictEqual(schemas[0].nodeType, NodeType.Schema);
  });

  test("schema children returns table nodes", async () => {
    const provider = new ConnectionTreeProvider();
    provider.setApis(createMockApis() as any);
    provider.setConnected("Production");

    const children = await provider.getChildren();
    const dbNode = children[0];
    const schemas = await provider.getChildren(dbNode);
    const tables = await provider.getChildren(schemas[0]);
    assert.strictEqual(tables.length, 2);
    assert.strictEqual(tables[0].label, "ADHOC_LOG");
    assert.strictEqual(tables[0].nodeType, NodeType.Table);
  });

  test("returns empty array when disconnected", async () => {
    const provider = new ConnectionTreeProvider();
    const children = await provider.getChildren();
    assert.strictEqual(children.length, 0);
  });

  test("setDisconnected clears state and returns empty", async () => {
    const provider = new ConnectionTreeProvider();
    provider.setApis(createMockApis() as any);
    provider.setConnected("Production");
    provider.setDisconnected();

    const children = await provider.getChildren();
    assert.strictEqual(children.length, 0);
  });

  test("setActiveDatabase and getActiveDatabase round-trip", () => {
    const provider = new ConnectionTreeProvider();
    assert.strictEqual(provider.getActiveDatabase(), undefined);

    provider.setActiveDatabase(1, "Snowflake", "PUBLIC");
    const active = provider.getActiveDatabase();
    assert.ok(active);
    assert.strictEqual(active.dbId, 1);
    assert.strictEqual(active.dbName, "Snowflake");
    assert.strictEqual(active.schema, "PUBLIC");
  });

  test("table nodes have insertTableName command", async () => {
    const provider = new ConnectionTreeProvider();
    provider.setApis(createMockApis() as any);
    provider.setConnected("Production");

    const children = await provider.getChildren();
    const dbNode = children[0];
    const schemas = await provider.getChildren(dbNode);
    const tables = await provider.getChildren(schemas[0]);

    assert.ok(tables[0].command);
    assert.strictEqual(tables[0].command?.command, "superset.insertTableName");
  });

  test("getTreeItem returns the same element", () => {
    const provider = new ConnectionTreeProvider();
    const node = new ConnectionNode("test", NodeType.Database, 1);
    const item = provider.getTreeItem(node);
    assert.strictEqual(item, node);
  });
});
