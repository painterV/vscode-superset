(function () {
  const vscode = acquireVsCodeApi();
  const model = JSON.parse(document.getElementById("model").textContent);

  const G = {
    fwd: new Map(), // key -> Set(downstream keys)
    back: new Map(), // key -> Set(upstream keys)
    nodeEls: new Map(), // key -> <g>
    edgeEls: [], // [{el, a, b}]
    selected: null,
  };

  render(model);
  setupFilter(model);

  function trunc(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function mapAdd(map, k, v) {
    let s = map.get(k);
    if (!s) { s = new Set(); map.set(k, s); }
    s.add(v);
  }

  function render(model) {
    const COLW = 190, GAP = 140, ROW = 30, PADX = 20, PADY = 16, BOXH = 22;
    const order = [
      { key: "db", items: model.databases },
      { key: "schema", items: model.schemas },
      { key: "dataset", items: model.datasets },
      { key: "chart", items: model.charts },
      { key: "dash", items: model.dashboards },
    ];
    const cols = order.map((c, i) => ({ ...c, x: PADX + i * (COLW + GAP) }));

    const pos = {};
    let maxRows = 0;
    for (const col of cols) {
      maxRows = Math.max(maxRows, col.items.length);
      col.items.forEach((it, i) => {
        pos[col.key + ":" + it.id] = { x: col.x, y: PADY + i * ROW, w: COLW, h: BOXH };
      });
    }
    const width = PADX * 2 + cols.length * COLW + (cols.length - 1) * GAP;
    const height = PADY * 2 + maxRows * ROW;

    const edges = [];
    for (const e of model.dbSchemaEdges) edges.push(["db:" + e.from, "schema:" + e.to]);
    for (const e of model.schemaDatasetEdges) edges.push(["schema:" + e.from, "dataset:" + e.to]);
    for (const e of model.datasetChartEdges) edges.push(["dataset:" + e.from, "chart:" + e.to]);
    for (const e of model.chartDashEdges) edges.push(["chart:" + e.from, "dash:" + e.to]);
    for (const [a, b] of edges) { mapAdd(G.fwd, a, b); mapAdd(G.back, b, a); }

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g id="edges">`;
    for (const [a, b] of edges) {
      const pa = pos[a], pb = pos[b];
      if (!pa || !pb) continue;
      const x1 = pa.x + pa.w, y1 = pa.y + pa.h / 2, x2 = pb.x, y2 = pb.y + pb.h / 2;
      const mx = (x1 + x2) / 2;
      svg += `<path class="edge" data-a="${a}" data-b="${b}" fill="none" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    }
    svg += `</g><g id="nodes">`;
    for (const col of cols) {
      for (const it of col.items) {
        const p = pos[col.key + ":" + it.id];
        svg += `<g class="node ${col.key}" data-key="${col.key}:${it.id}" data-kind="${col.key}" data-id="${it.id}">`;
        svg += `<title>${escapeHtml(it.name)}</title>`;
        svg += `<rect x="${p.x}" y="${p.y}" rx="4" width="${p.w}" height="${p.h}"/>`;
        svg += `<text x="${p.x + 8}" y="${p.y + p.h / 2 + 4}">${escapeHtml(trunc(it.name, 26))}</text>`;
        svg += `</g>`;
      }
    }
    svg += `</g></svg>`;

    const root = document.getElementById("graph");
    root.innerHTML = svg;

    root.querySelectorAll(".edge").forEach((el) =>
      G.edgeEls.push({ el, a: el.dataset.a, b: el.dataset.b }),
    );

    let clickTimer = null;
    root.querySelectorAll(".node").forEach((n) => {
      const key = n.dataset.key;
      G.nodeEls.set(key, n);
      n.addEventListener("mouseenter", () => { if (!G.selected) applyHighlight(neighbors(key)); });
      n.addEventListener("mouseleave", () => { if (!G.selected) clearAll(); });
      // Single click = trace lineage; double click = open in browser.
      n.addEventListener("click", (e) => {
        e.stopPropagation();
        if (clickTimer) return;
        clickTimer = setTimeout(() => { clickTimer = null; toggleSelect(key); }, 200);
      });
      n.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        clearTimeout(clickTimer); clickTimer = null;
        const kind = n.dataset.kind;
        if (kind === "chart" || kind === "dash") {
          vscode.postMessage({ type: "open", kind, id: Number(n.dataset.id) });
        }
      });
    });
    // Click empty space clears the selection.
    root.addEventListener("click", () => clearSelection());
  }

  /** Direct neighbors (one hop up + down) — used for hover preview. */
  function neighbors(key) {
    const s = new Set([key]);
    for (const u of G.back.get(key) ?? []) s.add(u);
    for (const d of G.fwd.get(key) ?? []) s.add(d);
    return s;
  }

  /** Full transitive lineage: all upstream ancestors + downstream descendants. */
  function lineageSet(start) {
    const set = new Set([start]);
    const walk = (map, n) => {
      for (const next of map.get(n) ?? []) {
        if (!set.has(next)) { set.add(next); walk(map, next); }
      }
    };
    walk(G.back, start);
    walk(G.fwd, start);
    return set;
  }

  function applyHighlight(set) {
    const root = document.getElementById("graph");
    root.classList.add("dim");
    G.nodeEls.forEach((el, key) => el.classList.toggle("hot", set.has(key)));
    for (const { el, a, b } of G.edgeEls) el.classList.toggle("hot", set.has(a) && set.has(b));
  }

  function clearAll() {
    const root = document.getElementById("graph");
    root.classList.remove("dim");
    G.nodeEls.forEach((el) => el.classList.remove("hot"));
    for (const { el } of G.edgeEls) el.classList.remove("hot");
  }

  function selectNode(key) {
    G.selected = key;
    applyHighlight(lineageSet(key));
    G.nodeEls.get(key)?.scrollIntoView?.({ block: "center", inline: "center" });
  }
  function toggleSelect(key) {
    if (G.selected === key) clearSelection();
    else selectNode(key);
  }
  function clearSelection() {
    if (!G.selected) return;
    G.selected = null;
    clearAll();
  }

  function setupFilter(model) {
    const ftype = document.getElementById("ftype");
    const fobj = document.getElementById("fobj");
    const fclear = document.getElementById("fclear");
    const byType = {
      db: model.databases, schema: model.schemas, dataset: model.datasets,
      chart: model.charts, dash: model.dashboards,
    };
    ftype.addEventListener("change", () => {
      const t = ftype.value;
      fobj.innerHTML = '<option value="">— pick object —</option>';
      if (t && byType[t]) {
        [...byType[t]].sort((a, b) => a.name.localeCompare(b.name)).forEach((it) => {
          const o = document.createElement("option");
          o.value = t + ":" + it.id;
          o.textContent = it.name;
          fobj.appendChild(o);
        });
      }
    });
    fobj.addEventListener("change", () => { if (fobj.value) selectNode(fobj.value); });
    fclear.addEventListener("click", () => {
      ftype.value = ""; fobj.innerHTML = '<option value="">—</option>'; clearSelection();
    });
  }
})();
