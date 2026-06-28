# Spike Results — Dataset Experiment Sandbox

**Date:** 2026-06-28 · against local Superset (examples, admin/admin)

All spike objects were created and deleted cleanly (no orphans left).

## Confirmed API shapes

- **`POST /api/v1/dataset/` (create virtual)** — body `{database, schema, table_name, sql}` → `201 { id }`.
- **`POST /api/v1/dataset/duplicate`** — body `{base_model_id, table_name}` → `201 { id, result:{...} }`. Use **`id` (top-level)**.
- **`POST /api/v1/dashboard/<id>/copy/`** — body `{dashboard_title, duplicate_slices:false, css, json_metadata}` → `200 { result:{ id, last_modified_time } }`. Use **`result.id`**.
  - ⚠️ The copy **drops `position_json`** (0 CHART components) but keeps the `charts` relationship. Therefore swap must use the **source** dashboard's `position_json`, then PUT it onto the copy.
- **`PUT /api/v1/dashboard/<id>`** — body `{position_json}` → `200`.
  - Verified: PUT'ing a `position_json` that references a chart **not originally on the dashboard** (i.e. a clone) succeeds; Superset adds it to the layout AND **auto-updates the dashboard's `charts` relationship** to match. No separate slices/charts update call is needed.

## position_json shape

Flat map of `componentId -> component`. Chart components:
```json
{ "type": "CHART", "meta": { "chartId": 83, "sliceName": "...", "uuid": "...", "width": 8, "height": 50 }, "children": [] }
```
Swap = for each value with `type === "CHART"` and `meta.chartId` in the id-map, set `meta.chartId` to the mapped clone id. Everything else preserved.

## Chart recreate fields (`GET /api/v1/chart/<id>` → `result`)

`slice_name`, `viz_type`, `datasource_id`, `datasource_type` (`"table"`), `params` (JSON string), `query_context` (JSON string or null). `POST /api/v1/chart/` accepts these directly.

## Conclusion

Plan approach validated unchanged. Implementation notes:
- `DatasetsApi.duplicate` → return `resp` and read `.id`.
- `DashboardsApi.copy` → return `resp.result` (has `.id`).
- `swapChartRefs` operates on the **source** dashboard's `position_json`.
- No extra charts-association call needed after PUT.
