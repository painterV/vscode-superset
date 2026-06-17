import * as assert from "assert";
import { encodeRison } from "../../../src/utils/rison";

suite("encodeRison", () => {
  test("encodes empty object", () => {
    assert.strictEqual(encodeRison({}), "()");
  });

  test("encodes simple key-value pairs", () => {
    assert.strictEqual(encodeRison({ page: 0, page_size: 25 }), "(page:0,page_size:25)");
  });

  test("encodes string values with single quotes", () => {
    assert.strictEqual(encodeRison({ name: "hello" }), "(name:'hello')");
  });

  test("encodes boolean values", () => {
    assert.strictEqual(encodeRison({ active: true, deleted: false }), "(active:!t,deleted:!f)");
  });

  test("encodes arrays with !() syntax", () => {
    assert.strictEqual(encodeRison({ filters: [] }), "(filters:!())");
  });

  test("encodes nested objects", () => {
    const input = { filters: [{ col: "id", opr: "gt", value: 5 }] };
    assert.strictEqual(
      encodeRison(input),
      "(filters:!((col:'id',opr:'gt',value:5)))"
    );
  });

  test("encodes null as !n", () => {
    assert.strictEqual(encodeRison({ x: null }), "(x:!n)");
  });
});
