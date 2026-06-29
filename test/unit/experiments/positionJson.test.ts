import * as assert from "assert";
import { swapChartRefs } from "../../../src/experiments/positionJson";

suite("swapChartRefs", () => {
  test("swaps only mapped chart ids, leaves others untouched", () => {
    const pj = JSON.stringify({
      "CHART-a": { type: "CHART", meta: { chartId: 96, sliceName: "A" } },
      "CHART-b": { type: "CHART", meta: { chartId: 50, sliceName: "B" } },
      GRID: { type: "GRID", meta: {} },
    });
    const out = JSON.parse(swapChartRefs(pj, new Map([[96, 200]])));
    assert.strictEqual(out["CHART-a"].meta.chartId, 200); // swapped
    assert.strictEqual(out["CHART-a"].meta.sliceName, "A"); // other meta preserved
    assert.strictEqual(out["CHART-b"].meta.chartId, 50); // untouched
    assert.strictEqual(out["GRID"].type, "GRID");
  });

  test("empty/blank position_json yields empty object", () => {
    assert.strictEqual(swapChartRefs("", new Map()), "{}");
  });
});
