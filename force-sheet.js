import { getSessionForHost, runSoql, runSoqlAll, salesforceRequest, SALESFORCE_API_VERSION, updateRecords } from "./sheetd-api.js";
import { mountAppLauncher } from "./app-launcher.js";
import { t, applyI18n, getLanguage, setLanguage, LANGUAGE_STORAGE_KEY } from "./sheetd-i18n.js";
import {
  normalizeReportRows,
  getReportTruncation,
  isJoinedReport,
  normalizeJoinedReport,
  buildJoinedMatrix,
  parseCsvText,
  csvMatrixToRows,
  parseExcelFile,
  parseExcelSheetMatrix,
  extractFormattedExcelSheet,
  stripReportExportMetadata,
} from "./force-sheet-import-utils.js";

mountAppLauncher({
  target: document.querySelector(".fs-header-right"),
  translate: t
});

// Guard Node.contains against non-Node relatedTarget values.
// In Chrome extension pages the mouseleave relatedTarget can be a non-Node
// object (e.g. when the pointer crosses into the browser chrome or a shadow
// boundary), causing Univer's onMouseLeave handler to throw.
// Returning false is the correct semantic: the pointer did not move into a child.
(function () {
  const _contains = Node.prototype.contains;
  Node.prototype.contains = function (other) {
    if (other == null || !(other instanceof Node)) return false;
    return _contains.call(this, other);
  };
})();

// ── DOM refs ───────────────────────────────────────────────────────────────

const statusEl           = document.getElementById("fs-status");
const resumeBtn          = document.getElementById("fs-resume");
const stopBtn            = document.getElementById("fs-stop");
const refreshBtn         = document.getElementById("fs-refresh");
const refreshLabelEl     = document.getElementById("fs-refresh-label");
const sheetEmptyEl       = document.getElementById("fs-sheet-empty");
const sheetContainerEl   = document.getElementById("fs-sheet-container");
const navBarEl           = document.getElementById("fs-nav-bar");
const leftPanelEl        = document.getElementById("fs-left-panel");
const panelWorkspaceEl   = document.getElementById("fs-panel-workspace");
const panelImportEl      = document.getElementById("fs-panel-import");
const auditNavBtn        = document.getElementById("fs-nav-audit");
const settingsNavBtn     = document.getElementById("fs-settings");
const settingsModalEl    = document.getElementById("fs-settings-modal");
const settingsLanguageEl = document.getElementById("fs-settings-language");
const settingsCloseBtn   = document.getElementById("fs-settings-close");
const settingsCancelBtn  = document.getElementById("fs-settings-cancel");
const settingsSaveBtn    = document.getElementById("fs-settings-save");
// File details (right-hand panel)
const detailsEl          = document.getElementById("fs-details");
const detailsTitleEl     = document.getElementById("fs-details-title");
const detailsBodyEl      = document.getElementById("fs-details-body");
const detailsCloseBtn    = document.getElementById("fs-details-close");
const detailsToggleBtn   = document.getElementById("fs-details-toggle");
// Query
const soqlBarEl          = document.getElementById("fs-soql-bar");
const soqlInputEl        = document.getElementById("fs-soql-input");
const soqlRunBtn         = document.getElementById("fs-soql-run");
// Report
const reportBarEl        = document.getElementById("fs-report-bar");
const reportInputEl      = document.getElementById("fs-report-input");
const reportRunBtn       = document.getElementById("fs-report-run");
// Upload
const uploadBarEl        = document.getElementById("fs-upload-bar");
const uploadInputEl      = document.getElementById("fs-upload-input");
const uploadLoadBtn      = document.getElementById("fs-upload-load");
const uploadFilenameEl   = document.getElementById("fs-upload-filename");

// Feat 0006: object + field pickers
const objectInputEl        = document.getElementById("fs-object-input");
const fieldInputEl         = document.getElementById("fs-field-input");
const soqlFieldSuggestEl   = document.getElementById("fs-soql-field-suggestions");
// WS3: error banner, stale-org chip, in-grid loading
const errorBannerEl        = document.getElementById("fs-error-banner");
const errorMessageEl       = document.getElementById("fs-error-message");
const errorDetailEl        = document.getElementById("fs-error-detail");
const errorRetryBtn        = document.getElementById("fs-error-retry");
const errorDismissBtn      = document.getElementById("fs-error-dismiss");
const orgChipEl            = document.getElementById("fs-org-chip");
const connectionEl         = document.getElementById("fs-connection");
const loadingOverlayEl     = document.getElementById("fs-loading-overlay");
const loadingTextEl        = document.getElementById("fs-loading-text");
// Feat 0008: Workspace
const uploadTargetEl       = document.getElementById("fs-upload-target");
const queryTargetEl        = document.getElementById("fs-query-target");
const reportTargetEl       = document.getElementById("fs-report-target");
const wsTreeEl             = document.getElementById("fs-ws-tree");
const wsFilterEl           = document.getElementById("fs-ws-filter");
const wsFilterSpinnerEl    = document.getElementById("fs-ws-filter-spinner");
const wsSearchBtn          = document.getElementById("fs-ws-search");
const wsClearSearchBtn     = document.getElementById("fs-ws-clear");
const wsCloseBtn           = document.getElementById("fs-ws-close");
const wsHandleEl           = document.getElementById("fs-ws-handle");
const breadcrumbEl         = document.getElementById("fs-breadcrumb");
// Object write-back action bar (header) — shown for Objects browse sheets
const objActionsEl         = document.getElementById("fs-obj-actions");
const objPicklistWrap      = document.getElementById("fs-obj-picklist-wrap");
const objPicklistLabel     = document.getElementById("fs-obj-picklist-label");
const objPicklistSel       = document.getElementById("fs-obj-picklist");

// ── State ──────────────────────────────────────────────────────────────────

let session          = null;
let running          = false;
let streamController = null;
let streamSheetId    = null;

// Feat 0006: caches
let objectCache = null; // null = not yet loaded
const fieldDescribeCache = new Map();
const fieldDescribeLoadPromises = new Map();

// Object chosen via the object picker (not hand-typed). When set and the query
// still targets this object, Run opens the result as an editable object sheet
// (View/Edit + Update) instead of a plain query. Cleared when the user
// hand-edits the SOQL.
let objectPickerName = null;

// Feat 0006: inline SOQL suggestion state
let inlineSugItems = [];
let inlineSugIndex = 0;
let inlineSugToken = null;
let inlineSugReqId = 0;
let inlineSugTimer = 0;

// Nav panel state
let currentPanel = null; // overlay panel starts closed — sheet-first layout

// ── Sheet source tagging ──
// Every sheet is editable. We only track where a sheet's data came from so the
// Objects browse view can offer Salesforce write-back while
// reports, files, queries, and uploads stay local. State is in-memory —
// browse views are ephemeral, so nothing persists in the workspace snapshot.
const sheetSource = new Map();      // sheetId -> "object" | "report" | "query" | "upload" | "audit"

// ── Objects/Reports browse mode (per browse sheet) ──
// Objects and Reports open read-only by default (mode "view"): cell A1 holds a
// live =SF_QUERY / =SF_REPORT formula that spills the data. The header toggle
// switches a sheet to editable static data (mode "edit"). Kept in-memory only.
// Map<sheetId, { kind:"object"|"report", mode:"view"|"edit",
//   objectName?, listViewId?, label?, soql?, reportId?, reportName?, folder? }>
const browseMeta = new Map();

// ── Objects write-back edit metadata (per object browse sheet, edit mode) ──
// Map<sheetId, { objectName, columns, ids, original, dirtyRows:Set }>
// `original` is the field-cell matrix captured right after render, so edits diff
// exactly against what the grid shows.
const objEditMeta = new Map();

// Successful Salesforce updates are retained as compact, per-org rollback
// receipts. Only changed values are stored, and the persisted history is
// bounded so it cannot grow into the workspace-storage problem this app
// intentionally removed.
const AUDIT_MAX_ENTRIES = 50;
const AUDIT_MAX_BYTES = 2 * 1024 * 1024;
let auditEntries = [];
let auditSheetId = null;

// Feat 0009: Workspace data
const wsData = { version: 1, tree: [] };
const wsFileSheetIds = new Map();
const wsSheetFileIds = new Map();
const wsFileTabIds = new Map();

// Per-sheet state. Map<sheetId, { mode, soql, reportId, reportName, fileName,
//   columns, rowCount, totalSize, done, nextRecordsUrl, updatedAt, host }>
const sheetStates = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function getActiveSheetId() {
  return window.QDBSheet?.getActiveSheetId() ?? null;
}

function getActiveState() {
  const id = getActiveSheetId();
  return id ? sheetStates.get(id) : null;
}

function setSheetEditableIfActive(sheetId, editable) {
  if (sheetId && getActiveSheetId() === sheetId) {
    window.QDBSheet?.setEditable?.(editable);
  }
}

function getOrCreateState(sheetId) {
  if (!sheetStates.has(sheetId)) {
    sheetStates.set(sheetId, {
      mode: "query",
      soql: "",
      reportId: "",
      reportName: "",
      fileName: "",
      columns: [],
      objectApiName: "",
      objectName: "",
      importTarget: "current-sheet",
      writeback: false,
      rowCount: 0,
      totalSize: 0,
      done: true,
      nextRecordsUrl: null,
      updatedAt: null,
      host: "",
    });
  }
  return sheetStates.get(sheetId);
}

function extractColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(k => k !== "attributes");
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

// Report/CSV/XLSX parsing lives in force-sheet-import-utils.js (pure, testable,
// no DOM/state) — imported at the top of this file.

// ── UI updates ─────────────────────────────────────────────────────────────

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = "fs-status" + (isError ? " error" : "");
}

// The JSON report API caps results at 2,000 rows, but the same endpoint hands
// back the whole report as a workbook when asked for one via Accept. That is a
// supported REST export on the normal bearer session — the same call the Data
// Export page makes — so it needs no cookie and no UI endpoint. It renders the
// report as configured (groupings and subtotals included), and it is the only
// export format joined reports support.
//
// Returns null whenever the export is unavailable, so callers fall back to the
// capped rows plus the truncation warning rather than showing nothing.
const REPORT_EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function fetchReportExportMatrix(host, sid, reportId, reportResult = {}) {
  if (!host || !sid || !reportId) return null;
  try {
    const response = await fetch(
      `https://${host}/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${sid}`, Accept: REPORT_EXCEL_MIME } });
    if (!response.ok) return null;
    // A refused export answers with a JSON error rather than a workbook.
    if ((response.headers.get("content-type") || "").toLowerCase().includes("application/json")) return null;
    const source = await response.arrayBuffer();
    const matrix = stripReportExportMetadata(
      await parseExcelSheetMatrix(source),
      reportResult
    );
    if (matrix.length) matrix.formattedSheet = await extractFormattedExcelSheet(source).catch(() => null);
    return matrix.length ? matrix : null;
  } catch (_) {
    return null;
  }
}

// Which org this page is connected to, parked in the header so it survives the
// status line being overwritten by every subsequent message. Shows the host
// immediately, then upgrades to the org's real name once Salesforce answers —
// the name is far more recognisable than a my.salesforce.com subdomain.
async function showConnectedOrg(host) {
  if (!connectionEl || !host) return;
  connectionEl.textContent = t("forceSheet.connectedTo", { org: host });
  connectionEl.title = host;
  connectionEl.hidden = false;
  try {
    const result = await runSoql(session.host, session.sid,
      "SELECT Name, IsSandbox FROM Organization LIMIT 1");
    const org = result.records?.[0];
    if (!org?.Name || connectionEl.hidden) return;
    connectionEl.textContent = t("forceSheet.connectedTo", {
      org: org.IsSandbox ? `${org.Name} (sandbox)` : org.Name,
    });
    connectionEl.title = host;
  } catch (_) {
    // Keep the host label — the connection itself is still good.
  }
}

// Report results are capped at 2,000 rows by Salesforce. When that happened,
// say so instead of reporting the short count as if it were the whole report.
function setReportStatus(result, loadedMessage, count) {
  const truncation = getReportTruncation(result);
  if (!truncation) {
    setStatus(loadedMessage);
    return;
  }
  setStatus(truncation.total === null
    ? t("forceSheet.status.reportTruncatedUnknown", { count: count.toLocaleString() })
    : t("forceSheet.status.reportTruncated", {
        count: count.toLocaleString(), total: truncation.total.toLocaleString(),
      }), true);
}

// Full-message error surface (the header status truncates long SF errors).
function showError(message, { detail = "", onRetry = null } = {}) {
  if (!errorBannerEl) return;
  errorMessageEl.textContent = message;
  errorDetailEl.textContent = detail;
  errorDetailEl.hidden = !detail;
  errorRetryBtn.hidden = !onRetry;
  errorRetryBtn.onclick = onRetry ? () => { clearError(); onRetry(); } : null;
  errorBannerEl.hidden = false;
}

function clearError() {
  if (errorBannerEl) errorBannerEl.hidden = true;
}

function showLoading(text) {
  if (!loadingOverlayEl) return;
  loadingTextEl.textContent = text;
  loadingOverlayEl.hidden = false;
}

function hideLoading() {
  if (loadingOverlayEl) loadingOverlayEl.hidden = true;
}

// Opens the overlay panel showing `panelId`. The panel slides OVER the sheet
// (the sheet keeps full width underneath). Esc / re-clicking the active rail
// icon / closePanel() dismisses it — nothing else force-opens it.
function switchPanel(panelId) {
  currentPanel = panelId;
  panelWorkspaceEl.hidden = panelId !== "workspace";
  panelImportEl.hidden    = panelId !== "import";
  leftPanelEl.hidden  = false;
  wsHandleEl.hidden   = false;
  navBarEl.querySelectorAll(".fs-nav-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.panel === panelId);
  });
}

function syncAuditNav() {
  if (!auditNavBtn || currentPanel) return;
  auditNavBtn.classList.toggle("active", sheetSource.get(getActiveSheetId()) === "audit");
}

function closePanel() {
  const openMenu = document.querySelector(".fs-ws-menu");
  if (typeof openMenu?._wsClose === "function") openMenu._wsClose(false);
  else openMenu?.remove();
  currentPanel = null;
  leftPanelEl.hidden = true;
  wsHandleEl.hidden  = true;
  navBarEl.querySelectorAll(".fs-nav-tab").forEach(btn => btn.classList.remove("active"));
  syncAuditNav();
}

function renderSheet() {
  const sheetId = getActiveSheetId();
  const state = sheetId ? sheetStates.get(sheetId) : null;
  const isStreaming = streamSheetId !== null && streamSheetId === sheetId;
  const mode = state?.mode ?? "query";
  const hasSession = !!session?.host && !!session?.sid;

  if (!sheetId) {
    soqlBarEl.hidden = true;
    reportBarEl.hidden = true;
    uploadBarEl.hidden = true;
    return;
  }

  stopBtn.hidden = !isStreaming;
  refreshBtn.hidden = !state || isStreaming || mode === "upload" || mode === "audit";
  syncAuditNav();

  // Org chip: which org this sheet's data came from — highlighted when it
  // differs from the connected org (was previously only a refresh tooltip).
  if (orgChipEl) {
    const chipStale = state?.host && session?.host && state.host !== session.host;
    if (state?.host) {
      orgChipEl.textContent = chipStale
        ? t("forceSheet.orgChip.stale", { host: state.host })
        : t("forceSheet.orgChip.current", { host: state.host });
      orgChipEl.classList.toggle("stale", Boolean(chipStale));
      orgChipEl.title = state.updatedAt ? formatTimestamp(state.updatedAt) : "";
      orgChipEl.hidden = false;
    } else {
      orgChipEl.hidden = true;
    }
  }

  // Import sub-tab highlight
  panelImportEl.querySelectorAll(".fs-mode-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  // Show only the active input bar
  soqlBarEl.hidden = mode !== "query";
  reportBarEl.hidden = mode !== "report";
  uploadBarEl.hidden = mode !== "upload";

  if (mode === "query") {
    if (!state) {
      resumeBtn.hidden = true;
      refreshBtn.title = t("common.refresh");
      soqlInputEl.value = "";
      soqlRunBtn.disabled = running || isStreaming || !hasSession;
      return;
    }
    const isStale = state.host && session?.host && state.host !== session.host;
    refreshBtn.title = isStale
      ? t("forceSheet.staleOrgRefreshTitle", { host: state.host })
      : (state.updatedAt ? formatTimestamp(state.updatedAt) + " · " + (state.host || "") : t("common.refresh"));
    resumeBtn.hidden = !((!isStreaming && !state.done && !!state.nextRecordsUrl && hasSession));
    soqlInputEl.value = state.soql || "";
    soqlRunBtn.disabled = running || isStreaming || !hasSession;
  } else if (mode === "report") {
    resumeBtn.hidden = true;
    if (state) {
      refreshBtn.title = state.updatedAt ? formatTimestamp(state.updatedAt) + " · " + (state.host || "") : t("common.refresh");
      reportInputEl.value = state.reportName || state.reportId || "";
    } else {
      refreshBtn.title = t("common.refresh");
      reportInputEl.value = "";
    }
    reportRunBtn.disabled = running || !hasSession;
  } else if (mode === "upload") {
    resumeBtn.hidden = true;
  }
}

// ── Mode switching ──────────────────────────────────────────────────────────

function switchMode(newMode) {
  const sheetId = getActiveSheetId();
  if (!sheetId) return;
  const state = getOrCreateState(sheetId);

  // Save current input values into state before switching
  if (state.mode === "query") state.soql = soqlInputEl.value;
  if (state.mode === "report") {
    state.reportName = reportInputEl.value;
    if (!state.reportId) state.reportId = reportInputEl.value;
  }

  state.mode = newMode;
  renderSheet();
}

// ── Streaming ──────────────────────────────────────────────────────────────

function stopStream() {
  if (streamController) { streamController.abort(); streamController = null; }
  streamSheetId = null;
}

async function streamPages(sheetId, columns, state, isOwned = () => true) {
  if (streamController) streamController.abort();
  streamController = new AbortController();
  streamSheetId = sheetId;
  const { signal } = streamController;
  const isActive = () => isOwned() && getActiveSheetId() === sheetId;

  if (isActive()) { stopBtn.hidden = false; resumeBtn.hidden = true; refreshBtn.hidden = true; soqlRunBtn.disabled = true; }

  try {
    while (isOwned() && !state.done && state.nextRecordsUrl && !signal.aborted) {
      const raw = state.nextRecordsUrl;
      const path = raw.startsWith("/") ? raw : new URL(raw).pathname + new URL(raw).search;
      let result;
      try {
        result = await salesforceRequest(session.host, session.sid, path, { signal });
      } catch (err) {
        if (signal.aborted || err?.name === "AbortError") break;
        throw err;
      }
      if (signal.aborted || !isOwned()) break;
      const batch = Array.isArray(result.records) ? result.records : [];
      state.rowCount += batch.length;
      state.done = result.done !== false;
      state.nextRecordsUrl = result.nextRecordsUrl || null;
      window.QDBSheet.append(sheetId, columns, batch);
      if (isActive()) {
        showLoading(t("forceSheet.status.streaming", { fetched: state.rowCount.toLocaleString(), total: (state.totalSize || 0).toLocaleString() }));
      }
    }

    if (!isOwned()) return;
    if (!signal.aborted) {
      state.updatedAt = new Date().toISOString();
      if (isActive()) {
        refreshBtn.title = formatTimestamp(state.updatedAt) + " · " + (state.host || "");
        setStatus(t("forceSheet.status.loaded", { count: state.rowCount.toLocaleString() }));
      }
    } else {
      if (isActive()) setStatus(t("forceSheet.status.stopped", { fetched: state.rowCount.toLocaleString(), total: (state.totalSize || 0).toLocaleString() }));
    }
  } catch (err) {
    if (isActive()) {
      const message = err?.message || t("forceSheet.status.streamError");
      setStatus(message, true);
      showError(message, { detail: state.soql || "" });
    }
  } finally {
    streamController = null;
    streamSheetId = null;
    if (isActive()) {
      hideLoading();
      stopBtn.hidden = true;
      refreshBtn.hidden = false;
      soqlRunBtn.disabled = !session?.host || !session?.sid;
      resumeBtn.hidden = !(!state.done && !!state.nextRecordsUrl);
    }
  }
}

// ── Run SOQL ───────────────────────────────────────────────────────────────

async function runQuery(options = {}) {
  const {
    sheetId: requestedSheetId = null,
    forceCurrentSheet = false,
    autoSave = true,
    preserveBreadcrumb = false,
    isCurrent: suppliedIsCurrent = null,
  } = options || {};
  const isCurrent = typeof suppliedIsCurrent === "function" ? suppliedIsCurrent : () => true;
  let sheetId = requestedSheetId || getActiveSheetId();
  const soql = soqlInputEl.value.trim();
  if (!soql || !sheetId || running || streamController || !session?.host || !session?.sid) return;

  running = true;
  soqlRunBtn.disabled = true;
  clearError();
  setStatus(t("forceSheet.status.running"));
  showLoading(t("forceSheet.status.running"));

  try {
    if (!forceCurrentSheet && queryTargetEl?.value === "new-sheet") {
      sheetId = window.QDBSheet?.addSheet?.(t("dinaSheet.sheet.query")) || sheetId;
    }
    tagSheetSource(sheetId, "query"); // manual query — editable
    window.QDBSheet?.setEditable?.(true); // in case a locked read-only view was active
    const result = await runSoql(session.host, session.sid, soql);
    if (!isCurrent()) return;
    const rows = Array.isArray(result.records) ? result.records : [];
    const columns = extractColumns(rows);

    const state = getOrCreateState(sheetId);
    state.mode = "query";
    state.soql = soql;
    state.columns = columns;
    state.rowCount = rows.length;
    state.totalSize = result.totalSize ?? rows.length;
    state.nextRecordsUrl = result.nextRecordsUrl || null;
    state.done = result.done !== false;
    state.updatedAt = new Date().toISOString();
    state.host = session.host;
    state.importTarget = forceCurrentSheet ? "current-sheet" : (queryTargetEl?.value || "current-sheet");

    // Any query import with Id can use the reviewed Update flow. The FROM
    // object is authoritative even when the SOQL was typed by hand.
    const fromObj = getQueryObjectName(soql);
    if (!preserveBreadcrumb) setBreadcrumb([fromObj || t("dinaSheet.sheet.query")]);
    if (state.done && fromObj && columns.some(c => c.toLowerCase() === "id")) {
      browseMeta.set(sheetId, { kind: "import", importMode: "query", objectName: fromObj, label: fromObj, soql });
      const data = await buildObjectEditData(fromObj, rows, soql);
      if (!isCurrent()) return;
      state.columns = data.columns;
      renderObjectSheet(sheetId, data, { source: "query" });
      state.objectName = fromObj;
      state.writeback = data.hasId;
      hideLoading();
      setStatus(t("forceSheet.status.loaded", { count: rows.length.toLocaleString() }));
      renderSheet();
      if (autoSave) wsAutoSaveOpenFile();
      syncFileDetails();
      return;
    }
    state.objectName = fromObj || "";
    state.writeback = false;
    browseMeta.set(sheetId, { kind: "import", importMode: "query", objectName: fromObj || "", label: fromObj || t("dinaSheet.sheet.query"), soql });

    window.QDBSheet.render(sheetId, columns, rows);

    if (!state.done && state.nextRecordsUrl) {
      const streamingText = t("forceSheet.status.streaming", { fetched: rows.length.toLocaleString(), total: state.totalSize.toLocaleString() });
      setStatus(streamingText);
      showLoading(streamingText);
      void streamPages(sheetId, columns, state, isCurrent);
    } else {
      hideLoading();
      setStatus(t("forceSheet.status.loaded", { count: rows.length.toLocaleString() }));
    }
    renderSheet();
    if (autoSave) wsAutoSaveOpenFile();
    syncFileDetails();
  } catch (err) {
    hideLoading();
    const message = err?.message || t("forceSheet.status.queryFailed");
    setStatus(message, true);
    showError(message, { detail: soql, onRetry: () => void runQuery(options) });
  } finally {
    running = false;
    soqlRunBtn.disabled = !!streamController || !session?.host || !session?.sid;
  }
}

// ── Run Report ─────────────────────────────────────────────────────────────

async function runReport() {
  let sheetId = getActiveSheetId();
  const input = reportInputEl.value.trim();
  if (!input || !sheetId || running || !session?.host || !session?.sid) return;

  running = true;
  reportRunBtn.disabled = true;
  clearError();
  setStatus(t("forceSheet.status.running"));
  showLoading(t("forceSheet.status.running"));

  try {
    if (reportTargetEl?.value === "new-sheet") {
      sheetId = window.QDBSheet?.addSheet?.(t("dinaSheet.sheet.report")) || sheetId;
    }
    tagSheetSource(sheetId, "report");
    window.QDBSheet?.setEditable?.(true); // in case a locked read-only view was active
    // Resolve name → ID if not already an SF ID (starts with 00O).
    // Prefer the preloaded all-reports cache (R5); fall back to the
    // analytics search endpoint.
    let reportId = input;
    let reportName = input;
    if (!/^00O/i.test(input)) {
      const needle = input.toLowerCase();
      const cached = (await loadAllReports()).find(r =>
        r.name.toLowerCase() === needle || r.developerName.toLowerCase() === needle);
      if (cached) {
        reportId = cached.id;
        reportName = cached.name;
        reportInputEl.value = reportName;
      } else {
        const search = await salesforceRequest(session.host, session.sid,
          `/services/data/${SALESFORCE_API_VERSION}/analytics/reports?pageSize=1&searchParam=${encodeURIComponent(input)}`);
        if (search.reports?.length) {
          reportId = search.reports[0].id;
          reportName = search.reports[0].name;
          reportInputEl.value = reportName;
        }
      }
    }

    const result = await salesforceRequest(session.host, session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}?includeDetails=true`);
    if (result?.reportMetadata?.name) {
      reportName = result.reportMetadata.name;
      reportInputEl.value = reportName;
    }
    setBreadcrumb([reportName || reportId], { kind: "report", reportId });

    const state = getOrCreateState(sheetId);
    state.mode = "report";
    state.reportId = reportId;
    state.reportName = reportName;
    state.done = true;
    state.nextRecordsUrl = null;
    state.updatedAt = new Date().toISOString();
    state.host = session.host;
    state.importTarget = reportTargetEl?.value || "current-sheet";
    browseMeta.set(sheetId, { kind: "report", reportId, reportName, folder: "" });

    // Past 2,000 rows the JSON result is short, so take the workbook export
    // instead — it covers joined reports too, which is the only export format
    // they support. Falls through to the capped rows when it isn't available.
    const exported = getReportTruncation(result)
      ? await fetchReportExportMatrix(session.host, session.sid, reportId, result)
      : null;

    if (exported) {
      const exportedRows = Math.max(0, exported.length - 1);
      state.columns = []; // workbook layout — no single uniform column set
      state.rowCount = exportedRows;
      state.totalSize = exportedRows;
      const writeback = await renderImportedMatrix(sheetId, exported, { source: "report" });
      state.objectName = writeback.objectName;
      state.writeback = writeback.writeback;
      setStatus(t("forceSheet.status.reportExported", { count: exportedRows.toLocaleString() }));
    } else if (isJoinedReport(result)) {
      // Joined (multi-block) reports have per-block columns — render each block
      // as its own table stacked in one sheet (divider + headers + rows).
      const blocks = normalizeJoinedReport(result);
      const totalRows = blocks.reduce((n, b) => n + b.rows.length, 0);
      state.columns = []; // ragged layout — no single uniform column set
      state.rowCount = totalRows;
      state.totalSize = totalRows;
      objEditMeta.delete(sheetId);
      window.QDBSheet.renderMatrix(sheetId, buildJoinedMatrix(blocks));
      state.objectName = "";
      state.writeback = false;
      setReportStatus(result, t("forceSheet.status.joinedLoaded", { blocks: blocks.length, count: totalRows.toLocaleString() }), totalRows);
    } else {
      const rows = normalizeReportRows(result);
      const columns = rows.length ? Object.keys(rows[0]) : [];
      state.columns = columns;
      state.rowCount = rows.length;
      state.totalSize = rows.length;
      const matrix = [columns, ...rows.map(row => columns.map(column => row[column] ?? ""))];
      const writeback = await renderImportedMatrix(sheetId, matrix, { source: "report" });
      state.objectName = writeback.objectName;
      state.writeback = writeback.writeback;
      setReportStatus(result, t("forceSheet.status.reportLoaded", { count: rows.length.toLocaleString() }), rows.length);
    }
    renderSheet();
    wsAutoSaveOpenFile();
    syncFileDetails();
  } catch (err) {
    const message = err?.message || t("forceSheet.status.reportFailed");
    setStatus(message, true);
    showError(message, { detail: input, onRetry: () => void runReport() });
  } finally {
    hideLoading();
    running = false;
    reportRunBtn.disabled = !session?.host || !session?.sid;
  }
}

// ── Load File ──────────────────────────────────────────────────────────────

async function loadFile() {
  const file = uploadInputEl.files?.[0];
  if (!file || !getActiveSheetId() || running) return;

  running = true;
  uploadLoadBtn.disabled = true;
  setStatus(t("forceSheet.status.running"));

  try {
    let columns, rows;
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv") {
      const text = await file.text();
      ({ columns, rows } = csvMatrixToRows(parseCsvText(text)));
    } else {
      ({ columns, rows } = await parseExcelFile(await file.arrayBuffer()));
    }

    // Upload target: current sheet / new sheet (the "new file" option was
    // removed in UX round 3). Sheet created only after a successful parse.
    const target = uploadTargetEl?.value || "current-sheet";
    let sheetId = getActiveSheetId();
    if (target === "new-sheet") {
      const newId = window.QDBSheet?.addSheet?.(file.name);
      if (newId) sheetId = newId;
    }
    window.QDBSheet?.setEditable?.(true); // in case a locked read-only view was active

    const state = getOrCreateState(sheetId);
    state.mode = "upload";
    state.fileName = file.name;
    state.columns = columns;
    state.rowCount = rows.length;
    state.totalSize = rows.length;
    state.done = true;
    state.nextRecordsUrl = null;
    state.updatedAt = new Date().toISOString();
    state.host = session?.host || "";
    state.importTarget = target;

    browseMeta.set(sheetId, { kind: "import", importMode: "upload", fileName: file.name, label: file.name });
    const matrix = [columns, ...rows.map(row => columns.map(column => row[column] ?? ""))];
    const writeback = await renderImportedMatrix(sheetId, matrix, { source: "upload" });
    state.objectName = writeback.objectName;
    state.writeback = writeback.writeback;
    setBreadcrumb([file.name]);
    setStatus(t("forceSheet.status.uploadLoaded", { count: rows.length.toLocaleString(), file: file.name }));
    renderSheet();
    // addSheet may reveal this local Import card before object resolution has
    // completed. Refresh the same logical card once with its final local state;
    // other file details retain normal same-key request deduplication.
    syncFileDetails({ force: true });
  } catch (err) {
    const message = err?.message || t("forceSheet.status.uploadFailed");
    setStatus(message, true);
    showError(message, { detail: file.name });
  } finally {
    running = false;
    uploadLoadBtn.disabled = false;
  }
}

// ── Report autocomplete ────────────────────────────────────────────────────

// R5 (UX round 2): preload ALL reports once; suggestions match name, Id, or
// developer name from the cached list.
let allReportsCache = null;
let allReportsLoadError = null;
async function loadAllReports({ throwOnError = false } = {}) {
  if (allReportsCache !== null) {
    if (throwOnError && allReportsLoadError) throw allReportsLoadError;
    return allReportsCache;
  }
  if (!session?.host || !session?.sid) return [];
  try {
    // Page through every report instead of capping the query. A single 2000-row
    // batch silently drops whole folders in report-heavy orgs: ordered by folder
    // name, the tail of the alphabet is cut off, which is how the Public and
    // Private buckets went missing in an org with 3,000+ reports.
    const records = await runSoqlAll(session.host, session.sid,
      "SELECT Id, Name, DeveloperName, FolderName, OwnerId FROM Report ORDER BY FolderName, Name");
    allReportsCache = records.map(r => ({
      id: r.Id, name: r.Name, developerName: r.DeveloperName || "", folderName: r.FolderName || "",
      ownerId: r.OwnerId || "",
    }));
    allReportsLoadError = null;
  } catch (error) {
    allReportsCache = [];
    allReportsLoadError = error instanceof Error ? error : new Error(String(error || "Report load failed"));
    if (throwOnError) throw allReportsLoadError;
  }
  return allReportsCache;
}

async function getReportSuggestions(term = "") {
  const reports = await loadAllReports();
  const needle = term.toLowerCase();
  return reports
    .filter(r => !needle
      || r.name.toLowerCase().includes(needle)
      || r.id.toLowerCase().includes(needle)
      || r.developerName.toLowerCase().includes(needle))
    .map(r => ({ value: r.name, name: r.name, meta: `${r.developerName ? r.developerName + " · " : ""}${r.id}`, id: r.id }));
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refreshTab() {
  const sheetId = getActiveSheetId();
  const state = sheetStates.get(sheetId);
  if (!state || !session?.host || !session?.sid || streamController) return;

  if (state.mode === "report") {
    if (!state.reportId) return;
    reportRunBtn.disabled = true;
    refreshBtn.disabled = true;
    refreshBtn.title = t("forceSheet.refreshing");
    try {
      const result = await salesforceRequest(session.host, session.sid,
        `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(state.reportId)}?includeDetails=true`);
      state.updatedAt = new Date().toISOString();
      const exported = getReportTruncation(result)
        ? await fetchReportExportMatrix(session.host, session.sid, state.reportId, result)
        : null;
      if (exported) {
        const exportedRows = Math.max(0, exported.length - 1);
        state.columns = [];
        state.rowCount = exportedRows;
        state.totalSize = exportedRows;
        const writeback = await renderImportedMatrix(sheetId, exported, { source: "report" });
        state.objectName = writeback.objectName;
        state.writeback = writeback.writeback;
        setStatus(t("forceSheet.status.reportExported", { count: exportedRows.toLocaleString() }));
      } else if (isJoinedReport(result)) {
        const blocks = normalizeJoinedReport(result);
        const totalRows = blocks.reduce((n, b) => n + b.rows.length, 0);
        state.columns = [];
        state.rowCount = totalRows;
        state.totalSize = totalRows;
        objEditMeta.delete(sheetId);
        window.QDBSheet.renderMatrix(sheetId, buildJoinedMatrix(blocks));
        state.objectName = "";
        state.writeback = false;
        setReportStatus(result, t("forceSheet.status.joinedLoaded", { blocks: blocks.length, count: totalRows.toLocaleString() }), totalRows);
      } else {
        const rows = normalizeReportRows(result);
        const columns = rows.length ? Object.keys(rows[0]) : [];
        state.columns = columns;
        state.rowCount = rows.length;
        state.totalSize = rows.length;
        const matrix = [columns, ...rows.map(row => columns.map(column => row[column] ?? ""))];
        const writeback = await renderImportedMatrix(sheetId, matrix, { source: "report" });
        state.objectName = writeback.objectName;
        state.writeback = writeback.writeback;
        setReportStatus(result, t("forceSheet.status.reportLoaded", { count: rows.length.toLocaleString() }), rows.length);
      }
      renderSheet();
      syncFileDetails();
    } catch (err) {
      setStatus(err?.message || t("forceSheet.status.reportFailed"), true);
      refreshBtn.title = t("forceSheet.error");
    } finally {
      reportRunBtn.disabled = false;
      refreshBtn.disabled = false;
    }
    return;
  }

  if (!state.soql) return;
  refreshBtn.disabled = true;
  refreshBtn.title = t("forceSheet.refreshing");
  try {
    const result = await runSoql(session.host, session.sid, state.soql);
    const rows = Array.isArray(result.records) ? result.records : [];
    const columns = extractColumns(rows);
    state.columns = columns;
    state.rowCount = rows.length;
    state.totalSize = result.totalSize ?? rows.length;
    state.nextRecordsUrl = result.nextRecordsUrl || null;
    state.done = result.done !== false;
    state.updatedAt = new Date().toISOString();
    state.host = session.host;
    const objectName = state.objectName || getQueryObjectName(state.soql);
    if (objectName && columns.some(column => column.toLowerCase() === "id")) {
      const data = await buildObjectEditData(objectName, rows, state.soql);
      state.columns = data.columns;
      browseMeta.set(sheetId, { kind: "import", importMode: "query", objectName, label: objectName, soql: state.soql });
      renderObjectSheet(sheetId, data, { source: "query" });
      state.objectName = objectName;
      state.writeback = data.hasId;
    } else {
      tagSheetSource(sheetId, "query");
      browseMeta.set(sheetId, { kind: "import", importMode: "query", objectName: objectName || "", label: objectName || t("dinaSheet.sheet.query"), soql: state.soql });
      window.QDBSheet.render(sheetId, columns, rows);
      state.writeback = false;
    }
    if (!state.done && state.nextRecordsUrl) {
      const streamingText = t("forceSheet.status.streaming", { fetched: rows.length.toLocaleString(), total: state.totalSize.toLocaleString() });
      setStatus(streamingText);
      showLoading(streamingText);
      void streamPages(sheetId, columns, state);
    } else {
      setStatus(t("forceSheet.status.refreshed", { count: rows.length.toLocaleString() }));
    }
    renderSheet();
    syncFileDetails();
  } catch (err) {
    const message = err?.message || t("forceSheet.status.refreshFailed");
    setStatus(message, true);
    showError(message, { detail: state?.soql || "", onRetry: () => void refreshTab() });
    refreshBtn.title = t("forceSheet.error");
  } finally {
    refreshBtn.disabled = false;
  }
}

// ── Feat 0006: Object + Field picker ─────────────────────────────────────────

async function loadObjects() {
  if (objectCache !== null) return objectCache;
  if (!session?.host || !session?.sid) return [];
  try {
    const result = await salesforceRequest(session.host, session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects`);
    objectCache = (result.sobjects || [])
      .filter(s => s.queryable)
      .map(s => ({ name: s.name, label: s.label, keyPrefix: s.keyPrefix || "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) { objectCache = []; }
  return objectCache;
}

// Generic custom suggestion dropdown — same UI/UX as the inline SOQL field
// suggestion list (R4/R5/R6, UX round 2). The list is appended inside the
// input's parent (which becomes the positioning context).
// getItems(term) → [{ value, name, meta }] (may be async); onPick(item).
function attachSuggestDropdown(inputEl, getItems, onPick) {
  const parent = inputEl.parentElement;
  parent.style.position = "relative";
  const list = document.createElement("div");
  list.className = "fs-soql-field-suggestions";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  parent.appendChild(list);
  inputEl.setAttribute("aria-autocomplete", "list");
  inputEl.setAttribute("aria-expanded", "false");

  let items = [];
  let index = 0;
  let timer = null;
  let requestSeq = 0;

  const hide = () => {
    list.hidden = true;
    inputEl.setAttribute("aria-expanded", "false");
  };
  const highlight = (next) => {
    index = next;
    [...list.children].forEach((el, i) => {
      el.classList.toggle("active", i === index);
      el.setAttribute("aria-selected", String(i === index));
    });
    list.children[index]?.scrollIntoView({ block: "nearest" });
  };
  const render = async () => {
    const seq = ++requestSeq;
    const result = (await getItems(inputEl.value.trim())) || [];
    if (seq !== requestSeq) return; // stale response
    // A delayed suggestion request can finish after its panel has closed.
    // Do not leave that stale list open to cover controls when the panel reopens.
    if (!inputEl.isConnected || inputEl.offsetParent === null) { hide(); return; }
    items = result.slice(0, 12);
    list.replaceChildren();
    if (!items.length) { hide(); return; }
    items.forEach((item, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fs-soql-field-suggest-item" + (i === 0 ? " active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(i === 0));
      btn.tabIndex = -1;
      const nameEl = document.createElement("span");
      nameEl.className = "fs-suggest-name";
      nameEl.textContent = item.name;
      const metaEl = document.createElement("span");
      metaEl.className = "fs-suggest-meta";
      metaEl.textContent = item.meta || "";
      btn.append(nameEl, metaEl);
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); hide(); onPick(item); });
      list.appendChild(btn);
    });
    index = 0;
    list.hidden = false;
    inputEl.setAttribute("aria-expanded", "true");
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void render(), 150); };

  inputEl.addEventListener("input", schedule);
  inputEl.addEventListener("focus", schedule);
  inputEl.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(index + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(index - 1, 0)); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); hide(); onPick(items[index]); }
    else if (e.key === "Escape") { e.stopPropagation(); hide(); }
  });
  // Close on a real click outside the input+list — NOT on blur. The embedded
  // Univer editor steals focus, which would fire blur and close the dropdown
  // the instant it opens; an outside-pointerdown check is immune to that.
  document.addEventListener("pointerdown", (e) => {
    if (list.hidden) return;
    if (e.target === inputEl || list.contains(e.target)) return;
    hide();
  }, true);
}

