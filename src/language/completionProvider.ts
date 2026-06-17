import * as vscode from "vscode";

/** Describes a Superset Jinja function available in SQL templates. */
export interface SupersetFunction {
  name: string;
  signature: string;
  doc: string;
}

/** Core Superset Jinja context functions exposed for completion and hover. */
export const SUPERSET_FUNCTIONS: SupersetFunction[] = [
  {
    name: "current_username",
    signature: "current_username()",
    doc: "Returns the username of the currently logged-in user.",
  },
  {
    name: "current_user_id",
    signature: "current_user_id()",
    doc: "Returns the user ID of the currently logged-in user.",
  },
  {
    name: "url_param",
    signature: "url_param(param, default=None)",
    doc: "Returns the value of a URL parameter. Use `default` to specify a fallback.",
  },
  {
    name: "filter_values",
    signature: "filter_values(column, default=None)",
    doc: "Returns the values for the given column from the dashboard's filter components. Returns `default` if no filter is active.",
  },
  {
    name: "cache_key_wrapper",
    signature: "cache_key_wrapper(value)",
    doc: "Wraps a value so it is included in the query cache key, ensuring cache invalidation when the value changes.",
  },
  {
    name: "timeseries_limit_metric",
    signature: "timeseries_limit_metric",
    doc: "The metric used to limit time series results in Superset chart queries.",
  },
  {
    name: "columns",
    signature: "columns",
    doc: "List of column objects available in the current dataset context.",
  },
];

/** Jinja2 control flow and template keywords. */
export const JINJA_KEYWORDS: string[] = [
  "if", "elif", "else", "endif",
  "for", "endfor",
  "set",
  "macro", "endmacro",
  "call", "endcall",
  "block", "endblock",
  "filter", "endfilter",
  "include", "import", "from", "extends",
  "raw", "endraw",
  "do",
];

/** The context type at a given cursor position within a line of Jinja-SQL. */
export type JinjaContext = "expression" | "statement" | "sql";

/**
 * Determines the Jinja context at a given character position within a line.
 *
 * @param lineText - The full text of the current line.
 * @param charIndex - The character index (cursor position) within the line.
 * @returns "expression" if inside `{{ }}`, "statement" if inside `{% %}`, else "sql".
 */
export function getContextAtPosition(lineText: string, charIndex: number): JinjaContext {
  const before = lineText.substring(0, charIndex);
  const lastExprOpen = before.lastIndexOf("{{");
  const lastExprClose = before.lastIndexOf("}}");
  if (lastExprOpen > lastExprClose) {
    return "expression";
  }
  const lastStmtOpen = before.lastIndexOf("{%");
  const lastStmtClose = before.lastIndexOf("%}");
  if (lastStmtOpen > lastStmtClose) {
    return "statement";
  }
  return "sql";
}

/** VS Code completion provider for Jinja-SQL documents. */
export class JinjaCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position).text;
    const context = getContextAtPosition(lineText, position.character);

    if (context === "expression") {
      return SUPERSET_FUNCTIONS.map((fn) => {
        const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
        item.detail = fn.signature;
        item.documentation = new vscode.MarkdownString(fn.doc);
        if (fn.signature.endsWith("()")) {
          item.insertText = new vscode.SnippetString(`${fn.name}()`);
        } else if (fn.signature.includes("(")) {
          item.insertText = new vscode.SnippetString(`${fn.name}($1)`);
        }
        return item;
      });
    }

    if (context === "statement") {
      return JINJA_KEYWORDS.map((kw) => {
        const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
        item.detail = `Jinja ${kw} statement`;
        return item;
      });
    }

    return [];
  }
}
