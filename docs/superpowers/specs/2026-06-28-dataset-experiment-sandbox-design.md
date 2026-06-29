# Dataset Experiment Sandbox — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorm) — pending spec review
**Component:** vscode-superset extension

## Problem

When experimenting on a Superset dataset, you don't want to mutate the original
(other charts/dashboards depend on it). Today the only option is to manually
duplicate the dataset, hand-rebuild each chart against the copy, and reassemble
a dashboard — then manually hunt down every object to clean up afterward. Error
prone and slow.

## Goal

One simple operation clones a dataset's whole downstream lineage into an
isolated **experiment** sandbox, and one click tears the entire sandbox down —
without ever touching the originals.

## Scope

**In scope**
- Clone a **virtual (SQL) dataset** and its downstream lineage, bottom-up:
  the dataset + all its charts + every dashboard containing those charts.
- Mixed dashboards are cloned as **faithful replicas**: charts based on the
  experiment dataset become cloned copies (repointed to the cloned dataset);
  all other charts keep referencing the existing originals.
- A manifest tracking every created object, and one-click teardown.

**Out of scope (YAGNI / later)**
- Physical-table datasets (Superset's duplicate endpoint is virtual-only).
- Editing the dataset's underlying data/rows (a DB/ETL concern).
- Cross-machine teardown (manifest is local; see Alternatives → tags).
- Diffing experiment vs original, or promoting an experiment back to the original.

## Confirmed API capabilities

Verified against Superset (local examples instance) earlier this session:

- `POST /api/v1/dataset/duplicate` — copies a **virtual** dataset
  (`{base_model_id, table_name}`).
- `GET /api/v1/chart/<id>` → `POST /api/v1/chart/` — read a chart, recreate it
  with `datasource_id` repointed to the cloned dataset.
- `POST /api/v1/dashboard/<id>/copy/` with `duplicate_slices: false` — copies a
  dashboard layout that references the **original** charts.
- `PUT /api/v1/dashboard/<id>` — update `position_json` to swap specific chart
  references (used to substitute cloned charts for the experiment dataset's
  charts only).
- `DELETE` on dataset / chart / dashboard — teardown.

## Workflow

```
Pick dataset D  (lineage graph node → right-click → "Clone as Experiment: <label>")
   │
1. POST /dataset/duplicate                  → D'   ("[<label>] <D name>")
2. for each chart C on D:
     GET C → POST new chart, datasource_id = D'  → record map  C → C'
3. for each dashboard Dash containing any such C:
     POST /dashboard/<Dash>/copy/ (duplicate_slices=false)   → Dash'
     PUT  /dashboard/<Dash'>  with position_json where each C → C'
                                  (other charts untouched)   → Dash'
   │
manifest[<label>] = { datasets:[D'], charts:[C'…], dashboards:[Dash'…], createdAt }
   │
"Experiments" view → Delete → remove Dash' → C' → D'  (reverse order, confirm)
```

## Components

### `ExperimentManager` (`src/experiments/experimentManager.ts`)
Orchestrates the clone sequence and owns the manifest. One public method per
verb: `clone(datasetId, label)`, `list()`, `delete(label)`. Pure orchestration;
all HTTP goes through the API layer.

### API additions
- `DatasetsApi.duplicate(baseId, newName)`
- `ChartsApi.create(payload)` and a fuller `ChartsApi.get(id)` returning
  `params` / `query_context` / `datasource_id`.
- `DashboardsApi.copy(id, opts)`, `DashboardsApi.get(id)`,
  `DashboardsApi.update(id, { position_json })`, plus a way to list dashboards
  that contain a given chart (from `chart.dashboards`, already available).

### Manifest (extension global state, key `superset.experiments`)
```ts
interface Experiment {
  label: string;
  connection: string;          // which Superset connection it belongs to
  createdAt: string;           // ISO
  datasets: number[];
  charts: number[];
  dashboards: number[];
  notes?: string;              // e.g. "dashboard X cloned reduced (mixed-clone fallback)"
}
```
Stored per connection name so experiments from different servers don't collide.

### `ExperimentsTreeView` (`src/views/experimentsTreeView.ts`)
New view in the Superset activity bar. Each experiment node shows its label +
object counts; expandable to the cloned objects (clicking opens them in the
browser, reusing `openSupersetUrl`). View-title/right-click action:
**Delete Experiment**.

### Entry points
- Lineage graph: right-click a **dataset** node → **Clone as Experiment**
  (prompts for a label).
- Command palette: **Superset: Clone Dataset as Experiment**,
  **Superset: Delete Experiment**.

## Teardown

- Deletes **only** IDs present in the manifest, in reverse dependency order:
  dashboards → charts → datasets.
- Confirmation dialog states exactly what will be removed
  (e.g. "Delete experiment 'exp1': 2 dashboards, 7 charts, 1 dataset?").
- Originals are never written to the manifest, so they are unreachable by delete.
- Per-object delete failures are collected and reported; the manifest entry is
  pruned of successfully deleted IDs so a retry resumes cleanly (idempotent).

## Error handling

- Any failure mid-clone: stop, then offer to roll back what was created so far
  (same teardown path over the partial manifest). No orphan sandboxes.
- `position_json` swap failure on a mixed dashboard → fall back to a **reduced
  clone** (experiment charts only), record a `notes` flag, and continue rather
  than abort the whole experiment.
- Clone is blocked with a clear message if the dataset is **physical**
  (`kind !== "virtual"`), since duplicate is virtual-only.

## Primary risk / spike

Step 3's `position_json` chart-swap is the one non-mechanical part. **De-risk
first** with a spike: copy one mixed dashboard, read its `position_json`, locate
the `meta.chartId` references, swap only the experiment charts, `PUT` it back,
and confirm in the UI that cloned charts render and originals are untouched. If
the layout format fights us, the reduced-clone fallback ships instead.

## Alternatives considered

- **Superset tags as source of truth** — tag every clone `experiment:<label>`,
  delete-by-tag. Enables cross-machine teardown and UI visibility, but requires
  the `TAGGING_SYSTEM` feature flag. Deferred; manifest is simpler and
  flag-free. Can be added later as a sync layer over the manifest.
- **Native `duplicate_slices: true`** — one call copies dashboard + all charts,
  but duplicates unrelated charts too, violating the faithful-replica rule.

## Testing

- Unit: `position_json` swap (given a layout + a C→C' map, only target chart IDs
  change); manifest reverse-order teardown; physical-dataset guard.
- Manual: clone a real virtual dataset with ≥2 charts across a mixed dashboard;
  verify cloned dashboard renders, originals unchanged; delete; verify all
  clones gone and originals intact.
