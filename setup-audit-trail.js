import {
  SALESFORCE_API_VERSION,
  getSessionForHost,
  runSoqlAll,
  salesforceRequest
} from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./monitoring-table.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("status");
const limitInput = document.getElementById("audit-limit");
const operationStatusEl = document.getElementById("audit-operation-status");
const resultsEl = document.getElementById("audit-results");
const filterPanelEl = document.getElementById("audit-filter-panel");
const activeFiltersEl = document.getElementById("audit-active-filters");
const clearFiltersButton = document.getElementById("clear-audit-filters");

const BLANK_FILTER_VALUE = "(Blank)";
const FILTER_VALUE_LIMIT = 250;
const COLUMN_DEFINITIONS = [
  { id: "createdDate", label: "Date", type: "date", width: 190, minWidth: 140 },
  { id: "userName", label: "User", type: "text", width: 220, minWidth: 150 },
  { id: "display", label: "Detail", type: "longText", width: 620, minWidth: 260 },
  { id: "namespacePrefix", label: "Source Namespace Prefix", type: "text", width: 190, minWidth: 130 },
  { id: "action", label: "Action Code", type: "text", width: 240, minWidth: 160 },
  { id: "section", label: "Section", type: "text", width: 180, minWidth: 130 },
  { id: "delegateUser", label: "Delegate User", type: "text", width: 180, minWidth: 130 }
];

let session = null;
let allRows = [];
let visibleRows = [];
let filters = {};
let sortState = {
  columnId: "createdDate",
  direction: "desc"
};
let activeFilterColumnId = "";
let setupAuditFields = null;
let columnWidths = Object.fromEntries(COLUMN_DEFINITIONS.map((column) => [column.id, column.width]));
let activeColumnResize = null;

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

function setOperationStatus(message, isError = false) {
  if (!operationStatusEl) {
    return;
  }
  operationStatusEl.textContent = formatUserFacingMessage(message);
  operationStatusEl.className = isError ? "tool-operation-status error" : "tool-operation-status";
}

function getColumnDefinition(columnId) {
  return COLUMN_DEFINITIONS.find((column) => column.id === columnId) || COLUMN_DEFINITIONS[0];
}

function ensureFilter(columnId) {
  if (!filters[columnId]) {
    filters[columnId] = {
      searchText: "",
      selectedValues: null
    };
  }
  return filters[columnId];
}

function hasFilter(columnId) {
  const filter = filters[columnId];
  return Boolean(
    filter &&
    ((filter.searchText || "").trim() || filter.selectedValues instanceof Set)
  );
}

function hasAnyFilter() {
  return COLUMN_DEFINITIONS.some((column) => hasFilter(column.id));
}