// Objects filtered by API name or label, shaped for attachSuggestDropdown.
async function getObjectSuggestions(term = "") {
  const objects = await loadObjects();
  const needle = term.toLowerCase();
  return objects
    .filter(o => !needle || o.name.toLowerCase().includes(needle) || (o.label || "").toLowerCase().includes(needle))
    .map(o => ({ value: o.name, name: o.name, meta: o.label || "" }));
}

async function loadFieldDescribe(objectName) {
  if (fieldDescribeCache.has(objectName)) return fieldDescribeCache.get(objectName);
  if (fieldDescribeLoadPromises.has(objectName)) return fieldDescribeLoadPromises.get(objectName);
  if (!session?.host || !session?.sid) return null;
  const promise = salesforceRequest(session.host, session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/describe`)
    .then(result => {
      const fields = result.fields || [];
      fieldDescribeCache.set(objectName, fields);
      fieldDescribeLoadPromises.delete(objectName);
      return fields;
    })
    .catch(() => { fieldDescribeLoadPromises.delete(objectName); return null; });
  fieldDescribeLoadPromises.set(objectName, promise);
  return promise;
}

// Field suggestions for the selected object, shaped for attachSuggestDropdown
// (same UI as every other suggestion list).
async function getFieldSuggestions(term = "") {
  const objectName = getQueryObjectName(soqlInputEl.value) || objectInputEl.value.trim();
  if (!objectName) return [];
  const fields = (await loadFieldDescribe(objectName)) || [];
  const needle = term.toLowerCase();
  return fields
    .filter(f => !needle || f.name.toLowerCase().includes(needle) || (f.label || "").toLowerCase().includes(needle))
    .map(f => ({ value: f.name, name: f.name, meta: `${f.label} (${f.type})` }));
}

function pickSampleFields(fields) {
  const preferred = ["Id", "Name", "CreatedDate", "LastModifiedDate"];
  const result = [];
  for (const name of preferred) {
    const f = fields.find(f => f.name === name);
    if (f) result.push(f.name);
  }
  for (const f of fields) {
    if (result.length >= 4) break;
    if (!result.includes(f.name)) result.push(f.name);
  }
  return result;
}

async function onObjectSelect(objectName) {
  if (!objectName) return;
  objectPickerName = objectName; // picker-chosen → Run offers CRUD
  const state = getActiveState();
  if (state) state.objectApiName = objectName;
  const fields = await loadFieldDescribe(objectName); // warms the field-suggestion cache
  if (!fields) return;
  if (!soqlInputEl.value.trim()) {
    const sampleFields = pickSampleFields(fields);
    soqlInputEl.value = `SELECT ${sampleFields.join(", ")} FROM ${objectName} LIMIT 200`;
  }
}

async function onFieldPick(fieldName) {
  if (!fieldName) return;
  const soql = soqlInputEl.value.trim();
  if (!soql) return;
  const selectMatch = soql.match(/^(SELECT\s+)([\s\S]+?)(\s+FROM\s+)/i);
  if (!selectMatch) { soqlInputEl.value = soql + `, ${fieldName}`; return; }
  const [, selectKw, cols, fromKw] = selectMatch;
  const colList = cols.split(",").map(c => c.trim()).filter(Boolean);
  if (!colList.includes(fieldName)) colList.push(fieldName);
  soqlInputEl.value = `${selectKw}${colList.join(", ")}${fromKw}${soql.slice(selectMatch[0].length)}`;
  fieldInputEl.value = "";
}

// ── Feat 0006: Inline SOQL field suggestions ──────────────────────────────────

function getQueryObjectName(soql) {
  const m = soql.match(/\bFROM\s+(\w+)/i);
  return m ? m[1] : null;
}

function getInlineTokenInfo(textarea) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  let start = pos;
  while (start > 0 && /\w/.test(val[start - 1])) start--;
  const before = val.slice(0, start);
  const inSelect = /\bSELECT\s+[\w\s,.]*$/i.test(before);
  if (!inSelect) return null;
  return { token: val.slice(start, pos), start, end: pos };
}

function applyInlineSuggestion(item) {
  if (!inlineSugToken) return;
  const val = soqlInputEl.value;
  soqlInputEl.value = val.slice(0, inlineSugToken.start) + item.name + val.slice(inlineSugToken.end);
  const newPos = inlineSugToken.start + item.name.length;
  soqlInputEl.setSelectionRange(newPos, newPos);
  hideInlineSuggestions();
  inlineSugItems = [];
  inlineSugToken = null;
  soqlInputEl.focus();
}

function highlightInlineSug(newIdx) {
  const btns = soqlFieldSuggestEl.querySelectorAll(".fs-soql-field-suggest-item");
  btns.forEach((b, i) => {
    b.classList.toggle("active", i === newIdx);
    b.setAttribute("aria-selected", String(i === newIdx));
  });
  inlineSugIndex = newIdx;
  soqlInputEl.setAttribute("aria-activedescendant", `fs-soql-sug-${newIdx}`);
  btns[newIdx]?.scrollIntoView({ block: "nearest" });
}

function hideInlineSuggestions() {
  soqlFieldSuggestEl.hidden = true;
  soqlInputEl.setAttribute("aria-expanded", "false");
  soqlInputEl.removeAttribute("aria-activedescendant");
}

function renderInlineSuggestions(items) {
  inlineSugItems = items;
  inlineSugIndex = 0;
  soqlFieldSuggestEl.replaceChildren();
  if (!items.length) { hideInlineSuggestions(); return; }
  items.forEach((item, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fs-soql-field-suggest-item" + (i === 0 ? " active" : "");
    btn.id = `fs-soql-sug-${i}`;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(i === 0));
    btn.tabIndex = -1;
    const nameEl = document.createElement("span");
    nameEl.className = "fs-suggest-name";
    nameEl.textContent = item.name;
    const metaEl = document.createElement("span");
    metaEl.className = "fs-suggest-meta";
    metaEl.textContent = item.label ? `${item.label} · ${item.type}` : item.type;
    btn.append(nameEl, metaEl);
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); applyInlineSuggestion(item); });
    soqlFieldSuggestEl.appendChild(btn);
  });
  soqlInputEl.setAttribute("aria-expanded", "true");
  soqlInputEl.setAttribute("aria-activedescendant", "fs-soql-sug-0");
  soqlFieldSuggestEl.hidden = false;
}

async function scheduleInlineSuggestions() {
  clearTimeout(inlineSugTimer);
  inlineSugTimer = setTimeout(async () => {
    const tokenInfo = getInlineTokenInfo(soqlInputEl);
    if (!tokenInfo || tokenInfo.token.length < 1) { hideInlineSuggestions(); return; }
    const soql = soqlInputEl.value;
    const objectName = getQueryObjectName(soql) || objectInputEl.value.trim();
    if (!objectName || !session?.host || !session?.sid) return;
    const reqId = ++inlineSugReqId;
    const fields = await loadFieldDescribe(objectName);
    if (reqId !== inlineSugReqId || !fields) return;
    inlineSugToken = tokenInfo;
    const token = tokenInfo.token.toLowerCase();
    const matches = fields.filter(f =>
      f.name.toLowerCase().startsWith(token) || f.label.toLowerCase().startsWith(token)
    ).slice(0, 10);
    renderInlineSuggestions(matches);
  }, 200);
}

// ── Feat 0009: Workspace data helpers + vanilla tree renderer ──

// Tree UI state
const wsOpenIds = new Set();
let wsActiveId = null;
// The user file (Workspace-root node) currently shown in the sheet. While set,
// running a query/report auto-saves its definition back into the file (no Save
// button). Cleared when a non-file source (list view / report browse) is opened.
let wsOpenFileId = null;
let wsRestoringFileId = null;
let wsSnapshotTimer = 0;
let wsRestoreReady = Promise.resolve();
let wsSelectionVersion = 0;
let wsAutoQueryVersion = 0;
window.addEventListener("beforeunload", () => clearTimeout(wsSnapshotTimer));
let wsDragId = null;
let wsDynDragCfg = null;
let wsFocusId = null; // roving-tabindex focus target

// ── Dynamic (org-browsing) subtrees: Objects + Reports ───────────────────────
// Root ids are expanded via the shared wsOpenIds set. Lazily-loaded children
// are cached here; a null entry means "not loaded yet".
const WS_ROOT_OBJECTS = "__root_objects";
const WS_ROOT_REPORTS = "__root_reports";
const WS_ROOT_FAVORITES = "__root_favorites";
const WS_ROOT_QUERY = "__root_query";
const WS_DEFAULT_QUERY_SOQL = "SELECT Id, Name FROM Account LIMIT 1";
const WS_QUERIES_VERSION = 1;
const WS_DEMO_QUERY_ID = "query-demo";
const WS_FAVORITES_VERSION = 3;
const WS_FAVORITES_MAX = 100;
const WS_FAVORITE_FOLDERS_MAX = 30;
const WS_DEFAULT_FAVORITES_FOLDER_ID = "default";
const dynChildrenCache = new Map(); // dynId → cfg[] (or "loading" sentinel)
const dynLoadErrors = new Map(); // dynId → Error for retryable lazy-load failures
const wsFilterAutoExpanded = new Set(); // roots the filter auto-opened
let wsOrgSearchTerm = "";
let wsFavorites = [];
let wsFavoriteFolders = [];

// Strip the .csv suffix for display (files are stored *.csv, shown without it).
function wsDisplayName(name = "") {
  return String(name).replace(/\.csv$/i, "");
}

function wsRenderTree() {
  const orgFilterTerm = wsOrgFilterTerm();
  wsTreeEl.replaceChildren();
  wsTreeEl.appendChild(wsRenderDynFolder({
    id: WS_ROOT_FAVORITES, name: t("forceSheet.favorites.title"),
    folder: true, favoriteFolder: true, count: wsFavorites.length,
    load: loadFavoritesRoot,
  }, 0));
  wsTreeEl.appendChild(wsRenderDynFolder({
    id: WS_ROOT_QUERY, name: t("forceSheet.query.title"),
    folder: true, queryRoot: true, renderUserChild: true,
    count: wsCountQueryFiles(wsData.tree),
  }, 0));
  wsTreeEl.appendChild(wsRenderDynFolder({
    id: WS_ROOT_OBJECTS, name: t("forceSheet.workspace.rootObjects"),
    folder: true,
    loadKey: orgFilterTerm,
    load: () => loadObjectsRoot(orgFilterTerm),
  }, 0));
  wsTreeEl.appendChild(wsRenderDynFolder({
    id: WS_ROOT_REPORTS, name: t("forceSheet.workspace.rootReports"),
    folder: true,
    loadKey: orgFilterTerm,
    load: () => loadReportsRoot(orgFilterTerm),
  }, 0));
  wsApplyRovingTabindex();
  applyWsFilter();
}

// Renders a folder row that either hosts user nodes (Workspace root) or
// lazily-loaded dynamic children (Objects/Reports). cfg:
//   { id, name, subtitle?, load?(): Promise<cfg[]>, getChildren?(): cfg[],
//     renderUserChild?: bool }
function wsRenderDynFolder(cfg, depth, parentId = "") {
  // While filtering, auto-expand lazily-loaded folders (Objects/Reports roots
  // and their object / report-folder children) so their leaf rows — the
  // list-view and report names the filter searches — get rendered. Tracked in
  // wsFilterAutoExpanded so clearing the filter collapses exactly these again.
  if (cfg.load && wsFilterActive() && !wsOpenIds.has(cfg.id)) {
    wsOpenIds.add(cfg.id);
    wsFilterAutoExpanded.add(cfg.id);
  }
  const isOpen = wsOpenIds.has(cfg.id);
  const wrapper = document.createElement("div");
  wrapper.className = "schema-tree-folder" + (isOpen ? " open" : "");

  const row = wsBuildDynRow(cfg, depth, true, parentId);
  row.addEventListener("click", () => {
    if (wsOpenIds.has(cfg.id)) wsOpenIds.delete(cfg.id); else wsOpenIds.add(cfg.id);
    wsFocusId = cfg.id;
    if (wsOpenIds.has(cfg.id) && cfg.load && !dynChildrenCache.has(cfg.id)) {
      void wsLoadDyn(cfg);
    }
    wsRenderTree();
  });
  // The Workspace root hosts user files → right-click offers Create at root.
  if (cfg.renderUserChild) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      wsShowContextMenu(null, null, e.clientX, e.clientY);
    });
    row.addEventListener("dragover", (e) => {
      if (!wsDynDragCfg) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      row.classList.add("drag-into");
    });
    row.addEventListener("drop", (e) => {
      if (!wsDynDragCfg) return;
      e.preventDefault(); e.stopPropagation();
      const cfgToCopy = wsDynDragCfg;
      wsDynDragCfg = null; wsClearDropMarkers();
      void wsCopyDynamicFile(cfgToCopy, null);
    });
  } else {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation(); wsShowDynamicContextMenu(cfg, e.clientX, e.clientY, row);
    });
  }
  if (cfg.favoriteChildFolder) {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      wsDynDragCfg = cfg;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", cfg.id);
    });
    row.addEventListener("dragover", (event) => {
      if (!wsDynDragCfg || (!wsDynDragCfg.favoriteShortcut && !wsDynDragCfg.favoriteChildFolder)) return;
      event.preventDefault(); event.stopPropagation(); wsClearDropMarkers();
      event.dataTransfer.dropEffect = "move";
      if (wsDynDragCfg.favoriteShortcut) {
        row.classList.add("drag-into");
      } else if (wsDynDragCfg.favoriteFolderId !== cfg.favoriteFolderId) {
        const after = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        row.classList.add(after ? "drag-below" : "drag-above");
      }
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-into", "drag-above", "drag-below"));
    row.addEventListener("drop", (event) => {
      const dragged = wsDynDragCfg;
      if (!dragged || (!dragged.favoriteShortcut && !dragged.favoriteChildFolder)) return;
      event.preventDefault(); event.stopPropagation();
      const after = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      wsDynDragCfg = null; wsClearDropMarkers();
      if (dragged.favoriteShortcut) {
        void wsMoveFavoriteEntry(dragged.favoriteEntryId, cfg.favoriteFolderId);
      } else {
        void wsReorderFavoriteFolder(dragged.favoriteFolderId, cfg.favoriteFolderId, after);
      }
    });
    row.addEventListener("dragend", () => { wsDynDragCfg = null; wsClearDropMarkers(); });
  }
  wrapper.appendChild(row);

  if (isOpen) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "schema-tree-children";
    childrenEl.setAttribute("role", "group");

    if (cfg.renderUserChild) {
      const nodes = wsData.tree;
      if (nodes.length) {
        for (const n of nodes) childrenEl.appendChild(wsRenderNode(n, depth + 1, cfg.id));
      } else {
        childrenEl.appendChild(wsDynEmptyRow(depth + 1, t("forceSheet.query.empty")));
      }
    } else {
      const cached = dynChildrenCache.get(cfg.id);
      const loadError = dynLoadErrors.get(cfg.id);
      if (loadError) {
        childrenEl.appendChild(wsDynErrorRow(cfg, depth + 1, loadError));
      } else if (cached === undefined || cached === "loading") {
        childrenEl.appendChild(wsDynEmptyRow(depth + 1, cached === "loading" ? t("dinaSheet.common.loading") : "…"));
        if (cached === undefined && cfg.load) void wsLoadDyn(cfg);
      } else if (!cached.length) {
        childrenEl.appendChild(wsDynEmptyRow(depth + 1, cfg.favoriteFolder
          ? t("forceSheet.favorites.empty")
          : cfg.favoriteChildFolder ? t("forceSheet.favorites.emptyFolder") : t("dinaSheet.common.none")));
      } else {
        for (const child of cached) {
          childrenEl.appendChild(child.folder
            ? wsRenderDynFolder(child, depth + 1, cfg.id)
            : wsRenderDynFile(child, depth + 1, cfg.id));
        }
      }
    }
    wrapper.appendChild(childrenEl);
  }
  return wrapper;
}

// Typing in the filter auto-expands the Objects/Reports trees, so a filter can
// sit behind several lazy loads. Drive the spinner off those actual in-flight
// loads rather than a timer, so it clears exactly when the tree is settled.
function wsUpdateFilterBusy() {
  if (!wsFilterSpinnerEl) return;
  let busy = false;
  for (const value of dynChildrenCache.values()) {
    if (value === "loading") { busy = true; break; }
  }
  wsFilterSpinnerEl.hidden = !busy;
  wsFilterEl?.setAttribute("aria-busy", String(busy));
}

async function wsLoadDyn(cfg) {
  dynLoadErrors.delete(cfg.id);
  dynChildrenCache.set(cfg.id, "loading");
  wsUpdateFilterBusy();
  if (wsOpenIds.has(cfg.id)) wsRenderTree();
  try {
    const children = (await cfg.load()) || [];
    // A debounced workspace-filter change can start a newer org-data query
    // while the previous term is still in flight. Never let that older result
    // replace the cache for the current term.
    if ([WS_ROOT_OBJECTS, WS_ROOT_REPORTS].includes(cfg.id) && cfg.loadKey !== wsOrgFilterTerm()) return;
    dynChildrenCache.set(cfg.id, children);
  } catch (error) {
    if ([WS_ROOT_OBJECTS, WS_ROOT_REPORTS].includes(cfg.id) && cfg.loadKey !== wsOrgFilterTerm()) return;
    dynChildrenCache.delete(cfg.id);
    dynLoadErrors.set(cfg.id, error instanceof Error ? error : new Error(String(error || "Load failed")));
  }
  wsUpdateFilterBusy();
  if (wsOpenIds.has(cfg.id)) wsRenderTree();
}

function wsRenderDynFile(cfg, depth, parentId = "") {
  const row = wsBuildDynRow(cfg, depth, false, parentId);
  row.addEventListener("click", () => {
    wsSelectionVersion += 1;
    wsActiveId = cfg.id;
    wsFocusId = cfg.id;
    syncFileDetailsToCfg(cfg);
    wsRenderTree();
    cfg.onOpen?.();
  });
  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    wsDynDragCfg = cfg;
    event.dataTransfer.effectAllowed = cfg.favoriteShortcut ? "move" : "copy";
    event.dataTransfer.setData("text/plain", cfg.id);
  });
  if (cfg.favoriteShortcut) {
    row.addEventListener("dragover", (event) => {
      if (!wsDynDragCfg?.favoriteShortcut || wsDynDragCfg.favoriteEntryId === cfg.favoriteEntryId) return;
      event.preventDefault(); event.stopPropagation(); wsClearDropMarkers();
      event.dataTransfer.dropEffect = "move";
      const after = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      row.classList.add(after ? "drag-below" : "drag-above");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-above", "drag-below"));
    row.addEventListener("drop", (event) => {
      const dragged = wsDynDragCfg;
      if (!dragged?.favoriteShortcut || dragged.favoriteEntryId === cfg.favoriteEntryId) return;
      event.preventDefault(); event.stopPropagation();
      const after = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      wsDynDragCfg = null; wsClearDropMarkers();
      void wsMoveFavoriteEntry(dragged.favoriteEntryId, cfg.favoriteFolderId, cfg.favoriteEntryId, after);
    });
  }
  row.addEventListener("dragend", () => { wsDynDragCfg = null; wsClearDropMarkers(); });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault(); event.stopPropagation();
    wsShowDynamicContextMenu(cfg, event.clientX, event.clientY, row);
  });
  return row;
}

function wsDynEmptyRow(depth, text) {
  const el = document.createElement("div");
  el.className = "fs-ws-dyn-empty";
  el.style.cssText = `padding: 0.18rem 0.55rem 0.18rem calc(0.45rem + ${depth}rem); font-size:0.72rem; color:#5f6368; font-style:italic;`;
  el.textContent = text;
  return el;
}

function wsDynErrorRow(cfg, depth, error) {
  const row = document.createElement("div");
  row.className = "fs-ws-dyn-error";
  row.style.setProperty("--tree-indent", `${depth}rem`);
  const message = document.createElement("span");
  message.textContent = error?.message || t("forceSheet.tree.loadFailed");
  message.title = message.textContent;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "fs-ws-dyn-retry";
  retry.textContent = t("common.retry");
  retry.addEventListener("click", () => void wsLoadDyn(cfg));
  row.append(message, retry);
  return row;
}

// Read-only row for roots + dynamic nodes (no drag / rename / context menu).
function wsBuildDynRow(cfg, depth, isFolder, parentId = "") {
  const row = document.createElement("div");
  row.className = "schema-tree-row" + (isFolder ? " schema-tree-folder-row" : "");
  row.classList.toggle("fs-favorite-movable", Boolean(cfg.favoriteChildFolder || cfg.favoriteShortcut));
  row.classList.toggle("selected", cfg.id === wsActiveId);
  row.style.setProperty("--tree-indent", `${depth}rem`);
  row.dataset.wsId = cfg.id;
  if (parentId) row.dataset.wsParentId = parentId;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-selected", String(cfg.id === wsActiveId));
  if (isFolder) row.setAttribute("aria-expanded", String(wsOpenIds.has(cfg.id)));
  row.tabIndex = -1;

  const caret = document.createElement("span");
  caret.className = isFolder ? "schema-tree-caret" : "schema-tree-indent";
  row.appendChild(caret);

  const icon = document.createElement("span");
  icon.className = `schema-tree-icon ${isFolder ? "folder" : cfg.queryFile ? "query" : "csv"} readonly${cfg.favoriteFolder || cfg.favoriteChildFolder || cfg.favoriteShortcut ? " favorite" : ""}`;
  if (cfg.favoriteFolder || cfg.favoriteChildFolder || cfg.favoriteShortcut) {
    const marker = document.createElement("span");
    marker.className = "fs-ws-star-marker";
    marker.textContent = "★";
    marker.setAttribute("aria-hidden", "true");
    icon.appendChild(marker);
  }
  row.appendChild(icon);

  const nameWrap = document.createElement("span");
  nameWrap.className = "schema-tree-name";
  const primary = document.createElement("span");
  primary.className = "schema-tree-primary";
  primary.textContent = cfg.name;
  nameWrap.appendChild(primary);
  // Show the subtitle only when it adds information (not a duplicate of the
  // name — e.g. Account's label equals its API name).
  if (cfg.subtitle && cfg.subtitle !== cfg.name) {
    const secondary = document.createElement("span");
    secondary.className = "schema-tree-secondary";
    secondary.textContent = cfg.subtitle;
    nameWrap.appendChild(secondary);
  }
  row.appendChild(nameWrap);

  const trailing = document.createElement("span");
  trailing.className = "fs-ws-row-trailing";
  if (Number.isFinite(cfg.count)) {
    const count = document.createElement("span");
    count.className = "fs-ws-count";
    count.textContent = String(cfg.count);
    count.setAttribute("aria-label", t(cfg.favoriteFolder || cfg.favoriteChildFolder
      ? "forceSheet.favorites.count" : "forceSheet.tree.itemCount", { count: cfg.count }));
    trailing.appendChild(count);
  }
  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "fs-ws-row-action-btn";
  actionBtn.tabIndex = -1;
  actionBtn.setAttribute("aria-label", t("forceSheet.actions"));
  actionBtn.textContent = "⋮";
  actionBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const rect = actionBtn.getBoundingClientRect();
    if (cfg.renderUserChild) wsShowContextMenu(null, null, rect.left, rect.bottom + 2);
    else wsShowDynamicContextMenu(cfg, rect.left, rect.bottom + 2, row);
  });
  trailing.appendChild(actionBtn);
  row.appendChild(trailing);
  return row;
}

function wsFavoritesStorageKey() {
  return `forceSheet.favorites.${session?.host || ""}`;
}

function wsQueriesStorageKey() {
  return `forceSheet.queries.${session?.host || ""}`;
}

function wsDemoQueryTree() {
  return [{
    id: WS_DEMO_QUERY_ID,
    type: "soql",
    name: "demo-query",
    payload: { soql: WS_DEFAULT_QUERY_SOQL },
  }];
}

function wsNormalizeQueryTree(values, seenIds = new Set()) {
  if (!Array.isArray(values)) return [];
  const normalized = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    let id = String(value.id || "").trim() || `query-${wsGenId()}`;
    while (seenIds.has(id)) id = `query-${wsGenId()}`;
    seenIds.add(id);
    const name = String(value.name || "").trim();
    if (!name) continue;
    if (value.type === "folder") {
      normalized.push({ id, type: "folder", name, children: wsNormalizeQueryTree(value.children, seenIds) });
    } else if (value.type === "soql") {
      const storedSoql = String(value.payload?.soql || "");
      normalized.push({
        id, type: "soql", name,
        payload: {
          soql: id === WS_DEMO_QUERY_ID && storedSoql === "SELECT Id, Name FROM Account"
            ? WS_DEFAULT_QUERY_SOQL
            : storedSoql,
        },
      });
    }
  }
  return normalized;
}

