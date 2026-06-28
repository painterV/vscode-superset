# Dataset Experiment Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone a virtual dataset's downstream lineage (dataset + charts + dashboards) into a manifest-tracked experiment sandbox, with one-click teardown that never touches originals.

**Architecture:** The extension orchestrates Superset REST calls in dependency order (dataset → charts → dashboards), records every created object ID in a per-connection manifest stored in VS Code global state, and tears down by deleting exactly those IDs in reverse order. Mixed dashboards are faithful replicas: only the experiment dataset's charts are swapped for clones via a pure `position_json` rewrite.

**Tech Stack:** TypeScript, VS Code extension API, esbuild, Superset REST API, Mocha (`@vscode/test-electron`), no new runtime dependencies.

## Global Constraints

- **Virtual datasets only** — block clone when `dataset.kind !== "virtual"` (Superset's duplicate endpoint is virtual-only).
- **Manifest in `context.globalState`**, key `superset.experiments`, keyed by connection name so servers don't collide.
- **Teardown deletes only manifest IDs**, reverse order: dashboards → charts → datasets. Originals are never written to the manifest.
- **Faithful-replica mixed dashboards** — swap only the experiment dataset's charts; all other charts keep referencing originals.
- **No new runtime dependencies.** Follow the existing `src/api/endpoints/*` and `src/views/*` patterns.
- Cloned objects are named `[<label>] <original name>`.

---

### Task 1: Spike — de-risk the duplicate + position_json swap end-to-end

**Goal:** Confirm the real request/response shapes before writing typed code. Exploratory; output is documented facts the next tasks consume.

**Files:**
- Create: `docs/superpowers/notes/2026-06-28-spike-results.md`

- [ ] **Step 1: Create a virtual dataset to test against** (examples has none)

Run against the local instance (admin/admin), via curl or a scratch node script: `POST /api/v1/dataset/` with `{ "database": 1, "schema": "main", "table_name": "exp_spike_src", "sql": "SELECT 1 AS id, 2 AS amount" }`. Record its `id`.

- [ ] **Step 2: Duplicate it**

`POST /api/v1/dataset/duplicate` with `{ "base_model_id": <id>, "table_name": "exp_spike_copy" }`. Confirm HTTP 201 and capture the new dataset id from the response. Note the exact response shape.

- [ ] **Step 3: Copy a dashboard with duplicate_slices=false**

`POST /api/v1/dashboard/<id>/copy/` with `{ "dashboard_title": "[spike] X", "duplicate_slices": false, "css": "", "json_metadata": "<source json_metadata>" }`. Capture the new dashboard id and confirm it references the ORIGINAL charts.

- [ ] **Step 4: Swap one chart ref in position_json and PUT it back**

GET the copied dashboard, parse `position_json`, find a `type:"CHART"` component, change its `meta.chartId` to a different existing chart id, `PUT /api/v1/dashboard/<newId>` with `{ "position_json": "<modified>" }`. Confirm in the browser UI the swapped chart renders.

- [ ] **Step 5: Delete the spike objects**

DELETE the copied dashboard, the duplicated dataset, the source dataset. Confirm clean teardown.

- [ ] **Step 6: Write `docs/superpowers/notes/2026-06-28-spike-results.md`**

Record: exact duplicate request/response, copy request/response, whether `position_json` PUT alone is enough or the dashboard `charts` relationship must also be updated, and any field surprises. **If the chart-swap requires more than position_json, note it — Task 5 depends on this.**

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/notes/2026-06-28-spike-results.md
git commit -m "spike: confirm dataset duplicate + dashboard position_json swap"
```

---

### Task 2: API layer — dataset duplicate, chart get/create, dashboard get/copy/update

**Files:**
- Modify: `src/api/endpoints/datasets.ts`
- Modify: `src/api/endpoints/charts.ts`
- Modify: `src/api/endpoints/dashboards.ts`

**Interfaces:**
- Consumes: `SupersetClient` (`get`, `post`, `put`, `del`) from `src/api/client.ts`.
- Produces:
  - `DatasetsApi.get(id): Promise<DatasetDetail>` where `DatasetDetail` includes `kind: string`, `table_name: string`, `database: {id; database_name}`.
  - `DatasetsApi.duplicate(baseModelId: number, newName: string): Promise<{ id: number }>`
  - `ChartsApi.get(id)` extended to return `params: string`, `query_context: unknown`, `datasource_type: string` (add to `ChartDetail`).
  - `ChartsApi.create(payload: ChartCreatePayload): Promise<{ id: number }>` where `ChartCreatePayload = { slice_name: string; viz_type: string; datasource_id: number; datasource_type: string; params: string; query_context?: string }`.
  - `DashboardsApi.get(id): Promise<DashboardDetail>` with `position_json: string`, `json_metadata: string`, `css: string`, `dashboard_title: string`.
  - `DashboardsApi.copy(id, opts: { dashboard_title: string; json_metadata: string; css: string }): Promise<{ id: number }>` (always `duplicate_slices:false`).
  - `DashboardsApi.update(id, body: { position_json?: string }): Promise<void>`
  - `DatasetsApi.delete(id)`, `ChartsApi.delete(id)`, `DashboardsApi.delete(id)`.

- [ ] **Step 1: Add duplicate + get + delete to `datasets.ts`**

```ts
export interface DatasetDetail extends Dataset {
  kind: string;
}

// inside DatasetsApi:
async get(id: number): Promise<DatasetDetail> {
  const resp = await this.client.get<{ result: DatasetDetail }>(`/api/v1/dataset/${id}`);
  return resp.result;
}

async duplicate(baseModelId: number, newName: string): Promise<{ id: number }> {
  return this.client.post<{ id: number }>("/api/v1/dataset/duplicate", {
    base_model_id: baseModelId,
    table_name: newName,
  });
}

async delete(id: number): Promise<void> {
  await this.client.del(`/api/v1/dataset/${id}`);
}
```

- [ ] **Step 2: Extend `charts.ts` with create + delete and fuller detail**

```ts
export interface ChartDetail extends Chart {
  query: string;
  datasource_name_text: string;
  params: string;
  query_context: string | null;
}

export interface ChartCreatePayload {
  slice_name: string;
  viz_type: string;
  datasource_id: number;
  datasource_type: string;
  params: string;
  query_context?: string;
}

// inside ChartsApi:
async create(payload: ChartCreatePayload): Promise<{ id: number }> {
  return this.client.post<{ id: number }>("/api/v1/chart/", payload);
}

async delete(id: number): Promise<void> {
  await this.client.del(`/api/v1/chart/${id}`);
}
```

- [ ] **Step 3: Add get/copy/update/delete to `dashboards.ts`**

```ts
export interface DashboardDetail {
  id: number;
  dashboard_title: string;
  position_json: string;
  json_metadata: string;
  css: string;
}

// inside DashboardsApi:
async get(id: number): Promise<DashboardDetail> {
  const resp = await this.client.get<{ result: DashboardDetail }>(`/api/v1/dashboard/${id}`);
  return resp.result;
}

async copy(id: number, opts: { dashboard_title: string; json_metadata: string; css: string }): Promise<{ id: number }> {
  const resp = await this.client.post<{ result: { id: number } }>(`/api/v1/dashboard/${id}/copy/`, {
    dashboard_title: opts.dashboard_title,
    duplicate_slices: false,
    css: opts.css,
    json_metadata: opts.json_metadata,
  });
  return resp.result;
}

async update(id: number, body: { position_json?: string }): Promise<void> {
  await this.client.put(`/api/v1/dashboard/${id}`, body);
}

async delete(id: number): Promise<void> {
  await this.client.del(`/api/v1/dashboard/${id}`);
}
```

> Adjust the `copy`/`duplicate` response unwrapping if Task 1's spike notes show a different envelope (`{id}` vs `{result:{id}}`).

- [ ] **Step 4: Compile**

Run: `npm run compile`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/endpoints/datasets.ts src/api/endpoints/charts.ts src/api/endpoints/dashboards.ts
git commit -m "feat(api): dataset duplicate, chart create, dashboard copy/update + deletes"
```

---

### Task 3: Pure `position_json` chart-swap

**Files:**
- Create: `src/experiments/positionJson.ts`
- Test: `test/suite/positionJson.test.ts`

**Interfaces:**
- Produces: `swapChartRefs(positionJson: string, idMap: Map<number, number>): string` — returns a new `position_json` string where every CHART component whose `meta.chartId` is a key in `idMap` is rewritten to the mapped id; all other components are byte-for-byte preserved.

- [ ] **Step 1: Write the failing test**

```ts
import * as assert from "assert";
import { swapChartRefs } from "../../src/experiments/positionJson";

suite("swapChartRefs", () => {
  test("swaps only mapped chart ids, leaves others untouched", () => {
    const pj = JSON.stringify({
      "CHART-a": { type: "CHART", meta: { chartId: 96, sliceName: "A" } },
      "CHART-b": { type: "CHART", meta: { chartId: 50, sliceName: "B" } },
      "GRID": { type: "GRID", meta: {} },
    });
    const out = JSON.parse(swapChartRefs(pj, new Map([[96, 200]])));
    assert.strictEqual(out["CHART-a"].meta.chartId, 200); // swapped
    assert.strictEqual(out["CHART-b"].meta.chartId, 50);  // untouched
    assert.strictEqual(out["GRID"].type, "GRID");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run compile-tests && node ./out/test/runTest.js`
Expected: FAIL — `swapChartRefs` not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Rewrite a dashboard position_json, replacing CHART components whose
 * meta.chartId is in idMap with the mapped clone id. Other components are
 * preserved. Pure — no I/O.
 */
export function swapChartRefs(positionJson: string, idMap: Map<number, number>): string {
  const layout = JSON.parse(positionJson || "{}");
  for (const node of Object.values(layout) as any[]) {
    if (node && node.type === "CHART" && node.meta && idMap.has(node.meta.chartId)) {
      node.meta = { ...node.meta, chartId: idMap.get(node.meta.chartId) };
    }
  }
  return JSON.stringify(layout);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm run compile-tests && node ./out/test/runTest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/experiments/positionJson.ts test/suite/positionJson.test.ts
git commit -m "feat(experiments): pure position_json chart-ref swap"
```

---

### Task 4: ExperimentManager — manifest model + clone orchestration

**Files:**
- Create: `src/experiments/experimentManager.ts`

**Interfaces:**
- Consumes: the API classes from Task 2, `swapChartRefs` from Task 3, `vscode.Memento` (global state), `ChartsApi` chart list (with `datasource_id`, `datasource_type`, `dashboards`).
- Produces:
  - `interface Experiment { label: string; connection: string; createdAt: string; datasets: number[]; charts: number[]; dashboards: number[]; notes?: string }`
  - `class ExperimentManager` constructed with `(state: vscode.Memento, apis: { datasets; charts; dashboards }, connectionName: string)`.
  - `list(): Experiment[]` (current connection only)
  - `clone(datasetId: number, label: string): Promise<Experiment>`

- [ ] **Step 1: Manifest read/write helpers + list**

```ts
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

export class ExperimentManager {
  constructor(
    private readonly state: vscode.Memento,
    private readonly apis: { datasets: DatasetsApi; charts: ChartsApi; dashboards: DashboardsApi },
    private readonly connectionName: string,
  ) {}

  private all(): Experiment[] {
    return this.state.get<Experiment[]>(KEY, []);
  }
  private async save(list: Experiment[]): Promise<void> {
    await this.state.update(KEY, list);
  }
  list(): Experiment[] {
    return this.all().filter((e) => e.connection === this.connectionName);
  }
}
```

- [ ] **Step 2: Implement `clone()` orchestration**

```ts
  async clone(datasetId: number, label: string): Promise<Experiment> {
    const ds = await this.apis.datasets.get(datasetId);
    if (ds.kind !== "virtual") {
      throw new Error(`Dataset "${ds.table_name}" is physical; only virtual (SQL) datasets can be cloned.`);
    }

    const exp: Experiment = {
      label, connection: this.connectionName, createdAt: new Date().toISOString(),
      datasets: [], charts: [], dashboards: [],
    };

    try {
      // 1. duplicate dataset
      const newDs = await this.apis.datasets.duplicate(datasetId, `[${label}] ${ds.table_name}`);
      exp.datasets.push(newDs.id);

      // 2. clone every chart on this dataset; build old->new id map
      const allCharts = await this.apis.charts.list();
      const onDataset = allCharts.filter((c) => c.datasource_type === "table" && c.datasource_id === datasetId);
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

      // 3. faithful-replica each affected dashboard
      for (const dashId of dashboardIds) {
        const src = await this.apis.dashboards.get(dashId);
        const copy = await this.apis.dashboards.copy(dashId, {
          dashboard_title: `[${label}] ${src.dashboard_title}`,
          json_metadata: src.json_metadata,
          css: src.css,
        });
        exp.dashboards.push(copy.id);
        const swapped = swapChartRefs(src.position_json, idMap);
        await this.apis.dashboards.update(copy.id, { position_json: swapped });
      }

      const list = this.all();
      list.push(exp);
      await this.save(list);
      return exp;
    } catch (err) {
      // best-effort rollback of whatever was created, then rethrow
      await this.teardownObjects(exp);
      throw err;
    }
  }
```

> `teardownObjects` is defined in Task 5; Task 4 and Task 5 land together if implemented in one file, but keep the commits separate per step.

- [ ] **Step 3: Compile**

Run: `npm run compile`
Expected: error — `teardownObjects` not yet defined (resolved in Task 5). If implementing tasks in order, proceed to Task 5 before compiling clean.

- [ ] **Step 4: Commit**

```bash
git add src/experiments/experimentManager.ts
git commit -m "feat(experiments): ExperimentManager clone orchestration"
```

---

### Task 5: ExperimentManager — teardown (reverse order, idempotent) + test

**Files:**
- Modify: `src/experiments/experimentManager.ts`
- Test: `test/suite/teardown.test.ts`

**Interfaces:**
- Produces:
  - `delete(label: string): Promise<{ deleted: number; failed: string[] }>`
  - private `teardownObjects(exp: Experiment): Promise<string[]>` — deletes dashboards → charts → datasets, returns list of failures, prunes succeeded ids from `exp` in place.

- [ ] **Step 1: Write the failing test (deletion order)**

```ts
import * as assert from "assert";
import { ExperimentManager } from "../../src/experiments/experimentManager";

suite("teardown order", () => {
  test("deletes dashboards, then charts, then datasets", async () => {
    const order: string[] = [];
    const apis: any = {
      dashboards: { delete: async (id: number) => order.push("dash:" + id) },
      charts: { delete: async (id: number) => order.push("chart:" + id) },
      datasets: { delete: async (id: number) => order.push("ds:" + id) },
    };
    const mem: any = { get: () => [{ label: "x", connection: "c", createdAt: "", datasets: [1], charts: [2], dashboards: [3] }], update: async () => {} };
    const mgr = new ExperimentManager(mem, apis, "c");
    await mgr.delete("x");
    assert.deepStrictEqual(order, ["dash:3", "chart:2", "ds:1"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run compile-tests && node ./out/test/runTest.js`
Expected: FAIL — `delete` not implemented.

- [ ] **Step 3: Implement teardown**

```ts
  private async teardownObjects(exp: Experiment): Promise<string[]> {
    const failed: string[] = [];
    const pass = async (ids: number[], del: (id: number) => Promise<void>, kind: string) => {
      const survivors: number[] = [];
      for (const id of ids) {
        try { await del(id); } catch (e: any) { failed.push(`${kind} ${id}: ${e.message}`); survivors.push(id); }
      }
      return survivors;
    };
    exp.dashboards = await pass(exp.dashboards, (id) => this.apis.dashboards.delete(id), "dashboard");
    exp.charts = await pass(exp.charts, (id) => this.apis.charts.delete(id), "chart");
    exp.datasets = await pass(exp.datasets, (id) => this.apis.datasets.delete(id), "dataset");
    return failed;
  }

  async delete(label: string): Promise<{ deleted: number; failed: string[] }> {
    const list = this.all();
    const exp = list.find((e) => e.label === label && e.connection === this.connectionName);
    if (!exp) return { deleted: 0, failed: [`No experiment "${label}"`] };
    const before = exp.dashboards.length + exp.charts.length + exp.datasets.length;
    const failed = await this.teardownObjects(exp);
    const remaining = exp.dashboards.length + exp.charts.length + exp.datasets.length;
    if (remaining === 0) {
      await this.save(list.filter((e) => e !== exp)); // fully gone — drop entry
    } else {
      await this.save(list); // keep pruned entry so retry resumes
    }
    return { deleted: before - remaining, failed };
  }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm run compile-tests && node ./out/test/runTest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/experiments/experimentManager.ts test/suite/teardown.test.ts
git commit -m "feat(experiments): idempotent reverse-order teardown"
```

---

### Task 6: Experiments tree view + commands + entry points

**Files:**
- Create: `src/views/experimentsTreeView.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ExperimentManager` (Tasks 4–5), `activeClient`/`activeAuth`, `openSupersetUrl`.
- Produces: commands `superset.cloneExperiment`, `superset.deleteExperiment`, `superset.refreshExperiments`; a `supersetExperiments` view.

- [ ] **Step 1: Tree view**

```ts
import * as vscode from "vscode";
import { Experiment } from "../experiments/experimentManager";

class ExperimentItem extends vscode.TreeItem {
  constructor(public readonly experiment: Experiment) {
    super(experiment.label, vscode.TreeItemCollapsibleState.None);
    this.description = `${experiment.datasets.length}ds · ${experiment.charts.length}ch · ${experiment.dashboards.length}db`;
    this.contextValue = "experiment";
    this.iconPath = new vscode.ThemeIcon("beaker");
    this.tooltip = `Created ${experiment.createdAt}${experiment.notes ? "\n" + experiment.notes : ""}`;
  }
}

export class ExperimentsTreeProvider implements vscode.TreeDataProvider<ExperimentItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private getList: () => Experiment[] = () => [];

  setSource(getList: () => Experiment[]): void { this.getList = getList; this.refresh(); }
  refresh(): void { this._onDidChangeTreeData.fire(); }
  getTreeItem(e: ExperimentItem): vscode.TreeItem { return e; }
  getChildren(): ExperimentItem[] { return this.getList().map((e) => new ExperimentItem(e)); }
}
```

- [ ] **Step 2: Register view, manager, and commands in `extension.ts`**

After connect succeeds (where the other APIs are built), construct the manager and wire the view:

```ts
// near other tree providers
const experimentsTree = new ExperimentsTreeProvider();
vscode.window.registerTreeDataProvider("supersetExperiments", experimentsTree);

// inside superset.connect, after activeClient is set:
const experimentManager = new ExperimentManager(
  context.globalState,
  { datasets: new DatasetsApi(activeClient), charts: new ChartsApi(activeClient), dashboards: new DashboardsApi(activeClient) },
  connection.name,
);
experimentsTree.setSource(() => experimentManager.list());
// store experimentManager in an outer-scope `let` so commands can reach it
```

Commands (register in the same `context.subscriptions.push(...)` block):

```ts
vscode.commands.registerCommand("superset.cloneExperiment", async (node?: { kind?: string; id?: string }) => {
  if (!activeExperimentManager) { vscode.window.showWarningMessage("Connect to Superset first."); return; }
  // dataset node from lineage graph passes kind==="dataset", id==="ds<id>"
  const datasetId = node?.kind === "dataset" && node.id ? Number(node.id.replace(/^ds/, "")) : undefined;
  if (datasetId === undefined) { vscode.window.showWarningMessage("Right-click a dataset node in the Dependency Graph to clone it."); return; }
  const label = await vscode.window.showInputBox({ prompt: "Experiment label", placeHolder: "exp1" });
  if (!label) return;
  try {
    const exp = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Cloning experiment "${label}"...` },
      () => activeExperimentManager!.clone(datasetId, label),
    );
    experimentsTree.refresh();
    vscode.window.showInformationMessage(`Experiment "${label}": ${exp.datasets.length} dataset, ${exp.charts.length} charts, ${exp.dashboards.length} dashboards.`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Clone failed: ${err.message}`);
  }
}),

vscode.commands.registerCommand("superset.deleteExperiment", async (item: { experiment: { label: string; datasets: number[]; charts: number[]; dashboards: number[] } }) => {
  if (!activeExperimentManager || !item?.experiment) return;
  const e = item.experiment;
  const ok = await vscode.window.showWarningMessage(
    `Delete experiment "${e.label}"? Removes ${e.dashboards.length} dashboards, ${e.charts.length} charts, ${e.datasets.length} dataset(s).`,
    { modal: true }, "Delete",
  );
  if (ok !== "Delete") return;
  const res = await activeExperimentManager.delete(e.label);
  experimentsTree.refresh();
  if (res.failed.length) vscode.window.showWarningMessage(`Deleted ${res.deleted}; ${res.failed.length} failed: ${res.failed.join("; ")}`);
  else vscode.window.showInformationMessage(`Deleted experiment "${e.label}".`);
}),

vscode.commands.registerCommand("superset.refreshExperiments", () => experimentsTree.refresh()),
```

Add a module-scope `let activeExperimentManager: ExperimentManager | null = null;` and set it on connect, clear on disconnect. Pipe the lineage graph's dataset right-click into `superset.cloneExperiment` (the lineage webview already posts node info on click; add a context action or a second message type `clone` handled in `LineagePanel`'s `onOpen` sibling).

- [ ] **Step 3: package.json — view, commands, menus**

Add under `contributes.views.superset-explorer` a `{ "id": "supersetExperiments", "name": "Experiments" }`. Add commands `superset.cloneExperiment` (icon `$(beaker)`), `superset.deleteExperiment` (icon `$(trash)`), `superset.refreshExperiments` (icon `$(refresh)`). Add `view/item/context` menu binding `superset.deleteExperiment` to `viewItem == experiment` (group `inline`), and `view/title` refresh on `view == supersetExperiments`.

- [ ] **Step 4: Compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/views/experimentsTreeView.ts src/extension.ts package.json
git commit -m "feat(experiments): Experiments view, clone/delete commands, lineage entry"
```

---

### Task 7: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build a virtual dataset + chart + dashboard in the local instance** (examples has no virtual datasets). Create a virtual dataset (`SELECT ...`), one chart on it, add the chart to a dashboard that also has an examples chart.

- [ ] **Step 2: Reload the extension** (`Cmd+R`), connect, open the Dependency Graph, right-click the virtual dataset node → Clone as Experiment → label `e2e`.

- [ ] **Step 3: Verify in Superset UI:** a `[e2e]` dataset, `[e2e]` chart(s), and `[e2e]` dashboard exist; the cloned dashboard shows the cloned chart AND the untouched original examples chart; the ORIGINAL dataset/charts/dashboard are unchanged.

- [ ] **Step 4: Verify the Experiments view** lists `e2e` with correct counts.

- [ ] **Step 5: Delete the experiment** from the view; confirm modal; verify all `[e2e]` objects are gone in Superset and originals remain.

- [ ] **Step 6: Commit any fixes found during verification.**

---

## Self-Review

**Spec coverage:**
- Virtual-only guard → Task 4 Step 2. ✓
- Bottom-up clone (dataset + charts + dashboards) → Task 4. ✓
- Faithful-replica mixed dashboards → Task 3 + Task 4 Step 2 (step 3 loop). ✓
- Manifest per connection in global state → Task 4 Step 1. ✓
- One-click teardown, reverse order, idempotent, originals safe → Task 5. ✓
- Entry points (lineage right-click, commands) + Experiments view → Task 6. ✓
- Rollback on mid-clone failure → Task 4 Step 2 catch → `teardownObjects`. ✓
- position_json-swap-failure → reduced-clone fallback: **NOT yet a task.** Deferred to post-spike; Task 1 confirms whether the swap is reliable. If the spike shows it's fragile, add a fallback task before Task 6. Flagged here rather than silently dropped.

**Placeholder scan:** No "TBD"/"add error handling" placeholders; concrete code in every code step. The reduced-clone fallback is explicitly deferred pending the spike, not hand-waved.

**Type consistency:** `swapChartRefs(string, Map<number,number>)` consistent across Tasks 3/4. `Experiment` shape consistent Tasks 4/5/6. API method names (`duplicate`, `create`, `copy`, `update`, `delete`, `get`) consistent Tasks 2/4/5. Dashboard `copy` returns `{id}` (unwrapped in Task 2) — confirm envelope against Task 1 spike notes.

**Known dependency:** Task 2's exact response unwrapping and Task 3/4's reliance on position_json `meta.chartId` are both confirmed by Task 1 (spike). Run Task 1 first.