function formatDate(value) {
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

function getColumnDisplayValue(row, columnId) {
  if (columnId === "display") {
    return row.display || row.action || "";
  }

  const value = row[columnId];
  if (columnId === "createdDate") {
    return formatDate(value);
  }
  return value == null ? "" : String(value);
}

function getColumnFilterValue(row, columnId) {
  const value = getColumnDisplayValue(row, columnId).trim();
  return value || BLANK_FILTER_VALUE;
}

function compareRows(left, right) {
  const column = getColumnDefinition(sortState.columnId);
  let result = 0;

  if (column.type === "date") {
    const leftTime = Date.parse(left[column.id] || "");
    const rightTime = Date.parse(right[column.id] || "");
    result = (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
  } else {
    result = getColumnDisplayValue(left, column.id).localeCompare(
      getColumnDisplayValue(right, column.id),
      undefined,
      {
        numeric: true,
        sensitivity: "base"
      }
    );
  }

  return sortState.direction === "asc" ? result : -result;
}

function rowPassesFilters(row) {
  return COLUMN_DEFINITIONS.every((column) => {
    const filter = filters[column.id];
    if (!filter) {
      return true;
    }

    const displayValue = getColumnDisplayValue(row, column.id);
    const normalizedValue = displayValue.toLowerCase();
    const searchText = (filter.searchText || "").trim().toLowerCase();
    if (searchText && !normalizedValue.includes(searchText)) {
      return false;
    }

    if (filter.selectedValues instanceof Set) {
      return filter.selectedValues.has(getColumnFilterValue(row, column.id));
    }

    return true;
  });
}

function applyViewState() {
  visibleRows = allRows.filter(rowPassesFilters).sort(compareRows);
  renderTable();
  renderActiveFilters();
  if (!allRows.length) {
    setOperationStatus("No setup audit trail rows loaded.");
  } else if (visibleRows.length === allRows.length) {
    setOperationStatus(`Loaded ${allRows.length} setup audit trail rows.`);
  } else {
    setOperationStatus(`Showing ${visibleRows.length} of ${allRows.length} setup audit trail rows.`);
  }
}

function getUniqueFilterValues(columnId) {
  return Array.from(new Set(allRows.map((row) => getColumnFilterValue(row, columnId)))).sort((left, right) => (
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  ));
}

function createSortLabel(column, direction) {
  if (column.type === "date") {
    return direction === "asc" ? "Oldest first" : "Newest first";
  }
  return direction === "asc" ? "A to Z" : "Z to A";
}

function getColumnWidth(columnId) {
  const column = getColumnDefinition(columnId);
  return columnWidths[columnId] || column.width || 160;
}

function getColumnMinWidth(columnId) {
  return getColumnDefinition(columnId).minWidth || 120;
}

function getTotalColumnWidth() {
  return COLUMN_DEFINITIONS.reduce((total, column) => total + getColumnWidth(column.id), 0);
}

function getRenderedColumnWidths() {
  const widths = Object.fromEntries(COLUMN_DEFINITIONS.map((column) => [column.id, getColumnWidth(column.id)]));
  const baseTotal = getTotalColumnWidth();
  const availableWidth = Math.max(baseTotal, Math.floor(resultsEl.clientWidth || 0));
  const extraWidth = availableWidth - baseTotal;
  if (extraWidth <= 0 || baseTotal <= 0) {
    return widths;
  }

  let assignedExtra = 0;
  COLUMN_DEFINITIONS.forEach((column, index) => {
    const isLast = index === COLUMN_DEFINITIONS.length - 1;
    const extra = isLast
      ? extraWidth - assignedExtra
      : Math.floor(extraWidth * (widths[column.id] / baseTotal));
    assignedExtra += extra;
    widths[column.id] += extra;
  });
  return widths;
}

function getRenderedTotalColumnWidth(renderedWidths = getRenderedColumnWidths()) {
  return COLUMN_DEFINITIONS.reduce((total, column) => total + (renderedWidths[column.id] || getColumnWidth(column.id)), 0);
}

function setColumnWidth(columnId, width) {
  const nextWidth = Math.max(getColumnMinWidth(columnId), Math.round(width));
  columnWidths = {
    ...columnWidths,
    [columnId]: nextWidth
  };
  return nextWidth;
}

function applyColumnWidths() {
  const table = resultsEl.querySelector(".audit-table");
  if (!table) {
    return;
  }

  const renderedWidths = getRenderedColumnWidths();
  table.style.width = `${getRenderedTotalColumnWidth(renderedWidths)}px`;
  COLUMN_DEFINITIONS.forEach((column) => {
    const width = `${renderedWidths[column.id] || getColumnWidth(column.id)}px`;
    table.querySelectorAll(`[data-column-id="${column.id}"]`).forEach((element) => {
      element.style.width = width;
    });
  });
}

function startColumnResize(event, columnId) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  activeColumnResize = {
    columnId,
    startX: event.clientX,
    startWidth: getColumnWidth(columnId)
  };
  document.body.classList.add("audit-resizing-column");
  event.preventDefault();
  event.stopPropagation();
}

function handleColumnResizePointerMove(event) {
  if (!activeColumnResize) {
    return;
  }

  const delta = event.clientX - activeColumnResize.startX;
  setColumnWidth(activeColumnResize.columnId, activeColumnResize.startWidth + delta);
  applyColumnWidths();
  event.preventDefault();
}

function endColumnResize() {
  if (!activeColumnResize) {
    return;
  }

  activeColumnResize = null;
  document.body.classList.remove("audit-resizing-column");
}

function setSort(columnId, direction) {
  sortState = {
    columnId,
    direction
  };
  applyViewState();
  if (activeFilterColumnId) {
    renderFilterPanel(activeFilterColumnId);
  }
}

function updateFilterSelection(columnId, value, isChecked) {
  const filter = ensureFilter(columnId);
  const allValues = getUniqueFilterValues(columnId);
  const selectedValues = filter.selectedValues instanceof Set
    ? new Set(filter.selectedValues)
    : new Set(allValues);

  if (isChecked) {
    selectedValues.add(value);
  } else {
    selectedValues.delete(value);
  }

  filter.selectedValues = selectedValues.size === allValues.length ? null : selectedValues;
  applyViewState();
}

function resetColumnFilter(columnId) {
  filters[columnId] = {
    searchText: "",
    selectedValues: null
  };
  applyViewState();
  if (activeFilterColumnId === columnId) {
    renderFilterPanel(columnId);
  }
}

function clearAllFilters() {
  filters = {};
  applyViewState();
  if (activeFilterColumnId) {
    renderFilterPanel(activeFilterColumnId);
  }
}

function renderActiveFilters() {
  activeFiltersEl.innerHTML = "";
  clearFiltersButton.disabled = !hasAnyFilter();

  const active = COLUMN_DEFINITIONS.filter((column) => hasFilter(column.id));
  if (!active.length) {
    return;
  }

  active.forEach((column) => {
    const filter = ensureFilter(column.id);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "audit-filter-chip";

    const details = [];
    if ((filter.searchText || "").trim()) {
      details.push(`contains "${filter.searchText.trim()}"`);
    }
    if (filter.selectedValues instanceof Set) {
      details.push(`${filter.selectedValues.size} values`);
    }

    chip.textContent = `${column.label}: ${details.join(", ") || "filtered"} x`;
    chip.addEventListener("click", () => resetColumnFilter(column.id));
    activeFiltersEl.appendChild(chip);
  });
}

function renderFilterPanel(columnId) {
  activeFilterColumnId = columnId;
  const column = getColumnDefinition(columnId);
  const filter = ensureFilter(columnId);
  const allValues = getUniqueFilterValues(columnId);
  const searchText = (filter.searchText || "").trim().toLowerCase();
  const matchingValues = searchText
    ? allValues.filter((value) => value.toLowerCase().includes(searchText))
    : allValues;
  const displayedValues = matchingValues.slice(0, FILTER_VALUE_LIMIT);

  filterPanelEl.innerHTML = "";
  filterPanelEl.hidden = false;

  const header = document.createElement("div");
  header.className = "audit-filter-panel-head";

  const title = document.createElement("h2");
  title.textContent = column.label;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ghost audit-small-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => {
    filterPanelEl.hidden = true;
    activeFilterColumnId = "";
  });

  header.append(title, closeButton);

  const sortControls = document.createElement("div");
  sortControls.className = "audit-filter-sort-controls";

  ["asc", "desc"].forEach((direction) => {
    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = sortState.columnId === column.id && sortState.direction === direction
      ? "audit-filter-sort active"
      : "audit-filter-sort";
    sortButton.textContent = createSortLabel(column, direction);
    sortButton.addEventListener("click", () => setSort(column.id, direction));
    sortControls.appendChild(sortButton);
  });

  const searchField = document.createElement("div");
  searchField.className = "field";

  const searchLabel = document.createElement("label");
  searchLabel.setAttribute("for", "audit-filter-search");
  searchLabel.textContent = "Search values";

  const searchInput = document.createElement("input");
  searchInput.id = "audit-filter-search";
  searchInput.type = "search";
  searchInput.value = filter.searchText || "";
  searchInput.placeholder = "Type to filter this column";
  searchInput.addEventListener("input", () => {
    filter.searchText = searchInput.value;
    applyViewState();
    renderFilterPanel(column.id);
    const nextInput = document.getElementById("audit-filter-search");
    nextInput?.focus();
    nextInput?.setSelectionRange(nextInput.value.length, nextInput.value.length);
  });

  searchField.append(searchLabel, searchInput);

  const valueActions = document.createElement("div");
  valueActions.className = "audit-filter-value-actions";

  const selectAllButton = document.createElement("button");
  selectAllButton.type = "button";
  selectAllButton.className = "ghost audit-small-button";
  selectAllButton.textContent = "Select All";
  selectAllButton.addEventListener("click", () => {
    filter.selectedValues = null;
    applyViewState();
    renderFilterPanel(column.id);
  });

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "ghost audit-small-button";
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", () => {
    filter.selectedValues = new Set();
    applyViewState();
    renderFilterPanel(column.id);
  });

  const clearFilterButton = document.createElement("button");
  clearFilterButton.type = "button";
  clearFilterButton.className = "secondary audit-small-button";
  clearFilterButton.textContent = "Clear Filter";
  clearFilterButton.addEventListener("click", () => resetColumnFilter(column.id));

  valueActions.append(selectAllButton, clearButton, clearFilterButton);

  const valuesList = document.createElement("div");
  valuesList.className = "audit-filter-values";

  displayedValues.forEach((value) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "audit-filter-value";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !(filter.selectedValues instanceof Set) || filter.selectedValues.has(value);
    checkbox.addEventListener("change", () => updateFilterSelection(column.id, value, checkbox.checked));

    const text = document.createElement("span");
    text.textContent = value;

    optionLabel.append(checkbox, text);
    valuesList.appendChild(optionLabel);
  });

  if (!displayedValues.length) {
    const empty = document.createElement("div");
    empty.className = "audit-empty";
    empty.textContent = "No values match this filter.";
    valuesList.appendChild(empty);
  }

  const valueCount = document.createElement("div");
  valueCount.className = "small";
  valueCount.textContent = matchingValues.length > FILTER_VALUE_LIMIT
    ? `Showing ${FILTER_VALUE_LIMIT} of ${matchingValues.length} values.`
    : `${matchingValues.length} values.`;

  filterPanelEl.append(header, sortControls, searchField, valueActions, valuesList, valueCount);
}

