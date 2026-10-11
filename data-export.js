import {
  SALESFORCE_API_VERSION,
  getActiveSession,
  getSessionForHost,
  runSoqlAll,
  salesforceRequest
} from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

const REPORT_EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";
const DOWNLOAD_METHODS = new Set(["report"]);
const REPORT_FORMATS_BY_METHOD = {
  report: ["csv", "excel", "json"]
};

const params = new URLSearchParams(window.location.search);
const methodEl = document.getElementById("export-method");
const targetFieldEl = document.getElementById("target-field");
const targetLabelEl = document.getElementById("target-label");
const targetNameEl = document.getElementById("target-name");
const targetOptionsEl = document.getElementById("target-options");
const reportFormatFieldEl = document.getElementById("report-format-field");
const reportFormatEl = document.getElementById("report-format");
const reportCsvWarningEl = document.getElementById("report-csv-warning");
const reportJoinedWarningEl = document.getElementById("report-joined-warning");
const requestFieldEl = document.getElementById("request-field");
const requestLabelEl = document.getElementById("request-label");
const requestBodyEl = document.getElementById("request-body");
const queryFieldSuggestionsEl = document.getElementById("query-field-suggestions");
const fieldPickerFieldEl = document.getElementById("field-picker-field");
const fieldPickerEl = document.getElementById("field-picker");
const fieldOptionsEl = document.getElementById("field-options");
const statusEl = document.getElementById("status");
const responseSummaryEl = document.getElementById("response-summary");
const exportOpenUrlRowEl = document.getElementById("export-open-url-row");
const exportOpenUrlEl = document.getElementById("export-open-url");
const rawResultsEl = document.getElementById("raw-results");
const tableResultsEl = document.getElementById("table-results");
const runButton = document.getElementById("run-query");
const sampleButton = document.getElementById("sample-body");
const viewCsvButton = document.getElementById("view-csv");
const viewJsonButton = document.getElementById("view-json");
const copyButton = document.getElementById("copy-response");
const downloadCsvButton = document.getElementById("download-csv");

let session = null;
let sobjectInfos = [];
let reportInfos = [];
let recentViewedReportInfos = [];
let fieldDescribeCache = new Map();
let fieldDescribeLoadPromises = new Map();
let fieldSuggestionTimer = 0;
let inlineFieldSuggestionItems = [];
let inlineFieldSuggestionIndex = 0;
let inlineFieldSuggestionToken = null;
let inlineFieldSuggestionRequestId = 0;
let reportSettingsPreviewTimer = 0;
let selectedReportIsJoined = false;
let currentView = "csv";
let lastJsonText = "";
let lastCsvText = "";
let lastRows = [];
let lastResponseDetails = null;
let lastOpenUrl = "";
let lastOpenLabel = "";
let lastDownloadName = "";
let lastDownloadObjectUrl = "";

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.classList.toggle("error", Boolean(isError));
}

function setResponseSummary(message, isError = false) {
  responseSummaryEl.textContent = formatUserFacingMessage(message);
  responseSummaryEl.classList.toggle("error", Boolean(isError));
}

function clearDownloadObjectUrl() {
  if (!lastDownloadObjectUrl) {
    return;
  }

  URL.revokeObjectURL(lastDownloadObjectUrl);
  lastDownloadObjectUrl = "";
}

function createDownloadObjectUrl(blob) {
  clearDownloadObjectUrl();
  lastDownloadObjectUrl = URL.createObjectURL(blob);
  return lastDownloadObjectUrl;
}

function setOpenUrl(openUrl = "", label = "", downloadName = "") {
  if (!openUrl || openUrl !== lastDownloadObjectUrl) {
    clearDownloadObjectUrl();
  }

  lastOpenUrl = openUrl || "";
  lastOpenLabel = label || lastOpenUrl;
  lastDownloadName = downloadName || "";
  if (!exportOpenUrlRowEl || !exportOpenUrlEl) {
    return;
  }

  exportOpenUrlRowEl.hidden = !lastOpenUrl;
  exportOpenUrlEl.href = lastOpenUrl || "#";
  exportOpenUrlEl.textContent = lastOpenLabel;
  if (lastDownloadName) {
    exportOpenUrlEl.setAttribute("download", lastDownloadName);
  } else {
    exportOpenUrlEl.removeAttribute("download");
  }
}

function updateDownloadCsvButton() {
  if (!downloadCsvButton) {
    return;
  }
  downloadCsvButton.hidden = !lastCsvText || !lastRows.length;
}

function setBusy(isBusy) {
  runButton.disabled = isBusy;
  sampleButton.disabled = isBusy;
  runButton.textContent = isBusy ? "Running..." : getRunButtonText();
}

function getMethod() {
  return methodEl.value || "soql";
}

function getRunButtonText(method = getMethod()) {
  return "Run Export";
}

function getTargetName(defaultValue = "") {
  return (targetNameEl.value || defaultValue).trim();
}

function getReportFormat() {
  const allowedFormats = getAllowedReportFormats();
  return allowedFormats.includes(reportFormatEl.value) ? reportFormatEl.value : allowedFormats[0] || "json";
}

function getAllowedReportFormats(method = getMethod()) {
  return REPORT_FORMATS_BY_METHOD[method] || [];
}

function normalizeCsvCell(value) {
  if (value == null) {
    return "";
  }

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const columns = collectColumns(rows);
  const lines = [columns.map(normalizeCsvCell).join(",")];
  rows.forEach((row) => {
    lines.push(columns.map((column) => normalizeCsvCell(row[column])).join(","));
  });
  return lines.join("\n");
}

function collectColumns(rows) {
  const columns = [];
  const seen = new Set();

  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key === "attributes" || seen.has(key)) {
        return;
      }
      seen.add(key);
      columns.push(key);
    });
  });

  return columns;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenExportRow(row = {}, prefix = "", output = {}) {
  Object.entries(row || {}).forEach(([key, value]) => {
    if (key === "attributes") {
      return;
    }

    const columnName = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenExportRow(value, columnName, output);
      return;
    }

    output[columnName] = value;
  });
  return output;
}

function normalizeExportRows(rows = []) {
  return rows.map((row) => (isPlainObject(row) ? flattenExportRow(row) : row));
}

function normalizeRows(result) {
  if (Array.isArray(result)) {
    return normalizeExportRows(result);
  }

  const reportRows = normalizeReportRows(result);
  if (reportRows.length) {
    return reportRows;
  }

  if (Array.isArray(result?.records)) {
    return normalizeExportRows(result.records);
  }

  if (Array.isArray(result?.searchRecords)) {
    return normalizeExportRows(result.searchRecords);
  }

  if (Array.isArray(result?.data?.uiapi?.query?.records?.edges)) {
    return normalizeExportRows(result.data.uiapi.query.records.edges.map((edge) => edge?.node).filter(Boolean));
  }

  return [];
}

