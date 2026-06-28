/**
 * Rewrite a dashboard position_json, replacing CHART components whose
 * meta.chartId is in idMap with the mapped clone id. Other components are
 * preserved. Pure — no I/O.
 */
export function swapChartRefs(positionJson: string, idMap: Map<number, number>): string {
  const layout = JSON.parse(positionJson || "{}");
  for (const node of Object.values(layout) as Array<{ type?: string; meta?: { chartId?: number } }>) {
    if (node && node.type === "CHART" && node.meta && idMap.has(node.meta.chartId as number)) {
      node.meta = { ...node.meta, chartId: idMap.get(node.meta.chartId as number) };
    }
  }
  return JSON.stringify(layout);
}
