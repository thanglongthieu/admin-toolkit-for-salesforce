import {
  SALESFORCE_API_VERSION,
  getSessionForHost,
  salesforceRequest
} from "./api.js";
import {
  formatUserFacingMessage,
  setOperationStatus,
  setStatus
} from "./monitoring-table.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("status");
const operationStatusEl = document.getElementById("api-usage-operation-status");
const resultsEl = document.getElementById("api-usage-results");

let session = null;

function formatNumber(value) {
  if (value === "" || value === undefined || value === null) {
    return "N/A";
  }
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "N/A";
}

function pluralizeUnit(value, singular, plural = `${singular}s`) {
  return Number(value) === 1 ? singular : plural;
}

function getUsageUnit(limitName = "") {
  const name = String(limitName || "").toLowerCase();
  if (/(storage|file|content|data|asset|mb|space)/.test(name)) {
    return { singular: "MB", plural: "MB" };
  }
  if (/email/.test(name)) {
    return { singular: "email", plural: "emails" };
  }
  if (/event/.test(name)) {
    return { singular: "event", plural: "events" };
  }
  if (/job|batch/.test(name)) {
    return { singular: "job", plural: "jobs" };
  }
  if (/callout/.test(name)) {
    return { singular: "callout", plural: "callouts" };
  }
  return { singular: "request", plural: "requests" };
}

function limitsToRows(limits = {}) {
  return Object.entries(limits || {})
    .map(([name, limit]) => {
      const max = Number.isFinite(limit?.Max) ? limit.Max : 0;
      const remaining = Number.isFinite(limit?.Remaining) ? limit.Remaining : 0;
      const used = Math.max(max - remaining, 0);
      const usagePercent = max > 0 ? (used / max) * 100 : 0;
      return {
        name,
        max,
        remaining,
        used,
        usagePercent,
        unit: getUsageUnit(name)
      };
    })
    .sort((left, right) => {
      const usageResult = right.usagePercent - left.usagePercent;
      if (usageResult !== 0) {
        return usageResult;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
}

function renderMessage(message, isError = false) {
  resultsEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = isError ? "audit-empty status error" : "audit-empty";
  empty.textContent = formatUserFacingMessage(message);
  resultsEl.appendChild(empty);
}

function createNameCell(row) {
  const td = document.createElement("td");
  td.className = "api-usage-name-cell";
  if (!row) {
    td.classList.add("empty");
    return td;
  }
  td.textContent = row.name;
  return td;
}

function createUsageCell(row) {
  const td = document.createElement("td");
  td.className = "api-usage-usage-cell";
  if (!row) {
    td.classList.add("empty");
    return td;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "api-usage-cell";

  const meta = document.createElement("div");
  meta.className = "api-usage-meta";

  const label = document.createElement("span");
  const usedUnit = pluralizeUnit(row.used, row.unit.singular, row.unit.plural);
  label.textContent = `Usage ${formatNumber(row.used)} ${usedUnit}`;

  const remaining = document.createElement("span");
  const remainingUnit = pluralizeUnit(row.max, row.unit.singular, row.unit.plural);
  remaining.textContent = `${formatNumber(row.remaining)}/${formatNumber(row.max)} ${remainingUnit} remaining`;

  const percent = Number(row.usagePercent || 0);
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  const percentText = `${percent.toFixed(1)}%`;

  const track = document.createElement("div");
  track.className = "api-usage-progress";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", `${row.name} ${percentText} used, ${remaining.textContent}`);
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(clampedPercent));

  const bar = document.createElement("span");
  bar.className = "api-usage-progress-bar";
  bar.style.width = `${clampedPercent}%`;

  const percentLabel = document.createElement("strong");
  percentLabel.className = "api-usage-percent";
  percentLabel.textContent = percentText;

  track.append(bar, percentLabel);
  meta.append(label, remaining);
  wrapper.append(meta, track);
  td.appendChild(wrapper);
  return td;
}

function renderApiUsageTable(rows = []) {
  resultsEl.innerHTML = "";
  if (!rows.length) {
    renderMessage("No limit rows returned.");
    return;
  }

  const columnGroupCount = 1;
  const groupSize = Math.ceil(rows.length / columnGroupCount);
  const rowGroups = Array.from({ length: columnGroupCount }, (_value, index) => (
    rows.slice(index * groupSize, (index + 1) * groupSize)
  ));

  const table = document.createElement("table");
  table.className = "audit-table api-usage-table";

  const colgroup = document.createElement("colgroup");
  Array.from({ length: columnGroupCount }, () => ["name", "usage"]).flat().forEach((type) => {
    const col = document.createElement("col");
    col.className = `api-usage-col-${type}`;
    colgroup.appendChild(col);
  });

  const tbody = document.createElement("tbody");
  rowGroups[0].forEach((_firstRow, index) => {
    const tr = document.createElement("tr");
    rowGroups.forEach((group) => {
      const row = group[index] || null;
      tr.append(createNameCell(row), createUsageCell(row));
    });
    tbody.appendChild(tr);
  });

  table.append(colgroup, tbody);
  resultsEl.appendChild(table);
}

async function loadSession() {
  const host = params.get("host");
  if (!host) {
    throw new Error("Missing host parameter.");
  }

  session = await getSessionForHost(host);
  setStatus(statusEl, `Connected to ${session.host}`);
}

async function loadApiUsage() {
  setOperationStatus(operationStatusEl, "Loading limits...");
  renderMessage("Loading...");

  try {
    const limits = await salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/limits`);
    const rows = limitsToRows(limits);
    renderApiUsageTable(rows);
    setOperationStatus(operationStatusEl, `Loaded ${rows.length} limit rows.`);
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : String(error), true);
    setOperationStatus(operationStatusEl, error instanceof Error ? error.message : String(error), true);
  }
}

loadSession()
  .then(loadApiUsage)
  .catch((error) => {
    setStatus(statusEl, error instanceof Error ? error.message : String(error), true);
  });