function createUniqueColumnName(name, usedNames) {
  const baseName = String(name || "Column").trim() || "Column";
  let nextName = baseName;
  let index = 2;
  while (usedNames.has(nextName)) {
    nextName = `${baseName} ${index}`;
    index += 1;
  }
  usedNames.add(nextName);
  return nextName;
}

function getReportColumnNames(result = {}) {
  const detailColumns = Array.isArray(result?.reportMetadata?.detailColumns)
    ? result.reportMetadata.detailColumns
    : [];
  const columnInfo = result?.reportExtendedMetadata?.detailColumnInfo || {};
  const usedNames = new Set();
  return detailColumns.map((column, index) => {
    const info = columnInfo[column] || {};
    return createUniqueColumnName(info.label || info.name || column || `Column ${index + 1}`, usedNames);
  });
}

function getReportCellValue(cell = {}) {
  if (cell === null || typeof cell === "undefined") {
    return "";
  }
  if (typeof cell !== "object") {
    return cell;
  }
  if (Object.prototype.hasOwnProperty.call(cell, "label")) {
    return cell.label;
  }
  if (Object.prototype.hasOwnProperty.call(cell, "value")) {
    return cell.value;
  }
  return JSON.stringify(cell);
}

function normalizeReportRows(result = {}) {
  const factMap = result?.factMap;
  if (!factMap || typeof factMap !== "object") {
    return [];
  }

  const columns = getReportColumnNames(result);
  const usedFallbackColumns = new Set(columns);
  return Object.values(factMap)
    .flatMap((fact = {}) => Array.isArray(fact.rows) ? fact.rows : [])
    .map((row = {}) => {
      const output = {};
      const cells = Array.isArray(row.dataCells) ? row.dataCells : [];
      cells.forEach((cell, index) => {
        const column = columns[index] || createUniqueColumnName(`Column ${index + 1}`, usedFallbackColumns);
        output[column] = getReportCellValue(cell);
      });
      return output;
    });
}

function updateViewButtons() {
  viewCsvButton.classList.toggle("active", currentView === "csv");
  viewJsonButton.classList.toggle("active", currentView === "json");
}

function renderCurrentView() {
  updateViewButtons();

  if (currentView === "json") {
    rawResultsEl.hidden = false;
    tableResultsEl.hidden = true;
    rawResultsEl.textContent = lastJsonText || "No JSON response.";
    return;
  }

  rawResultsEl.hidden = true;
  tableResultsEl.hidden = false;
  renderTable(lastRows);
}

function renderTable(rows) {
  tableResultsEl.textContent = "";

  if (lastResponseDetails) {
    const detailsSection = document.createElement("section");
    detailsSection.className = "data-export-response-section";

    const detailsTitle = document.createElement("h3");
    detailsTitle.textContent = lastResponseDetails.title || "Initial Details";

    const detailsPre = document.createElement("pre");
    detailsPre.className = "schema-api-usage-json";
    detailsPre.textContent = JSON.stringify(lastResponseDetails.value ?? lastResponseDetails, null, 2);

    detailsSection.append(detailsTitle, detailsPre);
    tableResultsEl.append(detailsSection);
  }

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "small schema-status";
    empty.textContent = "No rows to display.";
    tableResultsEl.append(empty);
    return;
  }

  const columns = collectColumns(rows);
  if (lastResponseDetails) {
    const tableTitle = document.createElement("h3");
    tableTitle.textContent = "Excel Table Preview";
    tableResultsEl.append(tableTitle);
  }

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      const value = row?.[column];
      td.textContent = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  tableResultsEl.append(table);
}

function setResult(result, rows = normalizeRows(result), options = {}) {
  lastRows = rows;
  lastJsonText = JSON.stringify(result ?? null, null, 2);
  lastCsvText = rowsToCsv(rows);
  lastResponseDetails = options.details || null;
  currentView = options.view || (rows.length ? "csv" : "json");
  setOpenUrl(
    options.openUrl || result?.openUrl || "",
    options.openLabel || result?.openLabel || "",
    options.downloadName || result?.downloadName || ""
  );
  updateDownloadCsvButton();
  renderCurrentView();
  setResponseSummary(options.summary || `${rows.length} row${rows.length === 1 ? "" : "s"} returned.`);
}

async function setSampleBody() {
  if (DOWNLOAD_METHODS.has(getMethod())) {
    return;
  }

  sampleButton.disabled = true;
  try {
    requestBodyEl.value = await createSampleBody();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setResponseSummary(message, true);
    requestBodyEl.value = createDefaultRequestBody();
  } finally {
    sampleButton.disabled = false;
  }
  hideInlineFieldSuggestions();
  scheduleFieldSuggestions();
}

function createDefaultRequestBody(method = getMethod()) {
  const objectName = getTargetName("Account") || "Account";

  switch (method) {
    case "sosl":
      return `FIND {Acme} IN ALL FIELDS RETURNING ${objectName}(Id, Name) LIMIT 20`;
    case "graphql":
      return JSON.stringify({
        query: `query records { uiapi { query { ${objectName}(first: 10) { edges { node { Id Name { value } } } } } } }`
      }, null, 2);
    case "soql":
    default:
      return `SELECT Id, Name FROM ${objectName} LIMIT 200`;
  }
}

async function createSampleBody() {
  return createDefaultRequestBody();
}

function getDefaultTargetName(method = getMethod()) {
  return method === "report" ? "" : "Account";
}

function resetMethodInputs(method = getMethod()) {
  targetNameEl.value = getDefaultTargetName(method);
  fieldPickerEl.value = "";
  reportFormatEl.value = getAllowedReportFormats(method)[0] || "json";
  requestBodyEl.value = DOWNLOAD_METHODS.has(method) ? "" : createDefaultRequestBody(method);
  hideInlineFieldSuggestions();
  setResult({ records: [], totalSize: 0, done: true }, [], {
    view: "csv",
    summary: "Run an export to see CSV grid results."
  });
}

