import * as vscode from "vscode";
import { Experiment } from "../experiments/experimentManager";

/** Tree item for one experiment sandbox. */
export class ExperimentItem extends vscode.TreeItem {
  constructor(public readonly experiment: Experiment) {
    super(experiment.label, vscode.TreeItemCollapsibleState.None);
    this.description = `${experiment.datasets.length}ds · ${experiment.charts.length}ch · ${experiment.dashboards.length}db`;
    this.contextValue = "experiment";
    this.iconPath = new vscode.ThemeIcon("beaker");
    this.tooltip = `Created ${experiment.createdAt}${experiment.notes ? "\n" + experiment.notes : ""}`;
  }
}

/** Lists experiment sandboxes for the active connection. */
export class ExperimentsTreeProvider implements vscode.TreeDataProvider<ExperimentItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private getList: () => Experiment[] = () => [];

  /** Point the view at the current manager's list and refresh. */
  setSource(getList: () => Experiment[]): void {
    this.getList = getList;
    this.refresh();
  }
  clear(): void {
    this.getList = () => [];
    this.refresh();
  }
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(e: ExperimentItem): vscode.TreeItem {
    return e;
  }
  getChildren(): ExperimentItem[] {
    return this.getList().map((e) => new ExperimentItem(e));
  }
}