async function wsLoadQueries() {
  try {
    const key = wsQueriesStorageKey();
    const payload = (await chrome.storage.local.get(key))?.[key];
    if (payload?.version === WS_QUERIES_VERSION && Array.isArray(payload.tree)) {
      wsData.tree = wsNormalizeQueryTree(payload.tree);
    } else {
      wsData.tree = wsDemoQueryTree();
      await wsPersist();
    }
  } catch (_) {
    wsData.tree = wsDemoQueryTree();
  }
  wsOpenIds.add(WS_ROOT_QUERY);
}

function wsFavoriteIdentity(value) {
  return `${value?.kind || ""}:${value?.salesforceId || ""}`;
}

function wsFavoriteEntryId(value) {
  return String(value?.entryId || "").trim();
}

function wsNormalizeFavorite(value, validFolderIds = new Set([WS_DEFAULT_FAVORITES_FOLDER_ID])) {
  if (!value || !["listView", "report", "query"].includes(value.kind)) return null;
  const salesforceId = String(value.salesforceId || "").trim();
  const name = String(value.name || "").trim();
  const folderId = validFolderIds.has(String(value.folderId || ""))
    ? String(value.folderId)
    : WS_DEFAULT_FAVORITES_FOLDER_ID;
  if (!salesforceId || !name) return null;
  if (value.kind === "query") {
    return {
      kind: "query", salesforceId, name,
      subtitle: String(value.subtitle || "SOQL").trim() || "SOQL",
      soql: String(value.soql || ""),
      folderId,
      entryId: wsFavoriteEntryId(value),
      addedAt: String(value.addedAt || new Date().toISOString()),
    };
  }
  if (value.kind === "listView") {
    const objectName = String(value.objectName || "").trim();
    if (!objectName) return null;
    return {
      kind: "listView", salesforceId, name, objectName,
      subtitle: String(value.subtitle || objectName).trim() || objectName,
      folderId,
      entryId: wsFavoriteEntryId(value),
      addedAt: String(value.addedAt || new Date().toISOString()),
    };
  }
  return {
    kind: "report", salesforceId, name,
    folder: String(value.folder || t("dinaSheet.common.unfiled")).trim() || t("dinaSheet.common.unfiled"),
    subtitle: String(value.subtitle || "").trim(),
    folderId,
    entryId: wsFavoriteEntryId(value),
    addedAt: String(value.addedAt || new Date().toISOString()),
  };
}

function wsNormalizeFavoriteFolders(payload) {
  const defaultFolder = { id: WS_DEFAULT_FAVORITES_FOLDER_ID, name: "Default", createdAt: "" };
  if (![2, WS_FAVORITES_VERSION].includes(payload?.version) || !Array.isArray(payload.folders)) return [defaultFolder];
  const folders = [];
  const seenIds = new Set();
  if (payload.version === 2) {
    folders.push(defaultFolder); seenIds.add(defaultFolder.id);
  }
  for (const value of payload.folders) {
    const id = String(value?.id || "").trim();
    const name = String(value?.name || "").trim();
    if (!id || !name || seenIds.has(id)) continue;
    if (id === WS_DEFAULT_FAVORITES_FOLDER_ID) {
      folders.push(defaultFolder); seenIds.add(id);
      continue;
    }
    // Deduplicate on id only. Name clashes are rejected when a folder is created
    // or renamed, against the label shown at that moment; re-testing the name on
    // load would silently delete a folder the user was allowed to create — the
    // localized Default label makes "Default" a legal name in Japanese.
    seenIds.add(id);
    folders.push({ id, name, createdAt: String(value.createdAt || "") });
    // Leave room for the Default folder still to be prepended below, so a
    // tampered payload can never yield more than WS_FAVORITE_FOLDERS_MAX.
    const cap = seenIds.has(WS_DEFAULT_FAVORITES_FOLDER_ID)
      ? WS_FAVORITE_FOLDERS_MAX : WS_FAVORITE_FOLDERS_MAX - 1;
    if (folders.length >= cap) break;
  }
  if (!seenIds.has(WS_DEFAULT_FAVORITES_FOLDER_ID)) folders.unshift(defaultFolder);
  return folders;
}

function wsNormalizeFavorites(payload, folders) {
  const values = [1, 2, WS_FAVORITES_VERSION].includes(payload?.version) && Array.isArray(payload.items) ? payload.items : [];
  const validFolderIds = new Set(folders.map(folder => folder.id));
  const seenEntries = new Set();
  const seenFolderSources = new Set();
  const normalized = [];
  for (const value of values) {
    let item = wsNormalizeFavorite(value, validFolderIds);
    if (!item) continue;
    const folderSource = `${item.folderId}:${wsFavoriteIdentity(item)}`;
    if (seenFolderSources.has(folderSource)) continue;
    let entryId = wsFavoriteEntryId(item) || `favorite-${wsGenId()}`;
    while (seenEntries.has(entryId)) entryId = `favorite-${wsGenId()}`;
    item = { ...item, entryId };
    seenEntries.add(entryId); seenFolderSources.add(folderSource);
    normalized.push(item);
    if (normalized.length >= WS_FAVORITES_MAX) break;
  }
  return normalized;
}

async function wsLoadFavorites() {
  let needsMigration = false;
  try {
    const key = wsFavoritesStorageKey();
    const payload = (await chrome.storage.local.get(key))?.[key];
    needsMigration = [1, 2].includes(payload?.version);
    wsFavoriteFolders = wsNormalizeFavoriteFolders(payload);
    wsFavorites = wsNormalizeFavorites(payload, wsFavoriteFolders);
  } catch (_) {
    wsFavoriteFolders = wsNormalizeFavoriteFolders(null);
    wsFavorites = [];
  }
  wsRefreshFavoritesCache();
  wsOpenIds.add(WS_ROOT_FAVORITES);
  if (needsMigration) {
    try { await wsPersistFavorites(); } catch (_) { /* retry on the next favorite mutation */ }
  }
}

async function wsPersistFavorites() {
  await chrome.storage.local.set({
    [wsFavoritesStorageKey()]: {
      version: WS_FAVORITES_VERSION,
      folders: wsFavoriteFolders,
      items: wsFavorites,
    },
  });
}

function wsFavoriteRecordFromCfg(cfg) {
  return wsNormalizeFavorite(cfg?.favorite, new Set(wsFavoriteFolders.map(folder => folder.id)));
}

function wsIsFavorite(cfg) {
  const item = wsFavoriteRecordFromCfg(cfg);
  if (!item) return false;
  const identity = wsFavoriteIdentity(item);
  return wsFavorites.some(favorite => wsFavoriteIdentity(favorite) === identity);
}

function wsFavoriteFolderLabel(folderId) {
  if (folderId === WS_DEFAULT_FAVORITES_FOLDER_ID) return t("forceSheet.favorites.defaultFolder");
  return wsFavoriteFolders.find(folder => folder.id === folderId)?.name || t("forceSheet.favorites.defaultFolder");
}

function wsRefreshFavoritesCache() {
  dynChildrenCache.set(WS_ROOT_FAVORITES, buildFavoriteFolderCfgs());
  for (const folder of wsFavoriteFolders) {
    dynChildrenCache.set(`favfolder:${folder.id}`, buildFavoriteCfgs(folder.id));
  }
}

function wsRefreshFavoritesTree() {
  wsRefreshFavoritesCache();
  wsRenderTree();
  syncActiveFilePresentation();
}

async function wsSyncFavoriteFolders(cfg, selectedFolderIds) {
  const item = wsFavoriteRecordFromCfg(cfg);
  if (!item) return false;
  const validIds = new Set(wsFavoriteFolders.map(folder => folder.id));
  const selected = new Set([...selectedFolderIds].filter(folderId => validIds.has(folderId)));
  const identity = wsFavoriteIdentity(item);
  const otherFavorites = wsFavorites.filter(favorite => wsFavoriteIdentity(favorite) !== identity);
  if (otherFavorites.length + selected.size > WS_FAVORITES_MAX) {
    showError(t("forceSheet.favorites.itemLimit", { count: WS_FAVORITES_MAX }));
    return false;
  }
  const existingByFolder = new Map(wsFavorites
    .filter(favorite => wsFavoriteIdentity(favorite) === identity)
    .map(favorite => [favorite.folderId, favorite]));
  const previous = wsFavorites.map(favorite => ({ ...favorite }));
  // Surviving entries stay at their current index — rebuilding the list as
  // "everything else, then this item" would drop the item to the bottom of its
  // folder on every save, discarding the order set by drag and drop.
  const kept = wsFavorites.filter(favorite => wsFavoriteIdentity(favorite) !== identity
    || selected.has(favorite.folderId));
  const added = wsFavoriteFolders
    .filter(folder => selected.has(folder.id) && !existingByFolder.has(folder.id))
    .map(folder => ({
      ...item,
      folderId: folder.id,
      entryId: `favorite-${wsGenId()}`,
      addedAt: new Date().toISOString(),
    }));
  wsFavorites = [...kept, ...added];
  wsOpenIds.add(WS_ROOT_FAVORITES);
  selected.forEach(folderId => wsOpenIds.add(`favfolder:${folderId}`));
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(selected.size
      ? t("forceSheet.favorites.foldersSynced", { name: item.name, count: selected.size })
      : t("forceSheet.favorites.removedAll", { name: item.name }));
    return true;
  } catch (error) {
    wsFavorites = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true);
    showError(message);
    return false;
  }
}

async function wsMoveFavoriteEntry(entryId, targetFolderId, targetEntryId = "", placeAfter = false) {
  const sourceIndex = wsFavorites.findIndex(favorite => wsFavoriteEntryId(favorite) === entryId);
  if (sourceIndex < 0 || !wsFavoriteFolders.some(folder => folder.id === targetFolderId)) return false;
  const source = wsFavorites[sourceIndex];
  const duplicate = wsFavorites.find(favorite => wsFavoriteEntryId(favorite) !== entryId
    && favorite.folderId === targetFolderId
    && wsFavoriteIdentity(favorite) === wsFavoriteIdentity(source));
  if (duplicate) {
    setStatus(t("forceSheet.favorites.alreadyInFolder", {
      name: source.name, folder: wsFavoriteFolderLabel(targetFolderId),
    }));
    return false;
  }
  if (targetEntryId === entryId) return true;
  const previous = wsFavorites.map(favorite => ({ ...favorite }));
  const [moving] = wsFavorites.splice(sourceIndex, 1);
  moving.folderId = targetFolderId;
  let insertIndex = wsFavorites.length;
  if (targetEntryId) {
    const targetIndex = wsFavorites.findIndex(favorite => wsFavoriteEntryId(favorite) === targetEntryId);
    if (targetIndex >= 0) insertIndex = targetIndex + (placeAfter ? 1 : 0);
  }
  wsFavorites.splice(insertIndex, 0, moving);
  wsOpenIds.add(WS_ROOT_FAVORITES);
  wsOpenIds.add(`favfolder:${targetFolderId}`);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.moved", { name: moving.name, folder: wsFavoriteFolderLabel(targetFolderId) }));
    return true;
  } catch (error) {
    wsFavorites = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true); showError(message);
    return false;
  }
}

async function wsReorderFavoriteFolder(folderId, targetFolderId, placeAfter = false) {
  if (!folderId || folderId === targetFolderId) return false;
  const sourceIndex = wsFavoriteFolders.findIndex(folder => folder.id === folderId);
  if (sourceIndex < 0) return false;
  const previous = wsFavoriteFolders.map(folder => ({ ...folder }));
  const [moving] = wsFavoriteFolders.splice(sourceIndex, 1);
  const targetIndex = wsFavoriteFolders.findIndex(folder => folder.id === targetFolderId);
  if (targetIndex < 0) { wsFavoriteFolders = previous; return false; }
  wsFavoriteFolders.splice(targetIndex + (placeAfter ? 1 : 0), 0, moving);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.folderMoved", { name: wsFavoriteFolderLabel(folderId) }));
    return true;
  } catch (error) {
    wsFavoriteFolders = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true); showError(message);
    return false;
  }
}

async function wsRemoveFavorite(cfg) {
  const item = wsFavoriteRecordFromCfg(cfg);
  if (!item) return;
  const previous = wsFavorites.map(favorite => ({ ...favorite }));
  const entryId = wsFavoriteEntryId(item);
  wsFavorites = wsFavorites.filter(favorite => wsFavoriteEntryId(favorite) !== entryId);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.removed", { name: item.name }));
  } catch (error) {
    wsFavorites = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true);
    showError(message);
  }
}

async function wsCreateFavoriteFolder(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = wsFavoriteFolders.find(folder => wsFavoriteFolderLabel(folder.id).toLowerCase() === clean.toLowerCase());
  if (existing) {
    setStatus(t("forceSheet.favorites.folderExists", { name: wsFavoriteFolderLabel(existing.id) }));
    return existing.id;
  }
  if (wsFavoriteFolders.length >= WS_FAVORITE_FOLDERS_MAX) {
    showError(t("forceSheet.favorites.folderLimit", { count: WS_FAVORITE_FOLDERS_MAX }));
    return null;
  }
  const folder = { id: `folder-${wsGenId()}`, name: clean, createdAt: new Date().toISOString() };
  const previous = wsFavoriteFolders.slice();
  wsFavoriteFolders.push(folder);
  wsOpenIds.add(WS_ROOT_FAVORITES);
  wsOpenIds.add(`favfolder:${folder.id}`);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.folderCreated", { name: folder.name }));
    return folder.id;
  } catch (error) {
    wsFavoriteFolders = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    showError(message);
    return null;
  }
}

async function wsRenameFavoriteFolder(folderId, name) {
  if (!folderId || folderId === WS_DEFAULT_FAVORITES_FOLDER_ID) return false;
  const clean = String(name || "").trim();
  const folder = wsFavoriteFolders.find(value => value.id === folderId);
  if (!folder || !clean) return false;
  const duplicate = wsFavoriteFolders.find(value => value.id !== folderId
    && wsFavoriteFolderLabel(value.id).toLowerCase() === clean.toLowerCase());
  if (duplicate) {
    setStatus(t("forceSheet.favorites.folderExists", { name: wsFavoriteFolderLabel(duplicate.id) }));
    return false;
  }
  if (folder.name === clean) return true;
  const previous = wsFavoriteFolders.map(value => ({ ...value }));
  wsFavoriteFolders = wsFavoriteFolders.map(value => value.id === folderId ? { ...value, name: clean } : value);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.folderRenamed", { name: clean }));
    return true;
  } catch (error) {
    wsFavoriteFolders = previous;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true);
    showError(message);
    return false;
  }
}

async function wsDeleteFavoriteFolder(folderId) {
  if (!folderId || folderId === WS_DEFAULT_FAVORITES_FOLDER_ID) return false;
  const folder = wsFavoriteFolders.find(value => value.id === folderId);
  if (!folder) return false;
  const previousFolders = wsFavoriteFolders.map(value => ({ ...value }));
  const previousFavorites = wsFavorites.map(value => ({ ...value }));
  const movedCount = wsFavorites.filter(favorite => favorite.folderId === folderId).length;
  wsFavoriteFolders = wsFavoriteFolders.filter(value => value.id !== folderId);
  const defaultSources = new Set(wsFavorites.filter(favorite => favorite.folderId === WS_DEFAULT_FAVORITES_FOLDER_ID).map(wsFavoriteIdentity));
  wsFavorites = wsFavorites.flatMap((favorite) => {
    if (favorite.folderId !== folderId) return [favorite];
    const source = wsFavoriteIdentity(favorite);
    if (defaultSources.has(source)) return [];
    defaultSources.add(source);
    return [{ ...favorite, folderId: WS_DEFAULT_FAVORITES_FOLDER_ID }];
  });
  wsOpenIds.delete(`favfolder:${folderId}`);
  dynChildrenCache.delete(`favfolder:${folderId}`);
  wsOpenIds.add(WS_ROOT_FAVORITES);
  wsOpenIds.add(`favfolder:${WS_DEFAULT_FAVORITES_FOLDER_ID}`);
  wsRefreshFavoritesTree();
  try {
    await wsPersistFavorites();
    setStatus(t("forceSheet.favorites.folderDeleted", { name: folder.name, count: movedCount }));
    return true;
  } catch (error) {
    wsFavoriteFolders = previousFolders;
    wsFavorites = previousFavorites;
    wsRefreshFavoritesTree();
    const message = error?.message || t("forceSheet.favorites.saveFailed");
    setStatus(message, true);
    showError(message);
    return false;
  }
}

function buildFavoriteCfgs(folderId = null) {
  return wsFavorites.filter(favorite => !folderId || favorite.folderId === folderId).map(favorite => {
    const cfg = {
      id: `fav:${favorite.folderId}:${wsFavoriteIdentity(favorite)}`,
      name: favorite.name,
      favorite: { ...favorite },
      favoriteShortcut: true,
      favoriteFolderId: favorite.folderId,
      favoriteEntryId: favorite.entryId,
    };
    if (favorite.kind === "listView") {
      cfg.subtitle = `${favorite.subtitle || favorite.objectName} · ${t("forceSheet.favorites.listView")}`;
      cfg.getDownloadGrid = () => getListViewDownloadGrid(favorite.objectName, favorite.salesforceId);
      cfg.getDetails = () => getListViewDetails(favorite.objectName, favorite.salesforceId, favorite.name);
      cfg.onOpen = () => openListView(favorite.objectName, favorite.salesforceId, favorite.name,
        [t("forceSheet.favorites.title"), wsFavoriteFolderLabel(favorite.folderId)], cfg);
    } else if (favorite.kind === "report") {
      cfg.subtitle = `${favorite.folder} · ${t("forceSheet.favorites.report")}`;
      cfg.getDownloadGrid = () => getReportDownloadGrid(favorite.salesforceId);
      cfg.getDetails = () => getReportDetails(favorite.salesforceId, favorite.name, favorite.folder);
      cfg.onOpen = () => openReport(favorite.salesforceId, favorite.name, favorite.folder,
        [t("forceSheet.favorites.title"), wsFavoriteFolderLabel(favorite.folderId)], cfg);
    } else {
      cfg.queryFile = true;
      cfg.subtitle = t("forceSheet.query.soqlFile");
      cfg.getDownloadGrid = () => getQueryDownloadGrid(favorite.soql);
      cfg.getDetails = () => wsQueryDetailsCards(favorite.salesforceId, favorite.name, favorite.soql);
      cfg.onOpen = () => {
        // Open the backing query file so the grid, breadcrumb and details all
        // describe the same thing. A favorite can outlive the file it points at.
        const node = wsFindNode(favorite.salesforceId);
        if (node?.type !== "soql") {
          setStatus(t("forceSheet.favorites.queryFileMissing", { name: favorite.name }), true);
          return;
        }
        openWorkspaceNode(node);
        setBreadcrumb([t("forceSheet.favorites.title"), wsFavoriteFolderLabel(favorite.folderId), favorite.name], null, cfg);
      };
    }
    return cfg;
  });
}

function buildFavoriteFolderCfgs() {
  return wsFavoriteFolders.map(folder => ({
    id: `favfolder:${folder.id}`,
    name: wsFavoriteFolderLabel(folder.id),
    folder: true,
    favoriteChildFolder: true,
    favoriteFolderId: folder.id,
    count: wsFavorites.filter(favorite => favorite.folderId === folder.id).length,
    load: async () => buildFavoriteCfgs(folder.id),
  }));
}

async function loadFavoritesRoot() {
  return buildFavoriteFolderCfgs();
}

// ── Dynamic loaders ───────────────────────────────────────────────────────

// Objects tree = only objects that actually have list views. One ListView
// SOQL query drives the whole tree (objects + their list views) instead of a
// REST call per object. List views with a null SobjectType (org-wide sharing
// views, etc.) can't be attributed to an object and are skipped.
// Some list views store SobjectType as the object's DurableId (a 15/18-char
// id like "01I5F000000iqdpUAA") instead of its API name — the tree then shows
// the raw id and the describe/query path can't resolve it. Detect those.
function isIdLikeSobjectType(name) {
  return /^[0-9][0-9A-Za-z]{14}(?:[0-9A-Za-z]{3})?$/.test(name);
}

// Map DurableId → QualifiedApiName via EntityDefinition. EntityDefinition's
// DurableId is the 15-char form; ListView.SobjectType may be the 18-char form,
// so match by prefix.
async function resolveSobjectIds(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const inList = ids.map(id => `'${id.replace(/'/g, "")}'`).join(", ");
  try {
    const res = await runSoql(session.host, session.sid,
      `SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE DurableId IN (${inList})`);
    for (const row of (res.records || [])) {
      const durable = row.DurableId || "";
      const match = ids.find(id => id === durable || id.startsWith(durable));
      if (match && row.QualifiedApiName) map.set(match, row.QualifiedApiName);
    }
  } catch (_) { /* leave unresolved ids as-is; openListView degrades gracefully */ }
  return map;
}

async function queryListViewsForWorkspaceFilter(term, objects) {
  const escaped = wsEscapeSoqlSearchTerm(term);
  if (!escaped) return [];
  const needle = String(term).trim().toLowerCase();
  // SobjectType supports equality/IN but Salesforce rejects LIKE because the
  // field is ID-backed. Resolve matching API names/labels first, then include
  // them as exact SobjectType values alongside list-view name matching.
  const objectNames = objects
    .filter(object => object.name.toLowerCase().includes(needle) || String(object.label || "").toLowerCase().includes(needle))
    .slice(0, 100)
    .map(object => `'${wsEscapeSoqlSearchTerm(object.name)}'`);
  const clauses = [`Name LIKE '%${escaped}%'`, `DeveloperName LIKE '%${escaped}%'`];
  if (objectNames.length) clauses.push(`SobjectType IN (${objectNames.join(", ")})`);
  return runSoqlAll(session.host, session.sid,
    `SELECT Id, Name, DeveloperName, SobjectType FROM ListView WHERE (${clauses.join(" OR ")}) ORDER BY SobjectType, Name`);
}

async function loadObjectsRoot(filterTerm = "") {
  const objects = await loadObjects(); // [{name, label}] cached — used for the object label subtitle
  const records = filterTerm
    ? await queryListViewsForWorkspaceFilter(filterTerm, objects)
    : (await runSoql(session.host, session.sid,
      "SELECT Id, Name, DeveloperName, SobjectType FROM ListView ORDER BY SobjectType, Name LIMIT 2000")).records || [];
  const apiNameById = await resolveSobjectIds(
    [...new Set(records.map(r => r.SobjectType).filter(s => s && isIdLikeSobjectType(s)))]);
  const labelByName = new Map(objects.map(o => [o.name, o.label]));
  // Only show objects that can actually be opened. Many list views belong to
  // objects that aren't queryable in this org (feature-gated: Order, Activity,
  // Employee, …) or to deleted objects — clicking them can only ever error.
  // loadObjects() is the org's queryable-sobject set; filter to it. Guard: if
  // that call failed (empty), skip the filter rather than empty the whole tree.
  const queryableNames = new Set(objects.map(o => o.name));
  const filterToQueryable = queryableNames.size > 0;
  const bySobject = new Map();
  for (const lv of records) {
    if (!lv.SobjectType) continue;
    const sobj = apiNameById.get(lv.SobjectType) || lv.SobjectType;
    if (filterToQueryable && !queryableNames.has(sobj)) continue;
    if (!bySobject.has(sobj)) bySobject.set(sobj, []);
    bySobject.get(sobj).push({ id: lv.Id, name: lv.Name, developerName: lv.DeveloperName });
  }
  return [...bySobject.keys()].sort((a, b) => a.localeCompare(b)).map(sobj => ({
    id: `obj:${sobj}`, name: sobj, subtitle: labelByName.get(sobj) || "", folder: true,
    load: async () => bySobject.get(sobj).map(lv => {
      const name = lv.name || lv.developerName;
      const cfg = {
        id: `objlv:${sobj}:${lv.id}`, name, subtitle: lv.developerName,
        favorite: {
          kind: "listView", salesforceId: lv.id, name, objectName: sobj,
          subtitle: labelByName.get(sobj) || sobj,
        },
        getDownloadGrid: () => getListViewDownloadGrid(sobj, lv.id),
        getDetails: () => getListViewDetails(sobj, lv.id, name),
        onOpen: () => openListView(sobj, lv.id, name, t("forceSheet.workspace.rootObjects"), cfg),
      };
      return cfg;
    }),
  }));
}

// The owner's key prefix says which bucket a report belongs to: the org (00D)
// owns the unfiled reports that have no folder parent, a User (005) owns the
// personal folder holding that user's own private reports, and a Folder (00l)
// owns anything filed into a real, named folder. Surface the first two as
// derived buckets — Salesforce names them like ordinary folders, and that name
// is localized — then list the named folders beside them. Note SOQL only ever
// returns the running user's own private reports, never anyone else's.
const REPORT_OWNER_UNFILED = "00D";
const REPORT_OWNER_PERSONAL = "005";

function reportOwnerPrefix(report) {
  return String(report.ownerId || "").slice(0, 3).toUpperCase();
}

function wsOrgFilterTerm() {
  return wsOrgSearchTerm;
}

function wsInvalidateOrgFilterTreeCache() {
  const isFilteredOrgNode = id => id === WS_ROOT_OBJECTS || id === WS_ROOT_REPORTS || /^(?:obj:|rpt[fg]:)/.test(id);
  for (const id of [...dynChildrenCache.keys()]) if (isFilteredOrgNode(id)) dynChildrenCache.delete(id);
  for (const id of [...dynLoadErrors.keys()]) if (isFilteredOrgNode(id)) dynLoadErrors.delete(id);
}

function wsEscapeSoqlSearchTerm(term) {
  return String(term || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function normalizeReportRecord(r) {
  return {
    id: r.Id, name: r.Name, developerName: r.DeveloperName || "", folderName: r.FolderName || "",
    ownerId: r.OwnerId || "",
  };
}

async function queryReportsForWorkspaceFilter(term) {
  const escaped = wsEscapeSoqlSearchTerm(term);
  if (!escaped) return [];
  const records = await runSoqlAll(session.host, session.sid,
    `SELECT Id, Name, DeveloperName, FolderName, OwnerId FROM Report WHERE (Name LIKE '%${escaped}%' OR DeveloperName LIKE '%${escaped}%' OR FolderName LIKE '%${escaped}%') ORDER BY FolderName, Name`);
  return records.map(normalizeReportRecord);
}

async function loadReportsRoot(filterTerm = "") {
  if (!filterTerm && allReportsLoadError) {
    allReportsCache = null;
    allReportsLoadError = null;
  }
  // Manual expansion still loads the complete tree. An active workspace
  // filter queries Report with that term, avoiding the expensive all-reports
  // preload in large orgs.
  const reports = filterTerm
    ? await queryReportsForWorkspaceFilter(filterTerm)
    : await loadAllReports({ throwOnError: true }); // [{id, name, developerName, folderName, ownerId}]
  const unfiled = [];
  const personal = [];
  const filed = [];
  for (const r of reports) {
    const prefix = reportOwnerPrefix(r);
    if (prefix === REPORT_OWNER_UNFILED) unfiled.push(r);
    else if (prefix === REPORT_OWNER_PERSONAL) personal.push(r);
    else filed.push(r);
  }
  const nodes = [];
  if (unfiled.length) nodes.push(reportBucketNode("public", t("forceSheet.workspace.reportsPublic"), unfiled));
  if (personal.length) nodes.push(reportBucketNode("private", t("forceSheet.workspace.reportsPrivate"), personal));
  nodes.push(...buildReportFolderNodes(filed));
  return nodes;
}

// A bucket holds its reports directly — there is no real folder to descend into.
function reportBucketNode(id, label, reports) {
  return {
    id: `rptg:${id}`, name: label, folder: true,
    load: async () => reports.map(r => reportLeafNode(r, label)),
  };
}

function reportLeafNode(report, folder) {
  const cfg = {
    id: `rpt:${report.id}`, name: report.name, subtitle: report.developerName,
    favorite: {
      kind: "report", salesforceId: report.id, name: report.name,
      folder, subtitle: report.developerName || "",
    },
    getDownloadGrid: () => getReportDownloadGrid(report.id),
    getDetails: () => getReportDetails(report.id, report.name, folder),
    onOpen: () => openReport(report.id, report.name, folder, t("forceSheet.workspace.rootReports"), cfg),
  };
  return cfg;
}

function buildReportFolderNodes(reports) {
  const byFolder = new Map();
  for (const r of reports) {
    const folder = r.folderName || t("dinaSheet.common.unfiled");
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(r);
  }
  return [...byFolder.keys()].sort((a, b) => a.localeCompare(b)).map(folder => ({
    id: `rptf:${folder}`, name: folder, folder: true,
    load: async () => byFolder.get(folder).map(r => reportLeafNode(r, folder)),
  }));
}

// ── Open handlers for dynamic files ───────────────────────────────────────

// Custom Metadata Types (__mdt) don't expose the standard audit/system fields,
// yet the list-view describe endpoint still emits them in its query — so the
// query fails with "No such column 'CreatedDate' on entity '…__mdt'". Drop
// those fields (only for __mdt) so the generated query runs.
const MDT_UNSUPPORTED_FIELDS = new Set([
  "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid",
  "systemmodstamp", "lastreferenceddate", "lastvieweddate", "isdeleted",
]);

function sanitizeListViewQuery(query, objectName) {
  if (!/__mdt$/i.test(objectName)) return query;
  const m = query.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+[\s\S]*)$/i);
  if (!m) return query;
  const kept = m[2].split(",").map(c => c.trim()).filter(Boolean)
    .filter(c => !MDT_UNSUPPORTED_FIELDS.has(c.toLowerCase()));
  if (!kept.length) return query;
  return `${m[1]}${kept.join(", ")}${m[3]}`;
}

// Fallback when the list-view describe endpoint is unavailable: query the
// object directly with a few of its own fields. Loses the list view's filter
// and column set, but shows real data instead of an error — and the exact
// SOQL stays visible in the query bar, so the fallback is transparent.
async function buildFallbackObjectQuery(objectName) {
  const fields = await loadFieldDescribe(objectName);
  if (!fields || !fields.length) return null;
  return `SELECT ${pickSampleFields(fields).join(", ")} FROM ${objectName} LIMIT 200`;
}

