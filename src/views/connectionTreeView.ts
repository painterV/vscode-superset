import * as vscode from "vscode";
import { DatabasesApi } from "../api/endpoints/databases";

/** Discriminates the three levels of the connection tree. */
export enum NodeType {
  Database = "database",
  Schema = "schema",
  Table = "table",
}

/**
 * A single item in the connection tree (database, schema, or table).
 */
export class ConnectionNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly nodeType: NodeType,
    public readonly dbId?: number,
    public readonly schema?: string,
    collapsibleState?: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = nodeType;

    switch (nodeType) {
      case NodeType.Database:
        this.iconPath = new vscode.ThemeIcon("database");
        break;

      case NodeType.Schema:
        this.iconPath = new vscode.ThemeIcon("folder");
        break;

      case NodeType.Table:
        this.iconPath = new vscode.ThemeIcon("file");
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        // Clicking a table node inserts the qualified name into the active editor.
        this.command = {
          command: "superset.insertTableName",
          title: "Insert Table Name",
          arguments: [{ label, nodeType, dbId, schema }],
        };
        break;
    }
  }
}

/**
 * Tree data provider that shows a 3-level hierarchy:
 *   Connection
 *   └── Database
 *       └── Schema
 *           └── Table / View
 */
export class ConnectionTreeProvider
  implements vscode.TreeDataProvider<ConnectionNode>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<ConnectionNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private databasesApi: DatabasesApi | null = null;
  private connectionName: string | null = null;
  private activeDatabase:
    | { dbId: number; dbName: string; schema?: string }
    | undefined;

  /** Inject the API bundle produced by the auth flow. */
  setApis(apis: { databases: DatabasesApi }): void {
    this.databasesApi = apis.databases;
  }

  /** Mark the provider as connected and trigger a tree refresh. */
  setConnected(name: string): void {
    this.connectionName = name;
    this.refresh();
  }

  /** Clear all state and trigger a tree refresh (shows empty tree). */
  setDisconnected(): void {
    this.connectionName = null;
    this.databasesApi = null;
    this.activeDatabase = undefined;
    this.refresh();
  }

  /** Record which database the user has activated for query execution. */
  setActiveDatabase(dbId: number, dbName: string, schema?: string): void {
    this.activeDatabase = { dbId, dbName, schema };
  }

  /** Return the currently active database, or undefined if none selected. */
  getActiveDatabase():
    | { dbId: number; dbName: string; schema?: string }
    | undefined {
    return this.activeDatabase;
  }

  /** Fire a tree-data-changed event to force VS Code to re-fetch children. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // -------------------------------------------------------------------------
  // TreeDataProvider implementation
  // -------------------------------------------------------------------------

  getTreeItem(element: ConnectionNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionNode): Promise<ConnectionNode[]> {
    // No API or not connected — show nothing.
    if (!this.databasesApi || !this.connectionName) {
      return [];
    }

    // Root level: list databases.
    if (!element) {
      const dbs = await this.databasesApi.list();
      return dbs.map(
        (db) => new ConnectionNode(db.database_name, NodeType.Database, db.id),
      );
    }

    // Database level: list schemas.
    if (element.nodeType === NodeType.Database && element.dbId !== undefined) {
      const schemas = await this.databasesApi.schemas(element.dbId);
      return schemas.map(
        (s) => new ConnectionNode(s, NodeType.Schema, element.dbId, s),
      );
    }

    // Schema level: list tables/views.
    if (
      element.nodeType === NodeType.Schema &&
      element.dbId !== undefined &&
      element.schema
    ) {
      const tables = await this.databasesApi.tables(
        element.dbId,
        element.schema,
      );
      return tables.map(
        (t) =>
          new ConnectionNode(t.value, NodeType.Table, element.dbId, element.schema),
      );
    }

    // Table nodes are leaves — no children.
    return [];
  }
}