function updateReportFormatOptions(method = getMethod()) {
  const allowedFormats = getAllowedReportFormats(method);

  Array.from(reportFormatEl.options).forEach((option) => {
    const isJoinedCsv = method === "report" && selectedReportIsJoined && option.value === "csv";
    const isAllowed = allowedFormats.includes(option.value) && !isJoinedCsv;
    option.hidden = !isAllowed;
    option.disabled = !isAllowed;
    option.title = isJoinedCsv ? "CSV is not available for joined reports." : "";
  });

  if (allowedFormats.length && !allowedFormats.includes(reportFormatEl.value)) {
    reportFormatEl.value = allowedFormats[0];
  }
  if (method === "report" && selectedReportIsJoined && reportFormatEl.value === "csv") {
    reportFormatEl.value = allowedFormats.includes("excel") ? "excel" : "json";
  }

  reportFormatEl.disabled = Array.from(reportFormatEl.options).filter((option) => !option.disabled).length <= 1;
}

function updateMethodUi(options = {}) {
  const method = getMethod();
  const isDownloadMethod = DOWNLOAD_METHODS.has(method);

  if (options.resetInputs) {
    resetMethodInputs(method);
    selectedReportIsJoined = false;
  }

  setOpenUrl("");
  hideInlineFieldSuggestions();
  updateReportFormatOptions(method);
  reportFormatFieldEl.hidden = !isDownloadMethod;
  reportCsvWarningEl.hidden = !(method === "report" && getReportFormat() === "csv");
  reportJoinedWarningEl.hidden = !(method === "report" && selectedReportIsJoined);
  requestFieldEl.hidden = isDownloadMethod && method !== "report";
  fieldPickerFieldEl.hidden = isDownloadMethod;
  sampleButton.hidden = isDownloadMethod;
  targetFieldEl.hidden = false;
  requestBodyEl.readOnly = method === "report";

  if (method === "report") {
    targetLabelEl.textContent = "Report Name or ID";
    targetNameEl.placeholder = "Sales Pipeline";
    requestLabelEl.textContent = "Report Settings";
    requestBodyEl.placeholder = "Select a report to load settings and filters.";
    reportFormatFieldEl.querySelector("label").textContent = "Format";
  } else if (method === "soql") {
    targetLabelEl.textContent = "Object API Name";
    targetNameEl.placeholder = "Account";
    requestLabelEl.textContent = "SOQL Query";
  } else if (method === "sosl") {
    targetLabelEl.textContent = "Object API Name";
    targetNameEl.placeholder = "Account";
    requestLabelEl.textContent = "SOSL Query";
  } else {
    targetLabelEl.textContent = "Object API Name";
    targetNameEl.placeholder = "Account";
    requestLabelEl.textContent = "GraphQL Query";
  }

  fieldPickerEl.disabled = isDownloadMethod;
  runButton.textContent = getRunButtonText(method);
  populateTargetOptions();
  loadFieldSuggestions();
  scheduleReportSettingsPreview();
}

function populateTargetOptions() {
  targetOptionsEl.textContent = "";
  const method = getMethod();
  let options = sobjectInfos;

  if (method === "report") {
    options = mergeRecentReportsForSuggestions();
  }

  options.slice(0, 1000).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.label = item.label || item.name;
    targetOptionsEl.append(option);
  });
}

function mergeRecentReportsForSuggestions() {
  const recentIds = new Set(recentViewedReportInfos.map((report) => report.id));
  return [
    ...recentViewedReportInfos,
    ...reportInfos.filter((report) => !recentIds.has(report.id))
  ];
}

function populateFieldOptions(fields = []) {
  fieldOptionsEl.textContent = "";
  fields
    .slice()
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .forEach((field) => {
      const option = document.createElement("option");
      option.value = field.name;
      option.label = [field.label, field.type].filter(Boolean).join(" - ");
      fieldOptionsEl.append(option);
    });
}

function extractSObjectNameFromQuery(query = "") {
  const cleaned = String(query)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
  const match = cleaned.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*(?:__[A-Za-z0-9]+)?)/i);
  return match?.[1] || "";
}