function escapeSheetFormulaString(value = "") {
  return String(value).replace(/"/g, '""');
}

async function getListViewFormula(objectName, listViewId) {
  try {
    const describe = await salesforceRequest(session.host, session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/listviews/${encodeURIComponent(listViewId)}/describe`);
    if (describe?.query) return `=SF_QUERY("${escapeSheetFormulaString(sanitizeListViewQuery(describe.query, objectName))}")`;
  } catch (_) {
    // Fall through to the object-query fallback below.
  }
  const fallback = await buildFallbackObjectQuery(objectName);
  return fallback ? `=SF_QUERY("${escapeSheetFormulaString(fallback)}")` : "";
}

// Run a SOQL statement to completion and shape it into a download grid.
// Shared by list-view downloads and favorited query files.
async function getSoqlDownloadGrid(soql) {
  const records = await runSoqlPaged(soql); // download every page, not page one
  const shaped = shapeQueryRecords(records, soql);
  return { version: 1, rows: [
    shaped.columns.map(v => ({ v })),
    ...shaped.records.map(record => shaped.columns.map(key => ({ v: record[key] ?? "" }))),
  ] };
}

// A favorited query file keeps its own copy of the SOQL (wsUpdateQueryDefinition
// syncs it), so it still downloads after the originating file is deleted.
async function getQueryDownloadGrid(soql) {
  const clean = String(soql || "").trim();
  if (!clean) throw new Error(t("forceSheet.favorites.emptyQuery"));
  return getSoqlDownloadGrid(clean);
}

async function getListViewDownloadGrid(objectName, listViewId) {
  const soql = await getListViewSoql(objectName, listViewId);
  if (!soql) return { version: 1, rows: [] };
  const grid = await getSoqlDownloadGrid(soql);
  // A header row plus at least one record means the described SOQL worked.
  if (grid.rows.length > 1 && grid.rows[0].length) return grid;

  // Some special list views return no usable rows from their described SOQL
  // even though the List View Results resource contains displayed records.
  // Fall back to that exact list view (same filters/columns), never to an
  // unfiltered object query, so Favorites workbook Object tabs stay populated.
  try {
    const result = await salesforceRequest(session.host, session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/listviews/${encodeURIComponent(listViewId)}/results`);
    const columns = (Array.isArray(result?.columns) ? result.columns : []).filter(column => column?.hidden !== true);
    const resultRecords = Array.isArray(result?.records) ? result.records : [];
    if (!columns.length || !resultRecords.length) return grid;
    const columnPath = (value) => String(value?.fieldNameOrPath || value?.fieldName || "");
    return { version: 1, rows: [
      columns.map((column, index) => ({ v: columnPath(column) || String(column.label || `Column ${index + 1}`) })),
      ...resultRecords.map((record) => {
        const cells = Array.isArray(record?.columns) ? record.columns : [];
        return columns.map((column, index) => {
          const fieldName = columnPath(column).toLowerCase();
          const cell = cells.find(value => columnPath(value).toLowerCase() === fieldName) || cells[index] || {};
          return { v: flattenCellValue(cell.displayValue ?? cell.value ?? "") };
        });
      }),
    ] };
  } catch (_) {
    return grid;
  }
}

async function getReportDownloadGrid(reportId) {
  const result = await salesforceRequest(session.host, session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}?includeDetails=true`);
  // A summary/grouped report can legitimately have no detail `rows` in its
  // JSON factMap even though the rendered report contains group and aggregate
  // data. Prefer Salesforce's workbook representation for downloads so the
  // Favorites XLSX tab contains the visible report instead of an empty sheet.
  // JSON remains the fallback for orgs where workbook export is unavailable.
  const exported = await fetchReportExportMatrix(session.host, session.sid, reportId, result);
  if (exported) return {
    version: 1,
    rows: exported.map(row => row.map(v => ({ v }))),
    formattedSheet: exported.formattedSheet || null,
  };
  if (isJoinedReport(result)) {
    return { version: 1, rows: buildJoinedMatrix(normalizeJoinedReport(result)).map(row => row.map(v => ({ v }))) };
  }
  const records = normalizeReportRows(result);
  const columns = records.length ? Object.keys(records[0]) : [];
  return { version: 1, rows: [columns.map(v => ({ v })), ...records.map(record => columns.map(key => ({ v: record[key] ?? "" })))] };
}

async function openListView(objectName, listViewId, label, rootLabel = t("forceSheet.workspace.rootObjects"), actionsCfg = null) {
  wsOpenFileId = null; // browsing a list view — not editing a user file
  switchMode("query");
  setBreadcrumb([...(Array.isArray(rootLabel) ? rootLabel : [rootLabel]), objectName, label], {
    kind: "listView", objectName, listViewId,
  }, actionsCfg || {
    name: label,
    favorite: { kind: "listView", salesforceId: listViewId, name: label, objectName, subtitle: objectName },
    getDownloadGrid: () => getListViewDownloadGrid(objectName, listViewId),
    getDetails: () => getListViewDetails(objectName, listViewId, label),
  });
  objectInputEl.value = "";
  soqlInputEl.value = "";
  showLoading(t("forceSheet.status.running"));
  try {
    const soql = await getListViewSoql(objectName, listViewId);
    if (!soql) {
      hideLoading();
      showError(t("dinaSheet.error.listViewQuery", { object: objectName }));
      return;
    }
    const sheetId = getActiveSheetId();
    tagSheetSource(sheetId, "object");
    browseMeta.set(sheetId, { kind: "object", objectName, listViewId, label, soql });
    const data = await getObjectEditData(objectName, soql);
    renderObjectSheet(sheetId, data);
    const state = getOrCreateState(sheetId);
    Object.assign(state, {
      mode: "query", soql, objectName, writeback: data.hasId,
      columns: data.columns, rowCount: data.records.length, totalSize: data.records.length,
      done: true, nextRecordsUrl: null, updatedAt: new Date().toISOString(), host: session.host,
      importTarget: "current-sheet",
    });
    hideLoading();
    syncFileDetails();
    setStatus(t("forceSheet.status.loaded", { count: data.records.length.toLocaleString() }));
  } catch (err) {
    hideLoading();
    showError(err?.message || t("dinaSheet.error.openObject", { object: objectName }));
  }
}

async function openReport(reportId, reportName, folder, rootLabel = t("forceSheet.workspace.rootReports"), actionsCfg = null) {
  wsOpenFileId = null; // browsing a report — not editing a user file
  switchMode("report");
  setBreadcrumb([...(Array.isArray(rootLabel) ? rootLabel : [rootLabel]), folder, reportName], {
    kind: "report", reportId,
  }, actionsCfg || {
    name: reportName,
    favorite: { kind: "report", salesforceId: reportId, name: reportName, folder, subtitle: "" },
    getDownloadGrid: () => getReportDownloadGrid(reportId),
    getDetails: () => getReportDetails(reportId, reportName, folder),
  });
  reportInputEl.value = "";
  showLoading(t("forceSheet.status.running"));
  try {
    const sheetId = getActiveSheetId();
    tagSheetSource(sheetId, "report");
    browseMeta.set(sheetId, { kind: "report", reportId, reportName, folder });
    const { matrix, exported } = await getReportEditMatrix(reportId);
    const writeback = await renderImportedMatrix(sheetId, matrix, { source: "report" });
    const state = getOrCreateState(sheetId);
    Object.assign(state, {
      mode: "report", reportId, reportName, objectName: writeback.objectName,
      writeback: writeback.writeback, columns: matrix[0] || [],
      rowCount: Math.max(0, matrix.length - 1), totalSize: Math.max(0, matrix.length - 1),
      done: true, nextRecordsUrl: null, updatedAt: new Date().toISOString(), host: session.host,
      importTarget: "current-sheet",
    });
    hideLoading();
    syncFileDetails();
    setStatus(t(exported ? "forceSheet.status.reportExported" : "forceSheet.status.loaded",
      { count: Math.max(0, matrix.length - 1).toLocaleString() }));
  } catch (err) {
    hideLoading();
    showError(err?.message || t("dinaSheet.error.openReport", { report: reportName }));
  }
}

// ── Objects / Reports: editable data ─────────────────────────────────────────
// Objects, reports, and imported files open as editable static cells. Any table
// with an Id column that resolves to one Salesforce object can use the reviewed
// Update flow; other tables stay local-only. Where a file's data came from — the list view's
// SOQL, a report's filters — is answered by the file-details panel rather than
// by a formula parked in A1.

const COLOR_EDIT   = "#fff2ac";  // an edited (dirty) cell
const COLOR_OK     = "#e6f4ea";  // a successfully-written row
const COLOR_ERR    = "#fce8e6";  // a row that failed to write
const COLOR_CLEAR  = "#ffffff";  // reset to default

// The SOQL behind an Object list view (used for both the read-only formula and
// the editable fetch). Empty when Salesforce exposes no query for the object.
async function getListViewSoql(objectName, listViewId) {
  const formula = await getListViewFormula(objectName, listViewId);
  const soql = formula.match(/^=SF_QUERY\("([\s\S]*)"\)$/)?.[1]?.replace(/""/g, '"') || "";
  return soql ? ensureIdInSoql(soql) : "";
}

// Ensure the query selects Id so the sheet can Update/Delete its records. Adds
// "Id, " after SELECT when it isn't already a top-level field. Skips aggregate
// queries (Id isn't valid there); subquery Ids don't count as the record Id.
function ensureIdInSoql(soql) {
  const m = soql.match(/^(\s*SELECT\s+)([\s\S]*?)(\s+FROM\s+[\s\S]*)$/i);
  if (!m) return soql;
  if (/(^|,)\s*id\s*(,|$)/i.test(m[2])) return soql;
  if (/\b(count|sum|avg|min|max)\s*\(|\bgroup\s+by\b/i.test(soql)) return soql;
  return `${m[1]}Id, ${m[2]}${m[3]}`;
}

// A SOQL result is one 2,000-row page; the rest hang off nextRecordsUrl. Follow
// them all so a list view over a large object opens whole instead of stopping at
// the first page, reporting progress because a six-figure object takes dozens of
// round trips.
async function runSoqlPaged(soql, { onProgress = null } = {}) {
  let result = await runSoql(session.host, session.sid, soql);
  const records = [...(result.records || [])];
  const total = Number(result.totalSize) || records.length;
  while (result.done === false && result.nextRecordsUrl) {
    onProgress?.(records.length, total);
    const raw = result.nextRecordsUrl;
    const path = raw.startsWith("/") ? raw : new URL(raw).pathname + new URL(raw).search;
    result = await salesforceRequest(session.host, session.sid, path);
    records.push(...(result.records || []));
  }
  return records;
}

// Objects edit fetch → editable rows keyed by record Id (kept out of the grid).
async function getObjectEditData(objectName, soql) {
  const records = await runSoqlPaged(soql, {
    onProgress: (fetched, total) => showLoading(t("forceSheet.status.streaming", {
      fetched: fetched.toLocaleString(), total: total.toLocaleString(),
    })),
  });
  return buildObjectEditData(objectName, records, soql);
}

// Flatten a field value to the string the grid displays — mirrors the render
// bridge's cell builder (relationship/nested objects → Name || Id || JSON). Used
// so the edit baseline equals what's shown, else relationship columns (Owner,
// CreatedBy, …) read as always-dirty and get swept into Update.
function flattenCellValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return v.Name || v.Id || JSON.stringify(v);
  return v;
}

function soqlTopLevelSelectClause(soql = "") {
  const select = /\bSELECT\b/i.exec(soql);
  if (!select) return "";
  const start = select.index + select[0].length;
  let depth = 0;
  let quoted = false;
  for (let index = start; index < soql.length; index++) {
    const char = soql[index];
    if (quoted) {
      if (char === "'" && soql[index + 1] === "'") { index += 1; continue; }
      if (char === "'" && soql[index - 1] !== "\\") quoted = false;
      continue;
    }
    if (char === "'") { quoted = true; continue; }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /^from\b/i.test(soql.slice(index)) && !/[A-Za-z0-9_]/.test(soql[index - 1] || "")) {
      return soql.slice(start, index).trim();
    }
  }
  return "";
}

function splitSoqlSelectExpressions(clause = "") {
  const expressions = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < clause.length; index++) {
    const char = clause[index];
    if (quoted) {
      if (char === "'" && clause[index + 1] === "'") { index += 1; continue; }
      if (char === "'" && clause[index - 1] !== "\\") quoted = false;
      continue;
    }
    if (char === "'") { quoted = true; continue; }
    if (char === "(") { depth += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); continue; }
    if (char === "," && depth === 0) {
      expressions.push(clause.slice(start, index).trim());
      start = index + 1;
    }
  }
  expressions.push(clause.slice(start).trim());
  return expressions.filter(Boolean);
}

function soqlFieldProjection(expression = "") {
  const fieldPath = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";
  const plain = new RegExp(`^(${fieldPath})$`).exec(expression.trim());
  if (plain) return { column: plain[1], path: plain[1] };
  const displayFunction = new RegExp(`^(?:toLabel|format|convertCurrency)\\s*\\(\\s*(${fieldPath})\\s*\\)$`, "i").exec(expression.trim());
  if (displayFunction) return { column: displayFunction[1], path: displayFunction[1] };
  return null;
}

function queryFieldProjections(soql = "") {
  const expressions = splitSoqlSelectExpressions(soqlTopLevelSelectClause(soql));
  if (!expressions.length) return [];
  const projections = expressions.map(soqlFieldProjection);
  return projections.every(Boolean) ? projections : [];
}

function recordOwnValue(record, key) {
  if (!record || typeof record !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  const actual = Object.keys(record).find(candidate => candidate.toLowerCase() === String(key).toLowerCase());
  return actual ? record[actual] : undefined;
}

function recordPathValue(record, path) {
  let value = record;
  for (const segment of String(path || "").split(".")) {
    value = recordOwnValue(value, segment);
    if (value == null) return value;
  }
  return value;
}

function shapeQueryRecords(records = [], soql = "") {
  const projections = queryFieldProjections(soql);
  const effective = projections.length
    ? projections
    : extractColumns(records).map(column => ({ column, path: column }));
  const columns = effective.map(projection => projection.column);
  const idProjection = effective.find(projection => projection.column.toLowerCase() === "id" && projection.path.toLowerCase() === "id");
  const rows = records.map(record => Object.fromEntries(effective.map(projection => [
    projection.column,
    flattenCellValue(recordPathValue(record, projection.path)),
  ])));
  // Only an exact top-level Id projection may identify the base record. A
  // relationship projection such as Owner.Id must never become Account.Id.
  const ids = idProjection ? records.map(record => recordOwnValue(record, idProjection.path) ?? "") : [];
  return { columns, records: rows, ids, hasId: Boolean(idProjection) };
}

// Shape already-fetched records into object edit data. Id stays as a visible
// but read-only column (record key); each column is resolved to its describe
// field (fieldByCol) for live validation — Id gets a synthetic non-updateable
// field so it reverts on edit even if describe didn't load.
async function buildObjectEditData(objectName, records, soql = "") {
  const shaped = shapeQueryRecords(records, soql);
  const { columns, ids } = shaped;
  const rows = shaped.records;
  const describe = (await loadFieldDescribe(objectName)) || [];
  const byName = new Map(describe.map(f => [String(f.name).toLowerCase(), f]));
  const byLabel = new Map();
  for (const field of describe) {
    const key = String(field.label || "").trim().toLowerCase();
    if (!key || byLabel.has(key)) { if (key) byLabel.set(key, null); continue; }
    byLabel.set(key, field);
  }
  const fieldByCol = columns.map(c => c.toLowerCase() === "id"
    ? { ...(byName.get("id") || { name: "Id", type: "id", nillable: false }), updateable: false }
    // Relationship projections such as Owner.Name are returned by Salesforce as
    // an `Owner` object column. They do not have a directly writable field with
    // that name (OwnerId is the DML field), so keep unmatched result columns
    // visible but explicitly read-only instead of allowing invalid DML keys.
    : (byName.get(c.toLowerCase())
      || ((field) => field && field.updateable === true && String(field.type).toLowerCase() !== "reference" ? field : null)(byLabel.get(c.trim().toLowerCase()))
      || { name: c, label: c, type: "unsupported", updateable: false }));
  return { objectName, columns, records: rows, ids, hasId: shaped.hasId, fieldByCol };
}

async function resolveObjectNameFromIds(ids = []) {
  const values = ids.map(id => String(id || "").trim()).filter(Boolean);
  if (!values.length || values.some(id => !/^[0-9A-Za-z]{15}(?:[0-9A-Za-z]{3})?$/.test(id))) return "";
  const prefixes = [...new Set(values.map(id => id.slice(0, 3)))];
  if (prefixes.length !== 1) return "";
  const objects = await loadObjects();
  return objects.find(item => item.keyPrefix === prefixes[0])?.name || "";
}

function matrixRecords(matrix = []) {
  const columns = (matrix[0] || []).map(value => String(value ?? "").trim());
  const idColumn = columns.findIndex(column => column.toLowerCase() === "id");
  if (idColumn < 0) return { columns, records: [], ids: [] };
  const records = matrix.slice(1).map(row => Object.fromEntries(columns.map((column, index) => [column, row?.[index] ?? ""])));
  return { columns, records, ids: records.map(record => record[columns[idColumn]]) };
}

async function renderImportedMatrix(sheetId, matrix, { source, objectName = "" } = {}) {
  const parsed = matrixRecords(matrix);
  const resolvedObject = objectName || await resolveObjectNameFromIds(parsed.ids);
  if (!parsed.records.length || !resolvedObject) {
    tagSheetSource(sheetId, source);
    renderReportSheet(sheetId, matrix);
    return { writeback: false, objectName: "" };
  }
  const data = await buildObjectEditData(resolvedObject, parsed.records);
  renderObjectSheet(sheetId, data, { source });
  return { writeback: data.hasId, objectName: resolvedObject };
}

// Object-picker query → open the fetched rows as an editable object sheet
// (View/Edit toggle + Update), reusing the browse machinery.
async function openObjectQueryAsBrowse(sheetId, objectName, soql, records) {
  setBreadcrumb([objectName], { kind: "object", objectName });
  tagSheetSource(sheetId, "object");
  browseMeta.set(sheetId, { kind: "object", objectName, listViewId: null, label: objectName, soql });
  const data = await buildObjectEditData(objectName, records, soql);
  renderObjectSheet(sheetId, data);
  setStatus(t("forceSheet.status.loaded", { count: data.records.length.toLocaleString() }));
}

// Editable report data. Past the 2,000-row cap the JSON result is short, so
// take the workbook export instead; `exported` tells the caller which arrived.
async function getReportEditMatrix(reportId) {
  const result = await salesforceRequest(session.host, session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}?includeDetails=true`);
  if (getReportTruncation(result)) {
    const exported = await fetchReportExportMatrix(session.host, session.sid, reportId, result);
    if (exported) return { matrix: exported, exported: true };
  }
  const grid = await getReportDownloadGrid(reportId);
  return { matrix: (grid.rows || []).map(row => row.map(cell => cell?.v ?? "")), exported: false };
}

function newEditMeta(overrides) {
  return {
    objectName: null, ids: null, hasId: false, fieldColStart: 0,
    rowCount: 0, colCount: 0, columns: [], original: [], fieldByCol: [],
    // lastValid mirrors the last accepted grid state; an invalid edit is
    // reverted to it, so a cell can never hold an invalid value.
    lastValid: [],
    dirtyRows: new Set(), editHighlighted: new Set(), pendingDml: false,
    ...overrides,
  };
}

function auditStorageKey() {
  const org = session?.userInfo?.organization_id || session?.host || "unknown";
  return `forceSheet.audit.v1.${org}`;
}

function normalizeAuditEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.map(entry => ({
    id: String(entry?.id || ""),
    objectName: String(entry?.objectName || ""),
    updatedAt: String(entry?.updatedAt || ""),
    rows: Array.isArray(entry?.rows) ? entry.rows.map(row => ({
      id: String(row?.id || ""),
      changes: Array.isArray(row?.changes) ? row.changes.map(change => ({
        field: String(change?.field || ""),
        before: String(change?.before ?? ""),
        after: String(change?.after ?? ""),
      })).filter(change => change.field) : [],
    })).filter(row => row.id && row.changes.length) : [],
  })).filter(entry => entry.objectName && entry.updatedAt && entry.rows.length)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, AUDIT_MAX_ENTRIES);
}

async function loadAuditEntries() {
  try {
    const key = auditStorageKey();
    auditEntries = normalizeAuditEntries((await chrome.storage.local.get(key))?.[key]);
  } catch (_) {
    auditEntries = [];
  }
}

async function persistAuditEntries() {
  const retained = auditEntries.slice(0, AUDIT_MAX_ENTRIES);
  while (retained.length > 1 && new TextEncoder().encode(JSON.stringify(retained)).length > AUDIT_MAX_BYTES) {
    retained.pop();
  }
  if (new TextEncoder().encode(JSON.stringify(retained)).length > AUDIT_MAX_BYTES) return false;
  auditEntries = retained;
  try {
    await chrome.storage.local.set({ [auditStorageKey()]: retained });
    return true;
  } catch (_) {
    return false;
  }
}

async function recordSuccessfulUpdates(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const objectName = entry.objectName;
    if (!objectName || !entry.id || !entry.changes?.length) continue;
    if (!grouped.has(objectName)) grouped.set(objectName, []);
    grouped.get(objectName).push({
      id: entry.id,
      changes: entry.changes.map(change => ({
        field: change.field,
        before: String(change.before ?? ""),
        after: String(change.after ?? ""),
      })),
    });
  }
  if (!grouped.size) return true;
  const updatedAt = new Date().toISOString();
  const added = [...grouped].map(([objectName, rows], index) => ({
    id: crypto.randomUUID?.() || `${updatedAt}-${index}`,
    objectName,
    updatedAt,
    rows,
  }));
  auditEntries = normalizeAuditEntries([...added, ...auditEntries]);
  return persistAuditEntries();
}

async function renderAuditSheet(sheetId) {
  if (!sheetId) return;
  const entries = [...auditEntries].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const state = getOrCreateState(sheetId);
  state.mode = "audit";
  state.fileName = t("dinaSheet.audit.title");
  state.updatedAt = entries[0]?.updatedAt || new Date().toISOString();
  state.host = session?.host || "";
  state.rowCount = entries.reduce((sum, entry) => sum + entry.rows.length, 0);
  state.writeback = entries.length > 0;
  tagSheetSource(sheetId, "audit");
  browseMeta.delete(sheetId);
  setSheetEditableIfActive(sheetId, true);
  clearSheet(sheetId);

  if (!entries.length) {
    window.QDBSheet?.renderMatrix?.(sheetId, [
      [t("dinaSheet.audit.title")],
      [t("dinaSheet.audit.empty")],
    ]);
    objEditMeta.delete(sheetId);
    refreshObjActions(sheetId);
    setStatus(t("dinaSheet.audit.emptyStatus"));
    syncFileDetails();
    return;
  }

  const objectNames = [...new Set(entries.map(entry => entry.objectName))];
  const describePairs = await Promise.all(objectNames.map(async objectName => [objectName, await loadFieldDescribe(objectName)]));
  const describes = new Map(describePairs.map(([objectName, fields]) => [
    objectName,
    new Map((fields || []).map(field => [String(field.name).toLowerCase(), field])),
  ]));
  const matrix = [];
  const auditRows = [];
  const titleCells = [];
  const headerCells = [];

  for (const entry of entries) {
    const fields = [];
    const seen = new Set();
    for (const row of entry.rows) for (const change of row.changes) {
      const key = change.field.toLowerCase();
      if (!seen.has(key)) { seen.add(key); fields.push(change.field); }
    }
    const colCount = fields.length + 2;
    const titleRow = matrix.length;
    matrix.push([`${entry.objectName} > ${detailsDate(entry.updatedAt)}`, ...Array(Math.max(0, colCount - 1)).fill("")]);
    for (let column = 0; column < colCount; column++) titleCells.push({ row: titleRow, column });
    const headerRow = matrix.length;
    const columns = [t("dinaSheet.audit.rollback"), "Id", ...fields];
    matrix.push(columns);
    for (let column = 0; column < colCount; column++) headerCells.push({ row: headerRow, column });

    for (const row of entry.rows) {
      const byField = new Map(row.changes.map(change => [change.field.toLowerCase(), change]));
      const rollback = fields.map(field => byField.get(field.toLowerCase())?.before ?? "");
      const after = fields.map(field => byField.get(field.toLowerCase())?.after ?? "");
      const gridRow = matrix.length;
      matrix.push(["☐", row.id, ...rollback]);
      const objectFields = describes.get(entry.objectName) || new Map();
      const fieldByCol = [
        { name: t("dinaSheet.audit.rollback"), type: "boolean", updateable: false },
        { ...(objectFields.get("id") || { name: "Id", type: "id" }), updateable: false },
        ...fields.map(field => objectFields.get(field.toLowerCase()) || { name: field, type: "unsupported", updateable: false }),
      ];
      auditRows.push({
        gridRow,
        objectName: entry.objectName,
        id: row.id,
        columns,
        fieldByCol,
        changedFields: new Set(row.changes.map(change => change.field.toLowerCase())),
        original: ["☐", row.id, ...after],
        lastValid: ["☐", row.id, ...rollback],
        selected: false,
      });
    }
    matrix.push(Array(colCount).fill(""));
  }

  window.QDBSheet?.renderMatrix?.(sheetId, matrix);
  if (titleCells.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, titleCells, "#d7eadf");
  if (headerCells.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, headerCells, "#e8f0fe");
  const meta = newEditMeta({
    kind: "audit",
    objectName: t("dinaSheet.audit.objectName"),
    hasId: true,
    auditRows,
    rowCount: auditRows.length,
    colCount: Math.max(0, ...auditRows.map(row => row.columns.length)),
  });
  objEditMeta.set(sheetId, meta);
  refreshObjActions(sheetId);
  setStatus(t(entries.length === 1 ? "dinaSheet.audit.loadedOne" : "dinaSheet.audit.loaded", { count: entries.length.toLocaleString() }));
  syncFileDetails();
}

async function openAuditSheet() {
  if (!window.QDBSheet) return;
  closePanel();
  if (!auditSheetId) auditSheetId = window.QDBSheet.addSheet?.(t("dinaSheet.sheet.audit")) || getActiveSheetId();
  else window.QDBSheet.activateSheet?.(auditSheetId);
  setBreadcrumb([t("dinaSheet.sheet.audit")]);
  await renderAuditSheet(auditSheetId);
  renderSheet();
  auditNavBtn?.classList.add("active");
}

// Object sheet (edit mode): editable data + guarded Salesforce updates.
function renderObjectSheet(sheetId, data, { source = "object" } = {}) {
  if (!sheetId) return;
  if (!data.hasId) {
    // No Id column (rare) — editable but no write-back.
    renderReportSheet(sheetId, [data.columns, ...data.records.map(r => data.columns.map(c => r[c] ?? ""))]);
    tagSheetSource(sheetId, source);
    return;
  }
  setSheetEditableIfActive(sheetId, true); // editable data (may come from a locked view)
  clearSheet(sheetId);
  window.QDBSheet?.render?.(sheetId, data.columns, data.records);
  tagSheetSource(sheetId, source);
  const rowCount = data.records.length, colCount = data.columns.length;
  // Baseline from what the grid actually shows (read back), so the dirty check
  // compares like-for-like across every data type. render commits synchronously,
  // so this reflects the just-rendered values. Booleans display as 1/0,
  // relationship objects as Name/Id, etc. — computing String(rawValue) instead
  // would mismatch those and flag untouched cells as dirty.
  const gridNow = window.QDBSheet?.getCellMatrix?.(sheetId, 1, 0, rowCount, colCount - 1) || [];
  const original = gridNow.length >= rowCount
    ? data.records.map((_, i) => data.columns.map((__, j) => String(gridNow?.[i]?.[j] ?? "")))
    : data.records.map(r => data.columns.map(c => String(r[c] ?? ""))); // fallback if read races
  const meta = newEditMeta({
    objectName: data.objectName, columns: data.columns, ids: data.ids, hasId: true,
    fieldColStart: 0, rowCount, colCount,
    fieldByCol: data.fieldByCol || [],
    original,
  });
  meta.lastValid = meta.original.map(row => [...row]); // accepted-state mirror
  objEditMeta.set(sheetId, meta);
  refreshObjActions(sheetId);
}

// Report (or Id-less object) sheet: editable data, local highlight only.
function renderReportSheet(sheetId, matrix) {
  if (!sheetId) return;
  setSheetEditableIfActive(sheetId, true); // editable data (may come from a locked view)
  clearSheet(sheetId);
  window.QDBSheet?.renderMatrix?.(sheetId, matrix);
  const meta = newEditMeta({
    fieldColStart: 0,
    rowCount: Math.max(0, matrix.length - 1),
    colCount: matrix[0]?.length || 0,
    original: matrix.slice(1).map(row => row.map(v => String(v ?? ""))),
  });
  objEditMeta.set(sheetId, meta);
  refreshObjActions(sheetId);
}

// Record where a sheet's data came from. Object, report, and audit sources can
// carry guarded update metadata; clear stale metadata for every other source.
function tagSheetSource(sheetId, src) {
  if (!sheetId) return;
  sheetSource.set(sheetId, src);
  if (src !== "object" && src !== "report" && src !== "audit") { objEditMeta.delete(sheetId); browseMeta.delete(sheetId); }
}

// ── Edit highlighting (Objects + Reports) ──
let recomputeTimer = 0;
function scheduleRecomputeEdits() {
  clearTimeout(recomputeTimer);
  recomputeTimer = window.setTimeout(() => recomputeEdits(getActiveSheetId()), 150);
}
function recomputeEdits(sheetId) {
  const meta = objEditMeta.get(sheetId);
  if (meta?.kind === "audit") { recomputeAuditEdits(sheetId, meta); return; }
  if (!meta || !meta.rowCount || !meta.colCount) return;
  const cur = window.QDBSheet?.getCellMatrix?.(sheetId, 1, meta.fieldColStart, meta.rowCount, meta.fieldColStart + meta.colCount - 1) || [];

  // Pass 1: validate cells that changed since the last accepted state. Invalid
  // edits are reverted to the last valid value (non-coercing write); valid
  // edits are accepted into lastValid.
  const reverts = []; // { row, column, value, i, j, field, err }
  for (let i = 0; i < meta.rowCount; i++) {
    for (let j = 0; j < meta.colCount; j++) {
      const now = String(cur?.[i]?.[j] ?? "");
      const prev = String(meta.lastValid?.[i]?.[j] ?? "");
      if (now === prev) continue; // unchanged since last accepted
      const f = meta.fieldByCol?.[j];
      const err = f ? validateFieldValue(f, now) : null;
      if (err) reverts.push({ row: i + 1, column: meta.fieldColStart + j, value: prev, i, j, field: meta.columns[j], err });
      else meta.lastValid[i][j] = now; // accept
    }
  }
  for (const rv of reverts) window.QDBSheet?.setCellData?.(sheetId, rv.row, rv.column, rv.value);
  if (reverts.length) {
    const r0 = reverts[0];
    setStatus(t("dinaSheet.status.reverted", { row: r0.i + 2, field: r0.field, error: r0.err }), true);
  }

  // Pass 2: highlight the accepted-state cells that differ from the load (dirty).
  const edited = [];
  const dirty = new Set();
  for (let i = 0; i < meta.rowCount; i++) {
    for (let j = 0; j < meta.colCount; j++) {
      if (String(meta.original?.[i]?.[j] ?? "") !== String(meta.lastValid?.[i]?.[j] ?? "")) {
        edited.push({ row: i + 1, column: meta.fieldColStart + j });
        dirty.add(i);
      }
    }
  }
  const nextKeys = new Set(edited.map(c => `${c.row},${c.column}`));
  const toSet = edited.filter(c => !meta.editHighlighted.has(`${c.row},${c.column}`));
  const toClear = [...meta.editHighlighted].filter(k => !nextKeys.has(k))
    .map(k => { const [r, c] = k.split(",").map(Number); return { row: r, column: c }; });
  if (toSet.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, toSet, COLOR_EDIT);
  if (toClear.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, toClear, COLOR_CLEAR);
  meta.editHighlighted = nextKeys;
  meta.dirtyRows = dirty;
  refreshObjActions(sheetId);
}

function recomputeAuditEdits(sheetId, meta) {
  if (!meta?.auditRows?.length) return;
  const edited = [];
  const dirty = new Set();
  for (let i = 0; i < meta.auditRows.length; i++) {
    const row = meta.auditRows[i];
    const cur = window.QDBSheet?.getCellMatrix?.(sheetId, row.gridRow, 0, row.gridRow, row.columns.length - 1)?.[0] || [];
    const selected = /^(?:☑|true|1|yes)$/i.test(String(cur[0] ?? "").trim());
    row.selected = selected;
    if (String(cur[1] ?? "") !== row.id) window.QDBSheet?.setCellData?.(sheetId, row.gridRow, 1, row.id);
    for (let j = 2; j < row.columns.length; j++) {
      const now = String(cur[j] ?? "");
      const prev = String(row.lastValid[j] ?? "");
      if (now === prev) continue;
      const field = row.fieldByCol[j];
      const allowed = row.changedFields.has(String(field?.name || row.columns[j]).toLowerCase());
      const err = allowed && field ? validateFieldValue(field, now) : t("dinaSheet.validation.notReceiptField");
      if (err) {
        window.QDBSheet?.setCellData?.(sheetId, row.gridRow, j, prev);
        setStatus(t("dinaSheet.status.reverted", { row: row.gridRow + 1, field: row.columns[j], error: err }), true);
      } else {
        row.lastValid[j] = now;
      }
    }
    const changedCells = [];
    for (let j = 2; j < row.columns.length; j++) {
      const field = row.fieldByCol[j];
      if (field?.updateable === true && row.changedFields.has(String(field.name).toLowerCase())
          && String(row.original[j] ?? "") !== String(row.lastValid[j] ?? "")) {
        changedCells.push({ row: row.gridRow, column: j });
      }
    }
    if (selected && changedCells.length) {
      dirty.add(i);
      edited.push({ row: row.gridRow, column: 0 }, ...changedCells);
    }
  }
  const nextKeys = new Set(edited.map(cell => `${cell.row},${cell.column}`));
  const toSet = edited.filter(cell => !meta.editHighlighted.has(`${cell.row},${cell.column}`));
  const toClear = [...meta.editHighlighted].filter(key => !nextKeys.has(key)).map(key => {
    const [row, column] = key.split(",").map(Number);
    return { row, column };
  });
  if (toSet.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, toSet, COLOR_EDIT);
  if (toClear.length) window.QDBSheet?.setCellBackgroundCells?.(sheetId, toClear, COLOR_CLEAR);
  meta.editHighlighted = nextKeys;
  meta.dirtyRows = dirty;
  refreshObjActions(sheetId);
}

