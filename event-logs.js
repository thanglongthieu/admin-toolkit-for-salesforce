import {
  SALESFORCE_API_VERSION,
  getSessionForHost,
  runSoqlAll
} from "./api.js";
import {
  createAuditTable,
  formatBytes,
  setOperationStatus,
  setStatus
} from "./monitoring-table.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("status");
const limitInput = document.getElementById("event-log-limit");
const operationStatusEl = document.getElementById("event-log-operation-status");
const resultsEl = document.getElementById("event-log-results");

const COLUMNS = [
  { id: "logDate", label: "Log Date", type: "date", width: 190 },
  { id: "eventType", label: "Event Type", type: "text", width: 220 },
  { id: "size", label: "Size", type: "number", width: 120, sortValue: (row) => Number(row.logFileLength || 0) },
  { id: "logFileLength", label: "Bytes", type: "number", width: 120 },
  { id: "createdDate", label: "Created Date", type: "date", width: 190 },
  {
    id: "download",
    label: "Download",
    type: "text",
    width: 140,
    render: (row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary monitoring-download-button";
      button.textContent = "Download";
      button.disabled = !row.id;
      button.addEventListener("click", () => {
        void downloadEventLogFile(row, button);
      });
      return button;
    }
  }
];

let session = null;

const table = createAuditTable({
  resultsEl,
  columns: COLUMNS,
  defaultSort: { columnId: "logDate", direction: "desc" },
  emptyMessage: "No event log files returned."
});

function getLimit() {
  const parsed = Number.parseInt(limitInput.value, 10);
  if (!Number.isFinite(parsed)) {
    return 200;
  }
  return Math.min(Math.max(parsed, 1), 2000);
}

function buildDownloadUrl(fileId) {
  return `https://${session.host}/services/data/${SALESFORCE_API_VERSION}/sobjects/EventLogFile/${encodeURIComponent(fileId)}/LogFile`;
}

function createEventLogFileName(row = {}) {
  const eventType = String(row.eventType || "EventLog").replace(/[^A-Za-z0-9_.-]+/g, "_");
  const logDate = String(row.logDate || row.createdDate || "").slice(0, 10) || "download";
  return `${eventType}_${logDate}_${row.id || "log"}.csv`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function downloadEventLogFile(row = {}, button = null) {
  if (!row.id) {
    setOperationStatus(operationStatusEl, "Event log file ID is missing.", true);
    return;
  }

  const originalText = button?.textContent || "Download";
  if (button) {
    button.disabled = true;
    button.textContent = "Downloading...";
  }
  setOperationStatus(operationStatusEl, `Downloading ${row.eventType || row.id} event log...`);

  try {
    const response = await fetch(buildDownloadUrl(row.id), {
      headers: {
        Authorization: `Bearer ${session.sid}`,
        Accept: "text/csv,*/*"
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `HTTP ${response.status}`);
    }

    downloadBlob(await response.blob(), createEventLogFileName(row));
    setOperationStatus(operationStatusEl, `Downloaded ${row.eventType || row.id} event log.`);
  } catch (error) {
    setOperationStatus(operationStatusEl, error instanceof Error ? error.message : String(error), true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function normalizeEventLogFile(file = {}) {
  return {
    id: file.Id || "",
    logDate: file.LogDate || "",
    eventType: file.EventType || "",
    size: formatBytes(file.LogFileLength),
    logFileLength: file.LogFileLength || "",
    createdDate: file.CreatedDate || ""
  };
}

async function loadSession() {
  const host = params.get("host");
  if (!host) {
    throw new Error("Missing host parameter.");
  }

  session = await getSessionForHost(host);
  setStatus(statusEl, `Connected to ${session.host}`);
}

async function loadEventLogs() {
  limitInput.disabled = true;
  setOperationStatus(operationStatusEl, "Loading event log files...");
  table.clear("Loading rows...");

  try {
    const records = await runSoqlAll(
      session.host,
      session.sid,
      `SELECT Id, EventType, LogDate, LogFileLength, CreatedDate FROM EventLogFile ORDER BY LogDate DESC LIMIT ${getLimit()}`
    );
    const rows = records.map(normalizeEventLogFile);
    table.setRows(rows);
    setOperationStatus(operationStatusEl, `Loaded ${rows.length} event log files.`);
  } catch (error) {
    table.clear(error instanceof Error ? error.message : String(error));
    setOperationStatus(operationStatusEl, error instanceof Error ? error.message : String(error), true);
  } finally {
    limitInput.disabled = false;
  }
}

limitInput.addEventListener("change", () => {
  void loadEventLogs();
});

loadSession()
  .then(loadEventLogs)
  .catch((error) => {
    setStatus(statusEl, error instanceof Error ? error.message : String(error), true);
  });