function extractSoslObjectNameFromQuery(query = "", cursorPosition = requestBodyEl.selectionStart) {
  const beforeCursor = String(query || "").slice(0, cursorPosition);
  const returningIndex = beforeCursor.toUpperCase().lastIndexOf("RETURNING");
  if (returningIndex < 0) {
    return "";
  }

  const returningText = beforeCursor.slice(returningIndex + "RETURNING".length);
  const objectPattern = /([A-Za-z_][A-Za-z0-9_]*(?:__[A-Za-z0-9]+)?)\s*\(/g;
  let match;
  let objectName = "";
  while ((match = objectPattern.exec(returningText))) {
    const openParenIndex = objectPattern.lastIndex - 1;
    const textAfterOpenParen = returningText.slice(openParenIndex + 1);
    const openCount = (textAfterOpenParen.match(/\(/g) || []).length;
    const closeCount = (textAfterOpenParen.match(/\)/g) || []).length;
    if (closeCount <= openCount) {
      objectName = match[1];
    }
  }
  return objectName;
}

function getActiveQueryObjectName() {
  const method = getMethod();
  if (method === "soql") {
    return extractSObjectNameFromQuery(requestBodyEl.value) || getTargetName("");
  }
  if (method === "sosl") {
    return extractSoslObjectNameFromQuery(requestBodyEl.value) || getTargetName("");
  }
  if (method === "graphql") {
    return getTargetName("");
  }
  return "";
}

function scheduleFieldSuggestions() {
  clearTimeout(fieldSuggestionTimer);
  fieldSuggestionTimer = window.setTimeout(() => {
    void loadFieldSuggestions();
  }, 250);
}

async function loadFieldSuggestions(objectName = getActiveQueryObjectName(), options = {}) {
  const method = getMethod();
  const shouldPopulatePicker = options.populate !== false;
  if (DOWNLOAD_METHODS.has(method) || !session?.host || !session?.sid) {
    if (shouldPopulatePicker) {
      populateFieldOptions([]);
    }
    return [];
  }

  const sobjectName = (objectName || "").trim();
  if (!sobjectName) {
    if (shouldPopulatePicker) {
      populateFieldOptions([]);
    }
    return [];
  }

  if (fieldDescribeCache.has(sobjectName)) {
    const fields = fieldDescribeCache.get(sobjectName);
    if (shouldPopulatePicker) {
      populateFieldOptions(fields);
    }
    return fields;
  }

  if (fieldDescribeLoadPromises.has(sobjectName)) {
    try {
      const fields = await fieldDescribeLoadPromises.get(sobjectName);
      if (shouldPopulatePicker) {
        populateFieldOptions(fields);
      }
      return fields;
    } catch (_error) {
      if (shouldPopulatePicker) {
        populateFieldOptions([]);
      }
      return [];
    }
  }

  const loadPromise = salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodeURIComponent(sobjectName)}/describe`
  ).then((describe) => {
    const fields = Array.isArray(describe?.fields) ? describe.fields : [];
    fieldDescribeCache.set(sobjectName, fields);
    return fields;
  });
  fieldDescribeLoadPromises.set(sobjectName, loadPromise);

  try {
    const fields = await loadPromise;
    if (shouldPopulatePicker) {
      populateFieldOptions(fields);
    }
    return fields;
  } catch (_error) {
    if (shouldPopulatePicker) {
      populateFieldOptions([]);
    }
    return [];
  } finally {
    fieldDescribeLoadPromises.delete(sobjectName);
  }
}

function insertTextAtCursor(input, text) {
  const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === "number" ? input.selectionEnd : input.value.length;
  const prefix = input.value.slice(0, start);
  const suffix = input.value.slice(end);
  input.value = `${prefix}${text}${suffix}`;
  const nextPosition = start + text.length;
  input.setSelectionRange(nextPosition, nextPosition);
  scheduleFieldSuggestions();
}

function hideInlineFieldSuggestions() {
  inlineFieldSuggestionRequestId += 1;
  inlineFieldSuggestionItems = [];
  inlineFieldSuggestionIndex = 0;
  inlineFieldSuggestionToken = null;
  if (queryFieldSuggestionsEl) {
    queryFieldSuggestionsEl.hidden = true;
    queryFieldSuggestionsEl.textContent = "";
  }
}

function getQueryFieldTokenInfo() {
  const cursorStart = typeof requestBodyEl.selectionStart === "number" ? requestBodyEl.selectionStart : requestBodyEl.value.length;
  const cursorEnd = typeof requestBodyEl.selectionEnd === "number" ? requestBodyEl.selectionEnd : cursorStart;
  const beforeCursor = requestBodyEl.value.slice(0, cursorStart);
  const match = beforeCursor.match(/(?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*$/) ||
    beforeCursor.match(/(?:[A-Za-z_][A-Za-z0-9_]*\.)+$/);
  if (!match) {
    return null;
  }
  const token = match[0];
  const lastDotIndex = token.lastIndexOf(".");
  const relationshipPath = lastDotIndex >= 0 ? token.slice(0, lastDotIndex).split(".").filter(Boolean) : [];
  const text = lastDotIndex >= 0 ? token.slice(lastDotIndex + 1) : token;
  return {
    start: cursorStart - match[0].length,
    end: cursorEnd,
    text,
    token,
    relationshipPath
  };
}

function getCachedFieldsForObject(sobjectName = "") {
  return fieldDescribeCache.get(sobjectName) || [];
}

async function resolveRelationshipObjectName(baseObjectName = "", relationshipPath = [], options = {}) {
  let currentObjectName = baseObjectName;
  for (const relationshipName of relationshipPath) {
    if (!currentObjectName || !relationshipName) {
      return "";
    }

    let fields = getCachedFieldsForObject(currentObjectName);
    if (!fields.length && options.loadIfNeeded) {
      fields = await loadFieldSuggestions(currentObjectName, { populate: false });
    }

    const relationshipField = fields.find((field) => (
      field?.relationshipName &&
      field.relationshipName.toLowerCase() === relationshipName.toLowerCase() &&
      Array.isArray(field.referenceTo) &&
      field.referenceTo.length
    ));
    if (!relationshipField) {
      return "";
    }
    currentObjectName = relationshipField.referenceTo[0] || "";
  }
  return currentObjectName;
}

async function getActiveSuggestionFields(tokenInfo = getQueryFieldTokenInfo(), options = {}) {
  const sobjectName = getActiveQueryObjectName();
  if (!sobjectName) {
    return [];
  }
  const targetObjectName = tokenInfo?.relationshipPath?.length
    ? await resolveRelationshipObjectName(sobjectName, tokenInfo.relationshipPath, options)
    : sobjectName;
  if (!targetObjectName) {
    return [];
  }

  let fields = getCachedFieldsForObject(targetObjectName);
  if (!fields.length && options.loadIfNeeded) {
    fields = await loadFieldSuggestions(targetObjectName, {
      populate: targetObjectName === sobjectName
    });
  }
  return fields;
}

function getInlineFieldSuggestionMatches(fields = [], prefix = "") {
  const lowerPrefix = prefix.toLowerCase();
  return fields
    .filter((field) => {
      if (!field?.name) {
        return false;
      }
      const lowerName = String(field.name || "").toLowerCase();
      const lowerLabel = String(field.label || "").toLowerCase();
      return lowerName.startsWith(lowerPrefix) || lowerLabel.startsWith(lowerPrefix) || lowerLabel.includes(lowerPrefix);
    })
    .sort((left, right) => {
      const leftNameStarts = String(left.name || "").toLowerCase().startsWith(lowerPrefix);
      const rightNameStarts = String(right.name || "").toLowerCase().startsWith(lowerPrefix);
      if (leftNameStarts !== rightNameStarts) {
        return leftNameStarts ? -1 : 1;
      }
      const leftLabelStarts = String(left.label || "").toLowerCase().startsWith(lowerPrefix);
      const rightLabelStarts = String(right.label || "").toLowerCase().startsWith(lowerPrefix);
      if (leftLabelStarts !== rightLabelStarts) {
        return leftLabelStarts ? -1 : 1;
      }
      return String(left.name).localeCompare(String(right.name));
    })
    .slice(0, 12);
}

function renderInlineFieldSuggestions(items = [], tokenInfo = null) {
  if (!queryFieldSuggestionsEl || !items.length || !tokenInfo) {
    hideInlineFieldSuggestions();
    return;
  }

  inlineFieldSuggestionItems = items;
  inlineFieldSuggestionToken = tokenInfo;
  inlineFieldSuggestionIndex = Math.min(inlineFieldSuggestionIndex, items.length - 1);
  queryFieldSuggestionsEl.textContent = "";

  items.forEach((field, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "data-export-inline-suggestion";
    button.classList.toggle("active", index === inlineFieldSuggestionIndex);

    const name = document.createElement("span");
    name.className = "data-export-inline-suggestion-name";
    name.textContent = field.name;

    const meta = document.createElement("span");
    meta.className = "data-export-inline-suggestion-meta";
    meta.textContent = [field.label, field.type].filter(Boolean).join(" - ");

    button.append(name, meta);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      insertInlineFieldSuggestion(index);
    });
    queryFieldSuggestionsEl.append(button);
  });

  queryFieldSuggestionsEl.hidden = false;
}

async function updateInlineFieldSuggestions(options = {}) {
  if (!queryFieldSuggestionsEl || DOWNLOAD_METHODS.has(getMethod()) || requestFieldEl.hidden) {
    hideInlineFieldSuggestions();
    return;
  }

  const tokenInfo = getQueryFieldTokenInfo();
  if (!tokenInfo || (tokenInfo.text.length < 1 && !tokenInfo.relationshipPath?.length)) {
    hideInlineFieldSuggestions();
    return;
  }

  let requestId = inlineFieldSuggestionRequestId;
  if (options.loadIfNeeded) {
    requestId += 1;
    inlineFieldSuggestionRequestId = requestId;
  }

  const fields = await getActiveSuggestionFields(tokenInfo, options);
  if (requestId !== inlineFieldSuggestionRequestId) {
    return;
  }

  const matches = getInlineFieldSuggestionMatches(fields, tokenInfo.text);
  if (!matches.length) {
    hideInlineFieldSuggestions();
    return;
  }

  renderInlineFieldSuggestions(matches, tokenInfo);
}

function setInlineFieldSuggestionIndex(index) {
  if (!inlineFieldSuggestionItems.length || !queryFieldSuggestionsEl || queryFieldSuggestionsEl.hidden) {
    return;
  }

  inlineFieldSuggestionIndex = (index + inlineFieldSuggestionItems.length) % inlineFieldSuggestionItems.length;
  Array.from(queryFieldSuggestionsEl.children).forEach((child, childIndex) => {
    child.classList.toggle("active", childIndex === inlineFieldSuggestionIndex);
  });
  queryFieldSuggestionsEl.children[inlineFieldSuggestionIndex]?.scrollIntoView({ block: "nearest" });
}

function insertInlineFieldSuggestion(index = inlineFieldSuggestionIndex) {
  const field = inlineFieldSuggestionItems[index];
  const tokenInfo = inlineFieldSuggestionToken || getQueryFieldTokenInfo();
  if (!field?.name || !tokenInfo) {
    hideInlineFieldSuggestions();
    return;
  }

  const replaceStart = tokenInfo.relationshipPath?.length
    ? tokenInfo.start + tokenInfo.token.length - tokenInfo.text.length
    : tokenInfo.start;
  const before = requestBodyEl.value.slice(0, replaceStart);
  const after = requestBodyEl.value.slice(tokenInfo.end);
  const nextPosition = before.length + field.name.length;
  requestBodyEl.value = `${before}${field.name}${after}`;
  requestBodyEl.setSelectionRange(nextPosition, nextPosition);
  hideInlineFieldSuggestions();
  requestBodyEl.focus();
  scheduleFieldSuggestions();
}

function handleRequestBodyKeydown(event) {
  if (!queryFieldSuggestionsEl || queryFieldSuggestionsEl.hidden || !inlineFieldSuggestionItems.length) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setInlineFieldSuggestionIndex(inlineFieldSuggestionIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setInlineFieldSuggestionIndex(inlineFieldSuggestionIndex - 1);
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    insertInlineFieldSuggestion();
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideInlineFieldSuggestions();
  }
}

function handleRequestBodyKeyup(event) {
  if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    return;
  }
  void updateInlineFieldSuggestions({ loadIfNeeded: true });
}

function createQueryPath(basePath, query) {
  return `${basePath}?q=${encodeURIComponent(query)}`;
}

async function executeSoql() {
  const query = requestBodyEl.value.trim();
  if (!query) {
    throw new Error("SOQL Query is required.");
  }

  const rows = await runSoqlAll(session.host, session.sid, query);
  return {
    result: { records: rows, totalSize: rows.length, done: true },
    rows: normalizeExportRows(rows)
  };
}

async function executeSosl() {
  const query = requestBodyEl.value.trim();
  if (!query) {
    throw new Error("SOSL Query is required.");
  }

  const result = await salesforceRequest(
    session.host,
    session.sid,
    createQueryPath(`/services/data/${SALESFORCE_API_VERSION}/search/`, query)
  );
  return { result, rows: normalizeRows(result) };
}

async function executeGraphQuery() {
  const bodyText = requestBodyEl.value.trim();
  if (!bodyText) {
    throw new Error("GraphQL Query body is required.");
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (_error) {
    body = { query: bodyText };
  }

  const result = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/graphql`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
  return { result, rows: normalizeRows(result) };
}

