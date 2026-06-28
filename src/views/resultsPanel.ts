import * as vscode from "vscode";
import { QueryResult } from "../api/endpoints/sqllab";
import { getSettings } from "../utils/config";

/** Quote a single CSV field per RFC 4180 when it contains a comma, quote, or newline. */
function csvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize columns + rows to an RFC 4180 CSV string (header row + all data rows). */
function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(csvField).join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\r\n");
  return `${header}\r\n${body}\r\n`;
}

/**
 * Manages query result webview panels.
 *
 * Each call to `show()` opens a new panel in column two (beside the editor).
 * Older panels are disposed when the `maxResultTabs` limit is reached.
 */
export class ResultsPanel {
  private panels: vscode.WebviewPanel[] = [];
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Open (or refresh) a results panel showing the given `QueryResult`.
   *
   * @param result - The query result returned by the Superset SQL Lab API.
   * @param title  - Short label used in the panel tab title.
   */
  show(result: QueryResult, title: string): void {
    const settings = getSettings();

    // Evict oldest panels when we're at the configured tab limit.
    while (this.panels.length >= settings.maxResultTabs) {
      const old = this.panels.shift();
      old?.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      "supersetResults",
      `Results: ${title}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );

    const cssUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "results.css"),
    );
    const jsUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "results.js"),
    );

    const duration = result.query?.duration ?? "?";
    const rowCount = result.data?.length ?? 0;

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="toolbar">
    <span class="info">✓ ${rowCount} rows · ${duration}s</span>
    <div>
      <button id="copyBtn">Copy</button>
      <button id="exportBtn">Export CSV</button>
    </div>
  </div>
  <div id="results"></div>
  <script src="${jsUri}"></script>
</body>
</html>`;

    // Send the result data to the webview after it loads.
    panel.webview.postMessage({
      type: "showResults",
      data: result.data,
      columns: result.columns,
      pageSize: settings.resultPageSize,
    });

    // Handle messages sent back from the webview JS.
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "copy") {
        vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage("Copied to clipboard");
      }
      if (msg.type === "export") {
        await this.exportCsv(result, title);
      }
    });

    // Remove the panel from the tracking array when the user closes it.
    panel.onDidDispose(() => {
      const idx = this.panels.indexOf(panel);
      if (idx >= 0) {
        this.panels.splice(idx, 1);
      }
    });

    this.panels.push(panel);
  }

  /**
   * Open an error panel when a query fails.
   *
   * @param error - Human-readable error message or stack trace.
   * @param title - Short label used in the panel tab title.
   */
  showError(error: string, title: string): void {
    const panel = vscode.window.createWebviewPanel(
      "supersetResults",
      `Error: ${title}`,
      vscode.ViewColumn.Two,
      { enableScripts: false },
    );

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <div class="error">${error}</div>
</body>
</html>`;
  }

  /**
   * Write the full result set (all rows, not just the visible page) to a
   * user-chosen .csv file via a save dialog.
   */
  private async exportCsv(result: QueryResult, title: string): Promise<void> {
    const rows = result.data ?? [];
    if (rows.length === 0) {
      vscode.window.showInformationMessage("Nothing to export — result set is empty.");
      return;
    }

    const safeName = title.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "results";
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${safeName}.csv`),
      filters: { "CSV files": ["csv"] },
    });
    if (!target) return;

    const csv = toCsv(result.columns, rows);
    await vscode.workspace.fs.writeFile(target, Buffer.from(csv, "utf8"));
    vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${target.fsPath}`);
  }

  /** Dispose all open result panels. */
  dispose(): void {
    for (const p of this.panels) {
      p.dispose();
    }
    this.panels = [];
  }
}
