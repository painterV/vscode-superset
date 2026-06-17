import * as assert from "assert";
import { findDiagnostics, DiagnosticInfo } from "../../../src/language/diagnosticProvider";

suite("JinjaDiagnosticProvider", () => {
  test("detects unmatched opening expression delimiter", () => {
    const text = "SELECT {{ name FROM users";
    const diags = findDiagnostics(text);
    assert.ok(diags.some((d) => d.message.includes("Unmatched")));
  });

  test("detects unmatched closing expression delimiter", () => {
    const text = "SELECT name }} FROM users";
    const diags = findDiagnostics(text);
    assert.ok(diags.some((d) => d.message.includes("Unmatched")));
  });

  test("detects unclosed if block", () => {
    const text = "{% if x > 1 %}\nSELECT 1\n";
    const diags = findDiagnostics(text);
    assert.ok(diags.some((d) => d.message.includes("Unclosed")));
  });

  test("passes clean document with no diagnostics", () => {
    const text = "{% if x %}\nSELECT {{ name }}\n{% endif %}";
    const diags = findDiagnostics(text);
    assert.strictEqual(diags.length, 0);
  });

  test("detects unclosed for block", () => {
    const text = "{% for i in items %}\nSELECT {{ i }}";
    const diags = findDiagnostics(text);
    assert.ok(diags.some((d) => d.message.includes("Unclosed")));
  });
});
