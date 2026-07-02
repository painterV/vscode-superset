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
import { Dashboard } from "./api/endpoints/dashboards";
import { ExperimentManager, Experiment } from "./experiments/experimentManager";
import { ExperimentsTreeProvider, ExperimentItem } from "./views/experimentsTreeView";

const LANG_SELECTOR: vscode.DocumentSelector = { language: "jinja-sql" };

let activeAuth: AuthManager | null = null;
let activeClient: SupersetClient | null = null;
let activeExperimentManager: ExperimentManager | null = null;
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
  const experimentsTree = new ExperimentsTreeProvider();

  vscode.window.registerTreeDataProvider("supersetConnections", connectionTree);
  vscode.window.registerTreeDataProvider("supersetSavedQueries", savedQueriesTree);
  vscode.window.registerTreeDataProvider("supersetDashboards", dashboardTree);
  vscode.window.registerTreeDataProvider("supersetExperiments", experimentsTree);

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
  const lineagePanel = new LineagePanel(
    context.extensionUri,
    (kind, id) => {
      const base = activeAuth?.getBaseUrl();
      if (!base) return;
      openSupersetUrl(
        kind === "chart"
          ? `${base}/explore/?slice_id=${id}`
          : `${base}/superset/dashboard/${id}/`,
      );
    },
    (nodes) => handleLineageDelete(nodes),
  );

  // In-memory backing for the experiment diff editor (superset-diff: scheme).
  const diffContents = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("superset-diff", {
      provideTextDocumentContent: (uri) => diffContents.get(uri.toString()) ?? "",
    }),
  );

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

      activeExperimentManager = new ExperimentManager(
        context.globalState,
        { datasets: new DatasetsApi(activeClient), charts: chartsApi, dashboards: dashboardsApi },
        connection.name,
      );
      experimentsTree.setSource(() => activeExperimentManager!.list());

      statusBarItem.text = `$(zap) Superset: ${connection.name}`;
      outputChannel.appendLine(`Connected to ${connection.name} at ${connection.url}`);
      vscode.window.showInformationMessage(`Connected to Superset: ${connection.name}`);
    }),

    vscode.commands.registerCommand("superset.disconnect", () => {
      activeAuth = null;
      activeClient = null;
      activeExperimentManager = null;
      connectionTree.setDisconnected();
      savedQueriesTree.clear();
      dashboardTree.clear();
      experimentsTree.clear();
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

    vscode.commands.registerCommand("superset.refreshSavedQueries", () => savedQueriesTree.refresh()),
    vscode.commands.registerCommand("superset.refreshDashboards", () => dashboardTree.refresh()),

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

    vscode.commands.registerCommand("superset.cloneExperiment", async () => {
      if (!activeExperimentManager || !activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset. Run 'Superset: Connect' first.");
        return;
      }
      const datasets = await new DatasetsApi(activeClient).list();
      const pick = await vscode.window.showQuickPick(
        datasets.map((d) => ({
          label: d.table_name,
          description: `${d.database.database_name}.${d.schema ?? ""}`,
          id: d.id,
        })),
        { placeHolder: "Pick a virtual (SQL) dataset to clone as an experiment" },
      );
      if (!pick) return;
      const label = await vscode.window.showInputBox({ prompt: "Experiment label", placeHolder: "exp1" });
      if (!label) return;
      try {
        const exp = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Cloning experiment "${label}"...` },
          () => activeExperimentManager!.clone(pick.id, label),
        );
        experimentsTree.refresh();
        vscode.window.showInformationMessage(
          `Experiment "${label}": ${exp.datasets.length} dataset, ${exp.charts.length} charts, ${exp.dashboards.length} dashboards.`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Clone failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.experimentDashboard", async () => {
      if (!activeExperimentManager || !activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset. Run 'Superset: Connect' first.");
        return;
      }
      const chartsApi = new ChartsApi(activeClient);
      const datasetsApi = new DatasetsApi(activeClient);

      // 1. pick a dashboard
      const dashboards = await new DashboardsApi(activeClient).list();
      const dashPick = await vscode.window.showQuickPick(
        dashboards.map((d) => ({ label: d.dashboard_title, id: d.id })),
        { placeHolder: "Pick a dashboard to experiment on" },
      );
      if (!dashPick) return;

      // 2. pick which charts to experiment (unpicked charts stay shared)
      const allCharts = await chartsApi.list();
      const inDash = allCharts.filter((c) => (c.dashboards ?? []).some((d) => d.id === dashPick.id));
      if (inDash.length === 0) {
        vscode.window.showWarningMessage("That dashboard has no charts to experiment.");
        return;
      }
      const chartPick = await vscode.window.showQuickPick(
        inDash.map((c) => ({ label: c.slice_name, description: `chart #${c.id}`, id: c.id })),
        { canPickMany: true, placeHolder: "Select charts to experiment — unselected charts stay shared with the original" },
      );
      if (!chartPick || chartPick.length === 0) return;
      const chartIds = new Set(chartPick.map((p) => p.id));

      // 3. offer to also experiment the charts' datasets — virtual only
      const dsIds = [
        ...new Set(
          inDash
            .filter((c) => chartIds.has(c.id) && c.datasource_type === "table")
            .map((c) => c.datasource_id),
        ),
      ];
      const details = await Promise.all(dsIds.map((id) => datasetsApi.get(id)));
      const virtual = details.filter((d) => d.kind === "virtual");
      const physicalCount = details.length - virtual.length;
      let datasetIds = new Set<number>();
      if (virtual.length > 0) {
        const dsPick = await vscode.window.showQuickPick(
          virtual.map((d) => ({ label: d.table_name, description: "virtual", id: d.id })),
          {
            canPickMany: true,
            placeHolder:
              `Also experiment these datasets? (unpicked stay shared)` +
              (physicalCount ? ` — ${physicalCount} physical dataset(s) can't be experimented` : ""),
          },
        );
        // Escape = experiment no datasets (charts still get cloned).
        if (dsPick) datasetIds = new Set(dsPick.map((p) => p.id));
      }

      // 4. label + run
      const label = await vscode.window.showInputBox({ prompt: "Experiment label", placeHolder: "exp1" });
      if (!label) return;
      try {
        const exp = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Experimenting dashboard "${label}"...` },
          () => activeExperimentManager!.cloneDashboard(dashPick.id, label, chartIds, datasetIds),
        );
        experimentsTree.refresh();
        vscode.window.showInformationMessage(
          `Experiment "${label}": ${exp.dashboards.length} dashboard, ${exp.charts.length} charts cloned, ${exp.datasets.length} datasets cloned (rest shared).`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Dashboard experiment failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.deleteExperiment", async (item: ExperimentItem) => {
      if (!activeExperimentManager || !item?.experiment) return;
      const e = item.experiment;
      const ok = await vscode.window.showWarningMessage(
        `Delete experiment "${e.label}"? Removes ${e.dashboards.length} dashboards, ${e.charts.length} charts, ${e.datasets.length} dataset(s).`,
        { modal: true },
        "Delete",
      );
      if (ok !== "Delete") return;
      const res = await activeExperimentManager.delete(e.label);
      experimentsTree.refresh();
      if (res.failed.length) {
        vscode.window.showWarningMessage(`Deleted ${res.deleted}; ${res.failed.length} failed: ${res.failed.join("; ")}`);
      } else {
        vscode.window.showInformationMessage(`Deleted experiment "${e.label}".`);
      }
    }),

    vscode.commands.registerCommand("superset.diffExperiment", async (item: ExperimentItem) => {
      if (!activeClient || !item?.experiment) return;
      const e = item.experiment;
      if (!e.links) {
        vscode.window.showWarningMessage(
          `Experiment "${e.label}" predates diff support — recreate it to enable Show Diff.`,
        );
        return;
      }
      const mode = await vscode.window.showQuickPick(
        [
          { label: "Full diff", description: "all fields, incl. defaults Superset adds on save", intersect: false },
          { label: "Changes only", description: "shared fields only — pure value changes", intersect: true },
        ],
        { placeHolder: "Diff mode" },
      );
      if (!mode) return;
      try {
        const { original, experiment } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Diffing experiment "${e.label}"...` },
          () => buildExperimentDiff(e, activeClient!, mode.intersect),
        );
        const stamp = Date.now();
        const left = vscode.Uri.parse(`superset-diff:/${e.label}/original-${stamp}.json`);
        const right = vscode.Uri.parse(`superset-diff:/${e.label}/experiment-${stamp}.json`);
        diffContents.set(left.toString(), original);
        diffContents.set(right.toString(), experiment);
        await vscode.commands.executeCommand(
          "vscode.diff",
          left,
          right,
          `Experiment "${e.label}": original ↔ experiment`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Diff failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("superset.refreshExperiments", () => experimentsTree.refresh()),

    vscode.commands.registerCommand("superset.showLineage", async () => {
      if (!activeClient) {
        vscode.window.showWarningMessage("Not connected to Superset. Run 'Superset: Connect' first.");
        return;
      }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Building dependency graph..." },
          () => refreshLineage(),
        );
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

  /** Fetch charts + datasets + dashboards and (re)render the lineage graph. */
  async function refreshLineage(): Promise<void> {
    if (!activeClient) return;
    const [charts, datasets, dashboards] = await Promise.all([
      new ChartsApi(activeClient).list(),
      new DatasetsApi(activeClient).list(),
      new DashboardsApi(activeClient).list(),
    ]);
    lineagePanel.show(buildLineage(charts, datasets, dashboards));
  }

  /**
   * Delete nodes selected in the lineage graph (dashboards → charts → datasets,
   * safe dependency order). Deleting a dashboard offers to also remove any chart
   * that was used only by the dashboard(s) being deleted. Refreshes the graph.
   */
  async function handleLineageDelete(nodes: { kind: string; id: number }[]): Promise<void> {
    if (!activeClient || nodes.length === 0) return;
    const chartsApi = new ChartsApi(activeClient);
    const datasetsApi = new DatasetsApi(activeClient);
    const dashboardsApi = new DashboardsApi(activeClient);

    const dsIds = new Set(nodes.filter((n) => n.kind === "dataset").map((n) => n.id));
    const chartIds = new Set(nodes.filter((n) => n.kind === "chart").map((n) => n.id));
    const dashIds = new Set(nodes.filter((n) => n.kind === "dashboard").map((n) => n.id));

    const summary = [
      dashIds.size && `${dashIds.size} dashboard(s)`,
      chartIds.size && `${chartIds.size} chart(s)`,
      dsIds.size && `${dsIds.size} dataset(s)`,
    ]
      .filter(Boolean)
      .join(", ");
    const ok = await vscode.window.showWarningMessage(
      `Delete ${summary} from "${activeAuth?.getConnectionName()}"? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (ok !== "Delete") return;

    // Cascade: charts used ONLY by the dashboards being deleted become orphans.
    if (dashIds.size > 0) {
      const allCharts = await chartsApi.list();
      const orphaned = allCharts.filter(
        (c) =>
          (c.dashboards?.length ?? 0) > 0 &&
          c.dashboards!.every((d) => dashIds.has(d.id)) &&
          !chartIds.has(c.id),
      );
      if (orphaned.length > 0) {
        const also = await vscode.window.showWarningMessage(
          `${orphaned.length} chart(s) are used only by the dashboard(s) you're deleting. Delete those charts too?`,
          { modal: true },
          "Delete charts too",
          "Keep charts",
        );
        if (also === "Delete charts too") orphaned.forEach((c) => chartIds.add(c.id));
      }
    }

    const errors: string[] = [];
    const run = async (ids: Set<number>, del: (id: number) => Promise<void>, kind: string) => {
      for (const id of ids) {
        try {
          await del(id);
        } catch (e: any) {
          errors.push(`${kind} ${id}: ${e.message}`);
        }
      }
    };
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Deleting…" },
      async () => {
        await run(dashIds, (id) => dashboardsApi.delete(id), "dashboard");
        await run(chartIds, (id) => chartsApi.delete(id), "chart");
        await run(dsIds, (id) => datasetsApi.delete(id), "dataset");
      },
    );

    if (errors.length > 0) {
      vscode.window.showErrorMessage(`Some deletions failed:\n${errors.join("\n")}`);
    } else {
      vscode.window.showInformationMessage(`Deleted ${summary}.`);
    }
    await refreshLineage();
  }
}

/**
 * Build the Database → Schema → Dataset → Chart → Dashboard lineage model.
 * Only nodes that actually feed a chart are included (true lineage). Charts are
 * grouped by their dataset to reduce edge crossing. Node ids are
 * column-unique strings (e.g. schema id = "<dbId>::<schema>").
 */
function buildLineage(charts: Chart[], datasets: Dataset[], allDashboards: Dashboard[]): LineageModel {
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

  // Include orphan datasets (used by no chart) so they surface as isolated nodes,
  // wiring their schema/database scaffolding but leaving them without a downstream.
  for (const ds of datasets) {
    const dsKey = `ds${ds.id}`;
    if (datasetNodes.has(dsKey)) continue;
    const dbId = String(ds.database.id);
    const schema = ds.schema || "(default)";
    const schemaKey = `${dbId}::${schema}`;
    databases.set(dbId, ds.database.database_name);
    schemas.set(schemaKey, schema);
    datasetNodes.set(dsKey, ds.table_name);
    dbSchema.add(`${dbId}|${schemaKey}`);
    schemaDataset.add(`${schemaKey}|${dsKey}`);
  }

  // Include empty dashboards (containing no charts) as isolated nodes.
  for (const d of allDashboards) {
    dashboards.set(String(d.id), d.dashboard_title);
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

/**
 * Build normalized JSON snapshots of an experiment's source objects vs the
 * experimented clones, for the diff editor. Names are stripped of the "[label] "
 * prefix so unchanged objects line up; genuine edits (dataset SQL, chart params,
 * dashboard tiles) show as diffs. Object ids naturally differ and aren't shown.
 */
async function buildExperimentDiff(
  exp: Experiment,
  client: SupersetClient,
  intersectionOnly: boolean,
): Promise<{ original: string; experiment: string }> {
  const datasetsApi = new DatasetsApi(client);
  const chartsApi = new ChartsApi(client);
  const dashboardsApi = new DashboardsApi(client);
  const strip = (s: string) => s.replace(/^\[[^\]]*\]\s*/, "");
  // Recursively sort object keys so the two sides align on matching keys and
  // only genuine value changes / added-removed keys show as diffs.
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        o[k] = sortKeys((v as Record<string, unknown>)[k]);
      }
      return o;
    }
    return v;
  };
  // Parse chart params and drop volatile fields: slice_id (the clone's own id)
  // and viz_type (already shown at chart level). Superset rewrites params on
  // save, so keys are sorted to keep the diff readable.
  const parse = (s: string) => {
    let p: unknown;
    try {
      p = JSON.parse(s);
    } catch {
      return s;
    }
    if (p && typeof p === "object") {
      delete (p as Record<string, unknown>).slice_id;
      delete (p as Record<string, unknown>).viz_type;
    }
    return sortKeys(p);
  };
  // Intersection mode: keep only keys present on BOTH sides (recursively), so
  // defaults Superset injects on save drop out and only shared keys remain —
  // the diff then shows pure value changes.
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const common = (a: unknown, b: unknown): [unknown, unknown] => {
    if (isObj(a) && isObj(b)) {
      const oa: Record<string, unknown> = {};
      const ob: Record<string, unknown> = {};
      for (const k of Object.keys(a)) {
        if (k in b) {
          const [ca, cb] = common(a[k], b[k]);
          oa[k] = ca;
          ob[k] = cb;
        }
      }
      return [oa, ob];
    }
    return [a, b];
  };
  const tiles = (pj: string | null) =>
    Object.values(JSON.parse(pj || "{}") as Record<string, { type?: string; meta?: { sliceName?: string; chartId?: number } }>)
      .filter((n) => n && n.type === "CHART")
      .map((n) => n.meta?.sliceName ?? n.meta?.chartId)
      .sort();

  const links = exp.links!;
  const orig = { datasets: [] as unknown[], charts: [] as unknown[], dashboards: [] as unknown[] };
  const test = { datasets: [] as unknown[], charts: [] as unknown[], dashboards: [] as unknown[] };

  for (const { from, to } of links.datasets) {
    const [o, c] = await Promise.all([datasetsApi.get(from), datasetsApi.get(to)]);
    orig.datasets.push({ name: o.table_name, sql: o.sql });
    test.datasets.push({ name: strip(c.table_name), sql: c.sql });
  }
  for (const { from, to } of links.charts) {
    const [o, c] = await Promise.all([chartsApi.get(from), chartsApi.get(to)]);
    let po: unknown = parse(o.params);
    let pc: unknown = parse(c.params);
    if (intersectionOnly) [po, pc] = common(po, pc);
    orig.charts.push({ name: o.slice_name, viz_type: o.viz_type, params: po });
    test.charts.push({ name: strip(c.slice_name), viz_type: c.viz_type, params: pc });
  }
  for (const { from, to } of links.dashboards) {
    const [o, c] = await Promise.all([dashboardsApi.get(from), dashboardsApi.get(to)]);
    orig.dashboards.push({ title: o.dashboard_title, tiles: tiles(o.position_json) });
    test.dashboards.push({ title: strip(c.dashboard_title), tiles: tiles(c.position_json) });
  }
  return { original: JSON.stringify(orig, null, 2), experiment: JSON.stringify(test, null, 2) };
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