// Keep the picklist control synchronized with the grid's native selection.
function onGridSelection(sel) {
  const sheetId = getActiveSheetId();
  const meta = objEditMeta.get(sheetId);
  if (meta?.kind === "audit" && sel && sel.startRow === sel.endRow && sel.startCol === 0 && sel.endCol === 0) {
    const auditRow = meta.auditRows.find(row => row.gridRow === sel.startRow);
    if (auditRow) {
      auditRow.selected = !auditRow.selected;
      window.QDBSheet?.setCellData?.(sheetId, auditRow.gridRow, 0, auditRow.selected ? "☑" : "☐");
      recomputeAuditEdits(sheetId, meta);
      return;
    }
  }
  updatePicklistPicker(sheetId, sel);
}

// ── Object/Report browse action bar (mode toggle + write-back) ──
function refreshObjActions(sheetId) {
  // Async loads and DML can finish after the user activates another tab. Do not
  // let completion for a background sheet rewrite the active sheet's toolbar.
  if (sheetId && sheetId !== getActiveSheetId()) return;
  const meta = objEditMeta.get(sheetId);
  // Updates are reviewed and confirmed in the Changed fields card.
  const writable = !!meta?.hasId && !!meta.objectName;
  if (objActionsEl) objActionsEl.hidden = !writable;
  if (!writable) {
    hidePicklistPicker();
    renderChangesCard();
    return;
  }
  renderChangesCard(); // edits and DML state both land here
}

// ── Picklist cell picker (toolbar) ──
// When a single picklist cell is selected in an Object edit sheet, show a
// dropdown of the field's allowed values in the header; picking writes the
// value into that cell (non-coercing).
let picklistTarget = null; // { sheetId, gridRow, col }

function hidePicklistPicker() {
  picklistTarget = null;
  if (objPicklistWrap) objPicklistWrap.hidden = true;
}

function updatePicklistPicker(sheetId, sel) {
  const meta = objEditMeta.get(sheetId);
  const editingObj = !!meta?.hasId && !!meta.objectName;
  const singleCell = sel && sel.startRow === sel.endRow && sel.startCol === sel.endCol && sel.startRow >= 1;
  const j = singleCell ? sel.startCol - meta.fieldColStart : -1;
  const field = (editingObj && j >= 0 && j < meta.colCount) ? meta.fieldByCol?.[j] : null;
  if (!field || String(field.type).toLowerCase() !== "picklist") { hidePicklistPicker(); return; }

  const gridRow = sel.startRow;
  const col = meta.fieldColStart + j;
  const currentVal = String(window.QDBSheet?.getCellMatrix?.(sheetId, gridRow, col, gridRow, col)?.[0]?.[0] ?? "");
  const values = (field.picklistValues || []).filter(p => p.active !== false).map(p => String(p.value));
  const options = [];
  if (field.nillable !== false) options.push({ value: "", label: t("dinaSheet.picklist.none") });
  for (const v of values) options.push({ value: v, label: v });
  if (currentVal && !values.includes(currentVal)) options.push({ value: currentVal, label: t("dinaSheet.picklist.current", { value: currentVal }) });
  objPicklistSel.replaceChildren(...options.map(o => {
    const el = document.createElement("option");
    el.value = o.value; el.textContent = o.label; return el;
  }));
  objPicklistSel.value = currentVal;
  objPicklistLabel.textContent = `${field.label || field.name}:`;
  objPicklistWrap.hidden = false;
  picklistTarget = { sheetId, gridRow, col };
}

function setupObjectActions() {
  detailsCloseBtn?.addEventListener("click", closeFileDetails);
  detailsToggleBtn?.addEventListener("click", toggleFileDetails);
  objPicklistSel?.addEventListener("change", () => {
    if (!picklistTarget) return;
    const { sheetId, gridRow, col } = picklistTarget;
    window.QDBSheet?.setCellData?.(sheetId, gridRow, col, objPicklistSel.value);
    scheduleRecomputeEdits();
  });
}

function formatDmlError(r) {
  return (r?.errors || []).map(e => [e.statusCode, e.message].filter(Boolean).join(": ")).join("; ");
}

// Pending edits as a write payload: one entry per dirty row, carrying the record
// Id and each changed field's before/after. Shared by the details panel's
// "Changed fields" card and by the update itself, so what you review is exactly
// what gets sent.
function collectPendingChanges(sheetId, meta) {
  if (meta?.kind === "audit") {
    const payload = [];
    for (const i of [...meta.dirtyRows].sort((a, b) => meta.auditRows[a].gridRow - meta.auditRows[b].gridRow)) {
      const row = meta.auditRows[i];
      const rec = { Id: row.id };
      const changes = [];
      for (let j = 2; j < row.columns.length; j++) {
        const field = row.fieldByCol[j];
        if (!field || field.updateable !== true || !row.changedFields.has(String(field.name).toLowerCase())) continue;
        const before = String(row.original[j] ?? "");
        const after = String(row.lastValid[j] ?? "");
        if (before === after) continue;
        rec[field.name] = after === "" ? null : after;
        changes.push({ field: field.name, before, after });
      }
      if (changes.length) payload.push({ dataRow: i, auditRowIndex: i, gridRow: row.gridRow, objectName: row.objectName, id: row.id, rec, changes });
    }
    return payload;
  }
  if (!meta || !meta.hasId || !meta.dirtyRows.size) return [];
  const cur = window.QDBSheet?.getCellMatrix?.(sheetId, 1, meta.fieldColStart, meta.rowCount, meta.fieldColStart + meta.colCount - 1) || [];
  const payload = []; // { dataRow, id, rec, changes:[{ field, before, after }] }
  for (const i of [...meta.dirtyRows].sort((a, b) => a - b)) {
    const id = meta.ids[i];
    if (!id) continue;
    const rec = { Id: id };
    const changes = [];
    for (let j = 0; j < meta.colCount; j++) {
      const field = meta.fieldByCol?.[j];
      if (!field || field.updateable !== true) continue; // Id, relationships, and other read-only fields
      const before = String(meta.original?.[i]?.[j] ?? "");
      const after = cur?.[i]?.[j];
      const afterStr = String(after ?? "");
      if (before !== afterStr) {
        const fieldName = field.name || meta.columns[j];
        rec[fieldName] = (after === "" || after == null) ? null : after;
        changes.push({ field: fieldName, before, after: afterStr });
      }
    }
    if (changes.length) payload.push({ dataRow: i, objectName: meta.objectName, id, rec, changes });
  }
  return payload;
}

async function runObjectUpdate() {
  const sheetId = getActiveSheetId();
  const meta = objEditMeta.get(sheetId);
  if (!meta || !meta.hasId || meta.pendingDml || meta.dirtyRows.size === 0) return;
  const payload = collectPendingChanges(sheetId, meta);
  if (!payload.length) return;
  // Guard the fast-click race: an invalid value typed just before the debounced
  // revert fires would otherwise reach here. Re-validate synchronously; if any
  // change is invalid, revert it now and abort the update.
  for (const entry of payload) {
    for (const c of entry.changes) {
      const f = meta.kind === "audit"
        ? meta.auditRows?.[entry.auditRowIndex]?.fieldByCol?.find(field => field?.name === c.field)
        : meta.fieldByCol?.find(field => field?.name === c.field);
      const err = f ? validateFieldValue(f, c.after) : null;
      if (err) {
        recomputeEdits(sheetId); // reverts the invalid cell(s)
        setStatus(t("dinaSheet.status.reverted", { row: entry.gridRow != null ? entry.gridRow + 1 : entry.dataRow + 2, field: c.field, error: err }), true);
        return;
      }
    }
  }
  showObjectUpdateModal(payload, meta.objectName, () => void doObjectUpdate(sheetId, meta, payload));
}

// ── Field-type validation (Objects) ──
// Runs live from recomputeEdits: a changed cell whose value is invalid for its
// describe field is painted red and blocks the write (see refreshObjActions).
// Numeric field types whose value must parse as a plain number.
const NUMERIC_FIELD_TYPES = new Set(["int", "double", "currency", "percent"]);

function picklistHas(f, value) {
  return (f.picklistValues || []).some(p => p.active !== false && String(p.value) === value);
}

// Returns an error string when `raw` is invalid for field `f`, else null.
function validateFieldValue(f, raw) {
  const val = raw == null ? "" : String(raw);
  if (f.updateable === false) return t("dinaSheet.validation.readOnly");
  if (val.trim() === "") return f.nillable === false ? t("dinaSheet.validation.required") : null;
  const type = String(f.type || "").toLowerCase();
  if (NUMERIC_FIELD_TYPES.has(type)) {
    if (!/^[+-]?\d*\.?\d+$/.test(val.trim())) return t("dinaSheet.validation.number", { type });
  } else if (type === "boolean") {
    if (!/^(true|false|1|0|yes|no)$/i.test(val.trim())) return t("dinaSheet.validation.boolean");
  } else if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val.trim()) || isNaN(Date.parse(val.trim()))) return t("dinaSheet.validation.date");
  } else if (type === "datetime") {
    if (isNaN(Date.parse(val.trim()))) return t("dinaSheet.validation.datetime");
  } else if (type === "picklist") {
    if (!picklistHas(f, val)) return t("dinaSheet.validation.picklist");
  } else if (type === "multipicklist") {
    const bad = val.split(";").map(s => s.trim()).filter(v => v && !picklistHas(f, v));
    if (bad.length) return t("dinaSheet.validation.notAllowed", { values: bad.join(", ") });
  } else if (type === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val.trim())) return t("dinaSheet.validation.email");
  }
  if (f.length && val.length > f.length) return t("dinaSheet.validation.tooLong", { length: f.length });
  return null;
}

// Confirmation modal listing exactly what will be pushed: for each record its
// grid row, object API name + record Id, and every changed field as "before → after".
function showObjectUpdateModal(entries, objectName, onConfirm) {
  const n = entries.length;
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal fs-modal-wide";
  dialog.innerHTML = `
    <p class="fs-modal-title"></p>
    <div class="fs-update-list"></div>
    <div class="fs-modal-actions">
      <button type="button" class="fs-modal-btn" data-action="cancel"></button>
      <button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button>
    </div>
  `;
  dialog.querySelector(".fs-modal-title").textContent = t(n === 1 ? "dinaSheet.update.confirmTitleOne" : "dinaSheet.update.confirmTitle", { count: n.toLocaleString() });
  dialog.querySelector("[data-action='cancel']").textContent = t("dinaSheet.common.cancel");
  dialog.querySelector("[data-action='confirm']").textContent = t("dinaSheet.common.update");
  const list = dialog.querySelector(".fs-update-list");
  for (const e of entries) {
    const rec = document.createElement("div");
    rec.className = "fs-update-rec";
    const head = document.createElement("div");
    head.className = "fs-update-rec-head";
    // +2: data record 0 sits under the column-header row, so it shows as row 2
    // in the grid's row gutter. Header: "Row N · <ObjectApiName> : <Id>".
    head.append(t("dinaSheet.update.row", { row: e.gridRow != null ? e.gridRow + 1 : e.dataRow + 2, object: e.objectName || objectName }));
    const idSpan = document.createElement("span");
    idSpan.className = "fs-update-rec-id";
    idSpan.textContent = e.id;
    head.append(idSpan);
    rec.append(head);
    for (const c of e.changes) {
      const line = document.createElement("div");
      line.className = "fs-update-change";
      const field = document.createElement("span");
      field.className = "fs-update-field";
      field.textContent = `${c.field}: `;
      const before = document.createElement("span");
      before.className = "fs-update-before";
      before.textContent = c.before === "" ? t("dinaSheet.common.empty") : c.before;
      const arrow = document.createElement("span");
      arrow.className = "fs-update-arrow";
      arrow.textContent = " → ";
      const after = document.createElement("span");
      after.className = "fs-update-after";
      after.textContent = c.after === "" ? t("dinaSheet.common.empty") : c.after;
      line.append(field, before, arrow, after);
      rec.append(line);
    }
    list.append(rec);
  }
  document.body.appendChild(dialog);
  dialog.showModal();
  const close = (confirmed) => { dialog.close(); dialog.remove(); if (confirmed) onConfirm(); };
  dialog.querySelector("[data-action='cancel']").onclick = () => close(false);
  dialog.querySelector("[data-action='confirm']").onclick = () => close(true);
  dialog.addEventListener("cancel", () => { dialog.remove(); });
}

async function doObjectUpdate(sheetId, meta, payload) {
  meta.pendingDml = true;
  refreshObjActions(sheetId);
  setStatus(t(payload.length === 1 ? "dinaSheet.update.updatingOne" : "dinaSheet.update.updating", { count: payload.length.toLocaleString() }));
  try {
    const grouped = new Map();
    for (const entry of payload) {
      const objectName = entry.objectName || meta.objectName;
      if (!grouped.has(objectName)) grouped.set(objectName, []);
      grouped.get(objectName).push(entry);
    }
    const outcomes = [];
    for (const [objectName, entries] of grouped) {
      try {
        const results = await updateRecords(session.host, session.sid, objectName, entries.map(entry => entry.rec), false);
        entries.forEach((entry, index) => outcomes.push({ entry, result: results[index] }));
      } catch (error) {
        entries.forEach(entry => outcomes.push({ entry, error }));
      }
    }
    const okDataRows = [], errRows = [], successful = [];
    let firstErr = "";
    outcomes.forEach(({ entry, result: r, error }) => {
      const i = entry.dataRow;
      if (r && r.success) {
        okDataRows.push(i);
        successful.push(entry);
        // Advance the baseline only to the values actually submitted. If the
        // user changed a cell while this request was in flight, recomputeEdits
        // below keeps that newer, unsent value dirty.
        if (meta.kind === "audit") {
          const row = meta.auditRows[entry.auditRowIndex];
          const current = window.QDBSheet?.getCellMatrix?.(sheetId, row.gridRow, 0, row.gridRow, row.columns.length - 1)?.[0] || [];
          const submittedStillCurrent = entry.changes.every(change => {
            const j = row.fieldByCol.findIndex(field => field?.name === change.field);
            return j >= 0 && String(current[j] ?? "") === String(change.after ?? "");
          });
          for (const change of entry.changes) {
            const j = row.fieldByCol.findIndex(field => field?.name === change.field);
            if (j >= 0) row.original[j] = change.after;
          }
          if (submittedStillCurrent) {
            row.selected = false;
            window.QDBSheet?.setCellData?.(sheetId, row.gridRow, 0, "☐");
          }
        } else {
          for (const change of entry.changes) {
            const j = meta.fieldByCol?.findIndex(field => field?.name === change.field) ?? -1;
            if (j >= 0) meta.original[i][j] = change.after;
          }
        }
      } else {
        errRows.push(entry.gridRow != null ? entry.gridRow : i + 1);
        if (!firstErr) firstErr = error?.message || (r ? (formatDmlError(r) || t("dinaSheet.update.failed")) : t("dinaSheet.error.noDmlResult"));
      }
    });
    const auditSaved = await recordSuccessfulUpdates(successful);
    recomputeEdits(sheetId);
    if (meta.kind !== "audit") {
      const cleanOkRows = okDataRows.filter(i => !meta.dirtyRows.has(i)).map(i => i + 1);
      const colCount = meta.fieldColStart + meta.colCount;
      if (cleanOkRows.length) window.QDBSheet?.setCellBackgrounds?.(sheetId, cleanOkRows, colCount, COLOR_OK);
      if (errRows.length) window.QDBSheet?.setCellBackgrounds?.(sheetId, errRows, colCount, COLOR_ERR);
    }
    setStatus(
      errRows.length
        ? t("dinaSheet.update.partial", { success: okDataRows.length.toLocaleString(), failed: errRows.length.toLocaleString(), error: firstErr })
        : `${t(okDataRows.length === 1 ? "dinaSheet.update.successOne" : "dinaSheet.update.success", { count: okDataRows.length.toLocaleString() })}${t(auditSaved ? "dinaSheet.update.successAudit" : "dinaSheet.update.auditFailed")}`,
      errRows.length > 0 || !auditSaved);
  } catch (err) {
    setStatus(err?.message || t("dinaSheet.update.failed"), true);
  } finally {
    meta.pendingDml = false;
    if (objEditMeta.get(sheetId) === meta) refreshObjActions(sheetId);
  }
}

// ── Breadcrumb ────────────────────────────────────────────────────────────

let currentBreadcrumbState = null;

function salesforceBreadcrumbUrl(target) {
  if (!session?.host || !target) return "";
  const base = `https://${session.host}`;
  if (target.kind === "listView" && target.objectName && target.listViewId) {
    return `${base}/lightning/o/${encodeURIComponent(target.objectName)}/list?filterName=${encodeURIComponent(target.listViewId)}`;
  }
  if (target.kind === "report" && target.reportId) {
    return `${base}/lightning/r/Report/${encodeURIComponent(target.reportId)}/view`;
  }
  if (target.kind === "object" && target.objectName) {
    return `${base}/lightning/o/${encodeURIComponent(target.objectName)}/list`;
  }
  return "";
}

function appendBreadcrumbActions(cfg) {
  if (!cfg || !breadcrumbEl) return;
  const actions = [];
  if (cfg.getDetails) actions.push({
    icon: "details", label: t("dinaSheet.action.viewDetails"),
    action: () => void openFileDetails(cfg),
  });
  if (cfg.favorite) {
    // A source row (Objects/Reports/Query) can point at an already-favorited
    // item — say so instead of always offering to add it again.
    const saved = cfg.favoriteShortcut || wsIsFavorite(cfg);
    actions.push({
      icon: "favorite",
      active: saved,
      label: t(cfg.favoriteShortcut ? "forceSheet.favorites.remove"
        : saved ? "forceSheet.favorites.editFolders" : "forceSheet.favorites.add"),
      action: () => cfg.favoriteShortcut ? void wsRemoveFavorite(cfg) : wsShowFavoriteFolderDialog(cfg),
    });
  }
  if (cfg.getDownloadGrid) {
    actions.push({ icon: "excel", label: t("forceSheet.download.excel"), action: () => void wsDownloadDynamicCfg(cfg, "excel") });
    actions.push({ icon: "csv", label: t("forceSheet.download.csv"), action: () => void wsDownloadDynamicCfg(cfg, "csv") });
  }
  if (!actions.length) return;
  const host = document.createElement("span");
  host.className = "fs-crumb-actions";
  actions.forEach((shortcut) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fs-crumb-action-btn";
    button.title = shortcut.label;
    button.setAttribute("aria-label", shortcut.label);
    button.appendChild(wsCreateActionIcon(shortcut.icon, { active: shortcut.active }));
    button.addEventListener("click", shortcut.action);
    host.appendChild(button);
  });
  breadcrumbEl.appendChild(host);
}

// Renders "SheetD > a > b > … > SF [file actions]" in the header. The
// Salesforce icon appears only when the current file has a navigation target.
function setBreadcrumb(parts = [], salesforceTarget = null, actionsCfg = null) {
  if (!breadcrumbEl) return;
  currentBreadcrumbState = {
    parts: [...parts],
    salesforceTarget: salesforceTarget ? { ...salesforceTarget } : null,
    actionsCfg,
  };
  breadcrumbEl.replaceChildren();
  const root = document.createElement("span");
  root.className = "fs-crumb fs-crumb-root";
  root.textContent = "SheetD";
  breadcrumbEl.appendChild(root);
  let currentCrumb = null;
  for (const part of parts) {
    if (!part) continue;
    const sep = document.createElement("span");
    sep.className = "fs-crumb-sep";
    sep.textContent = "›";
    breadcrumbEl.appendChild(sep);
    const crumb = document.createElement("span");
    crumb.className = "fs-crumb";
    crumb.textContent = part;
    crumb.title = part;
    breadcrumbEl.appendChild(crumb);
    currentCrumb = crumb;
  }
  currentCrumb?.classList.add("fs-crumb-current");
  const href = salesforceBreadcrumbUrl(salesforceTarget);
  if (href) {
    const sep = document.createElement("span");
    sep.className = "fs-crumb-sep";
    sep.textContent = "›";
    breadcrumbEl.appendChild(sep);
    const link = document.createElement("a");
    link.className = "fs-crumb-sf-link";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "SF";
    link.title = t("forceSheet.openInSalesforce");
    link.setAttribute("aria-label", t("forceSheet.openInSalesforce"));
    breadcrumbEl.appendChild(link);
  }
  appendBreadcrumbActions(actionsCfg);
}

function currentFavoriteCfg(cfg) {
  if (!cfg?.favoriteShortcut) return cfg;
  const entryId = String(cfg.favoriteEntryId || cfg.favorite?.entryId || "");
  const favorite = wsFavorites.find(value => wsFavoriteEntryId(value) === entryId);
  if (!favorite) {
    const replacement = wsFavorites.find(value =>
      wsFavoriteIdentity(value) === wsFavoriteIdentity(cfg.favorite));
    if (replacement) {
      return buildFavoriteCfgs(replacement.folderId)
        .find(value => value.favoriteEntryId === replacement.entryId) || cfg;
    }
    // Removing a shortcut does not close its Salesforce data. Present the open
    // item as a source file so its action immediately changes to Add/Edit.
    return {
      ...cfg,
      favoriteShortcut: false,
      favoriteFolderId: "",
      favoriteEntryId: "",
      favorite: { ...cfg.favorite, entryId: "" },
    };
  }
  return buildFavoriteCfgs(favorite.folderId)
    .find(value => value.favoriteEntryId === entryId) || cfg;
}

function resolveBreadcrumbState(state) {
  if (!state) return null;
  let cfg = currentFavoriteCfg(state.actionsCfg);
  let parts = [...state.parts];

  if (cfg?.favoriteShortcut) {
    if (parts[0] === t("forceSheet.favorites.title") && parts.length > 1) {
      parts[1] = wsFavoriteFolderLabel(cfg.favoriteFolderId);
    }
    if (parts.length) parts[parts.length - 1] = cfg.name;
  } else if (cfg?.queryFile) {
    const queryId = cfg.id || cfg.favorite?.salesforceId;
    const node = wsFindNode(queryId);
    if (!node || node.type !== "soql") {
      return { parts: [], salesforceTarget: null, actionsCfg: null };
    }
    cfg = wsQueryCfgFromNode(node);
    if (parts.length) parts[parts.length - 1] = node.name;
  }

  return { parts, salesforceTarget: state.salesforceTarget, actionsCfg: cfg };
}

// Sidebar mutations must update the active file wherever it was opened from,
// including a Favorites child folder. Rebuild details only while it is visible.
function syncActiveFilePresentation({ details = true } = {}) {
  const resolved = resolveBreadcrumbState(currentBreadcrumbState);
  if (resolved) setBreadcrumb(resolved.parts, resolved.salesforceTarget, resolved.actionsCfg);
  if (details) syncFileDetails();
}

// ── Filter (name substring; keeps ancestors of matches) ───────────────────

// True while the user is filtering. The filter matches against rendered rows,
// so lazily-loaded folders auto-expand while a term is active (see
// wsRenderDynFolder) to make their children — list-view / report names —
// searchable.
function wsFilterActive() {
  return Boolean(wsOrgFilterTerm());
}

function applyWsFilter() {
  const term = wsOrgFilterTerm().toLowerCase();
  for (const child of wsTreeEl.children) wsFilterNode(child, term, false);
  wsUpdateFilterBusy();
}

// Returns true when el (or a descendant) matches; hides non-matching nodes.
function wsFilterNode(el, term, forceShow) {
  const rowName = (r) => (r?.querySelector(".schema-tree-primary")?.textContent || "").toLowerCase();
  if (el.classList.contains("schema-tree-folder")) {
    const row = el.querySelector(":scope > .schema-tree-row");
    const childrenEl = el.querySelector(":scope > .schema-tree-children");
    const selfMatch = !term || rowName(row).includes(term);
    let childMatch = false;
    if (childrenEl) {
      for (const c of childrenEl.children) {
        childMatch = wsFilterNode(c, term, forceShow || selfMatch) || childMatch;
      }
    }
    const show = forceShow || selfMatch || childMatch;
    el.classList.toggle("fs-filter-hidden", !show);
    return show;
  }
  if (el.classList.contains("schema-tree-row")) {
    const show = forceShow || !term || rowName(el).includes(term);
    el.classList.toggle("fs-filter-hidden", !show);
    return show;
  }
  return false; // empty/loading placeholder rows follow their parent
}

// Exactly one row is in the tab order (ARIA tree roving-tabindex pattern).
function wsApplyRovingTabindex() {
  const rows = wsTreeEl.querySelectorAll("[data-ws-id]");
  if (!rows.length) return;
  let focusRow = wsFocusId ? wsTreeEl.querySelector(`[data-ws-id="${wsFocusId}"]`) : null;
  if (!focusRow) { focusRow = rows[0]; wsFocusId = focusRow.dataset.wsId; }
  rows.forEach(r => { r.tabIndex = r === focusRow ? 0 : -1; });
}

function wsFocusRow(id) {
  wsFocusId = id;
  wsApplyRovingTabindex();
  wsTreeEl.querySelector(`[data-ws-id="${id}"]`)?.focus();
}

function wsRenderNode(node, depth, parentId = "") {
  return node.type === "folder" ? wsRenderFolderNode(node, depth, parentId) : wsRenderFileNode(node, depth, parentId);
}

function wsBuildRow(node, depth, isFolder, parentId = "") {
  // A div (not <button>) so the nested ⋮ action button is valid HTML; the
  // ARIA tree pattern (treeitem + roving tabindex) supplies the semantics.
  const row = document.createElement("div");
  row.className = "schema-tree-row" + (isFolder ? " schema-tree-folder-row" : "");
  row.classList.toggle("selected", node.id === wsActiveId);
  row.style.setProperty("--tree-indent", `${depth}rem`);
  row.dataset.wsId = node.id;
  if (parentId) row.dataset.wsParentId = parentId;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-selected", String(node.id === wsActiveId));
  if (isFolder) row.setAttribute("aria-expanded", String(wsOpenIds.has(node.id)));
  row.tabIndex = -1; // roving tabindex applied after render

  const caretOrSpacer = document.createElement("span");
  caretOrSpacer.className = isFolder ? "schema-tree-caret" : "schema-tree-indent";
  row.appendChild(caretOrSpacer);

  const icon = document.createElement("span");
  icon.className = `schema-tree-icon ${isFolder ? "folder" : "query"}`;
  row.appendChild(icon);

  const nameWrap = document.createElement("span");
  nameWrap.className = "schema-tree-name";
  const primary = document.createElement("span");
  primary.className = "schema-tree-primary";
  // Files display without the .csv suffix; folders show their name as-is.
  primary.textContent = isFolder ? node.name : wsDisplayName(node.name);
  nameWrap.appendChild(primary);
  row.appendChild(nameWrap);

  const trailing = document.createElement("span");
  trailing.className = "fs-ws-row-trailing";
  // Visible actions affordance (keyboard/touch path to the context menu)
  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "fs-ws-row-action-btn";
  actionBtn.tabIndex = -1; // menu is reachable via Shift+F10 on the row
  actionBtn.setAttribute("aria-label", "Actions");
  actionBtn.textContent = "⋮";
  actionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = actionBtn.getBoundingClientRect();
    wsShowContextMenu(isFolder ? node.id : null, node, rect.left, rect.bottom + 2);
  });
  trailing.appendChild(actionBtn);
  row.appendChild(trailing);

  row.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); wsShowContextMenu(isFolder ? node.id : null, node, e.clientX, e.clientY); });
  row.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); wsStartInlineRename(node, primary); });

  // Drag-and-drop reorder / re-parent (wired to wsMoveToIndex)
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    wsDragId = node.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
  });
  row.addEventListener("dragend", () => { wsDragId = null; wsClearDropMarkers(); });
  row.addEventListener("dragover", (e) => {
    if (wsDynDragCfg && isFolder) {
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      wsClearDropMarkers(); row.classList.add("drag-into"); return;
    }
    if (!wsDragId || wsDragId === node.id || wsIsDescendant(wsDragId, node.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    wsClearDropMarkers();
    const intent = wsDropIntent(e, row, isFolder);
    row.classList.add(intent === "into" ? "drag-into" : intent === "above" ? "drag-above" : "drag-below");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-into", "drag-above", "drag-below"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wsDynDragCfg && isFolder) {
      const cfgToCopy = wsDynDragCfg;
      wsDynDragCfg = null; wsClearDropMarkers(); wsOpenIds.add(node.id);
      void wsCopyDynamicFile(cfgToCopy, node.id);
      return;
    }
    const dragId = wsDragId;
    wsClearDropMarkers();
    wsDragId = null;
    if (!dragId || dragId === node.id || wsIsDescendant(dragId, node.id)) return;
    const intent = wsDropIntent(e, row, isFolder);
    if (intent === "into") {
      wsOpenIds.add(node.id);
      wsMoveToIndex(dragId, node.id, wsFindNode(node.id)?.children?.length ?? 0);
    } else {
      const arr = wsFindParentArray(node.id);
      if (!arr) return;
      let idx = arr.findIndex(n => n.id === node.id);
      const dragIdx = arr.findIndex(n => n.id === dragId);
      if (dragIdx !== -1 && dragIdx < idx) idx -= 1; // account for splice-out
      wsMoveToIndex(dragId, wsFindParentId(node.id), idx + (intent === "below" ? 1 : 0));
    }
  });

  return row;
}

function wsDropIntent(e, row, isFolder) {
  const rect = row.getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / rect.height;
  if (isFolder) {
    if (ratio < 0.25) return "above";
    if (ratio > 0.75) return "below";
    return "into";
  }
  return ratio < 0.5 ? "above" : "below";
}

function wsClearDropMarkers() {
  wsTreeEl.querySelectorAll(".drag-into, .drag-above, .drag-below").forEach(el =>
    el.classList.remove("drag-into", "drag-above", "drag-below"));
}

function wsRenderFolderNode(node, depth, parentId = "") {
  const isOpen = wsOpenIds.has(node.id);
  const wrapper = document.createElement("div");
  wrapper.className = "schema-tree-folder" + (isOpen ? " open" : "");

  const row = wsBuildRow(node, depth, true, parentId);
  row.addEventListener("click", () => {
    if (wsOpenIds.has(node.id)) wsOpenIds.delete(node.id); else wsOpenIds.add(node.id);
    wsFocusId = node.id;
    wsRenderTree();
  });
  wrapper.appendChild(row);

  if (isOpen) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "schema-tree-children";
    childrenEl.setAttribute("role", "group");
    const kids = node.children || [];
    if (kids.length) {
      for (const child of kids) childrenEl.appendChild(wsRenderNode(child, depth + 1, node.id));
    } else {
      const emptyRow = document.createElement("div");
      emptyRow.style.cssText = `padding: 0.18rem 0.55rem 0.18rem calc(0.45rem + ${depth + 1}rem); font-size:0.72rem; color:#5f6368; font-style:italic;`;
      emptyRow.textContent = "(empty)";
      childrenEl.appendChild(emptyRow);
    }
    wrapper.appendChild(childrenEl);
  }

  return wrapper;
}

function wsRenderFileNode(node, depth, parentId = "") {
  const row = wsBuildRow(node, depth, false, parentId);
  row.addEventListener("click", () => {
    const selectionVersion = ++wsSelectionVersion;
    wsActiveId = node.id;
    wsFocusId = node.id;
    syncFileDetailsToCfg(wsQueryCfgFromNode(node));
    wsRenderTree();
    void wsRestoreReady.then(() => {
      if (selectionVersion !== wsSelectionVersion || wsActiveId !== node.id) return;
      openWorkspaceNode(node);
    });
  });
  return row;
}

function wsStartInlineRename(node, primaryEl) {
  const input = document.createElement("input");
  input.className = "fs-ws-rename-input";
  input.value = node.name;
  primaryEl.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== node.name) wsRename(node.id, newName);
    else wsRenderTree();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") { committed = true; wsRenderTree(); }
    e.stopPropagation();
  });
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ── Workspace modals (replaces prompt / confirm) ───────────────────────────

function showWsInputModal(title, defaultValue, onConfirm) {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `
    <p class="fs-modal-title"></p>
    <div class="fs-modal-field">
      <input class="fs-modal-input" type="text">
    </div>
    <div class="fs-modal-actions">
      <button type="button" class="fs-modal-btn" data-action="cancel">Cancel</button>
      <button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm">OK</button>
    </div>
  `;
  dialog.querySelector(".fs-modal-title").textContent = title;
  const input = dialog.querySelector(".fs-modal-input");
  input.value = defaultValue ?? "";
  document.body.appendChild(dialog);
  dialog.showModal();
  input.select();

  const close = (confirmed) => {
    dialog.close();
    dialog.remove();
    if (confirmed && input.value.trim()) onConfirm(input.value.trim());
  };
  dialog.querySelector("[data-action='cancel']").onclick = () => close(false);
  dialog.querySelector("[data-action='confirm']").onclick = () => close(true);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") close(true);
    else if (e.key === "Escape") close(false);
  });
  dialog.addEventListener("cancel", () => { dialog.remove(); });
}

