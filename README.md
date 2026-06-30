# Superset for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code ^1.95](https://img.shields.io/badge/VS%20Code-%5E1.95-blue.svg)](https://code.visualstudio.com/)

Work with [Apache Superset](https://superset.apache.org/) from inside VS Code: author Jinja-SQL, run queries, browse databases and saved queries, visualize object lineage, and spin up throwaway dataset experiments — without leaving your editor.

> **Status:** early (`0.0.1`). The SQL/data workflow is the focus; chart and dashboard *rendering* stays in Superset's own UI (the extension deep-links to it).

---

## Features

- **Connections** — configure multiple Superset servers; passwords are stored in VS Code [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage), never in settings.
- **Jinja-SQL editing** — dedicated language mode with syntax highlighting, completions, hover docs, and diagnostics for Superset's Jinja templating.
- **Query execution** — run the file or a selection (`Cmd+Enter`), estimate cost, and format SQL server-side.
- **Results** — sortable, paginated results panel with **Copy** and **Export CSV**, plus an aligned text preview in the *Superset* output channel.
- **Object browser** — tree views for Connections (database → schema → table), Saved Queries (open / create / update / delete), and Dashboards.
- **Dependency graph** — an interactive lineage view: **Database → Schema → Dataset → Chart → Dashboard**. Click any node to trace its full upstream + downstream; filter by type and object; click through to the browser.
- **Deep links** — open charts and dashboards in your browser, or inside VS Code's Simple Browser (`superset.viewIn`).
- **Experiment sandbox** — clone a virtual (SQL) dataset's whole downstream lineage (dataset + charts + dashboards) into an isolated experiment, then tear it all down in one click. Originals are never modified.

## Requirements

- VS Code `^1.95`
- A reachable Apache Superset instance (local or remote) and an account on it

Don't have one yet? The quickest local setup is Docker:

```bash
docker run -d -p 8088:8088 --name superset apache/superset
docker exec -it superset superset fab create-admin \
  --username admin --firstname admin --lastname admin --email admin@local --password admin
docker exec -it superset superset db upgrade
docker exec -it superset superset init
docker exec -it superset superset load_examples   # optional sample data
```

Superset is then at <http://localhost:8088> (admin / admin).

## Install

Not yet published to the Marketplace — build from source:

```bash
git clone https://github.com/painterV/vscode-superset.git
cd vscode-superset
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host with the extension loaded. To produce an installable `.vsix`:

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension vscode-superset-0.0.1.vsix
```

## Getting started

1. **Add a connection** — open Settings (JSON) and add:

   ```jsonc
   "superset.connections": [
     { "name": "Local", "url": "http://localhost:8088", "username": "admin" }
   ]
   ```

2. **Connect** — `Cmd+Shift+P` → **Superset: Connect**, pick the connection, enter your password (optionally remembered in SecretStorage).
3. **Run a query** — open a `.jinjasql` file (or switch a file's language to *Jinja SQL*), click a database in the **Connections** view to activate it, then `Cmd+Enter`.
4. **Explore** — open **Superset: Dependency Graph** from the Dashboards view to see lineage; use the **Experiments** view to clone a dataset for safe experimentation.

## Commands

| Command | Description |
| --- | --- |
| `Superset: Connect` / `Disconnect` / `Switch Connection` | Manage the active connection |
| `Superset: Run Query` | Execute the file or selection (`Cmd+Enter`) |
| `Superset: Estimate Query Cost` | Estimate cost (`Cmd+Shift+E`) |
| `Superset: Format SQL` | Server-side SQL formatting (`Cmd+Shift+F`) |
| `Superset: Save as Saved Query` | Persist the current query to Superset |
| `Superset: Dependency Graph` | Open the lineage graph |
| `Superset: Clone Dataset as Experiment` | Clone a virtual dataset's lineage into a sandbox |
| `Superset: Refresh` | Refresh the tree views |

Charts/dashboards offer **Open in Browser** actions; experiments offer **Delete Experiment**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `superset.connections` | `[]` | List of `{ name, url, username }` connection configs |
| `superset.defaultDatabase` | `""` | Default database name for query execution |
| `superset.resultPageSize` | `50` | Rows per page in the results panel |
| `superset.maxResultTabs` | `5` | Max result tabs kept in memory |
| `superset.schemaCacheTtlSeconds` | `300` | Cache TTL for schema/table lists |
| `superset.queryTimeoutSeconds` | `30` | Show a progress notification after this many seconds |
| `superset.viewIn` | `"browser"` | Open charts/dashboards in your `browser` or VS Code's `editor` (Simple Browser) |

> `editor` mode requires `TALISMAN_ENABLED = False` in your `superset_config.py` (Superset blocks framing by default) and a login inside the embedded view.

## Development

```bash
npm run watch      # rebuild on save (esbuild + tsc)
npm run lint       # eslint
npm test           # unit tests (downloads a throwaway VS Code via @vscode/test-electron)
```

Source layout:

```
src/
  api/            SupersetClient + typed endpoint wrappers (auth, sqllab, charts, …)
  language/       Jinja-SQL completion / hover / diagnostics providers
  views/          tree views + webview panels (results, lineage, experiments)
  experiments/    dataset experiment clone + teardown
media/            webview assets (CSS/JS for results & lineage)
test/unit/        mocha unit tests
docs/superpowers/ design specs and implementation plans
```

## How it works (briefly)

The extension talks to Superset's REST API (`/api/v1/...`) over `fetch`. Auth uses the JWT login endpoint plus the CSRF token and its session cookie. Chart and dashboard *visuals* are intentionally not re-rendered in VS Code — a Superset chart is a live, server-rendered visualization, so the extension deep-links to Superset's UI for those and keeps its focus on the SQL/data side, where an editor is genuinely better.

## Contributing

Issues and PRs are welcome. Please run `npm run lint` and `npm test` before opening a PR, and keep changes focused.

## License

[MIT](LICENSE) © Wenbao Li
