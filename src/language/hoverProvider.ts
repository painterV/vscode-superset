import * as vscode from "vscode";
import { SUPERSET_FUNCTIONS, getContextAtPosition } from "./completionProvider";

/** VS Code hover provider for Superset Jinja functions in Jinja-SQL documents. */
export class JinjaHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const lineText = document.lineAt(position).text;
    const context = getContextAtPosition(lineText, position.character);

    // Only provide hover information inside Jinja delimiters
    if (context !== "expression" && context !== "statement") {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const fn = SUPERSET_FUNCTIONS.find((f) => f.name === word);
    if (!fn) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    md.appendCodeblock(fn.signature, "typescript");
    md.appendMarkdown(`\n\n${fn.doc}`);
    return new vscode.Hover(md, wordRange);
  }
}
