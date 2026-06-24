import * as vscode from "vscode";
import { DashboardsApi } from "../api/endpoints/dashboards";
import { ChartsApi, Chart } from "../api/endpoints/charts";

/** Union of the two node types in the dashboard tree. */
type DashboardNode = DashboardItem | ChartItem;

/**
 * Top-level tree item representing a Superset dashboard.
 * Collapsible: its children are the charts embedded in that dashboard.
 */
class DashboardItem extends vscode.TreeItem {
  constructor(
    public readonly dashboardId: number,
    label: string,
    public readonly url: string,
    public readonly baseUrl: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("graph");
    this.contextValue = "dashboard";
  }
}

/**
 * Child tree item representing a chart inside a dashboard.
 * Leaf node; clicking triggers `superset.openChartSql` (registered in Task 10).
 */
class ChartItem extends vscode.TreeItem {
  constructor(
    public readonly chartId: number,
    label: string,
    public readonly dashboardId: number,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("graph-line");
    this.contextValue = "chart";
    this.command = {
      command: "superset.openChartSql",
      title: "View Chart SQL",
      arguments: [{ chartId, label, dashboardId }],
    };
  }
}

/**
 * Tree data provider for the Superset Dashboards panel.
 *
 * Shows a two-level hierarchy:
 *   Dashboard
 *   └── Chart
 *
 * Lifecycle:
 *   - Call `setApis()` after a successful connection.
 *   - Call `refresh()` to force VS Code to re-fetch the tree.
 *   - Call `clear()` on disconnect.
 */
export class DashboardTreeProvider implements vscode.TreeDataProvider<DashboardNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<DashboardNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private dashboardsApi: DashboardsApi | null = null;
  private chartsApi: ChartsApi | null = null;
  private baseUrl = "";

  /** Cache of chart lists keyed by dashboard ID (populated lazily). */
  private readonly dashboardCharts = new Map<number, Chart[]>();

  /**
   * Inject both API instances and the base URL used to build dashboard links.
   */
  setApis(apis: { dashboards: DashboardsApi; charts: ChartsApi }, baseUrl: string): void {
    this.dashboardsApi = apis.dashboards;
    this.chartsApi = apis.charts;
    this.baseUrl = baseUrl;
  }

  /** Clear the chart cache and fire a tree-data-changed event. */
  refresh(): void {
    this.dashboardCharts.clear();
    this._onDidChangeTreeData.fire();
  }

  /** Remove all API references and trigger a tree refresh. */
  clear(): void {
    this.dashboardsApi = null;
    this.chartsApi = null;
    this.baseUrl = "";
    this.dashboardCharts.clear();
    this._onDidChangeTreeData.fire();
  }

  // ---------------------------------------------------------------------------
  // TreeDataProvider implementation
  // ---------------------------------------------------------------------------

  getTreeItem(element: DashboardNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DashboardNode): Promise<DashboardNode[]> {
    if (!this.dashboardsApi || !this.chartsApi) {
      return [];
    }

    // Root level: list dashboards.
    if (!element) {
      const dashboards = await this.dashboardsApi.list();
      return dashboards.map(
        (d) => new DashboardItem(d.id, d.dashboard_title, d.url, this.baseUrl),
      );
    }

    // Dashboard level: list charts.
    // The Superset API doesn't expose a per-dashboard chart endpoint in the
    // basic plan, so we list all charts and cache the result.
    if (element instanceof DashboardItem) {
      let charts = this.dashboardCharts.get(element.dashboardId);
      if (!charts) {
        charts = await this.chartsApi.list();
        this.dashboardCharts.set(element.dashboardId, charts);
      }
      return charts.map((c) => new ChartItem(c.id, c.slice_name, element.dashboardId));
    }

    // Chart nodes are leaves.
    return [];
  }
}
