import * as vscode from "vscode";

/** Plain-object diagnostic result returned by `findDiagnostics`. */
export interface DiagnosticInfo {
  message: string;
  line: number;
  startChar: number;
  endChar: number;
  severity: "error" | "warning";
}

/**
 * Scans Jinja-SQL text for structural issues and returns plain diagnostic objects.
 *
 * Detections:
 * - Unmatched `{{` without a closing `}}`
 * - Unmatched `}}` without a preceding `{{`
 * - Unclosed block tags (`if`, `for`, `macro`, etc.) without matching `end*`
 * - Mismatched block close tags
 *
 * @param text - The full document text to analyse.
 * @returns An array of `DiagnosticInfo` objects (empty if the document is clean).
 */
export function findDiagnostics(text: string): DiagnosticInfo[] {
  const diags: DiagnosticInfo[] = [];
  const lines = text.split("\n");

  /** Block keywords that require a matching `end<keyword>` tag. */
  const BLOCK_OPENERS = new Set(["if", "for", "macro", "call", "block", "filter", "raw"]);

  const blockStack: { keyword: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Expression delimiter balance check ---
    const exprOpens = (line.match(/\{\{/g) ?? []).length;
    const exprCloses = (line.match(/\}\}/g) ?? []).length;

    if (exprOpens > exprCloses) {
      // More `{{` than `}}` on this line — check if the rest of the document closes it
      const remainingText = lines.slice(i + 1).join("\n");
      const remainingCloses = (remainingText.match(/\}\}/g) ?? []).length;
      const remainingOpens = (remainingText.match(/\{\{/g) ?? []).length;
      const netUnclosed = (exprOpens - exprCloses) - Math.max(0, remainingCloses - remainingOpens);
      if (netUnclosed > 0) {
        const col = line.indexOf("{{");
        diags.push({
          message: "Unmatched '{{' — missing closing '}}'",
          line: i,
          startChar: col,
          endChar: col + 2,
          severity: "error",
        });
      }
    } else if (exprCloses > exprOpens) {
      // More `}}` than `{{` on this line — check cumulative totals up to this point
      const preceding = lines.slice(0, i + 1).join("\n");
      const totalOpens = (preceding.match(/\{\{/g) ?? []).length;
      const totalCloses = (preceding.match(/\}\}/g) ?? []).length;
      if (totalCloses > totalOpens) {
        const col = line.indexOf("}}");
        diags.push({
          message: "Unmatched '}}' — missing opening '{{'",
          line: i,
          startChar: col,
          endChar: col + 2,
          severity: "error",
        });
      }
    }

    // --- Block tag stack check ---
    // Match `{%` optionally followed by `-` or `~`, then whitespace, then the keyword
    const stmtMatches = [...line.matchAll(/\{%[-~]?\s*(\w+)/g)];
    for (const match of stmtMatches) {
      const keyword = match[1];
      if (BLOCK_OPENERS.has(keyword)) {
        blockStack.push({ keyword, line: i });
      } else if (keyword.startsWith("end")) {
        const expected = keyword.substring(3); // e.g. "endif" → "if"
        const last = blockStack.pop();
        if (last && last.keyword !== expected) {
          diags.push({
            message: `Mismatched block: expected 'end${last.keyword}' but found '${keyword}'`,
            line: i,
            startChar: match.index ?? 0,
            endChar: (match.index ?? 0) + match[0].length,
            severity: "error",
          });
        }
      }
    }
  }

  // Any remaining unclosed blocks
  for (const unclosed of blockStack) {
    diags.push({
      message: `Unclosed '{%- ${unclosed.keyword} %}' block — missing '{%- end${unclosed.keyword} %}'`,
      line: unclosed.line,
      startChar: 0,
      endChar: lines[unclosed.line].length,
      severity: "error",
    });
  }

  return diags;
}

/** Manages a VS Code diagnostic collection for Jinja-SQL documents. */
export class JinjaDiagnosticManager {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("jinja-sql");
  }

  /**
   * Recomputes and publishes diagnostics for the given document.
   * No-ops if the document language is not `jinja-sql`.
   */
  update(document: vscode.TextDocument): void {
    if (document.languageId !== "jinja-sql") {
      return;
    }
    const infos = findDiagnostics(document.getText());
    const diagnostics = infos.map((info) => {
      const range = new vscode.Range(info.line, info.startChar, info.line, info.endChar);
      const severity =
        info.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;
      return new vscode.Diagnostic(range, info.message, severity);
    });
    this.collection.set(document.uri, diagnostics);
  }

  /** Disposes the underlying diagnostic collection. */
  dispose(): void {
    this.collection.dispose();
  }
}
