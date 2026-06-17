import * as assert from "assert";
import {
  SUPERSET_FUNCTIONS,
  JINJA_KEYWORDS,
  getContextAtPosition,
} from "../../../src/language/completionProvider";

suite("JinjaCompletionProvider", () => {
  test("SUPERSET_FUNCTIONS includes core context functions", () => {
    const names = SUPERSET_FUNCTIONS.map((f) => f.name);
    assert.ok(names.includes("current_username"));
    assert.ok(names.includes("filter_values"));
    assert.ok(names.includes("url_param"));
    assert.ok(names.includes("current_user_id"));
    assert.ok(names.includes("cache_key_wrapper"));
  });

  test("JINJA_KEYWORDS includes control flow keywords", () => {
    assert.ok(JINJA_KEYWORDS.includes("if"));
    assert.ok(JINJA_KEYWORDS.includes("for"));
    assert.ok(JINJA_KEYWORDS.includes("set"));
    assert.ok(JINJA_KEYWORDS.includes("macro"));
    assert.ok(JINJA_KEYWORDS.includes("endfor"));
  });

  test("getContextAtPosition detects expression context", () => {
    const line = "WHERE name = {{ current";
    const ctx = getContextAtPosition(line, line.length);
    assert.strictEqual(ctx, "expression");
  });

  test("getContextAtPosition detects statement context", () => {
    const line = "{% se";
    const ctx = getContextAtPosition(line, line.length);
    assert.strictEqual(ctx, "statement");
  });

  test("getContextAtPosition returns sql for plain SQL", () => {
    const line = "SELECT * FROM users WHERE";
    const ctx = getContextAtPosition(line, line.length);
    assert.strictEqual(ctx, "sql");
  });
});
