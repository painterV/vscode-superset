import * as assert from "assert";
import { ExperimentManager } from "../../../src/experiments/experimentManager";

suite("ExperimentManager teardown", () => {
  test("deletes dashboards, then charts, then datasets, and drops the entry", async () => {
    const order: string[] = [];
    const apis: any = {
      dashboards: { delete: async (id: number) => order.push("dash:" + id) },
      charts: { delete: async (id: number) => order.push("chart:" + id) },
      datasets: { delete: async (id: number) => order.push("ds:" + id) },
    };
    let saved: any[] | null = null;
    const mem: any = {
      get: () => [
        { label: "x", connection: "c", createdAt: "", datasets: [1], charts: [2], dashboards: [3] },
      ],
      update: async (_k: string, v: any[]) => { saved = v; },
    };
    const mgr = new ExperimentManager(mem, apis, "c");
    const res = await mgr.delete("x");

    assert.deepStrictEqual(order, ["dash:3", "chart:2", "ds:1"]);
    assert.strictEqual(res.deleted, 3);
    assert.deepStrictEqual(res.failed, []);
    assert.deepStrictEqual(saved, []); // entry removed when fully torn down
  });

  test("keeps the entry (pruned) when a delete fails", async () => {
    const apis: any = {
      dashboards: { delete: async () => { throw new Error("boom"); } },
      charts: { delete: async () => {} },
      datasets: { delete: async () => {} },
    };
    let saved: any[] | null = null;
    const mem: any = {
      get: () => [
        { label: "x", connection: "c", createdAt: "", datasets: [1], charts: [2], dashboards: [3] },
      ],
      update: async (_k: string, v: any[]) => { saved = v; },
    };
    const mgr = new ExperimentManager(mem, apis, "c");
    const res = await mgr.delete("x");

    assert.strictEqual(res.deleted, 2); // chart + dataset gone, dashboard survived
    assert.strictEqual(res.failed.length, 1);
    assert.strictEqual(saved!.length, 1); // entry kept
    assert.deepStrictEqual(saved![0].dashboards, [3]); // surviving id retained
    assert.deepStrictEqual(saved![0].charts, []);
  });
});