function createHeaderCell(column, renderedWidths = null) {
  const width = renderedWidths?.[column.id] || getColumnWidth(column.id);
  const th = document.createElement("th");
  th.dataset.columnId = column.id;
  th.style.width = `${width}px`;

  const content = document.createElement("div");
  content.className = "audit-header-cell";

  const sortButton = document.createElement("button");
  sortButton.type = "button";
  sortButton.className = sortState.columnId === column.id
    ? "audit-header-button sorted"
    : "audit-header-button";

  const label = document.createElement("span");
  label.textContent = column.label;

  const indicator = document.createElement("span");
  indicator.className = "audit-sort-indicator";
  indicator.textContent = sortState.columnId === column.id ? sortState.direction.toUpperCase() : "";

  sortButton.append(label, indicator);
  sortButton.addEventListener("click", () => {
    const nextDirection = sortState.columnId === column.id && sortState.direction === "asc" ? "desc" : "asc";
    setSort(column.id, nextDirection);
  });

  const filterButton = document.createElement("button");
  filterButton.type = "button";
  filterButton.className = hasFilter(column.id) ? "audit-filter-trigger active" : "audit-filter-trigger";
  filterButton.textContent = "Filter";
  filterButton.setAttribute("aria-label", `Filter ${column.label}`);
  filterButton.addEventListener("click", () => renderFilterPanel(column.id));

  const resizeHandle = document.createElement("span");
  resizeHandle.className = "audit-column-resizer";
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");
  resizeHandle.setAttribute("aria-label", `Resize ${column.label}`);
  resizeHandle.tabIndex = 0;
  resizeHandle.addEventListener("pointerdown", (event) => startColumnResize(event, column.id));
  resizeHandle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const step = event.shiftKey ? 40 : 16;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setColumnWidth(column.id, getColumnWidth(column.id) + (step * direction));
    applyColumnWidths();
    event.preventDefault();
  });

  content.append(sortButton, filterButton, resizeHandle);
  th.appendChild(content);
  return th;
}

