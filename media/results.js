(function () {
  const vscode = acquireVsCodeApi();
  let allData = [];
  let columns = [];
  let pageSize = 50;
  let currentPage = 0;
  let sortCol = null;
  let sortAsc = true;

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "showResults") {
      allData = msg.data;
      columns = msg.columns;
      pageSize = msg.pageSize || 50;
      currentPage = 0;
      sortCol = null;
      sortAsc = true;
      render();
    }
  });

  function render() {
    const container = document.getElementById("results");
    if (!container) return;

    const sorted = sortCol !== null ? sortData(allData, sortCol, sortAsc) : allData;
    const start = currentPage * pageSize;
    const pageData = sorted.slice(start, start + pageSize);
    const totalPages = Math.ceil(sorted.length / pageSize);

    let html = "<table><thead><tr>";
    for (const col of columns) {
      const indicator =
        sortCol === col ? (sortAsc ? " ▲" : " ▼") : "";
      html += `<th data-col="${col}">${col}<span class="sort-indicator">${indicator}</span></th>`;
    }
    html += "</tr></thead><tbody>";

    for (const row of pageData) {
      html += "<tr>";
      for (const col of columns) {
        const val = row[col];
        html += `<td title="${escapeHtml(String(val ?? ""))}">${escapeHtml(String(val ?? "NULL"))}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody></table>";

    html += `<div class="pagination">`;
    html += `<button id="prevBtn" ${currentPage === 0 ? "disabled" : ""}>← Prev</button>`;
    html += `<span>Page ${currentPage + 1} of ${totalPages}</span>`;
    html += `<button id="nextBtn" ${currentPage >= totalPages - 1 ? "disabled" : ""}>Next →</button>`;
    html += `</div>`;

    container.innerHTML = html;

    container.querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-col");
        if (sortCol === col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = col;
          sortAsc = true;
        }
        render();
      });
    });

    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    if (prevBtn) prevBtn.addEventListener("click", () => { currentPage--; render(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { currentPage++; render(); });
  }

  function sortData(data, col, asc) {
    return [...data].sort((a, b) => {
      const va = a[col], vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return asc ? va - vb : vb - va;
      return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  document.getElementById("copyBtn")?.addEventListener("click", () => {
    const sorted = sortCol !== null ? sortData(allData, sortCol, sortAsc) : allData;
    const start = currentPage * pageSize;
    const pageData = sorted.slice(start, start + pageSize);
    const header = columns.join("\t");
    const rows = pageData.map((r) => columns.map((c) => String(r[c] ?? "")).join("\t"));
    vscode.postMessage({ type: "copy", text: header + "\n" + rows.join("\n") });
  });

  document.getElementById("exportBtn")?.addEventListener("click", () => {
    vscode.postMessage({ type: "export" });
  });
})();