function showWsConfirmModal(message, onConfirm, confirmLabel = "Delete") {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `
    <p class="fs-modal-title"></p>
    <div class="fs-modal-actions">
      <button type="button" class="fs-modal-btn" data-action="cancel">Cancel</button>
      <button type="button" class="fs-modal-btn fs-modal-btn-primary fs-modal-btn-danger" data-action="confirm">Delete</button>
    </div>
  `;
  dialog.querySelector(".fs-modal-title").textContent = message;
  dialog.querySelector("[data-action='confirm']").textContent = confirmLabel;
  document.body.appendChild(dialog);
  dialog.showModal();

  const close = (confirmed) => {
    dialog.close();
    dialog.remove();
    if (confirmed) onConfirm();
  };
  dialog.querySelector("[data-action='cancel']").onclick = () => close(false);
  dialog.querySelector("[data-action='confirm']").onclick = () => close(true);
  dialog.addEventListener("cancel", () => { dialog.remove(); });
}

function wsShowContextMenu(parentId, node, x, y) {
  document.querySelector(".fs-ws-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "fs-ws-menu";
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:99999;`;

  const items = [];

  // Creation items for folders and empty space
  if (!node || node.type === "folder") {
    items.push({
      label: t("forceSheet.query.createFolder"),
      action: () => showWsInputModal(t("forceSheet.query.folderName"), t("forceSheet.query.newFolder"), (name) => wsAddFolder(parentId, name))
    });
    items.push({
      label: t("forceSheet.query.createFile"),
      action: () => showWsInputModal(t("forceSheet.query.fileName"), t("forceSheet.query.newFile"), (name) => wsAddFile(parentId, "soql", name, { soql: WS_DEFAULT_QUERY_SOQL }))
    });
  }

  // Node-specific: Rename, Move, Delete
  if (node) {
    if (items.length) items.push({ sep: true });
    if (node.type !== "folder") {
      const cfg = wsQueryCfgFromNode(node);
      const saved = wsIsFavorite(cfg);
      items.push({ icon: "details", label: t("dinaSheet.action.viewDetails"), action: () => void openFileDetails(cfg) });
      items.push({
        icon: "favorite", active: saved,
        label: t(saved ? "forceSheet.favorites.editFolders" : "forceSheet.favorites.add"),
        action: () => wsShowFavoriteFolderDialog(cfg),
      });
    }
    items.push({ label: t("forceSheet.query.rename"), action: () => {
      const primary = wsTreeEl.querySelector(`[data-ws-id="${node.id}"] .schema-tree-primary`);
      if (primary) wsStartInlineRename(node, primary);
    }});
    items.push({ label: t("forceSheet.query.move"), action: () => wsShowMoveToFolderMenu(node, x, y) });
    items.push({ label: t("forceSheet.query.delete"), danger: true, action: () => {
      const count = node.type === "folder" ? wsCountDescendants(node) : 0;
      const message = count
        ? t("forceSheet.query.deleteFolderConfirm", { name: node.name, count })
        : t("forceSheet.query.deleteFileConfirm", { name: node.name });
      showWsConfirmModal(message, () => wsDelete(node.id));
    }});
  }

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "fs-ws-menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fs-ws-menu-item" + (item.danger ? " danger" : "");
    if (item.icon) btn.appendChild(wsCreateActionIcon(item.icon, { active: item.active }));
    const label = document.createElement("span");
    label.textContent = item.label;
    btn.appendChild(label);
    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.remove(); item.action(); });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  wsMenuA11y(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", close, true); } };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function wsGridToCsv(grid = { rows: [] }) {
  const quote = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = wsExpandSalesforceFormulaResults(grid);
  return rows.map(row => (row || []).map(cell => quote(wsDownloadCellValue(cell))).join(",")).join("\r\n");
}

function wsExpandSalesforceFormulaResults(grid = { rows: [] }) {
  const rows = (grid.rows || []).map(row => (row || []).map(cell => ({ ...(cell || {}) })));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let colIndex = 0; colIndex < rows[rowIndex].length; colIndex++) {
      const cell = rows[rowIndex][colIndex];
      if (!wsIsSalesforceFormula(cell?.f) || !Array.isArray(cell.sfResult)) continue;
      cell.sfResult.forEach((resultRow, resultRowIndex) => {
        const targetRow = rowIndex + resultRowIndex;
        while (rows.length <= targetRow) rows.push([]);
        (Array.isArray(resultRow) ? resultRow : [resultRow]).forEach((value, resultColIndex) => {
          const targetCol = colIndex + resultColIndex;
          while (rows[targetRow].length <= targetCol) rows[targetRow].push({ v: "" });
          rows[targetRow][targetCol] = { v: value ?? "", ...(resultRowIndex === 0 && resultColIndex === 0 && cell.s ? { s: cell.s } : {}) };
        });
      });
    }
  }
  return rows;
}

function wsIsSalesforceFormula(formula = "") {
  return /^=\s*SF_/i.test(String(formula));
}

function wsDownloadCellValue(cell = {}) {
  return wsIsSalesforceFormula(cell?.f) ? (cell?.v ?? "") : (cell?.f || cell?.v || "");
}

function wsDownloadText(name, text, extension = "csv", type = "text/csv;charset=utf-8") {
  wsDownloadBlob(new Blob([text], { type }), `${wsDisplayName(name)}.${extension}`);
}

function wsDownloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function wsCrc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function wsCreateZipBlob(entries = []) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data ?? ""));
    const crc = wsCrc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.set(name, 46);
    localParts.push(local, data); centralParts.push(central); offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function wsXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wsColumnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function wsXlsxSheetXml(grid = { rows: [] }, styleIds = new Map()) {
  const rows = wsExpandSalesforceFormulaResults(grid).map((row, rowIndex) => {
    const cells = (row || []).map((cell, colIndex) => {
      const ref = `${wsColumnName(colIndex)}${rowIndex + 1}`;
      const styleId = cell?.s ? styleIds.get(JSON.stringify(cell.s)) || 0 : 0;
      const styleAttr = styleId ? ` s="${styleId}"` : "";
      const exportValue = wsDownloadCellValue(cell);
      if (cell?.f && !wsIsSalesforceFormula(cell.f)) return `<c r="${ref}"${styleAttr}><f>${wsXml(String(cell.f).replace(/^=/, ""))}</f></c>`;
      if (typeof exportValue === "number") return `<c r="${ref}"${styleAttr}><v>${exportValue}</v></c>`;
      if (typeof exportValue === "boolean") return `<c r="${ref}"${styleAttr} t="b"><v>${exportValue ? 1 : 0}</v></c>`;
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${wsXml(exportValue)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function wsXlsxStyles(workbook) {
  const styles = [];
  const ids = new Map();
  for (const sheet of workbook?.sheets || []) for (const row of sheet.grid?.rows || []) for (const cell of row || []) {
    if (!cell?.s || typeof cell.s !== "object") continue;
    const key = JSON.stringify(cell.s);
    if (!ids.has(key)) { styles.push(cell.s); ids.set(key, styles.length); }
  }
  const rgb = (value, fallback) => String(value || fallback).replace(/^#/, "").padStart(8, "F").slice(-8).toUpperCase();
  const fonts = [`<font><sz val="11"/><name val="Calibri"/></font>`, ...styles.map(s => `<font>${s.bl ? "<b/>" : ""}${s.it ? "<i/>" : ""}<sz val="${Number(s.fs) || 11}"/><color rgb="${rgb(s.cl?.rgb, "FF000000")}"/><name val="${wsXml(s.ff || "Calibri")}"/></font>`)];
  const fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`, ...styles.map(s => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(s.bg?.rgb, "FFFFFFFF")}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`, ...styles.map((s, i) => `<xf numFmtId="0" fontId="${i + 1}" fillId="${i + 2}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`)];
  return { ids, xml: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs></styleSheet>` };
}

function wsUniqueXlsxSheetNames(sheets) {
  const used = new Set();
  return sheets.map((sheet, index) => {
    const fallback = `Sheet${index + 1}`;
    const raw = String(sheet.name || fallback).replace(/[\\/?*:[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "") || fallback;
    let number = 1;
    let candidate = raw.slice(0, 31);
    while (used.has(candidate.toLowerCase())) {
      number += 1;
      const suffix = ` (${number})`;
      candidate = `${raw.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function wsCreateXlsxBlob(workbook) {
  const sheets = workbook?.sheets?.length ? workbook.sheets : [{ name: "Sheet1", grid: { rows: [] } }];
  const safeNames = wsUniqueXlsxSheetNames(sheets);
  const xlsxStyles = wsXlsxStyles({ sheets });
  const formattedTemplate = sheets.map(sheet => sheet.grid?.formattedSheet).find(source => source?.stylesXml) || null;
  const formattedStyles = formattedTemplate?.stylesXml || "";
  const themeXml = formattedTemplate?.themeXml || "";
  const sheetXml = (sheet) => {
    const source = sheet.grid?.formattedSheet;
    // Salesforce report exports normally share one style template. Preserve
    // source OOXML when its style table matches; otherwise use the safe value
    // grid rather than applying incorrect style IDs from another workbook.
    if (source?.sheetXml && (!formattedStyles || !source.stylesXml || source.stylesXml === formattedStyles)) return source.sheetXml;
    return wsXlsxSheetXml(sheet.grid, xlsxStyles.ids);
  };
  const contentTypes = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const themeContentType = themeXml ? `<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` : "";
  const themeRelationship = themeXml ? `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` : "";
  const entries = [
    { path: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${themeContentType}${contentTypes}</Types>` },
    { path: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { path: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${Math.min(workbook?.activeIndex || 0, sheets.length - 1)}"/></bookViews><sheets>${safeNames.map((name, i) => `<sheet name="${wsXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { path: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${themeRelationship}</Relationships>` },
    { path: "xl/styles.xml", data: formattedStyles || xlsxStyles.xml },
    ...(themeXml ? [{ path: "xl/theme/theme1.xml", data: themeXml }] : []),
    ...sheets.map((sheet, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) })),
  ];
  return wsCreateZipBlob(entries).slice(0, undefined, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

async function wsCopyDynamicFile(cfg, parentId = null) {
  const grid = await cfg?.getDownloadGrid?.();
  if (!grid) { setStatus("Could not copy this Salesforce item.", true); return; }
  const id = wsAddFile(parentId, "data", wsEnsureCsvName(cfg.name), {
    workbook: { version: 1, activeIndex: 0, sheets: [{ name: cfg.name, grid }] }
  });
  wsActiveId = id;
  setStatus(`Copied ${cfg.name} to Workspace.`);
}

// ── File details panel ──────────────────────────────────────────────────────
// Opened from a tree row's right-click menu or the header toggle. Answers what
// a file actually is: its Salesforce record fields, plus where its data comes
// from — the SOQL behind an object list view, the filters behind a report.
// Lookups stay cheap (a record query and a describe); none runs the file's data.

let lastDetailsCfg = null; // re-opened by the header toggle
let lastDetailsKey = "";
let detailsLoadVersion = 0;

function closeFileDetails() {
  if (detailsEl) detailsEl.hidden = true;
  detailsToggleBtn?.setAttribute("aria-expanded", "false");
}

function detailsField(label, value, { code = false, key = "" } = {}) {
  const field = document.createElement("div");
  field.className = "fs-details-field";
  if (key) field.dataset.detailsField = key;
  const labelEl = document.createElement("span");
  labelEl.className = "fs-details-label";
  labelEl.textContent = label;
  field.appendChild(labelEl);
  const valueEl = document.createElement(code ? "pre" : "div");
  valueEl.className = code ? "fs-details-code" : "fs-details-value";
  valueEl.textContent = value;
  field.appendChild(valueEl);
  return field;
}

// A card groups related facts under one heading. `fields` are label/value pairs;
// `filters` renders as a bulleted list; `empty` is the placeholder when neither
// has anything to show.
function detailsCard({ id = "", title, fields = [], filters = null, query = null, empty = "" }) {
  const card = document.createElement("section");
  card.className = "fs-details-card";
  if (id) card.id = id;
  const heading = document.createElement("h3");
  heading.className = "fs-details-card-title";
  heading.textContent = title;
  card.appendChild(heading);
  for (const field of fields) {
    if (field.value === "" || field.value == null) continue;
    card.appendChild(detailsField(field.label, String(field.value), { code: field.code, key: field.key }));
  }
  if (query) {
    const editor = document.createElement("textarea");
    editor.className = "fs-details-query";
    editor.value = query.soql;
    editor.spellcheck = false;
    editor.setAttribute("aria-label", t("dinaSheet.details.soqlAria"));
    if (typeof query.onChange === "function") {
      editor.addEventListener("input", () => query.onChange(editor.value));
    }
    card.appendChild(editor);
    const actions = document.createElement("div");
    actions.className = "fs-details-actions";
    if (query.showCopy) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "fs-details-copy";
      copy.title = t("dinaSheet.details.copyQuery");
      copy.setAttribute("aria-label", t("dinaSheet.details.copyQuery"));
      copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V4h11v13h-3v3H5V7h3Zm2 0h6v8h1V6h-7v1Zm4 2H7v9h7V9Z"/></svg>';
      copy.addEventListener("click", () => void copyQueryText(editor.value, copy));
      actions.appendChild(copy);
    }
    if (query.createFile) {
      const create = document.createElement("button");
      create.type = "button";
      create.className = "fs-details-create-query";
      create.textContent = t("dinaSheet.details.createQueryFile");
      create.addEventListener("click", () => wsShowCreateQueryFileDialog({
        name: query.createFile.name,
        folder: query.createFile.folder,
        soql: editor.value.trim(),
      }));
      actions.appendChild(create);
    }
    if (query.showRun !== false) {
      const run = document.createElement("button");
      run.type = "button";
      run.className = "fs-details-run";
      run.textContent = t("dinaSheet.details.runUpdateSheet");
      run.addEventListener("click", () => {
        const soql = editor.value.trim();
        query.onChange?.(soql);
        void (query.onRun ? query.onRun(soql, run) : runDetailsQuery(soql, run));
      });
      actions.appendChild(run);
    }
    if (actions.childElementCount) card.appendChild(actions);
  }
  if (filters) {
    if (filters.length) {
      const list = document.createElement("ul");
      list.className = "fs-details-filters";
      for (const line of filters) {
        const item = document.createElement("li");
        item.textContent = line;
        list.appendChild(item);
      }
      card.appendChild(list);
    } else {
      card.appendChild(Object.assign(document.createElement("div"),
        { className: "fs-details-empty", textContent: empty || t("dinaSheet.details.none") }));
    }
  }
  if (card.childElementCount === 1 && empty) {
    card.appendChild(Object.assign(document.createElement("div"),
      { className: "fs-details-empty", textContent: empty }));
  }
  return card;
}

function detailsMessage(text) {
  return Object.assign(document.createElement("div"),
    { className: "fs-details-empty", textContent: text });
}

async function copyQueryText(value, button) {
  const text = String(value || "");
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.readOnly = true;
      fallback.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    button?.classList.add("copied");
    setTimeout(() => button?.classList.remove("copied"), 1200);
    setStatus(t("dinaSheet.details.queryCopied"));
  } catch (error) {
    setStatus(error?.message || t("dinaSheet.details.queryCopyFailed"), true);
  }
}

function wsShowCreateQueryFileDialog({ name = "", folder = "", soql = "" } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal fs-create-query-modal";
  dialog.innerHTML = `
    <p class="fs-modal-title"></p>
    <div class="fs-modal-field">
      <label class="fs-modal-label" for="fs-create-query-name"></label>
      <input id="fs-create-query-name" class="fs-modal-input" type="text" maxlength="120">
    </div>
    <div class="fs-modal-field">
      <label class="fs-modal-label" for="fs-create-query-folder"></label>
      <input id="fs-create-query-folder" class="fs-modal-input" type="text" maxlength="120">
    </div>
    <div class="fs-modal-field">
      <label class="fs-modal-label" for="fs-create-query-soql"></label>
      <textarea id="fs-create-query-soql" class="fs-modal-input fs-create-query-soql" rows="6" spellcheck="false"></textarea>
    </div>
    <div class="fs-modal-actions">
      <button type="button" class="fs-modal-btn" data-action="cancel"></button>
      <button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button>
    </div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("dinaSheet.details.createQueryFile");
  dialog.querySelector('label[for="fs-create-query-name"]').textContent = t("forceSheet.query.fileName");
  dialog.querySelector('label[for="fs-create-query-folder"]').textContent = t("forceSheet.query.folderName");
  dialog.querySelector('label[for="fs-create-query-soql"]').textContent = t("dinaSheet.details.queryString");
  const nameInput = dialog.querySelector("#fs-create-query-name");
  const folderInput = dialog.querySelector("#fs-create-query-folder");
  const soqlInput = dialog.querySelector("#fs-create-query-soql");
  nameInput.value = String(name || "");
  folderInput.value = String(folder || "");
  soqlInput.value = String(soql || "");
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.create");
  document.body.appendChild(dialog);
  dialog.showModal();
  nameInput.focus();
  nameInput.select();

  const close = (confirmed) => {
    if (confirmed) {
      const fileName = nameInput.value.trim();
      const folderName = folderInput.value.trim();
      if (!fileName) { nameInput.focus(); return; }
      let parentId = null;
      if (folderName) {
        let folderNode = wsData.tree.find(node => node.type === "folder"
          && node.name.toLowerCase() === folderName.toLowerCase());
        if (!folderNode) {
          const folderId = wsAddFolder(null, folderName);
          folderNode = wsFindNode(folderId);
        }
        parentId = folderNode?.id || null;
        if (parentId) wsOpenIds.add(parentId);
      }
      wsOpenIds.add(WS_ROOT_QUERY);
      wsAddFile(parentId, "soql", fileName, { soql: soqlInput.value.trim() });
      setStatus(t("dinaSheet.details.queryFileCreated", { name: fileName, folder: folderName || t("forceSheet.query.title") }));
    }
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
  dialog.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", () => { dialog.remove(); });
}

// Pending edits for the active object sheet, shown above the file's own cards so
// what you are about to write sits at the top of the panel. Rendered into its own
// host element and refreshed on every edit — re-running the whole panel would
// re-query Salesforce on each keystroke.
// The Changed fields card is now the only place edits get written, so reveal the
// panel the first time a sheet has pending changes — otherwise an edit looks
// like it went nowhere. Tracked per sheet and reset once the changes clear, so
// closing the panel mid-edit does not make it spring back on the next keystroke.
const changesRevealed = new Set();

function autoRevealChanges(sheetId, hasChanges) {
  if (!sheetId || !hasChanges) { changesRevealed.delete(sheetId); return; }
  if (changesRevealed.has(sheetId)) return;
  changesRevealed.add(sheetId); // set before opening: openFileDetails re-enters here
  if (!detailsEl || !detailsEl.hidden) return; // already on screen
  const cfg = activeSheetDetailsCfg();
  if (cfg) void openFileDetails(cfg);
}

function renderChangesCard() {
  if (!detailsBodyEl) return;
  let host = detailsBodyEl.querySelector(".fs-details-changes-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "fs-details-changes-host";
    detailsBodyEl.prepend(host);
  }
  const sheetId = getActiveSheetId();
  const meta = objEditMeta.get(sheetId);
  if (!meta || !meta.hasId || !meta.objectName) {
    autoRevealChanges(sheetId, false);
    host.removeAttribute("data-change-signature");
    if (host.childElementCount) host.replaceChildren();
    return;
  }

  const payload = collectPendingChanges(sheetId, meta);
  autoRevealChanges(sheetId, payload.length > 0);
  if (!payload.length) {
    host.removeAttribute("data-change-signature");
    if (host.childElementCount) host.replaceChildren();
    return;
  }
  const signature = JSON.stringify(payload.map(entry => ({
    objectName: entry.objectName || meta.objectName,
    id: entry.id,
    gridRow: entry.gridRow,
    dataRow: entry.dataRow,
    changes: entry.changes,
  })));
  // Univer may emit workbook-change events for formatting operations. When the
  // reviewed payload is unchanged, keep the existing card and button nodes in
  // place so a repeated recompute cannot steal a user's click.
  if (host.dataset.changeSignature === signature && host.firstElementChild) {
    const existingUpdate = host.querySelector(".fs-details-run");
    if (existingUpdate) existingUpdate.disabled = Boolean(meta.pendingDml);
    return;
  }

  const card = document.createElement("section");
  card.className = "fs-details-card fs-details-changes";
  const heading = document.createElement("h3");
  heading.className = "fs-details-card-title";
  heading.textContent = t(payload.length === 1 ? "dinaSheet.changes.titleOne" : "dinaSheet.changes.title", { count: payload.length.toLocaleString() });
  card.appendChild(heading);

  for (const entry of payload) {
    const row = document.createElement("div");
    row.className = "fs-details-change";
    const id = document.createElement("div");
    id.className = "fs-details-change-id";
    // Normal data starts below one header row; audit blocks carry their own
    // absolute grid row and can span multiple Salesforce objects.
    id.textContent = t("dinaSheet.update.row", { row: entry.gridRow != null ? entry.gridRow + 1 : entry.dataRow + 2, object: entry.objectName || meta.objectName }) + entry.id;
    row.appendChild(id);
    for (const change of entry.changes) {
      const line = document.createElement("div");
      line.className = "fs-details-change-field";
      const name = document.createElement("span");
      name.className = "fs-details-change-name";
      name.textContent = change.field;
      const before = document.createElement("span");
      before.className = "fs-details-change-before";
      before.textContent = change.before === "" ? t("dinaSheet.common.empty") : change.before;
      const after = document.createElement("span");
      after.className = "fs-details-change-after";
      after.textContent = change.after === "" ? t("dinaSheet.common.empty") : change.after;
      line.append(name, before, document.createTextNode(" → "), after);
      row.appendChild(line);
    }
    card.appendChild(row);
  }

  const actions = document.createElement("div");
  actions.className = "fs-details-actions";
  const update = document.createElement("button");
  update.type = "button";
  update.className = "fs-details-run";
  update.textContent = t(payload.length === 1 ? "dinaSheet.changes.updateOne" : "dinaSheet.changes.update", { count: payload.length.toLocaleString() });
  update.disabled = Boolean(meta.pendingDml);
  // runObjectUpdate re-validates and raises its own confirmation modal.
  update.addEventListener("click", () => void runObjectUpdate());
  actions.appendChild(update);
  card.appendChild(actions);

  host.replaceChildren(card);
  host.dataset.changeSignature = signature;
}

function fileDetailsKey(cfg) {
  if (cfg?.detailsKey) return String(cfg.detailsKey);
  const favorite = cfg?.favorite;
  if (favorite?.kind === "query") return `query:${favorite.salesforceId}`;
  if (favorite?.kind === "listView") return `listView:${favorite.objectName}:${favorite.salesforceId}`;
  if (favorite?.kind === "report") return `report:${favorite.salesforceId}`;
  if (cfg?.queryFile && cfg.id) return `query:${cfg.id}`;
  return cfg?.id ? `file:${cfg.id}` : "";
}

async function openFileDetails(cfg, { force = false } = {}) {
  if (!detailsEl || !detailsBodyEl || !cfg?.getDetails) return;
  const key = fileDetailsKey(cfg);
  lastDetailsCfg = cfg;
  detailsEl.hidden = false;
  detailsToggleBtn?.setAttribute("aria-expanded", "true");
  detailsTitleEl.textContent = cfg.name || t("dinaSheet.details.title");
  // Tree configs are rebuilt frequently. Reuse the already loaded panel when
  // the logical Salesforce/query file is unchanged instead of treating each
  // new config object as a second file-details request.
  if (!force && key && key === lastDetailsKey && detailsBodyEl.childElementCount) {
    renderChangesCard();
    return;
  }
  const loadVersion = ++detailsLoadVersion;
  lastDetailsKey = key;
  detailsBodyEl.replaceChildren(detailsMessage(t("dinaSheet.details.loading")));
  try {
    const cards = await cfg.getDetails();
    if (loadVersion !== detailsLoadVersion || (key && lastDetailsKey !== key)) return;
    detailsBodyEl.replaceChildren(...cards.map(detailsCard));
    renderChangesCard();
  } catch (err) {
    if (loadVersion !== detailsLoadVersion || (key && lastDetailsKey !== key)) return;
    detailsBodyEl.replaceChildren(detailsMessage(err?.message || t("dinaSheet.details.loadFailed")));
  }
}

// Header toggle. With nothing opened yet it falls back to the file behind the
// active sheet, so the icon is useful without visiting the tree first.
function toggleFileDetails() {
  if (!detailsEl) return;
  if (!detailsEl.hidden) { closeFileDetails(); return; }
  const cfg = activeSheetDetailsCfg() || lastDetailsCfg;
  if (!cfg) {
    detailsEl.hidden = false;
    detailsToggleBtn?.setAttribute("aria-expanded", "true");
    detailsTitleEl.textContent = t("dinaSheet.details.title");
    detailsBodyEl.replaceChildren(detailsMessage(t("dinaSheet.details.noSelection")));
    return;
  }
  void openFileDetails(cfg);
}

// Keep the panel pointed at the file you are actually looking at: opening a
// file or switching sheets re-renders it while it is open.
function syncFileDetails({ force = false } = {}) {
  if (!detailsEl || detailsEl.hidden) return;
  const cfg = activeSheetDetailsCfg();
  if (cfg) { void openFileDetails(cfg, { force }); return; }
  // Query/upload sheets have no file behind them — say so rather than leave the
  // previous file's details on screen next to unrelated data.
  lastDetailsCfg = null;
  lastDetailsKey = "";
  detailsLoadVersion += 1;
  detailsTitleEl.textContent = t("dinaSheet.details.title");
  detailsBodyEl.replaceChildren(detailsMessage(t("dinaSheet.details.noBackingFile")));
}

// A tree selection owns the visible details panel immediately. Salesforce data
// and sheet state can continue loading in parallel; their normal completion
// sync enriches the panel afterward. This prevents the previously selected
// favorite's details from lingering while a different file is loading.
function syncFileDetailsToCfg(cfg) {
  if (!detailsEl || !cfg?.getDetails) return;
  void openFileDetails(cfg);
}

function importDetailsCards(sheetId) {
  const state = sheetStates.get(sheetId);
  if (!state?.updatedAt) return [];
  const meta = objEditMeta.get(sheetId);
  const mode = state.mode === "upload" ? t("dinaSheet.details.fileUpload") : state.mode === "report" ? t("dinaSheet.details.report") : t("dinaSheet.details.soqlQuery");
  const target = state.importTarget === "new-sheet" ? t("dinaSheet.details.newSheet") : t("dinaSheet.details.currentSheet");
  const writeback = Boolean(meta?.hasId && meta.objectName);
  return [
    {
      id: "import-mode-detail",
      title: t("dinaSheet.details.importMode"),
      fields: [
        { label: t("dinaSheet.details.mode"), value: mode },
        { label: t("dinaSheet.details.target"), value: target },
        { label: t("dinaSheet.details.salesforceObject"), value: meta?.objectName || state.objectName || t("dinaSheet.details.notResolved") },
        { label: t("dinaSheet.details.updateFeature"), value: writeback ? t("dinaSheet.details.availableId") : t("dinaSheet.details.unavailableId") },
      ],
    },
    {
      id: "last-import-info",
      title: t("dinaSheet.details.lastImport"),
      fields: [
        { label: t("dinaSheet.details.imported"), value: detailsDate(state.updatedAt) },
        { label: t("dinaSheet.details.rows"), value: Number(state.rowCount || 0).toLocaleString() },
        { label: t("dinaSheet.details.file"), value: state.fileName || "" },
        { label: t("dinaSheet.details.report"), value: state.reportName || "" },
        { label: t("dinaSheet.details.soql"), value: state.soql || "", code: true },
        { label: t("dinaSheet.details.salesforceOrg"), value: state.host || "" },
      ],
    },
  ];
}

function auditDetailsCards(sheetId) {
  const state = sheetStates.get(sheetId);
  const rollbackRows = auditEntries.reduce((sum, entry) => sum + entry.rows.length, 0);
  return [{
    id: "audit-file-detail",
    title: t("dinaSheet.audit.supportTitle"),
    fields: [
      { label: t("dinaSheet.audit.descriptionLabel"), value: t("dinaSheet.audit.description") },
      { label: t("dinaSheet.audit.formatLabel"), value: t("dinaSheet.audit.format") },
      { label: t("dinaSheet.details.sort"), value: t("dinaSheet.audit.sort") },
      { label: t("dinaSheet.audit.entries"), value: auditEntries.length.toLocaleString() },
      { label: t("dinaSheet.audit.rollbackRows"), value: rollbackRows.toLocaleString() },
      { label: t("dinaSheet.details.updateFeature"), value: rollbackRows ? t("dinaSheet.audit.available") : t("dinaSheet.audit.none") },
      { label: t("dinaSheet.audit.safetyLabel"), value: t("dinaSheet.audit.safety") },
      { label: t("dinaSheet.details.salesforceOrg"), value: state?.host || session?.host || "" },
      { label: t("dinaSheet.audit.retentionLabel"), value: t("dinaSheet.audit.retention", { count: AUDIT_MAX_ENTRIES.toLocaleString() }) },
    ],
  }];
}

function activeSheetDetailsCfg() {
  const sheetId = getActiveSheetId();
  // A Salesforce Favorite can load into the sheet that was previously owned
  // by a Query file. The sheet-to-file mapping is retained so the Query file
  // can be reopened, but it must only win while that file is actually open.
  // Otherwise B's completion refresh would resolve the stale mapping to A.
  const mappedFileId = wsSheetFileIds.get(sheetId);
  const queryNode = mappedFileId && wsOpenFileId === mappedFileId
    ? wsFindNode(mappedFileId)
    : null;
  if (queryNode?.type === "soql") return wsQueryCfgFromNode(queryNode);
  if (sheetSource.get(sheetId) === "audit") {
    return { name: t("dinaSheet.audit.title"), detailsKey: `audit:${sheetId}`, getDetails: async () => auditDetailsCards(sheetId) };
  }
  const bm = browseMeta.get(sheetId);
  const importCards = () => importDetailsCards(sheetId);
  if (!bm) return importCards().length
    ? { name: sheetStates.get(sheetId)?.fileName || t("dinaSheet.details.importTitle"), detailsKey: `import:${sheetId}`, getDetails: async () => importCards() }
    : null;
  if (bm.kind === "object") {
    // A sheet opened from a raw query has no ListView behind it, but its SOQL is
    // still worth showing — and editing.
    return {
      name: bm.label,
      detailsKey: bm.listViewId ? `listView:${bm.objectName}:${bm.listViewId}` : `querySheet:${sheetId}`,
      getDetails: async () => [...importCards(), ...await getListViewDetails(bm.objectName, bm.listViewId, bm.label, bm.soql)],
    };
  }
  if (bm.kind === "report") {
    return { name: bm.reportName, detailsKey: `report:${bm.reportId}`, getDetails: async () => [...importCards(), ...await getReportDetails(bm.reportId, bm.reportName, bm.folder)] };
  }
  if (bm.kind === "import") {
    return { name: bm.fileName || bm.label || t("dinaSheet.details.importTitle"), detailsKey: `import:${sheetId}`, getDetails: async () => importCards() };
  }
  return null;
}

function queryFileDetailsSummary(soql = "") {
  const objectName = soqlObjectName(soql);
  const selectClause = /^\s*SELECT\s+([\s\S]*?)\s+FROM\s+/i.exec(soql)?.[1] || "";
  const hasRecordId = selectClause.split(",").some(field => /^\s*Id(?:\s|$)/i.test(field));
  return {
    objectName: objectName || t("dinaSheet.details.notResolved"),
    updateFeature: objectName && hasRecordId
      ? t("dinaSheet.details.availableId")
      : t("dinaSheet.details.unavailableId"),
  };
}

function updateVisibleQueryFileDetails(queryId, soql, { updateEditor = false } = {}) {
  if (lastDetailsKey !== `query:${queryId}`) return;
  const summary = queryFileDetailsSummary(soql);
  const objectValue = detailsBodyEl?.querySelector('[data-details-field="query-object"] .fs-details-value');
  const updateValue = detailsBodyEl?.querySelector('[data-details-field="query-update"] .fs-details-value');
  if (objectValue) objectValue.textContent = summary.objectName;
  if (updateValue) updateValue.textContent = summary.updateFeature;
  const editor = detailsBodyEl?.querySelector(".fs-details-query");
  if (updateEditor && editor && document.activeElement !== editor) editor.value = soql;
}

function wsQueryDetailsCards(queryId, name, fallbackSoql = "") {
  const source = wsFindNode(queryId);
  const soql = source?.type === "soql" ? String(source.payload?.soql || "") : String(fallbackSoql || "");
  const summary = queryFileDetailsSummary(soql);
  return [{
    id: "query-file-detail",
    title: t("forceSheet.query.soqlFile"),
    fields: [
      { label: t("dinaSheet.details.name"), value: source?.name || name },
      { label: t("dinaSheet.details.mode"), value: "SOQL" },
      { key: "query-object", label: t("dinaSheet.details.salesforceObject"), value: summary.objectName },
      { key: "query-update", label: t("dinaSheet.details.updateFeature"), value: summary.updateFeature },
    ],
    query: {
      soql,
      onChange: (value) => wsUpdateQueryDefinition(queryId, value),
    },
  }];
}

function wsQueryCfgFromNode(node) {
  return {
    id: node.id,
    name: node.name,
    queryFile: true,
    favorite: {
      kind: "query",
      salesforceId: node.id,
      name: node.name,
      subtitle: "SOQL",
      soql: String(node.payload?.soql || ""),
    },
    getDetails: () => wsQueryDetailsCards(node.id, node.name, node.payload?.soql || ""),
    onOpen: () => openWorkspaceNode(node),
  };
}

function wsUpdateQueryDefinition(queryId, soql) {
  const value = String(soql || "");
  updateVisibleQueryFileDetails(queryId, value);
  const node = wsFindNode(queryId);
  if (node?.type === "soql") {
    node.payload = { ...(node.payload || {}), soql: value };
    if (wsOpenFileId === node.id) soqlInputEl.value = value;
  }
  let favoritesChanged = false;
  wsFavorites = wsFavorites.map((favorite) => {
    if (favorite.kind !== "query" || favorite.salesforceId !== queryId || favorite.soql === value) return favorite;
    favoritesChanged = true;
    return { ...favorite, soql: value };
  });
  if (node) void wsPersist();
  if (favoritesChanged) {
    wsRefreshFavoritesCache();
    void wsPersistFavorites();
  }
  // Keep favorite-backed download/detail action closures on the latest SOQL,
  // but do not rebuild the details panel while its textarea is being edited.
  syncActiveFilePresentation({ details: false });
}

// Salesforce timestamps are ISO strings; show them in the viewer's locale.
function detailsDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(getLanguage() === "jp" ? "ja-JP" : "en-US");
}

// The object a query targets, so an edited FROM clause re-points the sheet's
// write-back instead of silently updating the previous object's records.
function soqlObjectName(soql = "") {
  return /\bFROM\s+([A-Za-z0-9_]+)/i.exec(soql)?.[1] || "";
}

// Run the SOQL as edited in the details panel and replace the active sheet's
// data with the result. The sheet's browse metadata is repointed at the query
// that actually ran, so Update acts on what is now on screen.
async function runDetailsQuery(soql, button) {
  const sheetId = getActiveSheetId();
  if (!soql || !sheetId || !session?.host) return;
  const objectName = soqlObjectName(soql);
  if (!objectName) {
    setStatus(t("dinaSheet.error.queryObject"), true);
    return;
  }
  button.disabled = true;
  showLoading(t("forceSheet.status.running"));
  try {
    const withId = ensureIdInSoql(soql); // keep write-back possible
    const records = await runSoqlPaged(withId, {
      onProgress: (fetched, total) => showLoading(t("forceSheet.status.streaming", {
        fetched: fetched.toLocaleString(), total: total.toLocaleString(),
      })),
    });
    const data = await buildObjectEditData(objectName, records, withId);
    const previous = browseMeta.get(sheetId) || {};
    tagSheetSource(sheetId, "object");
    browseMeta.set(sheetId, {
      ...previous, kind: "object", objectName, soql: withId,
      label: previous.label || objectName,
    });
    renderObjectSheet(sheetId, data);
    hideLoading();
    setStatus(t("forceSheet.status.loaded", { count: data.records.length.toLocaleString() }));
  } catch (err) {
    hideLoading();
    setStatus(err?.message || t("dinaSheet.error.runQuery"), true);
  } finally {
    button.disabled = false;
  }
}

async function getListViewDetails(objectName, listViewId, label, currentSoql = "") {
  const [record, describedSoql] = await Promise.all([
    listViewId
      ? runSoql(session.host, session.sid,
          `SELECT Id, Name, DeveloperName, SobjectType, IsSoqlCompatible, NamespacePrefix, CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name FROM ListView WHERE Id = '${listViewId}'`)
          .then(r => r.records?.[0] || null).catch(() => null)
      : null,
    // Only ask Salesforce for the generated query when the sheet has none.
    currentSoql || !listViewId ? "" : getListViewSoql(objectName, listViewId).catch(() => ""),
  ]);
  const lv = record || {};
  const soql = currentSoql || describedSoql;
  return [
    {
      title: t(listViewId ? "dinaSheet.details.listView" : "dinaSheet.details.querySheet"),
      fields: [
        { label: t("dinaSheet.details.name"), value: lv.Name || label },
        { label: t("dinaSheet.details.apiName"), value: lv.DeveloperName },
        { label: t("dinaSheet.details.listViewId"), value: lv.Id || listViewId || "" },
        { label: t("dinaSheet.details.object"), value: lv.SobjectType || objectName },
        { label: t("dinaSheet.details.namespace"), value: lv.NamespacePrefix },
        { label: t("dinaSheet.details.soqlCompatible"), value: lv.IsSoqlCompatible === undefined ? "" : String(lv.IsSoqlCompatible) },
      ],
    },
    {
      title: t("dinaSheet.details.query"),
      // A Salesforce List View query is a source definition: copy it or save
      // it as a reusable Query file. Raw query sheets still retain Run.
      query: soql ? (listViewId ? {
        soql,
        showRun: false,
        showCopy: true,
        createFile: {
          name: lv.Name || label,
          folder: lv.SobjectType || objectName,
        },
      } : { soql }) : null,
      empty: t("dinaSheet.details.noQuery"),
    },
    {
      title: t("dinaSheet.details.history"),
      fields: [
        { label: t("dinaSheet.details.created"), value: detailsDate(lv.CreatedDate) },
        { label: t("dinaSheet.details.createdBy"), value: lv.CreatedBy?.Name },
        { label: t("dinaSheet.details.lastModified"), value: detailsDate(lv.LastModifiedDate) },
        { label: t("dinaSheet.details.lastModifiedBy"), value: lv.LastModifiedBy?.Name },
      ],
      empty: t("dinaSheet.details.noHistory"),
    },
  ];
}

// Salesforce states a report's criteria across several fields: a standard date
// filter, the field filters, and — for joined reports — one filter set per
// block. Flatten them all into readable lines.
function formatReportFilters(metadata = {}) {
  const lines = [];
  const collect = (md, prefix = "") => {
    const dateFilter = md?.standardDateFilter;
    if (dateFilter?.column && dateFilter?.durationValue) {
      const range = dateFilter.startDate && dateFilter.endDate
        ? ` (${dateFilter.startDate} → ${dateFilter.endDate})` : "";
      lines.push(`${prefix}${dateFilter.column}: ${dateFilter.durationValue}${range}`);
    }
    for (const filter of md?.reportFilters || []) {
      lines.push(`${prefix}${filter.column} ${filter.operator} ${filter.value}`.trim());
    }
    if (md?.reportBooleanFilter) lines.push(`${prefix}${t("dinaSheet.report.filterLogic", { logic: md.reportBooleanFilter })}`);
  };
  collect(metadata);
  (metadata?.blocks || []).forEach((block, i) => collect(block, `[${block.name || t("dinaSheet.report.block", { number: i + 1 })}] `));
  return lines;
}

async function getReportDetails(reportId, reportName, folder) {
  const [record, describe] = await Promise.all([
    runSoql(session.host, session.sid,
      `SELECT Id, Name, DeveloperName, FolderName, Format, Description, ReportTypeApiName, NamespacePrefix, LastRunDate, CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name FROM Report WHERE Id = '${reportId}'`)
      .then(r => r.records?.[0] || null).catch(() => null),
    salesforceRequest(session.host, session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}/describe`)
      .catch(() => null),
  ]);
  const rec = record || {};
  const md = describe?.reportMetadata || {};
  return [
    {
      title: t("dinaSheet.details.report"),
      fields: [
        { label: t("dinaSheet.details.name"), value: rec.Name || md.name || reportName },
        { label: t("dinaSheet.details.apiName"), value: rec.DeveloperName || md.developerName },
        { label: t("dinaSheet.details.reportId"), value: rec.Id || reportId },
        { label: t("dinaSheet.details.folder"), value: rec.FolderName || folder },
        { label: t("dinaSheet.details.format"), value: rec.Format || md.reportFormat },
        { label: t("dinaSheet.details.reportType"), value: md.reportType?.label || rec.ReportTypeApiName },
        { label: t("dinaSheet.details.scope"), value: md.scope },
        { label: t("dinaSheet.details.namespace"), value: rec.NamespacePrefix },
        { label: t("dinaSheet.details.description"), value: rec.Description || md.description },
      ],
    },
    {
      title: t("dinaSheet.details.filters"),
      filters: formatReportFilters(md),
      empty: t("dinaSheet.details.noFilters"),
    },
    {
      title: t("dinaSheet.details.history"),
      fields: [
        // Salesforce records when a report last ran, but not who ran it — the
        // Report object has LastRunDate and no matching user field.
        { label: t("dinaSheet.details.lastRun"), value: detailsDate(rec.LastRunDate) },
        { label: t("dinaSheet.details.created"), value: detailsDate(rec.CreatedDate) },
        { label: t("dinaSheet.details.createdBy"), value: rec.CreatedBy?.Name },
        { label: t("dinaSheet.details.lastModified"), value: detailsDate(rec.LastModifiedDate) },
        { label: t("dinaSheet.details.lastModifiedBy"), value: rec.LastModifiedBy?.Name },
      ],
      empty: t("dinaSheet.details.noHistory"),
    },
  ];
}

