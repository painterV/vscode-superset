import * as vscode from "vscode";
import { DatasetsApi } from "../api/endpoints/datasets";
import { ChartsApi } from "../api/endpoints/charts";
import { DashboardsApi } from "../api/endpoints/dashboards";
import { swapChartRefs } from "./positionJson";

const KEY = "superset.experiments";

/** original → clone id pairs, recorded so an experiment can be diffed against its source. */
export interface ExperimentLinks {
  datasets: { from: number; to: number }[];
  charts: { from: number; to: number }[];
  dashboards: { from: number; to: number }[];
}

export interface Experiment {
  label: string;
  connection: string;
  createdAt: string;
  datasets: number[];
  charts: number[];
  dashboards: number[];
  // Optional: absent on experiments created before diff support.
  links?: ExperimentLinks;
  notes?: string;
}

interface Apis {
  datasets: DatasetsApi;
  charts: ChartsApi;
  dashboards: DashboardsApi;
}

/**
 * Clones a virtual dataset's downstream lineage into a tracked "experiment"
 * sandbox and tears it down on demand. The manifest lives in VS Code global
 * state, scoped per connection so different servers never collide. Teardown
 * touches only manifest ids, so originals are unreachable.
 */
export class ExperimentManager {
  constructor(
    private readonly state: vscode.Memento,
    private readonly apis: Apis,
    private readonly connectionName: string,
  ) {}

  private all(): Experiment[] {
    return this.state.get<Experiment[]>(KEY, []);
  }
  private async save(list: Experiment[]): Promise<void> {
    await this.state.update(KEY, list);
  }

  /** Experiments belonging to the current connection. */
  list(): Experiment[] {
    return this.all().filter((e) => e.connection === this.connectionName);
  }

  /**
   * Clone dataset `datasetId` + all its charts + every dashboard containing
   * them. Rolls back partial work if anything fails mid-clone.
   */
  async clone(datasetId: number, label: string): Promise<Experiment> {
    const ds = await this.apis.datasets.get(datasetId);
    if (ds.kind !== "virtual") {
      throw new Error(
        `Dataset "${ds.table_name}" is physical; only virtual (SQL) datasets can be cloned.`,
      );
    }

    const exp: Experiment = {
      label,
      connection: this.connectionName,
      createdAt: new Date().toISOString(),
      datasets: [],
      charts: [],
      dashboards: [],
      links: { datasets: [], charts: [], dashboards: [] },
    };

    try {
      // 1. duplicate the dataset
      const newDs = await this.apis.datasets.duplicate(datasetId, `[${label}] ${ds.table_name}`);
      exp.datasets.push(newDs.id);
      exp.links!.datasets.push({ from: datasetId, to: newDs.id });

      // 2. clone every chart on this dataset; build original->clone id map
      const allCharts = await this.apis.charts.list();
      const onDataset = allCharts.filter(
        (c) => c.datasource_type === "table" && c.datasource_id === datasetId,
      );
      const idMap = new Map<number, number>();
      const dashboardIds = new Set<number>();
      for (const c of onDataset) {
        const detail = await this.apis.charts.get(c.id);
        const created = await this.apis.charts.create({
          slice_name: `[${label}] ${detail.slice_name}`,
          viz_type: detail.viz_type,
          datasource_id: newDs.id,
          datasource_type: "table",
          params: detail.params,
          query_context: detail.query_context ?? undefined,
        });
        idMap.set(c.id, created.id);
        exp.charts.push(created.id);
        exp.links!.charts.push({ from: c.id, to: created.id });
        for (const d of c.dashboards ?? []) dashboardIds.add(d.id);
      }

      // 3. build an experiment replica of each affected dashboard.
      for (const dashId of dashboardIds) {
        const newDashId = await this.buildExperimentDashboard(dashId, idMap, label);
        exp.dashboards.push(newDashId);
        exp.links!.dashboards.push({ from: dashId, to: newDashId });
      }

      const list = this.all();
      list.push(exp);
      await this.save(list);
      return exp;
    } catch (err) {
      // best-effort rollback of whatever was created so far
      await this.teardownObjects(exp);
      throw err;
    }
  }

