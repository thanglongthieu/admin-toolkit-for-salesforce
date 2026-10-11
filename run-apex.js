import {
  executeAnonymousApex,
  getActiveSession,
  getSessionForHost,
  getUserSummary,
  SALESFORCE_API_VERSION,
  salesforceRequest
} from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";
import { confirmOrgMutation, ORG_RISK } from "./org-safety.js";
import { recordOperation } from "./operation-history.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("status");
const apexCodeEl = document.getElementById("apex-code");
const runButton = document.getElementById("run-apex");
const outputEl = document.getElementById("apex-output");
const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";

let session = null;

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeSoqlString(value = "") {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function runToolingQuery(soql) {
  return salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/query?q=${encodeURIComponent(soql)}`
  );
}

function getUserIdFromUserInfo(userInfo = {}) {
  if (userInfo.user_id) {
    return userInfo.user_id;
  }
  if (userInfo.userId) {
    return userInfo.userId;
  }
  if (userInfo.sub) {
    return String(userInfo.sub).split("/").filter(Boolean).pop() || "";
  }
  return "";
}

async function getOrCreateDebugLevel() {
  const developerName = "Admin_Toolkit_for_Salesforce_Debug";
  const existing = await runToolingQuery(
    `SELECT Id FROM DebugLevel WHERE DeveloperName = '${developerName}' LIMIT 1`
  );
  if (existing.records?.[0]?.Id) {
    return existing.records[0].Id;
  }

  try {
    const created = await salesforceRequest(
      session.host,
      session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/DebugLevel`,
      {
        method: "POST",
        body: JSON.stringify({
          DeveloperName: developerName,
          MasterLabel: "Admin Toolkit for Salesforce Debug",
          ApexCode: "DEBUG",
          ApexProfiling: "INFO",
          Callout: "INFO",
          Database: "INFO",
          System: "DEBUG",
          Validation: "INFO",
          Visualforce: "INFO",
          Workflow: "INFO"
        })
      }
    );
    return created.id || created.Id;
  } catch (error) {
    const retry = await runToolingQuery(
      `SELECT Id FROM DebugLevel WHERE DeveloperName = '${developerName}' LIMIT 1`
    );
    if (retry.records?.[0]?.Id) {
      return retry.records[0].Id;
    }
    throw error;
  }
}

async function ensureDebugLogForCurrentUser() {
  const userInfo = await getUserSummary(session.host, session.sid);
  const userId = getUserIdFromUserInfo(userInfo);
  if (!userId) {
    throw new Error("Unable to identify current Salesforce user for debug logging.");
  }

  const traceFlags = await runToolingQuery(
    `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${escapeSoqlString(userId)}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`
  );
  const latestTraceFlag = traceFlags.records?.[0] || null;
  const activeTraceFlag = (traceFlags.records || []).find((traceFlag) => (
    traceFlag.ExpirationDate && new Date(traceFlag.ExpirationDate).getTime() > Date.now() + 60000
  ));
  if (activeTraceFlag) {
    return activeTraceFlag.Id;
  }

  const debugLevelId = await getOrCreateDebugLevel();
  const now = new Date();
  const expiration = new Date(now.getTime() + 30 * 60 * 1000);
  const traceFlagBody = {
    DebugLevelId: debugLevelId,
    StartDate: now.toISOString(),
    ExpirationDate: expiration.toISOString()
  };

  if (latestTraceFlag?.Id) {
    await salesforceRequest(
      session.host,
      session.sid,
      `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag/${encodeURIComponent(latestTraceFlag.Id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(traceFlagBody)
      }
    );
    return latestTraceFlag.Id;
  }

  const created = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag`,
    {
      method: "POST",
      body: JSON.stringify({
        TracedEntityId: userId,
        LogType: "USER_DEBUG",
        ...traceFlagBody
      })
    }
  );
  return created.id || created.Id;
}

async function fetchLatestApexLog(runStartedAtMs) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const logs = await runToolingQuery(
      "SELECT Id, StartTime, Operation, Status, LogLength FROM ApexLog ORDER BY StartTime DESC LIMIT 10"
    );
    const matchingLog = (logs.records || []).find((log) => (
      log.Id && log.StartTime && new Date(log.StartTime).getTime() >= runStartedAtMs - 5000
    ));
    if (matchingLog?.Id) {
      return matchingLog;
    }
    await sleep(750);
  }
  return null;
}