function wsShowDynamicContextMenu(cfg, x, y, originRow = null) {
  const existing = document.querySelector(".fs-ws-menu");
  if (typeof existing?._wsClose === "function") existing._wsClose(false);
  else existing?.remove();
  const menu = document.createElement("div");
  menu.className = "fs-ws-menu";
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:99999;`;
  const actions = [];
  if (cfg.favoriteFolder) {
    actions.push({
      label: t("forceSheet.favorites.createFolder"),
      disabled: wsFavoriteFolders.length >= WS_FAVORITE_FOLDERS_MAX,
      action: () => wsShowCreateFavoriteFolderDialog(),
    });
  } else if (cfg.favoriteChildFolder) {
    if (cfg.favoriteFolderId !== WS_DEFAULT_FAVORITES_FOLDER_ID) {
      actions.push({
        label: t("forceSheet.favorites.renameFolder"),
        action: () => wsShowRenameFavoriteFolderDialog(cfg),
      });
      actions.push({
        label: t("forceSheet.favorites.deleteFolder"),
        action: () => wsShowDeleteFavoriteFolderDialog(cfg),
      });
    }
    actions.push({
      label: t("forceSheet.favorites.downloadFolder"),
      disabled: !wsFavorites.some(favorite => favorite.folderId === cfg.favoriteFolderId),
      action: () => wsShowFavoriteFolderDownloadDialog(cfg.favoriteFolderId),
    });
  } else {
    if (cfg.getDetails) actions.push({ icon: "details", label: t("dinaSheet.action.viewDetails"), action: () => void openFileDetails(cfg) });
    if (cfg.favorite) {
      if (cfg.favoriteShortcut) {
        actions.push({ icon: "favorite", active: true, label: t("forceSheet.favorites.move"), action: () => wsShowMoveFavoriteDialog(cfg) });
        actions.push({ icon: "favorite", active: true, label: t("forceSheet.favorites.remove"), action: () => void wsRemoveFavorite(cfg) });
      } else {
        // Same item reachable from its source row — reflect whether it is saved.
        const saved = wsIsFavorite(cfg);
        actions.push({
          icon: "favorite", active: saved,
          label: t(saved ? "forceSheet.favorites.editFolders" : "forceSheet.favorites.add"),
          action: () => wsShowFavoriteFolderDialog(cfg),
        });
      }
    }
    if (cfg.folder && cfg.getDownloadGrid) actions.push({ icon: "csv", label: t("forceSheet.download.zip"), action: () => void wsDownloadDynamicCfg(cfg, "csv") });
    else if (cfg.getDownloadGrid) {
      actions.push({ icon: "excel", label: t("forceSheet.download.excel"), action: () => void wsDownloadDynamicCfg(cfg, "excel") });
      actions.push({ icon: "csv", label: t("forceSheet.download.csv"), action: () => void wsDownloadDynamicCfg(cfg, "csv") });
    }
  }
  for (const item of actions) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "fs-ws-menu-item";
    if (item.icon) btn.appendChild(wsCreateActionIcon(item.icon, { active: item.active }));
    const label = document.createElement("span"); label.textContent = item.label; btn.appendChild(label);
    btn.disabled = Boolean(item.disabled);
    btn.addEventListener("click", () => { menu._wsClose?.(true); item.action(); });
    menu.appendChild(btn);
  }
  wsMountMenu(menu, x, y, originRow);
}

// `active` marks a state-bearing icon as "on" — the star is only amber for an
// item that is actually favorited.
function wsCreateActionIcon(kind, { active = false } = {}) {
  const icon = document.createElement("span");
  icon.className = `fs-action-icon ${kind || ""}${active ? " is-active" : ""}`;
  icon.dataset.icon = kind || "details";
  icon.setAttribute("aria-hidden", "true");
  if (kind === "favorite") icon.textContent = "★";
  else if (kind === "excel") icon.textContent = "X";
  else if (kind === "csv") icon.textContent = "CSV";
  else icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6V2Zm8 2v5h4M9 13h6v1.5H9V13Zm0 3h6v1.5H9V16Z"/><circle cx="17.5" cy="17.5" r="3.5"/><path fill="#fff" d="M17 15.5h1v2.5h-1zM17 19h1v1h-1z"/></svg>';
  return icon;
}

function wsShowCreateFavoriteFolderDialog(onCreated = null) {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `<p class="fs-modal-title"></p><div class="fs-modal-field"><label class="fs-modal-label"></label><input class="fs-modal-input" type="text" maxlength="80"></div><div class="fs-modal-actions"><button type="button" class="fs-modal-btn" data-action="cancel"></button><button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button></div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.createFolderTitle");
  const folderLabel = dialog.querySelector(".fs-modal-label");
  folderLabel.textContent = t("forceSheet.favorites.folderName");
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.create");
  const input = dialog.querySelector("input");
  input.id = "fs-favorite-folder-name"; folderLabel.htmlFor = input.id;
  document.body.appendChild(dialog); dialog.showModal(); input.focus();
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const confirm = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const button = dialog.querySelector('[data-action="confirm"]');
    button.disabled = true;
    const folderId = await wsCreateFavoriteFolder(name);
    if (!folderId) { button.disabled = false; return; }
    close(); onCreated?.(folderId);
  };
  dialog.querySelector('[data-action="cancel"]').onclick = close;
  dialog.querySelector('[data-action="confirm"]').onclick = () => void confirm();
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void confirm(); } });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

function wsShowRenameFavoriteFolderDialog(cfg) {
  const folder = wsFavoriteFolders.find(value => value.id === cfg?.favoriteFolderId);
  if (!folder || folder.id === WS_DEFAULT_FAVORITES_FOLDER_ID) return;
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `<p class="fs-modal-title"></p><div class="fs-modal-field"><label class="fs-modal-label"></label><input class="fs-modal-input" type="text" maxlength="80"></div><div class="fs-modal-actions"><button type="button" class="fs-modal-btn" data-action="cancel"></button><button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button></div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.renameFolderTitle", { name: folder.name });
  const label = dialog.querySelector(".fs-modal-label");
  const input = dialog.querySelector("input");
  input.id = "fs-favorite-folder-rename"; input.value = folder.name;
  label.htmlFor = input.id; label.textContent = t("forceSheet.favorites.folderName");
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.rename");
  document.body.appendChild(dialog); dialog.showModal(); input.focus(); input.select();
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const confirm = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const button = dialog.querySelector('[data-action="confirm"]');
    button.disabled = true;
    const renamed = await wsRenameFavoriteFolder(folder.id, name);
    if (!renamed) { button.disabled = false; input.focus(); input.select(); return; }
    close();
  };
  dialog.querySelector('[data-action="cancel"]').onclick = close;
  dialog.querySelector('[data-action="confirm"]').onclick = () => void confirm();
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void confirm(); } });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

function wsShowDeleteFavoriteFolderDialog(cfg) {
  const folder = wsFavoriteFolders.find(value => value.id === cfg?.favoriteFolderId);
  if (!folder || folder.id === WS_DEFAULT_FAVORITES_FOLDER_ID) return;
  const count = wsFavorites.filter(favorite => favorite.folderId === folder.id).length;
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `<p class="fs-modal-title"></p><p class="fs-modal-label fs-favorite-delete-message"></p><div class="fs-modal-actions"><button type="button" class="fs-modal-btn" data-action="cancel"></button><button type="button" class="fs-modal-btn fs-modal-btn-primary fs-modal-btn-danger" data-action="confirm"></button></div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.deleteFolderTitle", { name: folder.name });
  dialog.querySelector(".fs-favorite-delete-message").textContent = t(
    count === 1 ? "forceSheet.favorites.deleteFolderMessageOne" : "forceSheet.favorites.deleteFolderMessage",
    { count, folder: wsFavoriteFolderLabel(WS_DEFAULT_FAVORITES_FOLDER_ID) },
  );
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.delete");
  document.body.appendChild(dialog); dialog.showModal();
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-action="cancel"]').onclick = close;
  dialog.querySelector('[data-action="confirm"]').onclick = () => { close(); void wsDeleteFavoriteFolder(folder.id); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

function wsShowFavoriteFolderDownloadDialog(folderId) {
  if (!wsFavoriteFolders.some(folder => folder.id === folderId)) return;
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `<p class="fs-modal-title"></p><fieldset class="fs-favorite-download-options"><legend class="fs-modal-label"></legend><label class="fs-favorite-download-option"><input type="radio" name="favorite-download-format" value="zip" checked><span></span></label><label class="fs-favorite-download-option"><input type="radio" name="favorite-download-format" value="excel"><span></span></label></fieldset><div class="fs-modal-actions"><button type="button" class="fs-modal-btn" data-action="cancel"></button><button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button></div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.downloadFolderTitle", {
    name: wsFavoriteFolderLabel(folderId),
  });
  dialog.querySelector("legend").textContent = t("dinaSheet.download.format");
  dialog.querySelector('[value="zip"] + span').textContent = t("forceSheet.favorites.downloadZipOption");
  dialog.querySelector('[value="excel"] + span').textContent = t("forceSheet.favorites.downloadWorkbookOption");
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("dinaSheet.common.download");
  document.body.appendChild(dialog); dialog.showModal(); dialog.querySelector('[value="zip"]').focus();
  const close = (format = "") => {
    if (dialog.open) dialog.close();
    dialog.remove();
    if (format) void wsDownloadFavorites(folderId, format);
  };
  dialog.querySelector('[data-action="cancel"]').onclick = () => close();
  dialog.querySelector('[data-action="confirm"]').onclick = () => close(dialog.querySelector('[name="favorite-download-format"]:checked')?.value || "zip");
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

function wsShowFavoriteChecklistDialog(cfg, item) {
  const identity = wsFavoriteIdentity(item);
  const memberships = new Set(wsFavorites
    .filter(favorite => wsFavoriteIdentity(favorite) === identity)
    .map(favorite => favorite.folderId));
  if (!memberships.size) memberships.add(WS_DEFAULT_FAVORITES_FOLDER_ID);
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal fs-favorite-checklist-modal";
  dialog.innerHTML = `
    <p class="fs-modal-title"></p>
    <fieldset class="fs-favorite-folder-checklist">
      <legend class="fs-modal-label"></legend>
      <div class="fs-favorite-check-toolbar">
        <button type="button" class="fs-favorite-check-all" data-action="check-all"></button>
        <button type="button" class="fs-favorite-check-all" data-action="uncheck-all"></button>
      </div>
      <div class="fs-favorite-check-list"></div>
    </fieldset>
    <button type="button" class="fs-favorite-create-inline" data-action="new-folder"></button>
    <div class="fs-modal-actions">
      <button type="button" class="fs-modal-btn" data-action="cancel"></button>
      <button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button>
    </div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.addTitle", { name: item.name });
  dialog.querySelector("legend").textContent = t("forceSheet.favorites.chooseFolders");
  dialog.querySelector('[data-action="check-all"]').textContent = t("forceSheet.favorites.checkAll");
  dialog.querySelector('[data-action="uncheck-all"]').textContent = t("forceSheet.favorites.uncheckAll");
  dialog.querySelector('[data-action="new-folder"]').textContent = t("forceSheet.favorites.createFolder");
  dialog.querySelector('[data-action="new-folder"]').disabled = wsFavoriteFolders.length >= WS_FAVORITE_FOLDERS_MAX;
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.addConfirm");
  const list = dialog.querySelector(".fs-favorite-check-list");
  wsFavoriteFolders.forEach((folder) => {
    const label = document.createElement("label");
    label.className = "fs-favorite-check-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "favorite-folder";
    checkbox.value = folder.id;
    checkbox.checked = memberships.has(folder.id);
    const text = document.createElement("span");
    text.textContent = wsFavoriteFolderLabel(folder.id);
    label.append(checkbox, text);
    list.appendChild(label);
  });
  const checkboxes = () => [...dialog.querySelectorAll('[name="favorite-folder"]')];
  dialog.querySelector('[data-action="check-all"]').addEventListener("click", () => {
    checkboxes().forEach(checkbox => { checkbox.checked = true; });
  });
  dialog.querySelector('[data-action="uncheck-all"]').addEventListener("click", () => {
    checkboxes().forEach(checkbox => { checkbox.checked = false; });
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  checkboxes()[0]?.focus();
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-action="new-folder"]').addEventListener("click", () => {
    close();
    wsShowCreateFavoriteFolderDialog(() => wsShowFavoriteFolderDialog(cfg));
  });
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", close);
  dialog.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    const button = dialog.querySelector('[data-action="confirm"]');
    button.disabled = true;
    const selected = new Set(checkboxes().filter(checkbox => checkbox.checked).map(checkbox => checkbox.value));
    void wsSyncFavoriteFolders(cfg, selected).then((saved) => {
      if (saved) close(); else button.disabled = false;
    });
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

// Adding picks folder membership through the checklist (an item may live in
// several folders); moving relocates one existing entry to exactly one folder.
function wsShowFavoriteFolderDialog(cfg) {
  const item = wsFavoriteRecordFromCfg(cfg);
  if (!item) return;
  wsShowFavoriteChecklistDialog(cfg, item);
}

function wsShowMoveFavoriteDialog(cfg) {
  const item = wsFavoriteRecordFromCfg(cfg);
  if (!item) return;
  const existing = wsFavorites.find(favorite => wsFavoriteEntryId(favorite) === wsFavoriteEntryId(item));
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  dialog.innerHTML = `<p class="fs-modal-title"></p><div class="fs-modal-field"><label class="fs-modal-label"></label><select class="fs-modal-input"></select></div><div class="fs-modal-field fs-favorite-new-folder" hidden><label class="fs-modal-label"></label><input class="fs-modal-input" type="text" maxlength="80"></div><div class="fs-modal-actions"><button type="button" class="fs-modal-btn" data-action="cancel"></button><button type="button" class="fs-modal-btn fs-modal-btn-primary" data-action="confirm"></button></div>`;
  dialog.querySelector(".fs-modal-title").textContent = t("forceSheet.favorites.moveTitle", { name: item.name });
  const select = dialog.querySelector("select");
  const selectLabel = dialog.querySelector(".fs-modal-field > .fs-modal-label");
  select.id = "fs-favorite-folder-select"; selectLabel.htmlFor = select.id;
  selectLabel.textContent = t("forceSheet.favorites.chooseFolder");
  for (const folder of wsFavoriteFolders) {
    const option = document.createElement("option"); option.value = folder.id; option.textContent = wsFavoriteFolderLabel(folder.id); select.appendChild(option);
  }
  if (wsFavoriteFolders.length < WS_FAVORITE_FOLDERS_MAX) {
    const option = document.createElement("option"); option.value = "__new"; option.textContent = t("forceSheet.favorites.newFolderOption"); select.appendChild(option);
  }
  select.value = existing?.folderId || WS_DEFAULT_FAVORITES_FOLDER_ID;
  const newFolderWrap = dialog.querySelector(".fs-favorite-new-folder");
  const newFolderInput = newFolderWrap.querySelector("input");
  const newFolderLabel = newFolderWrap.querySelector("label");
  newFolderInput.id = "fs-favorite-new-folder-name"; newFolderLabel.htmlFor = newFolderInput.id;
  newFolderLabel.textContent = t("forceSheet.favorites.folderName");
  dialog.querySelector('[data-action="cancel"]').textContent = t("dinaSheet.common.cancel");
  dialog.querySelector('[data-action="confirm"]').textContent = t("forceSheet.favorites.moveConfirm");
  const syncNewFolder = () => {
    newFolderWrap.hidden = select.value !== "__new";
    if (!newFolderWrap.hidden) newFolderInput.focus();
  };
  select.addEventListener("change", syncNewFolder);
  document.body.appendChild(dialog); dialog.showModal(); select.focus();
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const confirm = async () => {
    const button = dialog.querySelector('[data-action="confirm"]');
    button.disabled = true;
    let folderId = select.value;
    if (folderId === "__new") {
      folderId = await wsCreateFavoriteFolder(newFolderInput.value);
      if (!folderId) { button.disabled = false; newFolderInput.focus(); return; }
    }
    close();
    await wsMoveFavoriteEntry(wsFavoriteEntryId(item), folderId);
  };
  dialog.querySelector('[data-action="cancel"]').onclick = close;
  dialog.querySelector('[data-action="confirm"]').onclick = () => void confirm();
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
}

function wsCreateFavoritesExportProgress(total) {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal fs-export-progress";
  const title = document.createElement("p"); title.className = "fs-modal-title"; title.textContent = t("forceSheet.favorites.preparingDownload");
  const progress = document.createElement("progress"); progress.max = total; progress.value = 0;
  const status = document.createElement("p"); status.className = "fs-export-progress-label";
  const actions = document.createElement("div"); actions.className = "fs-modal-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "fs-modal-btn"; cancel.textContent = t("dinaSheet.common.cancel");
  actions.appendChild(cancel); dialog.append(title, progress, status, actions);
  document.body.appendChild(dialog); dialog.showModal();
  const state = { cancelled: false };
  const requestCancel = () => { state.cancelled = true; cancel.disabled = true; cancel.textContent = t("forceSheet.favorites.cancelling"); };
  cancel.addEventListener("click", requestCancel);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestCancel(); });
  return {
    state,
    update(current, name) {
      progress.value = current;
      status.textContent = t("forceSheet.favorites.downloadProgress", { current, total, name });
    },
    close() { if (dialog.open) dialog.close(); dialog.remove(); },
  };
}

function wsSafeDownloadSegment(value, fallback = "Item") {
  const clean = String(value || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return clean || fallback;
}

function wsUniqueArchivePath(path, used) {
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let candidate = `${stem}${extension}`;
  let number = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${number++})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function wsShowFavoritesExportFailures(failures, successCount) {
  const dialog = document.createElement("dialog");
  dialog.className = "fs-modal";
  const title = document.createElement("p"); title.className = "fs-modal-title";
  title.textContent = t("forceSheet.favorites.partialTitle", { success: successCount, failed: failures.length });
  const list = document.createElement("ul"); list.className = "fs-export-failure-list";
  failures.forEach(({ favorite, error }) => {
    const item = document.createElement("li");
    item.textContent = `${favorite.name}: ${error?.message || t("forceSheet.favorites.downloadItemFailed")}`;
    list.appendChild(item);
  });
  const actions = document.createElement("div"); actions.className = "fs-modal-actions";
  const close = document.createElement("button"); close.type = "button"; close.className = "fs-modal-btn fs-modal-btn-primary"; close.textContent = t("common.close");
  actions.appendChild(close); dialog.append(title, list, actions); document.body.appendChild(dialog); dialog.showModal();
  close.addEventListener("click", () => { dialog.close(); dialog.remove(); });
  dialog.addEventListener("cancel", () => dialog.remove());
}

async function wsDownloadFavorites(folderId, format = "zip") {
  if (!folderId || !wsFavoriteFolders.some(folder => folder.id === folderId)) return;
  const configs = buildFavoriteCfgs(folderId);
  if (!configs.length) return;
  const progress = wsCreateFavoritesExportProgress(configs.length);
  const successes = [];
  const failures = [];
  for (let index = 0; index < configs.length; index++) {
    if (progress.state.cancelled) break;
    const cfg = configs[index];
    progress.update(index + 1, cfg.name);
    try {
      const grid = await cfg.getDownloadGrid();
      successes.push({ cfg, favorite: cfg.favorite, grid: grid || { version: 1, rows: [] } });
    } catch (error) {
      failures.push({ favorite: cfg.favorite, error });
    }
  }
  const cancelled = progress.state.cancelled;
  progress.close();
  if (!successes.length) {
    if (cancelled) {
      setStatus(t("forceSheet.favorites.downloadCancelled"));
      return;
    }
    const detail = failures.map(item => `${item.favorite.name}: ${item.error?.message || t("forceSheet.favorites.downloadItemFailed")}`).join("\n");
    const message = t("forceSheet.favorites.downloadAllFailed");
    setStatus(message, true);
    showError(message, { detail, onRetry: () => void wsDownloadFavorites(folderId, format) });
    return;
  }
  const folderName = wsSafeDownloadSegment(wsFavoriteFolderLabel(folderId), "Folder");
  const fileName = `SheetD-Favorites-${folderName}`;
  if (format === "excel") {
    wsDownloadBlob(wsCreateXlsxBlob({
      version: 1,
      activeIndex: 0,
      sheets: successes.map(({ favorite, grid }) => ({ name: favorite.name, grid })),
    }), `${fileName}.xlsx`);
  } else {
    const used = new Set();
    const entries = successes.map(({ favorite, grid }) => {
      // List views group under their object and reports under their Salesforce
      // folder; query files have no such parent, so they sit flat in Queries/.
      const group = favorite.kind === "listView" ? "Objects" : favorite.kind === "report" ? "Reports" : "Queries";
      const source = favorite.kind === "listView" ? favorite.objectName : favorite.kind === "report" ? favorite.folder : "";
      const parent = source ? `${wsSafeDownloadSegment(source, group)}/` : "";
      const basePath = `${folderName}/${group}/${parent}${wsSafeDownloadSegment(favorite.name)}.csv`;
      return { path: wsUniqueArchivePath(basePath, used), data: wsGridToCsv(grid) };
    });
    wsDownloadBlob(wsCreateZipBlob(entries), `${fileName}.zip`);
  }
  setStatus(t(cancelled ? "forceSheet.favorites.downloadCancelledPartial" : "forceSheet.favorites.downloadComplete", {
    count: successes.length,
  }));
  if (failures.length) wsShowFavoritesExportFailures(failures, successes.length);
}

async function wsDownloadDynamicCfg(cfg, format = "csv") {
  try {
    const leaves = [];
    const collect = async (item) => {
      if (!item.folder) { leaves.push(item); return; }
      const children = dynChildrenCache.get(item.id);
      const resolved = Array.isArray(children) ? children : (await item.load?.()) || [];
      for (const child of resolved) await collect(child);
    };
    await collect(cfg);
    const prepared = [];
    for (const leaf of leaves) {
      const grid = await leaf.getDownloadGrid?.();
      if (!grid) continue;
      prepared.push({ leaf, grid });
    }
    if (format === "excel" && prepared.length === 1 && !cfg.folder) {
      const [{ leaf, grid }] = prepared;
      wsDownloadBlob(wsCreateXlsxBlob({ version: 1, activeIndex: 0, sheets: [{ name: leaf.name, grid }] }), `${wsDisplayName(leaf.name)}.xlsx`);
    } else {
      const entries = prepared.map(({ leaf, grid }) => ({ path: `${wsDisplayName(leaf.name)}.csv`, data: wsGridToCsv(grid) }));
      if (entries.length === 1 && !cfg.folder) {
        wsDownloadBlob(new Blob([entries[0].data], { type: "text/csv;charset=utf-8" }), entries[0].path);
      } else if (entries.length) {
        wsDownloadBlob(wsCreateZipBlob(entries), `${wsDisplayName(cfg.name)}.zip`);
      }
    }
    setStatus(t("dinaSheet.status.downloaded", { count: prepared.length.toLocaleString(), name: cfg.name }));
  } catch (error) {
    setStatus(error?.message || t("dinaSheet.status.downloadFailed", { name: cfg.name }), true);
  }
}

// Workspace files are csv-named (R3, UX round 2).
function wsEnsureCsvName(name = "") {
  const clean = String(name).trim();
  return /\.csv$/i.test(clean) ? clean : `${clean}.csv`;
}

function wsStorageKey() {
  return `forceSheet.workspace.${session?.host ?? ""}`;
}

function wsLastOpenKey() {
  return `${wsStorageKey()}.lastOpenFile`;
}

// Startup: open a workspace file in the sheet instead of an empty grid —
// restore the last-opened file (cached per org), fall back to the first file,
// and create a default one when the workspace has none.
async function wsRestoreLastOpenFile() {
  const firstFile = (nodes) => {
    for (const n of nodes) {
      if (n.type !== "folder") return n;
      const f = n.children?.length ? firstFile(n.children) : null;
      if (f) return f;
    }
    return null;
  };
  if (!firstFile(wsData.tree)) wsAddFile(null, "soql", "query1.csv", { soql: WS_DEFAULT_QUERY_SOQL });
  let lastId = null;
  try {
    lastId = (await chrome.storage.local.get(wsLastOpenKey()))?.[wsLastOpenKey()] || null;
  } catch (_) {
    // Storage is optional; use the first workspace file when unavailable.
  }
  const node = (lastId && wsFindNode(lastId)) || firstFile(wsData.tree);
  if (node && node.type !== "folder") openWorkspaceNode(node);
}

// Menu semantics shared by the workspace popup menus (WS5): role=menu,
// menuitem roles, arrow-key navigation, Esc closes, first item focused.
function wsMenuA11y(menu) {
  menu.setAttribute("role", "menu");
  menu.querySelectorAll(".fs-ws-menu-item").forEach(btn => btn.setAttribute("role", "menuitem"));
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll(".fs-ws-menu-item:not(:disabled)")];
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (typeof menu._wsClose === "function") menu._wsClose(true);
      else menu.remove();
    }
  });
  menu.querySelector(".fs-ws-menu-item:not(:disabled)")?.focus();
}