function createColumnGroup(renderedWidths = null) {
  const colgroup = document.createElement("colgroup");
  COLUMN_DEFINITIONS.forEach((column) => {
    const width = renderedWidths?.[column.id] || getColumnWidth(column.id);
    const col = document.createElement("col");
    col.dataset.columnId = column.id;
    col.style.width = `${width}px`;
    colgroup.appendChild(col);
  });
  return colgroup;
}

function renderTable() {
  resultsEl.innerHTML = "";

  if (!allRows.length) {
    const empty = document.createElement("div");
    empty.className = "audit-empty";
    empty.textContent = "No setup audit trail rows returned.";
    resultsEl.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "audit-table";
  const renderedWidths = getRenderedColumnWidths();
  table.style.width = `${getRenderedTotalColumnWidth(renderedWidths)}px`;
  table.appendChild(createColumnGroup(renderedWidths));

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  COLUMN_DEFINITIONS.forEach((column) => headRow.appendChild(createHeaderCell(column, renderedWidths)));
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  visibleRows.forEach((row) => {
    const tr = document.createElement("tr");
    COLUMN_DEFINITIONS.forEach((column) => {
      const td = document.createElement("td");
      td.dataset.columnId = column.id;
      td.style.width = `${renderedWidths[column.id] || getColumnWidth(column.id)}px`;
      const displayValue = getColumnDisplayValue(row, column.id);
      td.textContent = displayValue;
      if (column.type === "longText") {
        td.title = displayValue;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (!visibleRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLUMN_DEFINITIONS.length;
    td.className = "audit-empty-cell";
    td.textContent = "No rows match the current filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  resultsEl.appendChild(table);
}

function getLimit() {
  const parsed = Number.parseInt(limitInput.value, 10);
  if (!Number.isFinite(parsed)) {
    return 500;
  }
  return Math.min(Math.max(parsed, 1), 2000);
}

async function describeSetupAuditTrail() {
  if (setupAuditFields) {
    return setupAuditFields;
  }

  const describe = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/SetupAuditTrail/describe`
  );
  const availableFields = new Set((describe.fields || []).map((field) => field.name));
  const namespaceField = [
    "ResponsibleNamespacePrefix",
    "SourceNamespacePrefix",
    "NamespacePrefix"
  ].find((fieldName) => availableFields.has(fieldName)) || "";

  setupAuditFields = {
    availableFields,
    namespaceField
  };
  return setupAuditFields;
}

function buildSetupAuditTrailQuery(fieldInfo, createdByRelationshipField = "Username") {
  const fields = ["Id"];

  ["CreatedDate", "Display", "Action", "Section", "DelegateUser"].forEach((fieldName) => {
    if (fieldInfo.availableFields.has(fieldName)) {
      fields.push(fieldName);
    }
  });

  if (fieldInfo.namespaceField) {
    fields.push(fieldInfo.namespaceField);
  }

  if (fieldInfo.availableFields.has("CreatedById")) {
    fields.push("CreatedById");
    if (createdByRelationshipField) {
      fields.push(`CreatedBy.${createdByRelationshipField}`);
    }
  }

  const orderField = fieldInfo.availableFields.has("CreatedDate") ? "CreatedDate" : "Id";
  return `SELECT ${[...new Set(fields)].join(", ")} FROM SetupAuditTrail ORDER BY ${orderField} DESC LIMIT ${getLimit()}`;
}

function normalizeAuditRecord(record, fieldInfo) {
  const createdBy = record.CreatedBy && typeof record.CreatedBy === "object"
    ? record.CreatedBy.Username || record.CreatedBy.Name || ""
    : "";

  return {
    id: record.Id || "",
    createdDate: record.CreatedDate || "",
    userName: createdBy || record.CreatedById || "",
    display: record.Display || "",
    namespacePrefix: fieldInfo.namespaceField ? record[fieldInfo.namespaceField] || "" : "",
    action: record.Action || "",
    section: record.Section || "",
    delegateUser: record.DelegateUser || ""
  };
}

async function fetchSetupAuditRows() {
  const fieldInfo = await describeSetupAuditTrail();
  let lastError = null;

  for (const createdByField of ["Username", "Name", ""]) {
    try {
      const records = await runSoqlAll(session.host, session.sid, buildSetupAuditTrailQuery(fieldInfo, createdByField));
      return records.map((record) => normalizeAuditRecord(record, fieldInfo));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function loadSession() {
  const host = params.get("host");
  if (!host) {
    throw new Error("Missing host parameter.");
  }

  session = await getSessionForHost(host);
  setStatus(t("auditTrail.status.connected", { host: session.host }));
}

async function loadAuditTrail() {
  limitInput.disabled = true;
  setOperationStatus("Loading Setup Audit Trail...");
  resultsEl.innerHTML = "<div class=\"audit-empty\">Loading rows...</div>";

  try {
    allRows = await fetchSetupAuditRows();
    applyViewState();
  } catch (error) {
    allRows = [];
    visibleRows = [];
    resultsEl.innerHTML = "";
    renderActiveFilters();
    setOperationStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    limitInput.disabled = false;
  }
}

limitInput.addEventListener("change", () => {
  void loadAuditTrail();
});

clearFiltersButton.addEventListener("click", clearAllFilters);

document.addEventListener("pointermove", handleColumnResizePointerMove);
document.addEventListener("pointerup", endColumnResize);
document.addEventListener("pointercancel", endColumnResize);
window.addEventListener("resize", applyColumnWidths);

loadSession()
  .then(loadAuditTrail)
  .catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