function findReportInfo(value) {
  return findAssetInfo(value, reportInfos);
}

function findAssetInfo(value, infos = []) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  return infos.find((asset) => (
    asset.id === text ||
    asset.name?.toLowerCase() === lower ||
    asset.developerName?.toLowerCase() === lower ||
    asset.label?.toLowerCase() === lower
  )) || { id: text, name: text, known: false };
}

function createDownloadFileName(asset, extension, fallbackName = "salesforce-export") {
  const baseName = (asset?.name || asset?.developerName || asset?.id || fallbackName)
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallbackName;
  return `${baseName}.${extension}`;
}

function createReportFileName(report) {
  return createDownloadFileName(report, "xlsx", "salesforce-report");
}

function createReportCsvFileName(report) {
  return createDownloadFileName(report, "csv", "salesforce-report");
}

function findZipEndOfCentralDirectory(view) {
  const minimumEndRecordLength = 22;
  const maximumCommentLength = 0xffff;
  const startOffset = Math.max(0, view.byteLength - minimumEndRecordLength - maximumCommentLength);

  for (let offset = view.byteLength - minimumEndRecordLength; offset >= startOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Excel file is not a valid ZIP archive.");
}

function readZipText(bytes, offset, length) {
  return new TextDecoder("utf-8").decode(bytes.subarray(offset, offset + length));
}

async function inflateZipBytes(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Excel preview is not supported by this browser.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const endRecordOffset = findZipEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endRecordOffset + 10, true);
  let centralOffset = view.getUint32(endRecordOffset + 16, true);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new Error("Excel ZIP central directory is invalid.");
    }

    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralOffset + 42, true);
    const fileName = readZipText(bytes, centralOffset + 46, fileNameLength).replaceAll("\\", "/");

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Excel ZIP local header is invalid for ${fileName}.`);
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    entries.set(fileName, {
      method,
      bytes: bytes.subarray(dataOffset, dataOffset + compressedSize)
    });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntryBytes(entries, path) {
  const entry = entries.get(path);
  if (!entry) {
    return null;
  }

  if (entry.method === 0) {
    return entry.bytes;
  }

  if (entry.method === 8) {
    return inflateZipBytes(entry.bytes);
  }

  throw new Error(`Unsupported Excel ZIP compression method ${entry.method}.`);
}

async function readZipEntryText(entries, path) {
  const bytes = await readZipEntryBytes(entries, path);
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

function parseXmlDocument(xmlText, label) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(`Could not parse Excel ${label}.`);
  }
  return document;
}

function parseExcelSharedStrings(xmlText) {
  if (!xmlText) {
    return [];
  }

  const document = parseXmlDocument(xmlText, "shared strings");
  return Array.from(document.getElementsByTagName("si")).map((item) => (
    Array.from(item.getElementsByTagName("t")).map((textNode) => textNode.textContent || "").join("")
  ));
}

function getFirstWorksheetPath(entries, workbookText, relationshipText) {
  if (workbookText && relationshipText) {
    const workbook = parseXmlDocument(workbookText, "workbook");
    const relationships = parseXmlDocument(relationshipText, "workbook relationships");
    const firstSheet = workbook.getElementsByTagName("sheet")[0];
    const relationshipId = firstSheet?.getAttribute("r:id");
    const relationship = Array.from(relationships.getElementsByTagName("Relationship"))
      .find((item) => item.getAttribute("Id") === relationshipId);
    const target = relationship?.getAttribute("Target");
    if (target) {
      const normalizedTarget = target.replace(/^\/+/, "");
      return normalizedTarget.startsWith("xl/") ? normalizedTarget : `xl/${normalizedTarget}`;
    }
  }

  return Array.from(entries.keys())
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    [0] || "";
}

function getExcelColumnIndex(cellReference = "") {
  const letters = String(cellReference).match(/^[A-Za-z]+/)?.[0] || "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return Math.max(index - 1, 0);
}

function getFirstChildText(element, tagName) {
  return Array.from(element.childNodes)
    .find((node) => node.nodeType === Node.ELEMENT_NODE && node.localName === tagName)
    ?.textContent || "";
}

function getExcelCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t") || "";
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
  }

  const value = getFirstChildText(cell, "v");
  if (type === "s") {
    return sharedStrings[Number(value)] || "";
  }
  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }
  return value;
}

function getExcelColumnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function isExcelRowEmpty(row = []) {
  return row.every((value) => !String(value ?? "").trim());
}

function excelMatrixToGridRows(matrix) {
  const visibleRows = matrix.filter((row) => !isExcelRowEmpty(row));
  if (!visibleRows.length) {
    return [];
  }

  const columnCount = Math.max(...visibleRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_value, index) => getExcelColumnName(index));
  return visibleRows.map((row) => {
    const output = {};
    columns.forEach((column, index) => {
      output[column] = row[index] ?? "";
    });
    return output;
  });
}

function parseExcelWorksheetRows(sheetText, sharedStrings) {
  const document = parseXmlDocument(sheetText, "worksheet");
  return Array.from(document.getElementsByTagName("row")).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      values[getExcelColumnIndex(cell.getAttribute("r"))] = getExcelCellValue(cell, sharedStrings);
    });
    return values;
  });
}

async function parseReportExcelRows(blob) {
  const entries = await readZipEntries(await blob.arrayBuffer());
  const [sharedStringsText, workbookText, relationshipText] = await Promise.all([
    readZipEntryText(entries, "xl/sharedStrings.xml"),
    readZipEntryText(entries, "xl/workbook.xml"),
    readZipEntryText(entries, "xl/_rels/workbook.xml.rels")
  ]);
  const sheetPath = getFirstWorksheetPath(entries, workbookText, relationshipText);
  if (!sheetPath) {
    throw new Error("Excel workbook has no worksheet.");
  }

  const sheetText = await readZipEntryText(entries, sheetPath);
  if (!sheetText) {
    throw new Error(`Excel worksheet ${sheetPath} was not found.`);
  }

  return excelMatrixToGridRows(parseExcelWorksheetRows(sheetText, parseExcelSharedStrings(sharedStringsText)));
}

async function requestReportJson(reportId) {
  return salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );
}

async function requestReportExcel(reportId) {
  const response = await fetch(
    `https://${session.host}/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.sid}`,
        Accept: REPORT_EXCEL_MIME
      }
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Report Excel export failed (${response.status}): ${text || response.statusText}`);
  }

  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "";
  if (contentType.toLowerCase().includes("application/json")) {
    const text = await blob.text().catch(() => "");
    throw new Error(`Report Excel export returned JSON: ${text || contentType}`);
  }

  return blob;
}

function createReportInitialDetails(report = {}, reportJson = {}, excelInfo = {}) {
  const metadata = reportJson?.reportMetadata || {};
  return {
    report: {
      id: report.id || reportJson?.reportMetadata?.id || "",
      name: report.name || metadata.name || "",
      developerName: report.developerName || "",
      format: excelInfo.format || "json",
      previewSource: excelInfo.previewSource || ""
    },
    settings: {
      reportType: metadata.reportType?.type || metadata.reportType || "",
      reportFormat: metadata.reportFormat || "",
      currency: metadata.currency || "",
      detailColumns: metadata.detailColumns || [],
      groupingsDown: metadata.groupingsDown || [],
      groupingsAcross: metadata.groupingsAcross || [],
      aggregates: metadata.aggregates || []
    },
    filters: {
      standardDateFilter: metadata.standardDateFilter || null,
      reportFilters: metadata.reportFilters || [],
      crossFilters: metadata.crossFilters || [],
      scope: metadata.scope || ""
    }
  };
}

function isJoinedReport(reportJson = {}) {
  const metadata = reportJson?.reportMetadata || {};
  const reportFormat = String(metadata.reportFormat || "").toLowerCase().replace(/[\s-]+/g, "_");
  return reportFormat === "joined"
    || reportFormat === "multi_block"
    || reportFormat === "multiblock"
    || Array.isArray(metadata.blocks)
    || Array.isArray(metadata.blockInfo)
    || (metadata.reportType && typeof metadata.reportType === "object" && Array.isArray(metadata.reportType.blocks));
}

function updateReportCsvAvailability(reportJson = null) {
  selectedReportIsJoined = Boolean(reportJson && isJoinedReport(reportJson));
  updateReportFormatOptions(getMethod());
  reportCsvWarningEl.hidden = !(getMethod() === "report" && getReportFormat() === "csv");
  reportJoinedWarningEl.hidden = !(getMethod() === "report" && selectedReportIsJoined);
}

async function loadSelectedReportSettingsPreview() {
  if (getMethod() !== "report" || !session?.host || !session?.sid) {
    return;
  }

  const selectedValue = getTargetName("");
  const report = findReportInfo(selectedValue);
  if (!report?.id || (!report.known && !/^00O[A-Za-z0-9]{12,15}$/.test(report.id))) {
    updateReportCsvAvailability(null);
    requestBodyEl.value = "";
    return;
  }

  requestBodyEl.value = "Loading report settings...";
  const reportJson = await requestReportJson(report.id);
  if (getMethod() !== "report" || getTargetName("") !== selectedValue) {
    return;
  }
  updateReportCsvAvailability(reportJson);
  requestBodyEl.value = JSON.stringify(createReportInitialDetails(report, reportJson, {
    format: getReportFormat()
  }), null, 2);
}

function scheduleReportSettingsPreview() {
  clearTimeout(reportSettingsPreviewTimer);
  if (getMethod() !== "report") {
    return;
  }

  reportSettingsPreviewTimer = window.setTimeout(() => {
    loadSelectedReportSettingsPreview().catch((error) => {
      updateReportCsvAvailability(null);
      requestBodyEl.value = JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 2);
    });
  }, 300);
}

async function executeReportExport() {
  const report = findReportInfo(getTargetName(""));
  if (!report?.id) {
    throw new Error("Report Name or ID is required.");
  }

  const reportFormat = getReportFormat();

  if (reportFormat === "json") {
    const result = await requestReportJson(report.id);
    return {
      result,
      rows: normalizeRows(result),
      view: "json",
      summary: `Loaded JSON report ${report.name || report.id}.`
    };
  }

  const reportJsonResult = await requestReportJson(report.id).catch((error) => ({ error }));
  if (reportFormat === "csv") {
    if (reportJsonResult?.error) {
      throw reportJsonResult.error;
    }
    if (isJoinedReport(reportJsonResult)) {
      throw new Error("CSV export is not available for joined reports. Use Excel or JSON.");
    }
    const reportRows = normalizeReportRows(reportJsonResult);
    const fileName = createReportCsvFileName(report);
    const result = {
      reportId: report.id,
      reportName: report.name,
      exportType: "CSV",
      format: "csv",
      fileName,
      rowLimit: 2000,
      previewSource: "Synchronous report run",
      previewRows: reportRows.length,
      reportResult: reportJsonResult
    };
    return {
      result,
      rows: reportRows,
      view: "csv",
      downloadName: fileName,
      summary: `CSV ready: ${fileName}. Showing ${reportRows.length} row${reportRows.length === 1 ? "" : "s"} from synchronous report run. Salesforce returns up to 2,000 rows.`
    };
  }

  const blob = await requestReportExcel(report.id);
  const fileName = createReportFileName(report);
  const downloadUrl = createDownloadObjectUrl(blob);
  let reportRows = [];
  let previewSource = "Excel file";
  let previewWarning = "";

  try {
    reportRows = await parseReportExcelRows(blob);
  } catch (error) {
    previewWarning = `Excel file preview failed: ${formatUserFacingMessage(error instanceof Error ? error.message : String(error))}`;
    if (reportJsonResult?.error) {
      previewWarning = `${previewWarning}. JSON preview fallback failed: ${formatUserFacingMessage(reportJsonResult.error instanceof Error ? reportJsonResult.error.message : String(reportJsonResult.error))}`;
    } else {
      reportRows = normalizeReportRows(reportJsonResult);
      previewSource = "Report JSON fallback";
    }
  }

  const result = {
    reportId: report.id,
    reportName: report.name,
    exportType: "Excel",
    format: "xlsx",
    mimeType: REPORT_EXCEL_MIME,
    bytes: blob.size,
    fileName,
    openUrl: downloadUrl,
    openLabel: `Download ${fileName}`,
    downloadName: fileName,
    previewSource,
    previewRows: reportRows.length,
    previewWarning
  };

  return {
    result,
    rows: reportRows,
    view: "csv",
    openUrl: downloadUrl,
    openLabel: `Download ${fileName}`,
    downloadName: fileName,
    summary: reportRows.length
      ? `Excel ready: ${fileName}. Showing ${reportRows.length} CSV grid rows from ${previewSource}.`
      : `Excel ready: ${fileName}. Download link is shown below.${previewWarning ? ` ${previewWarning}` : ""}`
  };
}

async function runExport() {
  if (!session?.host || !session?.sid) {
    setStatus(t("dataExport.status.sessionNotReady"), true);
    return;
  }

  setBusy(true);
  setStatus(t("dataExport.status.running", { method: getMethod().toUpperCase(), host: session.host }));

  try {
    const method = getMethod();
    let payload;

    setOpenUrl("");
    if (method === "soql") {
      payload = await executeSoql();
    } else if (method === "sosl") {
      payload = await executeSosl();
    } else if (method === "graphql") {
      payload = await executeGraphQuery();
    } else if (method === "report") {
      payload = await executeReportExport();
    } else {
      throw new Error(`Unsupported export method: ${method}`);
    }

    setResult(payload.result, payload.rows, {
      view: payload.view,
      summary: payload.summary,
      openUrl: payload.openUrl,
      openLabel: payload.openLabel,
      downloadName: payload.downloadName,
      details: payload.details
    });
    setStatus(t("dataExport.status.connected", { host: session.host }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setOpenUrl("");
    setStatus(message, true);
    setResponseSummary(message, true);
  } finally {
    setBusy(false);
  }
}

async function copyCurrentView() {
  const text = currentView === "json" ? lastJsonText : lastCsvText;
  if (!text) {
    setResponseSummary("Nothing to copy.", true);
    return;
  }

  await navigator.clipboard.writeText(text);
  setResponseSummary(currentView === "json" ? "JSON copied." : "CSV copied.");
}

function getCsvDownloadFileName() {
  const sourceName = lastDownloadName || `${getTargetName("salesforce-export")}.csv`;
  return sourceName.replace(/\.[^.]+$/, "") + ".csv";
}

function downloadCurrentCsv() {
  if (!lastCsvText || !lastRows.length) {
    setResponseSummary("No CSV rows to download.", true);
    return;
  }

  const url = URL.createObjectURL(new Blob([lastCsvText], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = getCsvDownloadFileName();
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  setResponseSummary(`CSV download ready: ${link.download}`);
}

async function loadObjectSuggestions() {
  try {
    const result = await salesforceRequest(
      session.host,
      session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects`
    );
    sobjectInfos = (result?.sobjects || [])
      .filter((item) => item?.name)
      .map((item) => ({
        name: item.name,
        label: item.label || item.name
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    populateTargetOptions();
    loadFieldSuggestions();
  } catch (_error) {
    sobjectInfos = [];
  }
}

function normalizeReportInfo(report = {}, options = {}) {
  const id = report.Id || report.id || report.reportId;
  const name = report.Name || report.name || report.label || report.DeveloperName || id;
  return {
    id,
    name,
    developerName: report.DeveloperName || report.developerName || report.name,
    label: [id, report.FolderName || report.folderName || options.sourceLabel].filter(Boolean).join(" - "),
    known: true,
    source: options.source || report.source || ""
  };
}

function dedupeReports(reports) {
  return dedupeAssets(reports);
}

function dedupeAssets(assets) {
  const byId = new Map();
  const result = [];

  assets.forEach((asset) => {
    if (!asset?.id) {
      return;
    }
    if (byId.has(asset.id)) {
      const existing = byId.get(asset.id);
      existing.name = existing.name || asset.name;
      existing.developerName = existing.developerName || asset.developerName;
      existing.label = [existing.label, asset.label].filter(Boolean).join(" / ");
      existing.source = [...new Set([existing.source, asset.source].filter(Boolean))].join(",");
      return;
    }
    byId.set(asset.id, asset);
    result.push(asset);
  });

  return result.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadReportSuggestionsFromSoql() {
  const query = [
    "SELECT Id, Name, DeveloperName, FolderName",
    "FROM Report",
    "ORDER BY Name",
    "LIMIT 2000"
  ].join(" ");
  const rows = await runSoqlAll(session.host, session.sid, query);
  return rows.map((row) => normalizeReportInfo(row, {
    source: "soql",
    sourceLabel: "Report"
  }));
}

async function loadRecentViewedReportSuggestions() {
  const query = [
    "SELECT Id, Name, LastViewedDate",
    "FROM RecentlyViewed",
    "WHERE Type = 'Report'",
    "ORDER BY LastViewedDate DESC",
    "LIMIT 25"
  ].join(" ");
  try {
    const rows = await runSoqlAll(session.host, session.sid, query);
    return rows.map((row) => normalizeReportInfo({
      Id: row.Id,
      Name: row.Name
    }, {
      source: "recentlyViewed",
      sourceLabel: "Recently Viewed"
    }));
  } catch (_error) {
    return [];
  }
}

function extractAnalyticsReports(node, reports = []) {
  if (!node || typeof node !== "object") {
    return reports;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => extractAnalyticsReports(item, reports));
    return reports;
  }

  if ((node.id || node.reportId) && (node.name || node.label)) {
    reports.push(normalizeReportInfo(node, {
      source: "analytics",
      sourceLabel: "Analytics"
    }));
  }

  Object.values(node).forEach((value) => extractAnalyticsReports(value, reports));
  return reports;
}

async function loadReportSuggestionsFromAnalytics() {
  const result = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/analytics/reports`
  );
  return extractAnalyticsReports(result);
}

async function loadReportSuggestions() {
  const results = await Promise.allSettled([
    loadRecentViewedReportSuggestions(),
    loadReportSuggestionsFromSoql(),
    loadReportSuggestionsFromAnalytics()
  ]);
  recentViewedReportInfos = results[0].status === "fulfilled" ? dedupeReports(results[0].value) : [];
  reportInfos = dedupeReports(results.slice(1).flatMap((result) => (
    result.status === "fulfilled" ? result.value : []
  )));
  populateTargetOptions();
  updateReportFormatOptions(getMethod());
}

async function loadSuggestions() {
  await Promise.allSettled([
    loadObjectSuggestions(),
    loadReportSuggestions()
  ]);
}

async function loadSession() {
  const requestedHost = params.get("host");
  setStatus(requestedHost ? `Connecting to ${requestedHost}...` : "Finding active Salesforce session...");
  session = requestedHost ? await getSessionForHost(requestedHost) : await getActiveSession();
  if (!session?.host || !session?.sid) {
    throw new Error("No Salesforce session available.");
  }

  if (session?.host) {
    try {
      localStorage.setItem(LAST_HOST_STORAGE_KEY, session.host);
    } catch (_error) {
      // Cache is optional.
    }
  }

  setStatus(t("dataExport.status.loadingSuggestions", { host: session.host }));
  await loadSuggestions();
  setStatus(t("dataExport.status.connected", { host: session.host }));
}

methodEl.addEventListener("change", () => {
  updateMethodUi({ resetInputs: true });
});
reportFormatEl.addEventListener("change", () => {
  updateMethodUi();
  scheduleReportSettingsPreview();
});
targetNameEl.addEventListener("input", () => {
  scheduleFieldSuggestions();
  updateReportFormatOptions(getMethod());
  void updateInlineFieldSuggestions({ loadIfNeeded: true });
  scheduleReportSettingsPreview();
});
targetNameEl.addEventListener("change", () => {
  scheduleReportSettingsPreview();
});
requestBodyEl.addEventListener("input", () => {
  scheduleFieldSuggestions();
  void updateInlineFieldSuggestions({ loadIfNeeded: true });
});
requestBodyEl.addEventListener("keyup", handleRequestBodyKeyup);
requestBodyEl.addEventListener("keydown", handleRequestBodyKeydown);
requestBodyEl.addEventListener("blur", () => {
  window.setTimeout(hideInlineFieldSuggestions, 120);
});
sampleButton.addEventListener("click", () => {
  setSampleBody().catch((error) => {
    setResponseSummary(error instanceof Error ? error.message : String(error), true);
  });
});
runButton.addEventListener("click", runExport);
viewCsvButton.addEventListener("click", () => {
  currentView = "csv";
  renderCurrentView();
});
viewJsonButton.addEventListener("click", () => {
  currentView = "json";
  renderCurrentView();
});
copyButton.addEventListener("click", () => {
  copyCurrentView().catch((error) => {
    setResponseSummary(error instanceof Error ? error.message : String(error), true);
  });
});
downloadCsvButton.addEventListener("click", downloadCurrentCsv);
fieldPickerEl.addEventListener("change", () => {
  const fieldName = fieldPickerEl.value.trim();
  if (!fieldName) {
    return;
  }
  insertTextAtCursor(requestBodyEl, fieldName);
  fieldPickerEl.value = "";
  hideInlineFieldSuggestions();
  requestBodyEl.focus();
});

updateMethodUi();
setResult({ records: [], totalSize: 0, done: true }, [], {
  view: "csv",
  summary: "Run an export to see CSV grid results."
});
loadSession().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(message, true);
  setResponseSummary(message, true);
});