function wsMountMenu(menu, x, y, originRow = null) {
  const close = (restoreFocus = false) => {
    document.removeEventListener("pointerdown", onOutside, true);
    if (menu.isConnected) menu.remove();
    if (restoreFocus) originRow?.focus();
  };
  const onOutside = (event) => { if (!menu.contains(event.target)) close(false); };
  menu._wsClose = close;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  wsMenuA11y(menu);
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  return close;
}

// Folders `node` may move into (its own subtree excluded), depth-first.
function wsCollectFolders(excludeId, nodes = wsData.tree, depth = 0, out = []) {
  for (const node of nodes) {
    if (node.id === excludeId) continue; // skip the moved node's own subtree
    if (node.type !== "folder") continue;
    out.push({ id: node.id, name: node.name, depth });
    wsCollectFolders(excludeId, node.children || [], depth + 1, out);
  }
  return out;
}

function wsShowMoveToFolderMenu(node, x, y) {
  document.querySelector(".fs-ws-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "fs-ws-menu";
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:99999;`;

  const currentParentId = wsFindParentId(node.id) ?? null;
  const targets = [{ id: null, name: "(root)", depth: 0 }, ...wsCollectFolders(node.id)];
  for (const target of targets) {
    if (target.id === currentParentId) continue; // already there
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fs-ws-menu-item";
    btn.textContent = target.id ? `📁 ${target.name}` : target.name;
    btn.style.paddingLeft = `${0.75 + target.depth * 0.75}rem`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();
      if (target.id) wsOpenIds.add(target.id);
      const targetLength = target.id
        ? (wsFindNode(target.id)?.children?.length ?? 0)
        : wsData.tree.length;
      wsMoveToIndex(node.id, target.id, targetLength);
    });
    menu.appendChild(btn);
  }
  if (!menu.childElementCount) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "fs-ws-menu-item";
    empty.disabled = true;
    empty.textContent = "No other folder";
    menu.appendChild(empty);
  }

  document.body.appendChild(menu);
  wsMenuA11y(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", close, true); } };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function wsPersist() {
  // Query files deliberately persist definitions only. Never include workbook
  // snapshots: query result grids can be large enough to exceed extension
  // storage, while names/folders/SOQL stay compact.
  const tree = wsNormalizeQueryTree(wsData.tree);
  return chrome.storage.local.set({
    [wsQueriesStorageKey()]: { version: WS_QUERIES_VERSION, tree },
  }).then(() => true);
}

function wsGenId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function wsFindNode(id, nodes = wsData.tree) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) { const f = wsFindNode(id, node.children); if (f) return f; }
  }
  return null;
}

function wsFindParentArray(id, nodes = wsData.tree) {
  for (const node of nodes) {
    if (node.id === id) return nodes;
    if (node.children) { const f = wsFindParentArray(id, node.children); if (f) return f; }
  }
  return null;
}

// Parent node id of `id`, or null when at root (undefined if not found).
function wsFindParentId(id, nodes = wsData.tree, parentId = null) {
  for (const node of nodes) {
    if (node.id === id) return parentId;
    if (node.children) {
      const found = wsFindParentId(id, node.children, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function wsIsDescendant(ancestorId, id) {
  const ancestor = wsFindNode(ancestorId);
  return ancestor?.children ? Boolean(wsFindNode(id, ancestor.children)) : false;
}

function wsCountDescendants(node) {
  let count = 0;
  for (const child of node.children || []) count += 1 + wsCountDescendants(child);
  return count;
}

function wsCountQueryFiles(nodes = wsData.tree) {
  return nodes.reduce((count, node) => count + (node.type === "folder"
    ? wsCountQueryFiles(node.children || [])
    : 1), 0);
}


function wsAddFile(parentId, type, name, payload) {
  const node = { id: wsGenId(), type, name, payload };
  const parent = parentId ? wsFindNode(parentId) : null;
  if (parent?.type === "folder") { parent.children = parent.children || []; parent.children.push(node); }
  else wsData.tree.push(node);
  wsPersist();
  wsRenderTree();
  syncActiveFilePresentation();
  return node.id;
}

function wsAddFolder(parentId, name) {
  const node = { id: wsGenId(), type: "folder", name, children: [] };
  const parent = parentId ? wsFindNode(parentId) : null;
  if (parent?.type === "folder") { parent.children = parent.children || []; parent.children.push(node); }
  else wsData.tree.push(node);
  wsPersist();
  wsOpenIds.add(node.id);
  wsRenderTree();
  syncActiveFilePresentation();
  return node.id;
}

function wsRename(id, newName) {
  const node = wsFindNode(id);
  if (node) {
    node.name = newName;
    let favoritesChanged = false;
    wsFavorites = wsFavorites.map((favorite) => {
      if (favorite.kind !== "query" || favorite.salesforceId !== id) return favorite;
      favoritesChanged = true;
      return { ...favorite, name: newName };
    });
    void wsPersist();
    if (favoritesChanged) {
      wsRefreshFavoritesCache();
      void wsPersistFavorites();
    }
    wsRenderTree();
    syncActiveFilePresentation();
  }
}

function wsMoveToIndex(dragId, parentId, index) {
  const arr = wsFindParentArray(dragId);
  if (!arr) return;
  const nodeIdx = arr.findIndex(n => n.id === dragId);
  if (nodeIdx === -1) return;
  const [node] = arr.splice(nodeIdx, 1);
  const parent = parentId ? wsFindNode(parentId) : null;
  const targetArr = parent ? (parent.children ??= []) : wsData.tree;
  targetArr.splice(Math.min(index, targetArr.length), 0, node);
  wsPersist();
  wsRenderTree();
  syncActiveFilePresentation();
}

function wsDelete(id) {
  const arr = wsFindParentArray(id);
  if (!arr) return;
  const idx = arr.findIndex(n => n.id === id);
  if (idx !== -1) {
    arr.splice(idx, 1);
    wsOpenIds.delete(id);
    if (wsActiveId === id) wsActiveId = null;
    if (wsOpenFileId === id) wsOpenFileId = null;
    const sheetId = wsFileSheetIds.get(id);
    const tabIds = [...(wsFileTabIds.get(id) || (sheetId ? [sheetId] : []))];
    wsFileSheetIds.delete(id);
    wsFileTabIds.delete(id);
    for (const tabId of tabIds) {
      wsSheetFileIds.delete(tabId);
      sheetStates.delete(tabId);
      window.QDBSheet?.deleteSheet?.(tabId);
    }
    wsPersist();
    wsRenderTree();
    syncActiveFilePresentation();
  }
}

// Blanks one explicit sheet. The default keeps the convenient active-sheet
// behavior for synchronous workspace actions, while async callers pass the
// sheet they started on so tab switches cannot erase unrelated data.
function clearSheet(sheetId = getActiveSheetId()) {
  if (sheetId) window.QDBSheet?.render?.(sheetId, [], []);
}

function wsBindFileToSheet(fileId, sheetId) {
  if (!fileId || !sheetId) return;
  const previousSheetId = wsFileSheetIds.get(fileId);
  if (previousSheetId && previousSheetId !== sheetId) wsSheetFileIds.delete(previousSheetId);
  const previousFileId = wsSheetFileIds.get(sheetId);
  if (previousFileId && previousFileId !== fileId) wsFileSheetIds.delete(previousFileId);
  wsFileSheetIds.set(fileId, sheetId);
  wsSheetFileIds.set(sheetId, fileId);
  if (!wsFileTabIds.has(fileId)) wsFileTabIds.set(fileId, new Set());
  wsFileTabIds.get(fileId).add(sheetId);
  tagSheetSource(sheetId, "file"); // workspace files are always editable
}

function wsAssociateTabWithFile(fileId, sheetId) {
  if (!fileId || !sheetId) return;
  wsSheetFileIds.set(sheetId, fileId);
  if (!wsFileTabIds.has(fileId)) wsFileTabIds.set(fileId, new Set());
  wsFileTabIds.get(fileId).add(sheetId);
  tagSheetSource(sheetId, "file"); // workspace files are always editable
}

function wsShowOnlyFileTabs(fileId, activeSheetId = null) {
  const ids = [...(wsFileTabIds.get(fileId) || [])];
  if (activeSheetId && !ids.includes(activeSheetId)) ids.push(activeSheetId);
  window.QDBSheet?.setVisibleSheets?.(ids);
}

function wsSnapshotOpenFile() {
  if (!wsOpenFileId) return;
  const node = wsFindNode(wsOpenFileId);
  const tabIds = [...(wsFileTabIds.get(wsOpenFileId) || [])];
  if (!node || node.type === "folder" || !tabIds.length) return;
  const activeId = getActiveSheetId();
  const sheets = tabIds.map((sheetId, index) => ({
    key: `tab-${index + 1}`,
    name: window.QDBSheet?.getSheetName?.(sheetId) || `Sheet ${index + 1}`,
    grid: window.QDBSheet?.getSheetSnapshot?.(sheetId) || { version: 1, rows: [] },
  }));
  node.payload = {
    ...(node.payload || {}),
    workbook: {
      version: 1,
      activeIndex: Math.max(0, tabIds.indexOf(activeId)),
      sheets,
    },
  };
  delete node.payload.grid;
  wsPersist();
}

function wsScheduleSnapshot() {
  if (!wsOpenFileId || wsRestoringFileId) return;
  clearTimeout(wsSnapshotTimer);
  const expectedFileId = wsOpenFileId;
  wsSnapshotTimer = setTimeout(() => {
    if (document.visibilityState === "hidden" || wsOpenFileId !== expectedFileId) return;
    wsSnapshotOpenFile();
  }, 250);
}

function wsPayloadWorkbook(node) {
  const workbook = node.payload?.workbook;
  if (workbook?.version === 1 && Array.isArray(workbook.sheets) && workbook.sheets.length) return workbook;
  return {
    version: 1,
    activeIndex: 0,
    sheets: [{ name: wsDisplayName(node.name), grid: node.payload?.grid || { version: 1, rows: [] } }],
  };
}

function wsGetOrCreateFileSheet(node) {
  let sheetId = wsFileSheetIds.get(node.id);
  if (sheetId) {
    wsShowOnlyFileTabs(node.id, sheetId);
    if (window.QDBSheet?.activateSheet?.(sheetId)) return sheetId;
  }

  const workbook = wsPayloadWorkbook(node);
  wsRestoringFileId = node.id;
  // The first restored workspace file owns Univer's initial sheet. Later files
  // get their own sheet, so live cell edits never share a grid.
  const activeSheetId = getActiveSheetId();
  if (!wsFileSheetIds.size && activeSheetId && !wsSheetFileIds.has(activeSheetId)) {
    sheetId = activeSheetId;
  } else {
    sheetId = window.QDBSheet?.addSheet?.(wsDisplayName(node.name)) || getActiveSheetId();
  }
  if (!sheetId) { wsRestoringFileId = null; return null; }
  wsBindFileToSheet(node.id, sheetId);
  getOrCreateState(sheetId);
  window.QDBSheet?.restoreSheetSnapshot?.(sheetId, workbook.sheets[0]?.grid || { version: 1, rows: [] });
  const restoredIds = [sheetId];
  for (const savedSheet of workbook.sheets.slice(1)) {
    const restoredId = window.QDBSheet?.addSheet?.(savedSheet.name || "Sheet");
    if (!restoredId) continue;
    wsAssociateTabWithFile(node.id, restoredId);
    getOrCreateState(restoredId);
    window.QDBSheet?.restoreSheetSnapshot?.(restoredId, savedSheet.grid || { version: 1, rows: [] });
    restoredIds.push(restoredId);
  }
  wsRestoringFileId = null;
  const activeId = restoredIds[Math.min(workbook.activeIndex || 0, restoredIds.length - 1)] || sheetId;
  wsFileSheetIds.set(node.id, activeId);
  wsShowOnlyFileTabs(node.id, activeId);
  window.QDBSheet?.activateSheet?.(activeId);
  return activeId;
}

// Auto-save (Google-Sheets style): while a user file is open, persist the
// active sheet's current query/report definition back into that file so it
// re-opens to the same view. No Save button — this runs after every run.
function wsAutoSaveOpenFile() {
  if (!wsOpenFileId) return;
  const node = wsFindNode(wsOpenFileId);
  if (!node || node.type === "folder") return;
  const state = getActiveState();
  if ((state?.mode ?? "query") === "report") {
    node.type = "report";
    node.payload = {
      ...(node.payload || {}),
      reportId: state?.reportId || "",
      reportName: state?.reportName || reportInputEl.value.trim(),
    };
  } else {
    node.type = "soql";
    const soql = soqlInputEl.value.trim();
    node.payload = {
      ...(node.payload || {}),
      soql,
      objectApiName: objectInputEl.value.trim(),
    };
    updateVisibleQueryFileDetails(node.id, soql, { updateEditor: true });
  }
  wsSnapshotOpenFile();
}

function wsAutoLoadQuery(node, sheetId, version) {
  if (version !== wsAutoQueryVersion || wsOpenFileId !== node.id) return;
  if (running || streamController) {
    setTimeout(() => wsAutoLoadQuery(node, sheetId, version), 50);
    return;
  }
  void runQuery({
    sheetId,
    forceCurrentSheet: true,
    autoSave: false,
    preserveBreadcrumb: true,
    isCurrent: () => version === wsAutoQueryVersion
      && wsOpenFileId === node.id
      && wsFileSheetIds.get(node.id) === sheetId,
  });
}

function openWorkspaceNode(node) {
  const autoQueryVersion = ++wsAutoQueryVersion;
  if (wsOpenFileId && wsOpenFileId !== node.id) wsSnapshotOpenFile();
  const alreadyOpen = wsFileSheetIds.has(node.id);
  const sheetId = wsGetOrCreateFileSheet(node);
  if (!sheetId) {
    setStatus("Could not open the workspace file grid.", true);
    return;
  }
  wsShowOnlyFileTabs(node.id, sheetId);
  window.QDBSheet?.activateSheet?.(sheetId);
  const queryCfg = wsQueryCfgFromNode(node);
  setBreadcrumb([t("forceSheet.query.title"), node.name], null, queryCfg);
  wsOpenFileId = node.id; // this file now owns the sheet → auto-save on run
  chrome.storage.local.set({ [wsLastOpenKey()]: node.id }).catch(() => {});
  switchMode("query");
  soqlInputEl.value = node.payload?.soql ?? "";
  const objectName = soqlObjectName(soqlInputEl.value);
  objectInputEl.value = objectName;
  if (objectName) void onObjectSelect(objectName);
  // A Query file is a live Salesforce view: every open refreshes it. Preserve
  // already-rendered rows while the request is pending, but start a clean grid
  // for a file that has never loaded before.
  if (!alreadyOpen) clearSheet(sheetId);
  if (streamSheetId === sheetId) stopStream();
  if (soqlInputEl.value.trim()) wsAutoLoadQuery(node, sheetId, autoQueryVersion);
  wsActiveId = node.id;
  wsRenderTree();
  // File clicks open Details immediately; same-file completion reuses it.
  syncFileDetails();
}

function initWorkspaceSidebarResize() {
  let dragging = false;
  let startX = 0;
  let startW = 0;

  wsHandleEl.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startW = leftPanelEl.offsetWidth;
    wsHandleEl.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const w = Math.min(480, Math.max(180, startW + e.clientX - startX));
    leftPanelEl.style.width = w + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    wsHandleEl.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    chrome.storage.local.set({ "forceSheet.workspaceSidebarWidth": leftPanelEl.offsetWidth }).catch(() => {
      // The resized panel remains usable when persistence is unavailable.
    });
  });
}

async function initWorkspace() {
  // Restore saved sidebar width
  try {
    const stored = await chrome.storage.local.get("forceSheet.workspaceSidebarWidth");
    const w = stored?.["forceSheet.workspaceSidebarWidth"];
    if (w >= 180 && w <= 480) leftPanelEl.style.width = w + "px";
  } catch (_) {
    // Keep the default width when storage is unavailable.
  }

  // Purge the retired workbook-backed Workspace payload. Query definitions use
  // their own compact per-org key and never contain result-grid snapshots.
  try {
    const stored = await chrome.storage.local.get(null);
    const legacyKeys = Object.keys(stored || {}).filter((key) =>
      key === "forceSheet.workspace" || key.startsWith("forceSheet.workspace."));
    if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
  } catch (_) {
    // Legacy cleanup is best-effort and must not block workspace startup.
  }
  // Query starts expanded; Objects/Reports stay collapsed and lazy-load.
  wsRenderTree();

  if (wsFilterEl) {
    // Search only from the button. Enter may confirm Japanese IME composition,
    // so neither typing nor Enter may send a ListView/Report query.
    const submitOrgSearch = () => {
      wsOrgSearchTerm = wsFilterEl.value.trim();
      wsInvalidateOrgFilterTreeCache();
      if (!wsOrgSearchTerm) {
        for (const id of wsFilterAutoExpanded) wsOpenIds.delete(id);
        wsFilterAutoExpanded.clear();
      }
      wsRenderTree(); // auto-expand + server queries + committed-term filtering
    };
    wsSearchBtn?.addEventListener("click", submitOrgSearch);
    wsClearSearchBtn?.addEventListener("click", () => {
      wsFilterEl.value = "";
      submitOrgSearch();
      wsFilterEl.focus();
    });
  }

  if (wsCloseBtn) {
    wsCloseBtn.addEventListener("click", closePanel);
  }

  // ARIA tree keyboard navigation (roving tabindex) for org-data rows.
  wsTreeEl.addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-ws-id]");
    if (!row) return;
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
        clientX: rect.left + Math.min(rect.width - 8, 32), clientY: rect.top + rect.height,
      }));
      return;
    }
    const rows = [...wsTreeEl.querySelectorAll("[data-ws-id]")];
    const idx = rows.indexOf(row);
    const node = wsFindNode(row.dataset.wsId); // null for dynamic/root rows
    const isFolder = row.classList.contains("schema-tree-folder-row");
    const expanded = row.getAttribute("aria-expanded") === "true";
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows[idx + 1]) wsFocusRow(rows[idx + 1].dataset.wsId);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows[idx - 1]) wsFocusRow(rows[idx - 1].dataset.wsId);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const id = row.dataset.wsId;
      if (isFolder && !expanded) { row.click(); wsFocusRow(id); } // expand + keep focus
      else if (isFolder && rows[idx + 1]) wsFocusRow(rows[idx + 1].dataset.wsId); // first child
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const id = row.dataset.wsId;
      if (isFolder && expanded) { row.click(); wsFocusRow(id); } // collapse + keep focus
      else {
        const parentId = row.dataset.wsParentId || (node ? wsFindParentId(node.id) : null);
        if (parentId) wsFocusRow(parentId);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      wsFocusId = row.dataset.wsId;
      row.click(); // folder toggle / file open
    }
  });

  initWorkspaceSidebarResize();
}

// ── Sheet initialisation ───────────────────────────────────────────────────

// Injects the heavy Univer IIFE bundle on demand (once). Resolves when
// window.QDBSheet is available.
let univerBundlePromise = null;
function loadUniverBundle() {
  if (window.QDBSheet) return Promise.resolve();
  if (univerBundlePromise) return univerBundlePromise;
  univerBundlePromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "force-sheet-univer.bundle.js"; // packaged extension resource (same origin)
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(t("dinaSheet.error.engine")));
    document.body.appendChild(el);
  });
  return univerBundlePromise;
}

function initSheet() {
  setupObjectActions();
  sheetContainerEl.hidden = false;
  sheetEmptyEl.hidden = true;
  window.QDBSheet.init("fs-sheet-container");

  const initialId = window.QDBSheet.getActiveSheetId();
  if (initialId) getOrCreateState(initialId);

  window.QDBSheet.onSheetActivated((sheetId) => {
    if (streamSheetId && streamSheetId !== sheetId) stopStream();
    const fileId = wsSheetFileIds.get(sheetId);
    if (fileId) {
      wsOpenFileId = fileId;
      wsActiveId = fileId;
      const node = wsFindNode(fileId);
      if (node) setBreadcrumb([t("forceSheet.query.title"), node.name], null, wsQueryCfgFromNode(node));
      wsRenderTree();
    } else if (wsOpenFileId && wsFileSheetIds.get(wsOpenFileId) !== sheetId) {
      wsSnapshotOpenFile();
      wsOpenFileId = null;
      wsActiveId = null;
      wsRenderTree();
    }
    renderSheet();
    if (!wsRestoringFileId) wsSnapshotOpenFile();
    refreshObjActions(sheetId);
    syncFileDetails();
    window.QDBSheet?.setEditable?.(true); // every sheet is editable
  });

  window.QDBSheet.onSheetCreated((sheetId) => {
    getOrCreateState(sheetId);
    const ownerFileId = wsRestoringFileId || wsOpenFileId;
    if (ownerFileId) {
      wsAssociateTabWithFile(ownerFileId, sheetId);
      wsShowOnlyFileTabs(ownerFileId, sheetId);
    }
    wsScheduleSnapshot();
  });

  window.QDBSheet.onSheetDeleted((sheetId) => {
    if (streamSheetId === sheetId) stopStream();
    if (auditSheetId === sheetId) auditSheetId = null;
    const fileId = wsSheetFileIds.get(sheetId);
    if (fileId) {
      wsFileTabIds.get(fileId)?.delete(sheetId);
      if (wsFileSheetIds.get(fileId) === sheetId) {
        const replacement = [...(wsFileTabIds.get(fileId) || [])][0] || null;
        if (replacement) wsFileSheetIds.set(fileId, replacement); else wsFileSheetIds.delete(fileId);
      }
    }
    wsSheetFileIds.delete(sheetId);
    sheetSource.delete(sheetId);
    objEditMeta.delete(sheetId);
    browseMeta.delete(sheetId);
    wsScheduleSnapshot();
    sheetStates.delete(sheetId);
    renderSheet();
  });

  window.QDBSheet.onWorkbookChanged?.(wsScheduleSnapshot);
  window.QDBSheet.onWorkbookChanged?.(scheduleRecomputeEdits);
  window.QDBSheet.onSelectionChanged?.(onGridSelection);

  renderSheet();
}


// ── Init ───────────────────────────────────────────────────────────────────

function openSettingsModal() {
  if (!settingsModalEl || !settingsLanguageEl) return;
  settingsLanguageEl.value = getLanguage();
  if (!settingsModalEl.open) settingsModalEl.showModal();
  settingsLanguageEl.focus();
}

function closeSettingsModal() {
  if (settingsModalEl?.open) settingsModalEl.close();
}

function saveSettings() {
  if (!settingsLanguageEl) return;
  const previousLanguage = getLanguage();
  const nextLanguage = settingsLanguageEl.value;
  setLanguage(nextLanguage);
  closeSettingsModal();
  if (nextLanguage !== previousLanguage) window.location.reload();
}

async function init() {
  applyI18n(document);
  // Language is chosen in the extension popup. The popup shares this origin's
  // localStorage, so pick the change up here and reload to re-render the UI.
  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY && event.newValue !== event.oldValue) location.reload();
  });
  settingsNavBtn?.addEventListener("click", openSettingsModal);
  settingsCloseBtn?.addEventListener("click", closeSettingsModal);
  settingsCancelBtn?.addEventListener("click", closeSettingsModal);
  settingsSaveBtn?.addEventListener("click", saveSettings);
  settingsModalEl?.addEventListener("click", (event) => {
    if (event.target === settingsModalEl) closeSettingsModal();
  });

  // SOQL inline-suggestion combobox semantics (WS5)
  soqlFieldSuggestEl.setAttribute("role", "listbox");
  soqlInputEl.setAttribute("aria-autocomplete", "list");
  soqlInputEl.setAttribute("aria-controls", "fs-soql-field-suggestions");
  soqlInputEl.setAttribute("aria-expanded", "false");

  // Nav bar — switch left panel
  if (errorDismissBtn) errorDismissBtn.addEventListener("click", clearError);

  navBarEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".fs-nav-tab");
    if (tab?.dataset.action === "audit") {
      void openAuditSheet();
      return;
    }
    if (!tab?.dataset.panel) return;
    // Re-clicking the active rail icon closes the overlay.
    if (tab.dataset.panel === currentPanel && !leftPanelEl.hidden) {
      closePanel();
      return;
    }
    switchPanel(tab.dataset.panel);
  });

  // Esc closes the overlay panel (modals and suggestion dropdowns keep their
  // own Esc handling — skip when one of those is open).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || leftPanelEl.hidden) return;
    if (document.querySelector(".fs-modal, .fs-ws-menu")) return;
    if (!soqlFieldSuggestEl.hidden) return;
    closePanel();
  });

  // Import sub-tabs — switch query / report / upload
  panelImportEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".fs-mode-tab");
    if (tab?.dataset.mode) switchMode(tab.dataset.mode);
  });

  // Query
  stopBtn.addEventListener("click", () => {
    const sheetId = getActiveSheetId();
    const state = sheetId ? sheetStates.get(sheetId) : null;
    stopStream();
    if (state) setStatus(t("forceSheet.status.stopped", { fetched: state.rowCount.toLocaleString(), total: (state.totalSize || 0).toLocaleString() }));
  });
  resumeBtn.addEventListener("click", () => {
    const sheetId = getActiveSheetId();
    const state = sheetId ? sheetStates.get(sheetId) : null;
    if (state?.nextRecordsUrl && !state.done) void streamPages(sheetId, state.columns, state);
  });
  refreshBtn.addEventListener("click", () => void refreshTab());
  soqlRunBtn.addEventListener("click", () => void runQuery());
  soqlInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runQuery(); }
  });

  // Report
  reportRunBtn.addEventListener("click", () => void runReport());
  reportInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void runReport(); }
  });
  attachSuggestDropdown(reportInputEl, getReportSuggestions, (item) => {
    reportInputEl.value = item.value;
  });

  // Upload
  uploadInputEl.addEventListener("change", () => {
    const file = uploadInputEl.files?.[0];
    uploadFilenameEl.textContent = file ? file.name : t("forceSheet.upload.noFile");
    uploadLoadBtn.disabled = !file;
  });
  uploadLoadBtn.addEventListener("click", () => void loadFile());

  // Feat 0006: Object picker
  objectInputEl.addEventListener("change", () => void onObjectSelect(objectInputEl.value.trim()));
  attachSuggestDropdown(objectInputEl, getObjectSuggestions, (item) => {
    objectInputEl.value = item.value;
    void onObjectSelect(item.value);
  });

  // Feat 0006: Field picker
  fieldInputEl.addEventListener("change", () => {
    const val = fieldInputEl.value.trim();
    if (val) void onFieldPick(val);
  });
  attachSuggestDropdown(fieldInputEl, getFieldSuggestions, (item) => {
    void onFieldPick(item.value);
  });

  // Feat 0006: Inline SOQL suggestions
  soqlInputEl.addEventListener("input", () => {
    objectPickerName = null; // hand-edited SOQL → no longer "via object picker"
    void scheduleInlineSuggestions();
  });
  soqlInputEl.addEventListener("keydown", (e) => {
    if (soqlFieldSuggestEl.hidden || !inlineSugItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightInlineSug(Math.min(inlineSugIndex + 1, inlineSugItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightInlineSug(Math.max(inlineSugIndex - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const item = inlineSugItems[inlineSugIndex];
      if (item) { e.preventDefault(); applyInlineSuggestion(item); }
    } else if (e.key === "Escape") {
      hideInlineSuggestions();
    }
  });
  soqlInputEl.addEventListener("blur", () => {
    setTimeout(() => { hideInlineSuggestions(); }, 150);
  });

  const params = new URLSearchParams(window.location.search);
  const host = params.get("host") || "";

  if (!host) {
    setStatus(t("forceSheet.status.noHost"), true);
    return;
  }

  setStatus(t("forceSheet.status.connecting", { host }));

  try {
    session = await getSessionForHost(host);
    await Promise.all([loadAuditEntries(), wsLoadFavorites(), wsLoadQueries()]);
    setStatus(t("forceSheet.status.connected", { host: session.host }));
    showConnectedOrg(session.host);
    window.__sfQuery = (soql) => runSoql(session.host, session.sid, soql);
    // Backs the =SF_REPORT() sheet formula: returns a row-major matrix
    // (header row first) from the Analytics API.
    window.__sfReport = async (reportId) => {
      const result = await salesforceRequest(session.host, session.sid,
        `/services/data/${SALESFORCE_API_VERSION}/analytics/reports/${encodeURIComponent(reportId)}?includeDetails=true`);
      // No workbook-export fallback here: a formula spills its result into the
      // grid, and an export's tens of thousands of rows will not spill — the
      // sheet just comes back blank. Browsing routes big reports through
      // renderReportBrowseView instead, so this only warns.
      // Joined reports spill the same side-by-side block layout as Run.
      if (isJoinedReport(result)) {
        const matrix = buildJoinedMatrix(normalizeJoinedReport(result));
        setReportStatus(result, statusEl.textContent, Math.max(0, matrix.length - 1));
        return matrix;
      }
      const rows = normalizeReportRows(result);
      // The spilled formula has no status line of its own, so flag a capped
      // report here — otherwise a read-only browse looks complete when it isn't.
      setReportStatus(result, statusEl.textContent, rows.length);
      if (!rows.length) return [];
      const columns = Object.keys(rows[0]);
      // Empty string (not null) so blank cells spill blank, not 0.
      return [columns, ...rows.map(r => columns.map(c => r[c] ?? ""))];
    };
  } catch (err) {
    window.__sfQuery = null;
    window.__sfReport = null;
    const message = err?.message || t("forceSheet.status.sessionUnavailable");
    setStatus(message, true);
    showError(message);
    return;
  }

  // Load object list in background for autocomplete
  void loadObjects(); // warm the suggestion cache

  // The Objects/Reports tree doesn't need Univer — render it
  // immediately, then load the heavy spreadsheet bundle and init the grid.
  const workspaceReady = initWorkspace();
  switchPanel("workspace"); // Salesforce data panel opens by default
  window.__forceSheetWorkspaceReady = false;
  try {
    setStatus(t("forceSheet.status.loadingEngine"));
    await loadUniverBundle();
    initSheet();
    await workspaceReady;
    window.__forceSheetWorkspaceReady = true;
    setStatus(t("forceSheet.status.connected", { host: session.host }));
  } catch (err) {
    window.__forceSheetWorkspaceReady = true;
    setStatus(err?.message || t("dinaSheet.error.engine"), true);
    showError(err?.message || t("dinaSheet.error.engine"));
  }
}

void init();
