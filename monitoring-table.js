import { formatUserFacingMessage } from "./ui-messages.js";

const DEFAULT_COLUMN_WIDTH = 180;

export { formatUserFacingMessage };

export function setStatus(statusEl, message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

export function setOperationStatus(statusEl, message, isError = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "tool-operation-status error" : "tool-operation-status";
}

export function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function normalizeColumnId(value = "", index = 0, usedIds = new Set()) {
  const base = String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || `column_${index + 1}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

export function inferColumnType(label = "") {
  if (/date|time/i.test(label)) {
    return "date";
  }
  if (/count|limit|max|remaining|used|total|size|length|version/i.test(label)) {
    return "number";
  }
  return "text";
}

export function getColumnsFromRows(rows = []) {
  const usedIds = new Set();
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return headers.map((header, index) => ({
    id: normalizeColumnId(header, index, usedIds),
    label: header,
    type: inferColumnType(header),
    width: index === 0 ? 220 : DEFAULT_COLUMN_WIDTH
  }));
}

export function parseCsv(text = "") {
  const parsedRows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (inQuotes) {
      if (char === "\"" && nextChar === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      parsedRows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    parsedRows.push(row);
  }

  const usedIds = new Set();
  const columns = (parsedRows.shift() || []).map((header, index) => {
    const label = String(header || "").replace(/^\uFEFF/, "") || `Column ${index + 1}`;
    return {
      id: normalizeColumnId(label, index, usedIds),
      label,
      type: inferColumnType(label),
      width: index === 0 ? 220 : DEFAULT_COLUMN_WIDTH
    };
  });

  const rows = parsedRows
    .filter((cells) => cells.some((cell) => String(cell || "").trim()))
    .map((cells) => Object.fromEntries(columns.map((column, index) => [column.id, cells[index] || ""])));

  return { columns, rows };
}

export function createAuditTable({
  resultsEl,
  columns = [],
  defaultSort = {},
  emptyMessage = "No rows returned."
}) {
  let currentRows = [];
  let currentColumns = columns;
  let sortedRows = [];
  let sortState = {
    columnId: defaultSort.columnId || columns[0]?.id || "",
    direction: defaultSort.direction || "asc"
  };

  function getColumns() {
    return currentColumns.length ? currentColumns : getColumnsFromRows(currentRows);
  }

  function getColumnDisplayValue(row, column) {
    const value = row[column.id];
    if (column.type === "date") {
      return formatDate(value);
    }
    return value === undefined || value === null ? "" : String(value);
  }

  function getColumnSortValue(row, column) {
    if (typeof column.sortValue === "function") {
      return column.sortValue(row, column);
    }
    const value = row[column.id];
    if (column.type === "date") {
      const timestamp = Date.parse(value || "");
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    if (column.type === "number") {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
    return getColumnDisplayValue(row, column).toLocaleLowerCase();
  }

  function appendColumnValue(td, row, column) {
    if (typeof column.render === "function") {
      const rendered = column.render(row, column);
      if (rendered instanceof Node) {
        td.appendChild(rendered);
      } else {
        td.textContent = rendered === undefined || rendered === null ? "" : String(rendered);
      }
      return;
    }

    td.textContent = getColumnDisplayValue(row, column);
  }

  function compareRows(left, right, column) {
    const leftValue = getColumnSortValue(left, column);
    const rightValue = getColumnSortValue(right, column);
    const result = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    return sortState.direction === "asc" ? result : -result;
  }

  function renderMessage(message) {
    resultsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "audit-empty";
    empty.textContent = formatUserFacingMessage(message);
    resultsEl.appendChild(empty);
  }

  function render() {
    resultsEl.innerHTML = "";
    const tableColumns = getColumns();

    if (!currentRows.length || !tableColumns.length) {
      renderMessage(emptyMessage);
      sortedRows = [];
      return;
    }

    if (!sortState.columnId || !tableColumns.some((column) => column.id === sortState.columnId)) {
      sortState = {
        columnId: tableColumns[0].id,
        direction: defaultSort.direction || "asc"
      };
    }

    const sortColumn = tableColumns.find((column) => column.id === sortState.columnId) || tableColumns[0];
    sortedRows = [...currentRows].sort((left, right) => compareRows(left, right, sortColumn));

    const table = document.createElement("table");
    table.className = "audit-table";
    table.style.width = `${tableColumns.reduce((total, column) => total + (column.width || DEFAULT_COLUMN_WIDTH), 0)}px`;

    const colgroup = document.createElement("colgroup");
    tableColumns.forEach((column) => {
      const col = document.createElement("col");
      col.dataset.columnId = column.id;
      col.style.width = `${column.width || DEFAULT_COLUMN_WIDTH}px`;
      colgroup.appendChild(col);
    });

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    tableColumns.forEach((column) => {
      const th = document.createElement("th");
      th.dataset.columnId = column.id;
      th.style.width = `${column.width || DEFAULT_COLUMN_WIDTH}px`;

      const cell = document.createElement("div");
      cell.className = "audit-header-cell";

      const button = document.createElement("button");
      button.type = "button";
      button.className = sortColumn.id === column.id ? "audit-header-button sorted" : "audit-header-button";

      const label = document.createElement("span");
      label.textContent = column.label || column.id;

      const indicator = document.createElement("span");
      indicator.className = "audit-sort-indicator";
      indicator.textContent = sortColumn.id === column.id ? sortState.direction.toUpperCase() : "";

      button.append(label, indicator);
      button.addEventListener("click", () => {
        sortState = {
          columnId: column.id,
          direction: sortState.columnId === column.id && sortState.direction === "asc" ? "desc" : "asc"
        };
        render();
      });

      cell.appendChild(button);
      th.appendChild(cell);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    sortedRows.forEach((row) => {
      const tr = document.createElement("tr");
      tableColumns.forEach((column) => {
        const td = document.createElement("td");
        td.dataset.columnId = column.id;
        appendColumnValue(td, row, column);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.append(colgroup, thead, tbody);
    resultsEl.appendChild(table);
  }

  function setRows(rows = [], nextColumns = null) {
    currentRows = Array.isArray(rows) ? rows : [];
    if (Array.isArray(nextColumns)) {
      currentColumns = nextColumns;
    }
    render();
  }

  function clear(message = emptyMessage) {
    currentRows = [];
    sortedRows = [];
    renderMessage(message);
  }

  return {
    clear,
    getRows: () => [...sortedRows],
    setRows
  };
}