async function fetchApexLogBody(logId) {
  return salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/ApexLog/${encodeURIComponent(logId)}/Body`,
    {
      headers: {
        Accept: "text/plain"
      }
    }
  );
}

function extractSystemDebugOutput(logBody = "") {
  return String(logBody || "")
    .split(/\r?\n/)
    .filter((line) => line.includes("|USER_DEBUG|"))
    .map((line) => {
      const parts = line.split("|");
      const debugIndex = parts.indexOf("USER_DEBUG");
      const sourceLine = parts[debugIndex + 1] || "";
      const level = parts[debugIndex + 2] || "";
      const message = parts.slice(debugIndex + 3).join("|");
      return [sourceLine, level, message].filter(Boolean).join(" ");
    });
}

function formatApexRunOutput(result, log, systemDebugLines, logError = "") {
  const sections = [];
  sections.push("System.debug output");
  sections.push("-------------------");
  if (systemDebugLines.length) {
    sections.push(systemDebugLines.join("\n"));
  } else if (logError) {
    sections.push(`Unable to load debug log: ${logError}`);
  } else if (log) {
    sections.push("No System.debug lines found in the Apex log.");
  } else {
    sections.push("No Apex debug log found for this run.");
  }

  sections.push("");
  sections.push("Execute Anonymous result");
  sections.push("------------------------");
  sections.push(JSON.stringify(result, null, 2));

  if (log) {
    sections.push("");
    sections.push("Apex log");
    sections.push("--------");
    sections.push(JSON.stringify(log, null, 2));
  }

  return sections.join("\n");
}

async function runApex() {
  try {
    const code = apexCodeEl.value.trim();
    if (!code) {
      throw new Error("Enter Apex code to run.");
    }
    await confirmOrgMutation({
      host: session?.host,
      operation: "Execute anonymous Apex",
      target: "Current Salesforce org",
      risk: ORG_RISK.CODE_EXECUTION
    });

    runButton.disabled = true;
    setStatus(t("runApex.status.preparingLog"));
    let debugSetupError = "";
    try {
      await ensureDebugLogForCurrentUser();
    } catch (error) {
      debugSetupError = error instanceof Error ? error.message : String(error);
    }

    const runStartedAtMs = Date.now();
    setStatus(t("runApex.status.running"));
    const result = await executeAnonymousApex(session.host, session.sid, code);
    setStatus(t("runApex.status.loadingOutput"));

    let log = null;
    let systemDebugLines = [];
    let logError = debugSetupError;
    try {
      log = await fetchLatestApexLog(runStartedAtMs);
      if (log?.Id) {
        const logBody = await fetchApexLogBody(log.Id);
        systemDebugLines = extractSystemDebugOutput(logBody);
      }
    } catch (error) {
      logError = formatUserFacingMessage(error instanceof Error ? error.message : String(error));
    }

    outputEl.textContent = formatApexRunOutput(result, log, systemDebugLines, logError);
    if (result?.success === false) {
      setStatus(t("runApex.status.completedWithErrors"), true);
    } else {
      setStatus(`Apex executed. ${systemDebugLines.length} System.debug ${systemDebugLines.length === 1 ? "line" : "lines"}.`);
    }
    await recordOperation({
      kind: "apex-execution",
      status: result?.success === false ? "failed" : "success",
      host: session.host,
      compiled: result?.compiled,
      success: result?.success
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputEl.textContent = formatUserFacingMessage(message);
    setStatus(message, true);
    if (session?.host) await recordOperation({ kind: "apex-execution", status: "failed", host: session.host, message });
  } finally {
    runButton.disabled = false;
  }
}

async function init() {
  const host = params.get("host") || window.localStorage.getItem(LAST_HOST_STORAGE_KEY) || "";
  setStatus(host ? `Connecting to ${host}...` : "Finding active Salesforce session...");
  session = host ? await getSessionForHost(host) : await getActiveSession();
  window.localStorage.setItem(LAST_HOST_STORAGE_KEY, session.host);
  setStatus(t("runApex.status.connected", { host: session.host }));
  runButton.addEventListener("click", () => void runApex());
}

init().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
