import * as vscode from "vscode";
import { AuthManager } from "./api/auth";
import { SupersetClient } from "./api/client";
import { DatabasesApi } from "./api/endpoints/databases";
import { SqlLabApi, QueryResult } from "./api/endpoints/sqllab";
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
import { LineagePanel, LineageModel } from "./views/lineagePanel";
import { DatasetsApi } from "./api/endpoints/datasets";
import { Chart } from "./api/endpoints/charts";
import { Dataset } from "./api/endpoints/datasets";

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

  // Lineage graph panel — clicking a node opens it in the browser/editor.
  const lineagePanel = new LineagePanel(context.extensionUri, (kind, id) => {
    const base = activeAuth?.getBaseUrl();
    if (!base) return;
    openSupersetUrl(
      kind === "chart"
        ? `${base}/explore/?slice_id=${id}`
        : `${base}/superset/dashboard/${id}/`,
    );
  });

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
        previewResultToOutput(outputChannel, result, title);
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

    vscode.commands.registerCommand("superset.openChartSql", async (args: { chartId: number; label: string }) => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset.");
        return;
      }
      const chartsApi = new ChartsApi(activeClient);
      try {
        const chart = await chartsApi.get(args.chartId);
        const sql = chart.query || "-- No SQL query associated with this chart";
        const doc = await vscode.workspace.openTextDocument({ content: sql, language: "jinja-sql" });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load chart SQL: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.addConnection", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "superset.connections");
    }),

    vscode.commands.registerCommand("superset.showLineage", async () => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset. Run 'Superset: Connect' first.");
        return;
      }
      try {
        const [charts, datasets] = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Building dependency graph..." },
          () => Promise.all([new ChartsApi(activeClient!).list(), new DatasetsApi(activeClient!).list()]),
        );
        lineagePanel.show(buildLineage(charts, datasets));
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to build dependency graph: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.openChartInBrowser", (node: { chartId?: number }) => {
      const base = activeAuth?.getBaseUrl();
      if (!base || node?.chartId === undefined) {
        vscode.window.showWarningMessage("Not connected, or no chart selected.");
        return;
      }
      openSupersetUrl(`${base}/explore/?slice_id=${node.chartId}`);
    }),

    vscode.commands.registerCommand("superset.openDashboardInBrowser", (node: { baseUrl?: string; url?: string }) => {
      if (!node?.baseUrl || !node?.url) {
        vscode.window.showWarningMessage("No dashboard selected.");
        return;
      }
      openSupersetUrl(`${node.baseUrl}${node.url}`);
    }),
  );

  context.subscriptions.push(statusBarItem, outputChannel, resultsPanel, lineagePanel);
}

/**
 * Build the Database → Schema → Dataset → Chart → Dashboard lineage model.
 * Only nodes that actually feed a chart are included (true lineage). Charts are
 * grouped by their dataset to reduce edge crossing. Node ids are
 * column-unique strings (e.g. schema id = "<dbId>::<schema>").
 */
function buildLineage(charts: Chart[], datasets: Dataset[]): LineageModel {
  const dsById = new Map(datasets.map((d) => [d.id, d]));

  const databases = new Map<string, string>();
  const schemas = new Map<string, string>();
  const datasetNodes = new Map<string, string>();
  const dashboards = new Map<string, string>();
  const dbSchema = new Set<string>();
  const schemaDataset = new Set<string>();
  const datasetChart: { from: string; to: string }[] = [];
  const chartDash: { from: string; to: string }[] = [];
  // Remember each chart's dataset so charts can be grouped by it.
  const chartGroup = new Map<number, string>();

  for (const c of charts) {
    const ds = c.datasource_type === "table" ? dsById.get(c.datasource_id) : undefined;
    if (ds) {
      const dbId = String(ds.database.id);
      const schema = ds.schema || "(default)";
      const schemaKey = `${dbId}::${schema}`;
      const dsKey = `ds${ds.id}`;
      databases.set(dbId, ds.database.database_name);
      schemas.set(schemaKey, schema);
      datasetNodes.set(dsKey, ds.table_name);
      dbSchema.add(`${dbId}|${schemaKey}`);
      schemaDataset.add(`${schemaKey}|${dsKey}`);
      datasetChart.push({ from: dsKey, to: String(c.id) });
      chartGroup.set(c.id, dsKey);
    }
    for (const d of c.dashboards ?? []) {
      dashboards.set(String(d.id), d.dashboard_title);
      chartDash.push({ from: String(c.id), to: String(d.id) });
    }
  }

  const nodes = (m: Map<string, string>) =>
    [...m.entries()].map(([id, name]) => ({ id, name }));
  const edges = (s: Set<string>) =>
    [...s].map((e) => {
      const [from, to] = e.split("|");
      return { from, to };
    });

  // Group charts by dataset so connected nodes sit in adjacent rows.
  const chartNodes = charts
    .map((c) => ({ id: String(c.id), name: c.slice_name, g: chartGroup.get(c.id) ?? "~" }))
    .sort((a, b) => a.g.localeCompare(b.g) || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));

  return {
    databases: nodes(databases),
    schemas: nodes(schemas),
    datasets: nodes(datasetNodes),
    charts: chartNodes,
    dashboards: nodes(dashboards),
    dbSchemaEdges: edges(dbSchema),
    schemaDatasetEdges: edges(schemaDataset),
    datasetChartEdges: datasetChart,
    chartDashEdges: chartDash,
  };
}

export function deactivate(): void {}

/**
 * Open a Superset URL either externally or in VS Code's Simple Browser,
 * per the `superset.viewIn` setting.
 */
function openSupersetUrl(url: string): void {
  const where = vscode.workspace.getConfiguration("superset").get<string>("viewIn", "browser");
  if (where === "editor") {
    vscode.commands.executeCommand("simpleBrowser.show", url);
  } else {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

/** Format a cell for the text preview: NULL for nullish, whitespace collapsed to one line. */
function previewCell(value: unknown): string {
  return value == null ? "NULL" : String(value).replace(/[\r\n\t]+/g, " ");
}

/**
 * Append an aligned text table of the query result to the Superset output
 * channel (first 100 rows), and reveal it without stealing focus.
 */
function previewResultToOutput(
  channel: vscode.OutputChannel,
  result: QueryResult,
  title: string,
): void {
  const cols = result.columns ?? [];
  const rows = result.data ?? [];
  const MAX_ROWS = 100;
  const MAX_W = 40;

  const widths = cols.map((c) => {
    let w = c.length;
    for (const r of rows.slice(0, MAX_ROWS)) {
      w = Math.max(w, previewCell(r[c]).length);
    }
    return Math.min(w, MAX_W);
  });

  const pad = (s: string, w: number) =>
    s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
  const line = (vals: string[]) => vals.map((v, i) => pad(v, widths[i])).join("  ");

  channel.appendLine("");
  channel.appendLine(`── ${title} · ${rows.length} rows · ${result.query?.duration ?? "?"}s ──`);
  channel.appendLine(line(cols));
  channel.appendLine(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows.slice(0, MAX_ROWS)) {
    channel.appendLine(line(cols.map((c) => previewCell(r[c]))));
  }
  if (rows.length > MAX_ROWS) {
    channel.appendLine(`… and ${rows.length - MAX_ROWS} more rows`);
  }
  channel.show(true);
}
