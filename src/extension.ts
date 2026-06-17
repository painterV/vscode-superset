import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { SupersetClient } from "./api/client";
import { DatabasesApi } from "./api/endpoints/databases";
import { SqlLabApi } from "./api/endpoints/sqllab";
import { SavedQueriesApi } from "./api/endpoints/savedQueries";
import { DashboardsApi } from "./api/endpoints/dashboards";
import { ChartsApi } from "./api/endpoints/charts";
import { getConnections, getSettings } from "./utils/config";
import { JinjaCompletionProvider } from "./language/completionProvider";
import { JinjaHoverProvider } from "./language/hoverProvider";
import { JinjaDiagnosticManager } from "./language/diagnosticProvider";
import { ConnectionTreeProvider } from "./views/connectionTreeView";
import {
  SavedQueriesTreeProvider,
  SavedQueryDocumentProvider,
  SavedQueryNode,
} from "./views/savedQueriesTreeView";
import { DashboardTreeProvider } from "./views/dashboardTreeView";
import { ResultsPanel } from "./views/resultsPanel";

const LANG_SELECTOR: vscode.DocumentSelector = { language: "jinja-sql" };

let activeAuth: AuthManager | null = null;
let activeClient: SupersetClient | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Superset");

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "superset.switchConnection";
  statusBarItem.text = "$(plug) Superset: Disconnected";
  statusBarItem.show();

  // Tree views
  const connectionTree = new ConnectionTreeProvider();
  const savedQueriesTree = new SavedQueriesTreeProvider();
  const dashboardTree = new DashboardTreeProvider();

  vscode.window.registerTreeDataProvider("supersetConnections", connectionTree);
  vscode.window.registerTreeDataProvider("supersetSavedQueries", savedQueriesTree);
  vscode.window.registerTreeDataProvider("supersetDashboards", dashboardTree);

  // Language features
  const diagnosticManager = new JinjaDiagnosticManager();
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANG_SELECTOR, new JinjaCompletionProvider(), "{"),
    vscode.languages.registerHoverProvider(LANG_SELECTOR, new JinjaHoverProvider()),
    diagnosticManager,
  );

  // Update diagnostics on edit
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => diagnosticManager.update(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => diagnosticManager.update(doc)),
  );

  // Saved query virtual documents
  const savedQueryDocProvider = new SavedQueryDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("superset-query", savedQueryDocProvider),
  );

  // Results panel
  const resultsPanel = new ResultsPanel(context.extensionUri);

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand("superset.connect", async () => {
      const connections = getConnections();
      if (connections.length === 0) {
        vscode.window.showWarningMessage(
          "No Superset connections configured. Add connections in Settings → superset.connections.",
        );
        return;
      }

      let connection = connections[0];
      if (connections.length > 1) {
        const picked = await vscode.window.showQuickPick(
          connections.map((c) => ({ label: c.name, description: c.url, connection: c })),
          { placeHolder: "Select a Superset connection" },
        );
        if (!picked) return;
        connection = picked.connection;
      }

      const auth = new AuthManager(connection, context.secrets);
      let password = await auth.getPassword();
      if (!password) {
        password = await vscode.window.showInputBox({
          prompt: `Password for ${connection.username}@${connection.url}`,
          password: true,
        });
        if (!password) return;
      }

      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Connecting to Superset..." },
          async () => {
            await auth.login(password!);
          },
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
        return;
      }

      // Ask to remember password
      const remember = await vscode.window.showQuickPick(["Yes", "No"], {
        placeHolder: "Remember password?",
      });
      if (remember === "Yes") {
        await auth.storePassword(password);
      }

      activeAuth = auth;
      activeClient = new SupersetClient(auth);

      const databasesApi = new DatabasesApi(activeClient);
      const sqlLabApi = new SqlLabApi(activeClient);
      const savedQueriesApi = new SavedQueriesApi(activeClient);
      const dashboardsApi = new DashboardsApi(activeClient);
      const chartsApi = new ChartsApi(activeClient);

      // Keep sqlLabApi reference available in scope (used via closure below)
      void sqlLabApi;

      connectionTree.setApis({ databases: databasesApi });
      connectionTree.setConnected(connection.name);
      savedQueriesTree.setApi(savedQueriesApi);
      savedQueriesTree.refresh();
      savedQueryDocProvider.setApi(savedQueriesApi);
      dashboardTree.setApis({ dashboards: dashboardsApi, charts: chartsApi }, auth.getBaseUrl());
      dashboardTree.refresh();

      statusBarItem.text = `$(zap) Superset: ${connection.name}`;
      outputChannel.appendLine(`Connected to ${connection.name} at ${connection.url}`);
      vscode.window.showInformationMessage(`Connected to Superset: ${connection.name}`);
    }),

    vscode.commands.registerCommand("superset.disconnect", () => {
      activeAuth = null;
      activeClient = null;
      connectionTree.setDisconnected();
      savedQueriesTree.clear();
      dashboardTree.clear();
      statusBarItem.text = "$(plug) Superset: Disconnected";
      vscode.window.showInformationMessage("Disconnected from Superset");
    }),

    vscode.commands.registerCommand("superset.switchConnection", () => {
      vscode.commands.executeCommand("superset.connect");
    }),

    vscode.commands.registerCommand("superset.execute", async () => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset. Run 'Superset: Connect' first.");
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      if (!sql.trim()) return;

      const activeDb = connectionTree.getActiveDatabase();
      if (!activeDb) {
        // Try magic comment
        const firstLine = editor.document.lineAt(0).text;
        const match = firstLine.match(/^--\s*database:\s*(.+)$/i);
        if (!match) {
          vscode.window.showWarningMessage("No database selected. Click a database in the Connections tree first.");
          return;
        }
      }

      const dbId = activeDb?.dbId ?? 1;
      const schema = activeDb?.schema;
      const sqlLabApi = new SqlLabApi(activeClient);
      const settings = getSettings();

      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Running query...", cancellable: true },
          async (progress, _token) => {
            const resultPromise = sqlLabApi.execute(dbId, sql, schema);

            const timeout = setTimeout(() => {
              progress.report({ message: `Query running for ${settings.queryTimeoutSeconds}s...` });
            }, settings.queryTimeoutSeconds * 1000);

            try {
              return await resultPromise;
            } finally {
              clearTimeout(timeout);
            }
          },
        );

        const title = editor.document.fileName.split("/").pop() ?? "Query";
        resultsPanel.show(result, title);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Query failed: ${err.message}`);
        resultsPanel.showError(err.message, "Query Error");
      }
    }),

    vscode.commands.registerCommand("superset.estimate", async () => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset.");
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      const activeDb = connectionTree.getActiveDatabase();
      const dbId = activeDb?.dbId ?? 1;

      const sqlLabApi = new SqlLabApi(activeClient);
      try {
        const estimate = await sqlLabApi.estimate(dbId, sql, activeDb?.schema);
        vscode.window.showInformationMessage(`Estimate: ${JSON.stringify(estimate.result)}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Estimate failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.formatSql", async () => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset.");
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const sql = editor.document.getText();
      const sqlLabApi = new SqlLabApi(activeClient);
      try {
        const formatted = await sqlLabApi.formatSql(sql);
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(sql.length),
        );
        await editor.edit((edit) => edit.replace(fullRange, formatted));
      } catch (err: any) {
        vscode.window.showErrorMessage(`Format failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.openSavedQuery", async (node: SavedQueryNode) => {
      const uri = vscode.Uri.parse(`superset-query:/${node.queryId}.jinjasql`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      await vscode.languages.setTextDocumentLanguage(doc, "jinja-sql");
    }),

    vscode.commands.registerCommand("superset.refreshConnections", () => {
      connectionTree.refresh();
      savedQueriesTree.refresh();
      dashboardTree.refresh();
    }),

    vscode.commands.registerCommand("superset.selectDatabase", async (node) => {
      if (!connectionTree) return;
      if (node && node.dbId !== undefined) {
        connectionTree.setActiveDatabase(node.dbId, node.label as string, node.schema);
        vscode.window.showInformationMessage(`Active database set to: ${node.label}`);
      }
    }),

    vscode.commands.registerCommand("superset.insertTableName", async (node) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !node) return;
      const tableName = node.schema ? `${node.schema}.${node.label}` : (node.label as string);
      await editor.edit((edit) => {
        edit.insert(editor.selection.active, tableName);
      });
    }),
  );

  context.subscriptions.push(statusBarItem, outputChannel, resultsPanel);
}

export function deactivate(): void {}
