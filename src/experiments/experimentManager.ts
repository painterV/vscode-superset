import * as vscode from "vscode";
import { DatasetsApi } from "../api/endpoints/datasets";
import { ChartsApi } from "../api/endpoints/charts";
import { DashboardsApi } from "../api/endpoints/dashboards";
import { swapChartRefs } from "./positionJson";

const KEY = "superset.experiments";

export interface Experiment {
  label: string;
  connection: string;
  createdAt: string;
  datasets: number[];
  charts: number[];
  dashboards: number[];
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
    };

    try {
      // 1. duplicate the dataset
      const newDs = await this.apis.datasets.duplicate(datasetId, `[${label}] ${ds.table_name}`);
      exp.datasets.push(newDs.id);

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
        for (const d of c.dashboards ?? []) dashboardIds.add(d.id);
      }

      // 3. faithful-replica each affected dashboard: copy (shares originals),
      //    then PUT the source layout with only our charts swapped to clones.
      for (const dashId of dashboardIds) {
        const src = await this.apis.dashboards.get(dashId);
        const copy = await this.apis.dashboards.copy(dashId, {
          dashboard_title: `[${label}] ${src.dashboard_title}`,
          json_metadata: src.json_metadata || "{}",
          css: src.css || "",
        });
        exp.dashboards.push(copy.id);
        await this.apis.dashboards.update(copy.id, {
          position_json: swapChartRefs(src.position_json, idMap),
        });
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
