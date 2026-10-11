import {
  SALESFORCE_API_VERSION,
  getSessionForHost,
  runSoqlAll,
  salesforceRequest
} from "./api.js";
import {
  createAuditTable,
  setOperationStatus,
  setStatus
} from "./monitoring-table.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("status");
const limitInput = document.getElementById("login-history-limit");
const operationStatusEl = document.getElementById("login-history-operation-status");
const resultsEl = document.getElementById("login-history-results");

const CANDIDATE_COLUMNS = [
  { id: "LoginTime", label: "Login Time", type: "date", width: 190 },
  { id: "UserId", label: "User ID", type: "text", width: 180 },
  { id: "SourceIp", label: "Source IP", type: "text", width: 140 },
  { id: "Status", label: "Status", type: "text", width: 180 },
  { id: "Application", label: "Application", type: "text", width: 200 },
  { id: "Browser", label: "Browser", type: "text", width: 180 },
  { id: "Platform", label: "Platform", type: "text", width: 150 },
  { id: "LoginType", label: "Login Type", type: "text", width: 160 },
  { id: "ApiType", label: "API Type", type: "text", width: 140 },
  { id: "ApiVersion", label: "API Version", type: "number", width: 130 }
];

let session = null;
let availableColumns = CANDIDATE_COLUMNS;

const table = createAuditTable({
  resultsEl,
  columns: availableColumns,
  defaultSort: { columnId: "LoginTime", direction: "desc" },
  emptyMessage: "No login history rows returned."
});

function getLimit() {
  const parsed = Number.parseInt(limitInput.value, 10);
  if (!Number.isFinite(parsed)) {
    return 500;
  }
  return Math.min(Math.max(parsed, 1), 2000);
}

async function loadSession() {
  const host = params.get("host");
  if (!host) {
    throw new Error("Missing host parameter.");
  }

  session = await getSessionForHost(host);
  setStatus(statusEl, `Connected to ${session.host}`);
}

async function describeLoginHistoryColumns() {
  const describe = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/LoginHistory/describe`
  );
  const availableFields = new Set((describe.fields || []).map((field) => field.name));
  availableColumns = CANDIDATE_COLUMNS.filter((column) => availableFields.has(column.id));
  if (!availableColumns.length) {
    availableColumns = CANDIDATE_COLUMNS.slice(0, 4);
  }
}

function normalizeRows(records = []) {
  return records.map((record) => (
    Object.fromEntries(availableColumns.map((column) => [column.id, record[column.id] ?? ""]))
  ));
}

async function loadLoginHistory() {
  limitInput.disabled = true;
  setOperationStatus(operationStatusEl, "Loading login history...");
  table.clear("Loading rows...");

  try {
    await describeLoginHistoryColumns();
    const orderField = availableColumns.some((column) => column.id === "LoginTime") ? "LoginTime" : "Id";
    const records = await runSoqlAll(
      session.host,
      session.sid,
      `SELECT ${availableColumns.map((column) => column.id).join(", ")} FROM LoginHistory ORDER BY ${orderField} DESC LIMIT ${getLimit()}`
    );
    const rows = normalizeRows(records);
    table.setRows(rows, availableColumns);
    setOperationStatus(operationStatusEl, `Loaded ${rows.length} login history rows.`);
  } catch (error) {
    table.clear(error instanceof Error ? error.message : String(error));
    setOperationStatus(operationStatusEl, error instanceof Error ? error.message : String(error), true);
  } finally {
    limitInput.disabled = false;
  }
}

limitInput.addEventListener("change", () => {
  void loadLoginHistory();
});

loadSession()
  .then(loadLoginHistory)
  .catch((error) => {
    setStatus(statusEl, error instanceof Error ? error.message : String(error), true);
  });