  /**
   * Experiment a *dashboard* selectively (top-down): clone only the chosen
   * charts (and, for chosen virtual datasets, their datasets), then copy the
   * dashboard so it points at the clones for experimented charts and keeps the
   * originals for everything else. Originals are never modified.
   *
   * @param chartIds   charts the user chose to experiment (clone)
   * @param datasetIds virtual datasets the user chose to experiment; physical
   *                   datasets are skipped (they can't be updated safely)
   */
  async cloneDashboard(
    dashboardId: number,
    label: string,
    chartIds: Set<number>,
    datasetIds: Set<number>,
  ): Promise<Experiment> {
    const allCharts = await this.apis.charts.list();
    const inDash = allCharts.filter((c) => (c.dashboards ?? []).some((d) => d.id === dashboardId));

    const exp: Experiment = {
      label,
      connection: this.connectionName,
      createdAt: new Date().toISOString(),
      datasets: [],
      charts: [],
      dashboards: [],
      links: { datasets: [], charts: [], dashboards: [] },
    };

    try {
      // 1. clone chosen datasets (virtual only) → original->clone id map
      const dsMap = new Map<number, number>();
      for (const dsId of datasetIds) {
        const ds = await this.apis.datasets.get(dsId);
        if (ds.kind !== "virtual") continue; // physical datasets stay shared
        const created = await this.apis.datasets.duplicate(dsId, `[${label}] ${ds.table_name}`);
        dsMap.set(dsId, created.id);
        exp.datasets.push(created.id);
        exp.links!.datasets.push({ from: dsId, to: created.id });
      }

      // 2. clone chosen charts, repointing to a cloned dataset when applicable
      const chartMap = new Map<number, number>();
      for (const c of inDash) {
        if (!chartIds.has(c.id)) continue;
        const detail = await this.apis.charts.get(c.id);
        const newDsId =
          c.datasource_type === "table" && dsMap.has(c.datasource_id)
            ? dsMap.get(c.datasource_id)!
            : c.datasource_id;
        const created = await this.apis.charts.create({
          slice_name: `[${label}] ${detail.slice_name}`,
          viz_type: detail.viz_type,
          datasource_id: newDsId,
          datasource_type: c.datasource_type ?? "table",
          params: detail.params,
          query_context: detail.query_context ?? undefined,
        });
        chartMap.set(c.id, created.id);
        exp.charts.push(created.id);
        exp.links!.charts.push({ from: c.id, to: created.id });
      }

      // 3. build the experiment replica dashboard (clones swapped in, rest shared).
      const newDashId = await this.buildExperimentDashboard(dashboardId, chartMap, label);
      exp.dashboards.push(newDashId);
      exp.links!.dashboards.push({ from: dashboardId, to: newDashId });

      const list = this.all();
      list.push(exp);
      await this.save(list);
      return exp;
    } catch (err) {
      await this.teardownObjects(exp);
      throw err;
    }
  }

  /**
   * Build an experiment replica of dashboard `srcDashId`: a fresh dashboard whose
   * layout points at the cloned charts (per `chartMap`) and shares the originals
   * for everything else. Chart↔dashboard associations are set from the chart side
   * — the only reliable REST path (PUTting a dashboard's position_json changes
   * layout but never the chart M2M). Deleting the replica later cleanly detaches
   * the shared originals without altering them.
   *
   * ponytail: json_metadata (native filters) is copied verbatim; a filter scope
   * that targets an experimented chart still references the original id — fine
   * for a sandbox, revisit if filter fidelity on clones is needed.
   */
  private async buildExperimentDashboard(
    srcDashId: number,
    chartMap: Map<number, number>,
    label: string,
  ): Promise<number> {
    const src = await this.apis.dashboards.get(srcDashId);
    // Listed AFTER clones exist, so clones' current memberships are visible too.
    const allCharts = await this.apis.charts.list();
    const dashesOf = new Map<number, number[]>(
      allCharts.map((c) => [c.id, (c.dashboards ?? []).map((d) => d.id)]),
    );
    const inDash = allCharts.filter((c) => (dashesOf.get(c.id) ?? []).includes(srcDashId));

    const created = await this.apis.dashboards.create({
      dashboard_title: `[${label}] ${src.dashboard_title}`,
      json_metadata: src.json_metadata || "{}",
      css: src.css || "",
    });
    const newId = created.id;
    await this.apis.dashboards.update(newId, {
      position_json: swapChartRefs(src.position_json, chartMap),
    });

    // Associate the replica from the chart side: clone for experimented charts,
    // the original itself for shared ones. Append (never overwrite) so a clone
    // reused across several replicas keeps all its memberships.
    for (const c of inDash) {
      const chartId = chartMap.has(c.id) ? chartMap.get(c.id)! : c.id;
      const cur = dashesOf.get(chartId) ?? [];
      await this.apis.charts.setDashboards(chartId, [...new Set([...cur, newId])]);
    }
    return newId;
  }

  /**
   * Delete an experiment's objects (dashboards → charts → datasets) and remove
   * its manifest entry. Idempotent: per-object failures are reported and the
   * surviving ids are kept so a retry resumes cleanly.
   */
  async delete(label: string): Promise<{ deleted: number; failed: string[] }> {
    const list = this.all();
    const exp = list.find((e) => e.label === label && e.connection === this.connectionName);
    if (!exp) return { deleted: 0, failed: [`No experiment "${label}"`] };

    const before = exp.dashboards.length + exp.charts.length + exp.datasets.length;
    const failed = await this.teardownObjects(exp);
    const remaining = exp.dashboards.length + exp.charts.length + exp.datasets.length;

    if (remaining === 0) {
      await this.save(list.filter((e) => e !== exp));
    } else {
      await this.save(list); // keep pruned entry so a retry resumes
    }
    return { deleted: before - remaining, failed };
  }

  /** Delete in reverse dependency order; prune succeeded ids from `exp`. */
  private async teardownObjects(exp: Experiment): Promise<string[]> {
    const failed: string[] = [];
    const pass = async (
      ids: number[],
      del: (id: number) => Promise<void>,
      kind: string,
    ): Promise<number[]> => {
      const survivors: number[] = [];
      for (const id of ids) {
        try {
          await del(id);
        } catch (e: unknown) {
          failed.push(`${kind} ${id}: ${(e as Error).message}`);
          survivors.push(id);
        }
      }
      return survivors;
    };
    exp.dashboards = await pass(exp.dashboards, (id) => this.apis.dashboards.delete(id), "dashboard");
    exp.charts = await pass(exp.charts, (id) => this.apis.charts.delete(id), "chart");
    exp.datasets = await pass(exp.datasets, (id) => this.apis.datasets.delete(id), "dataset");
    return failed;
  }
}
