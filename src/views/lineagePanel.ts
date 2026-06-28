import * as vscode from "vscode";

interface LineageNode {
  id: string;
  name: string;
}
interface LineageEdge {
  from: string;
  to: string;
}

/** Node + edge model for the Database → Schema → Dataset → Chart → Dashboard graph. */
export interface LineageModel {
  databases: LineageNode[];
  schemas: LineageNode[];
  datasets: LineageNode[];
  charts: LineageNode[];
  dashboards: LineageNode[];
  dbSchemaEdges: LineageEdge[];
  schemaDatasetEdges: LineageEdge[];
  datasetChartEdges: LineageEdge[];
  chartDashEdges: LineageEdge[];
}

/**
 * Webview panel rendering the lineage graph as a 3-column SVG.
 * The model is embedded into the HTML (no postMessage race); node clicks are
 * sent back to the extension via `onOpen`.
 */
export class LineagePanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onOpen: (kind: string, id: number) => void,
  ) {}

  show(model: LineageModel): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "supersetLineage",
        "Superset: Dependency Graph",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((m) => {
        if (m.type === "open") this.onOpen(m.kind, m.id);
      });
    }

    const w = this.panel.webview;
    const cssUri = w.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "lineage.css"));
    const jsUri = w.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "lineage.js"));
    // Escape `<` so the JSON can't break out of the script tag.
    const json = JSON.stringify(model).replace(/</g, "\\u003c");

    w.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="header">
    <div class="counts">
      ${model.databases.length} db · ${model.schemas.length} schemas · ${model.datasets.length} datasets · ${model.charts.length} charts · ${model.dashboards.length} dashboards
    </div>
    <div class="filterbar">
      <select id="ftype">
        <option value="">Filter by type…</option>
        <option value="db">Database</option>
        <option value="schema">Schema</option>
        <option value="dataset">Dataset</option>
        <option value="chart">Chart</option>
        <option value="dash">Dashboard</option>
      </select>
      <select id="fobj"><option value="">—</option></select>
      <button id="fclear">Clear</button>
    </div>
    <span class="hint">click a node to trace its full upstream + downstream · double-click a chart/dashboard to open</span>
  </div>
  <div id="graph"></div>
  <script id="model" type="application/json">${json}</script>
  <script src="${jsUri}"></script>
</body>
</html>`;

    this.panel.reveal();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
