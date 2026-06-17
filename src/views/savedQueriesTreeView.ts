import * as vscode from "vscode";
import { SavedQueriesApi } from "../api/endpoints/savedQueries";

/**
 * A tree item representing a single saved query in the Superset Saved Queries panel.
 */
export class SavedQueryNode extends vscode.TreeItem {
  constructor(
    public readonly queryId: number,
    label: string,
    public readonly dbId: number,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.contextValue = "savedQuery";
    // Command is registered in Task 10; defined here so the node is self-contained.
    this.command = {
      command: "superset.openSavedQuery",
      title: "Open Saved Query",
      arguments: [this],
    };
  }
}

/**
 * Tree data provider that lists all saved queries accessible by the current user.
 *
 * Lifecycle:
 *   - Call `setApi()` after a successful connection.
 *   - Call `refresh()` to force VS Code to re-fetch children.
 *   - Call `clear()` on disconnect.
 */
export class SavedQueriesTreeProvider implements vscode.TreeDataProvider<SavedQueryNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SavedQueryNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private api: SavedQueriesApi | null = null;

  /** Inject the API instance produced by the auth flow. */
  setApi(api: SavedQueriesApi): void {
    this.api = api;
  }

  /** Fire a tree-data-changed event so VS Code re-fetches children. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Remove the API reference and trigger a tree refresh (shows empty tree). */
  clear(): void {
    this.api = null;
    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // TreeDataProvider implementation
  // ---------------------------------------------------------------------------

  getTreeItem(element: SavedQueryNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SavedQueryNode[]> {
    if (!this.api) {
      return [];
    }
    const queries = await this.api.list();
    return queries.map((q) => new SavedQueryNode(q.id, q.label, q.db_id));
  }
}

/**
 * Virtual document provider for the `superset-query` URI scheme.
 *
 * URIs look like: `superset-query:///42.jinjasql`
 * The numeric segment before `.jinjasql` is the saved-query ID.
 */
export class SavedQueryDocumentProvider implements vscode.TextDocumentContentProvider {
  private api: SavedQueriesApi | null = null;

  /** Inject the API instance produced by the auth flow. */
  setApi(api: SavedQueriesApi): void {
    this.api = api;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this.api) {
      return "-- Not connected to Superset";
    }
    const filename = uri.path.split("/").pop() ?? "";
    const id = parseInt(filename.replace(".jinjasql", ""), 10);
    if (isNaN(id)) {
      return `-- Invalid query ID in URI: ${uri.toString()}`;
    }
    const query = await this.api.get(id);
    return query.sql;
  }
}
