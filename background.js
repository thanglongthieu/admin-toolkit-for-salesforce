import { getOrgSummary, getUserSummary } from "./api.js";

const OPEN_EXTENSION_PAGE_ALLOWLIST = new Set([
  "data-export.html",
  "document-folders.html",
  "event-logs.html",
  "latest-api-usage.html",
  "login-history.html",
  "manual.html",
  "object-schema.html",
  "org-differences.html",
  "permission-explorer.html",
  "rest-explorer.html",
  "run-apex.html",
  "schema-viewer.html",
  "setup-audit-trail.html",
  "tools.html",
  "force-sheet.html"
]);
const extensionRuntime = globalThis.chrome?.runtime;
const SALESFORCE_HOST_PATTERNS = [
  ".my.salesforce.com",
  ".salesforce-setup.com",
  ".lightning.force.com",
  ".visual.force.com",
  ".vf.force.com",
  ".force.com",
  ".visualforce.com",
  ".cloudforce.com",
  ".my.site.com",
  ".salesforce-sites.com"
];

const NON_ORG_SALESFORCE_HOSTS = new Set([
  "appexchange.salesforce.com",
  "developer.salesforce.com",
  "help.salesforce.com",
  "login.salesforce.com",
  "trailhead.salesforce.com",
  "www.salesforce.com"
]);

function getExtensionOrigin() {
  return new URL(chrome.runtime.getURL("")).origin;
}

function isTrustedExtensionPageSender(sender = {}) {
  if (sender?.id !== chrome.runtime.id) {
    return false;
  }

  const extensionBaseUrl = chrome.runtime.getURL("");
  const senderUrl = String(sender?.url || "");
  if (senderUrl.startsWith(extensionBaseUrl)) {
    return true;
  }

  return String(sender?.origin || "") === getExtensionOrigin();
}

function normalizeExtensionPagePath(path = "") {
  const pagePath = String(path || "").trim().replace(/^\/+/, "");
  if (!OPEN_EXTENSION_PAGE_ALLOWLIST.has(pagePath)) {
    throw new Error("Unsupported extension page.");
  }
  return pagePath;
}

function normalizeExtensionPageQuery(query = "") {
  const queryText = String(query || "").trim().replace(/^\?/, "");
  return new URLSearchParams(queryText).toString();
}

function createDebugLogger(scope = "background") {
  const logs = [];

  function append(level, event, detail) {
    logs.push({
      timestamp: new Date().toISOString(),
      scope,
      level,
      event,
      detail
    });
  }

  return {
    logs,
    log(event, detail) {
      append("info", event, detail);
    },
    error(event, error, detail = {}) {
      const errorDetail = error instanceof Error
        ? {
          message: error.message,
          stack: error.stack
        }
        : {
          message: String(error)
        };

      append("error", event, {
        ...detail,
        error: errorDetail
      });
    }
  };
}

function normalizeHost(hostname) {
  if (hostname.endsWith(".lightning.force.com")) {
    return hostname.replace(".lightning.force.com", ".my.salesforce.com");
  }

  const [visualforceHost] = getVisualforceApiHostCandidates(hostname);
  if (visualforceHost) {
    return visualforceHost;
  }

  return hostname;
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

const VISUALFORCE_SITE_SUFFIXES = new Set(["c", "apex"]);

function getVisualforceOrgParts(parts = []) {
  return parts.length >= 2 && VISUALFORCE_SITE_SUFFIXES.has(String(parts[parts.length - 1] || "").toLowerCase())
    ? parts.slice(0, -1)
    : parts;
}

function getVisualforceApiHostCandidates(hostname = "") {
  const suffixes = [
    { suffix: ".sandbox.vf.force.com", sandbox: true },
    { suffix: ".sandbox.visual.force.com", sandbox: true },
    { suffix: ".vf.force.com", sandbox: false },
    { suffix: ".visual.force.com", sandbox: false }
  ];
  const match = suffixes.find((entry) => hostname.endsWith(entry.suffix));
  if (!match) {
    return [];
  }

  const prefix = hostname.slice(0, -match.suffix.length);
  const parts = prefix.split("--").filter(Boolean);
  if (!parts.length) {
    return [];
  }

  const orgParts = getVisualforceOrgParts(parts);
  if (match.sandbox) {
    const sandboxOrgSegment = orgParts.join("--") || parts[0];
    return uniqueValues([
      `${sandboxOrgSegment}.sandbox.my.salesforce.com`,
      `${sandboxOrgSegment}.sandbox.lightning.force.com`
    ]);
  }

  const orgSubdomain = orgParts.length >= 2 ? orgParts[orgParts.length - 1] : orgParts[0];
  return uniqueValues([
    `${orgSubdomain}.my.salesforce.com`,
    `${parts[0]}.my.salesforce.com`
  ]);
}

function getSalesforceApiHostCandidates(hostname = "") {
  return uniqueValues([
    ...getVisualforceApiHostCandidates(hostname),
    normalizeHost(hostname),
    hostname
  ]);
}

function isSalesforceHost(hostname) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  if (!normalizedHostname || NON_ORG_SALESFORCE_HOSTS.has(normalizedHostname)) {
    return false;
  }

  return isSalesforceInstanceHost(normalizedHostname)
    || SALESFORCE_HOST_PATTERNS.some((suffix) => normalizedHostname.endsWith(suffix));
}

function isSalesforceInstanceHost(hostname) {
  if (!hostname.endsWith(".salesforce.com") || hostname.endsWith(".my.salesforce.com")) {
    return false;
  }

  const labels = hostname.split(".");
  if (labels.length !== 3) {
    return false;
  }

  return /^(?:ap|au|br|ca|ch|cs|de|eu|fr|gs|in|jp|kr|na|se|uk|um|usa)\d+$/i.test(labels[0]);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function getSalesforceTabUrl(tab = {}) {
  if (!tab?.url) {
    return "";
  }

  try {
    const url = new URL(tab.url);
    return isSalesforceHost(url.hostname) ? tab.url : "";
  } catch (_error) {
    return "";
  }
}

async function findOpenSalesforceTab(preferredWindowId = null) {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => getSalesforceTabUrl(tab))
    .sort((left, right) => {
      const leftPreferred = Number.isInteger(preferredWindowId) && left.windowId === preferredWindowId ? 1 : 0;
      const rightPreferred = Number.isInteger(preferredWindowId) && right.windowId === preferredWindowId ? 1 : 0;
      if (leftPreferred !== rightPreferred) {
        return rightPreferred - leftPreferred;
      }

      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0);
    })[0] || null;
}

async function getSessionForUrl(urlString) {
  const url = new URL(urlString);
  const cookieCandidates = await chrome.cookies.getAll({ name: "sid" });
  const apiHostCandidates = getSalesforceApiHostCandidates(url.hostname);
  const cookieHostCandidates = uniqueValues([...apiHostCandidates, url.hostname]);

  const exactDomainMatch = (host, cookie) => host === cookie.domain.replace(/^\./, "");
  const suffixDomainMatch = (host, cookie) => host.endsWith(cookie.domain.replace(/^\./, ""));
  const findCookiesForHost = (host) => cookieCandidates.filter((cookie) => (
    exactDomainMatch(host, cookie) || suffixDomainMatch(host, cookie)
  ));

  const sessionCandidates = [];
  apiHostCandidates.forEach((host) => {
    cookieHostCandidates
      .flatMap((cookieHost) => findCookiesForHost(cookieHost))
      .forEach((cookie) => {
        sessionCandidates.push({
          host,
          cookieDomain: cookie.domain,
          sid: cookie.value
        });
      });
  });

  const uniqueSessionCandidates = uniqueValues(
    sessionCandidates.map((session) => `${session.host}\n${session.cookieDomain}\n${session.sid}`)
  ).map((key) => {
    const [host, cookieDomain, sid] = key.split("\n");
    return { host, cookieDomain, sid };
  });

  if (!uniqueSessionCandidates.length) {
    throw new Error(`No Salesforce sid cookie found for ${url.hostname}`);
  }

  const errors = [];
  for (const session of uniqueSessionCandidates) {
    try {
      const userInfo = await getUserSummary(session.host, session.sid);
      return {
        ...session,
        userInfo
      };
    } catch (error) {
      errors.push(`${session.host} via ${session.cookieDomain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No usable Salesforce session found for ${url.hostname}. ${errors.slice(0, 3).join(" | ")}`);
}

function getUserInfoOrgHost(userInfo = {}) {
  const urls = userInfo.urls && typeof userInfo.urls === "object" ? userInfo.urls : {};
  const candidates = [
    urls.custom_domain,
    urls.rest,
    urls.enterprise,
    urls.metadata,
    urls.partner,
    userInfo.profile
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const host = normalizeHost(new URL(String(candidate)).hostname.toLowerCase());
      if (isSalesforceHost(host)) return host;
    } catch (_error) {
      // Ignore incomplete or templated identity URLs.
    }
  }
  return "";
}

async function getSessionForSidCookie(cookie = {}) {
  const cookieDomain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
  const directHosts = isSalesforceHost(cookieDomain)
    ? getSalesforceApiHostCandidates(cookieDomain).filter((host) => isSalesforceHost(host))
    : [];
  const identityHosts = cookieDomain.includes(".sandbox.")
    ? ["test.salesforce.com", "login.salesforce.com"]
    : ["login.salesforce.com", "test.salesforce.com"];
  const errors = [];
  for (const host of uniqueValues([...directHosts, ...identityHosts])) {
    try {
      const userInfo = await getUserSummary(host, cookie.value);
      const resolvedHost = getUserInfoOrgHost(userInfo) || (isSalesforceHost(host) ? host : "");
      if (!resolvedHost) continue;
      return {
        host: resolvedHost,
        cookieDomain: cookie.domain,
        sid: cookie.value,
        userInfo
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No usable Salesforce session found for ${cookieDomain}. ${errors.slice(0, 2).join(" | ")}`);
}

async function listSidCookieSessions() {
  const cookies = await chrome.cookies.getAll({ name: "sid" });
  const candidates = [];
  const seenSids = new Set();
  for (const cookie of cookies) {
    if (!cookie?.value || seenSids.has(cookie.value)) continue;
    seenSids.add(cookie.value);
    candidates.push(cookie);
    if (candidates.length >= 24) break;
  }
  // Resolve every cookie at once. Each one already walks its candidate hosts
  // in series, so doing the cookies in series too meant the popup could wait on
  // ~96 chained round trips before it could paint the org list.
  const resolved = await Promise.all(candidates.map(async (cookie) => {
    try {
      return await getSessionForSidCookie(cookie);
    } catch (_error) {
      // Stale or unrelated sid cookies are not selectable orgs.
      return null;
    }
  }));

  const sessions = [];
  const seen = new Set();
  for (const candidate of resolved) {
    if (!candidate) continue;
    const key = getPopupSessionKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push(candidate);
  }
  return sessions;
}

function getPopupSessionKey(candidate = {}) {
  const userInfo = candidate.userInfo || {};
  const organizationId = userInfo.organization_id || userInfo.organizationId || userInfo.OrganizationId || "";
  const userId = userInfo.user_id || userInfo.userId || userInfo.UserId || "";
  if (organizationId || userId) {
    return `${organizationId}|${userId}`;
  }
  const username = userInfo.preferred_username || userInfo.username || userInfo.email || "";
  return `${candidate.host || ""}|${username}`;
}

async function toPopupOrg(candidate = {}) {
  const userInfo = candidate.userInfo || {};
  let organization = null;
  try {
    organization = await getOrgSummary(candidate.host, candidate.sid);
  } catch (_error) {
    // Host and user information still make a useful selector card.
  }
  return {
    key: getPopupSessionKey(candidate),
    host: String(candidate.host || ""),
    organizationId: String(userInfo.organization_id || userInfo.organizationId || userInfo.OrganizationId || organization?.Id || ""),
    organizationName: String(organization?.Name || candidate.host || "Salesforce org"),
    username: String(userInfo.preferred_username || userInfo.username || userInfo.email || ""),
    displayName: String(userInfo.name || userInfo.display_name || ""),
    isSandbox: Boolean(organization?.IsSandbox),
    salesforceUserLanguage: firstNonEmptyString(
      userInfo.LanguageLocaleKey,
      userInfo.language,
      userInfo.locale
    ),
    salesforceUserLocale: firstNonEmptyString(
      userInfo.LocaleSidKey,
      userInfo.locale
    )
  };
}

async function getPopupOrgDashboard(activeTab = null) {
  const sessions = await listSidCookieSessions();
  const orgs = await Promise.all(sessions.map((candidate) => toPopupOrg(candidate)));
  orgs.sort((left, right) => (
    left.organizationName.localeCompare(right.organizationName)
    || left.host.localeCompare(right.host)
  ));

  let current = null;
  const tab = activeTab || await getActiveTab();
  const currentUrl = getSalesforceTabUrl(tab);
  if (currentUrl) {
    try {
      const currentSession = await getSessionForUrl(currentUrl);
      // Match the whole session, not just the org: one org can hold several
      // logged-in users at once (My Domain plus an Experience site), and
      // picking the wrong one hands the popup another user's permissions.
      const currentKey = getPopupSessionKey(currentSession);
      current = orgs.find((org) => org.key === currentKey) || null;
    } catch (_error) {
      // Keep the selector available when the active Salesforce tab has no usable session.
    }
  }

  return {
    current,
    orgs
  };
}

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

async function getSalesforceLanguageContext(session, debugLogger = null) {
  let userInfo = session?.userInfo || null;

  if (!userInfo) {
    try {
      userInfo = await getUserSummary(session.host, session.sid);
    } catch (error) {
      debugLogger?.error("Salesforce userinfo language lookup failed", error, {
        host: session.host
      });
    }
  }

  return {
    salesforceUserLanguage: firstNonEmptyString(
      userInfo?.LanguageLocaleKey,
      userInfo?.language,
      userInfo?.locale
    ),
    salesforceUserLocale: firstNonEmptyString(
      userInfo?.LocaleSidKey,
      userInfo?.locale
    )
  };
}

extensionRuntime?.onMessage?.addListener((message, sender, sendResponse) => {
  const debugLogger = createDebugLogger();
  const runtimeMessage = message && typeof message === "object" ? message : {};

  (async () => {
    if (!isTrustedExtensionPageSender(sender)) {
      throw new Error("Untrusted runtime message sender.");
    }

    debugLogger.log("Runtime message received", {
      type: runtimeMessage.type,
      host: runtimeMessage.host,
      currentUrl: runtimeMessage.currentUrl || null,
      currentTitle: runtimeMessage.currentTitle || null,
      messageCount: Array.isArray(runtimeMessage.messages) ? runtimeMessage.messages.length : undefined,
      previousResponseId: runtimeMessage.previousResponseId || null
    });

    if (runtimeMessage.type === "get-active-salesforce-session") {
      let tab = sender?.tab || await getActiveTab();
      if (!tab?.url) {
        tab = await findOpenSalesforceTab();
      }
      if (!tab?.url) {
        throw new Error("No Salesforce tab found.");
      }

      if (!getSalesforceTabUrl(tab)) {
        const fallbackTab = await findOpenSalesforceTab(tab.windowId);
        if (fallbackTab) {
          debugLogger.log("Active tab is not Salesforce; using open Salesforce tab", {
            activeUrl: tab.url,
            fallbackUrl: fallbackTab.url,
            fallbackTitle: fallbackTab.title || ""
          });
          tab = fallbackTab;
        }
      }

      if (!getSalesforceTabUrl(tab)) {
        throw new Error("Open a Salesforce tab first.");
      }

      const session = await getSessionForUrl(tab.url);
      debugLogger.log("Active Salesforce session resolved", {
        host: session.host,
        cookieDomain: session.cookieDomain,
        currentUrl: tab.url,
        currentTitle: tab.title || ""
      });

      const languageContext = await getSalesforceLanguageContext(session, debugLogger);

      sendResponse({
        ok: true,
        tabId: tab.id,
        currentUrl: tab.url,
        currentTitle: tab.title || "",
        ...session,
        ...languageContext,
        logs: debugLogger.logs
      });
      return;
    }

    if (runtimeMessage.type === "get-session-for-host") {
      if (!isSalesforceHost(runtimeMessage.host)) {
        throw new Error("Unsupported Salesforce org host.");
      }
      const url = `https://${runtimeMessage.host}/`;
      const session = await getSessionForUrl(url);
      debugLogger.log("Salesforce session resolved for host", {
        host: session.host,
        cookieDomain: session.cookieDomain
      });

      const languageContext = await getSalesforceLanguageContext(session, debugLogger);

      sendResponse({ ok: true, ...session, ...languageContext, logs: debugLogger.logs });
      return;
    }

    if (runtimeMessage.type === "get-popup-org-dashboard") {
      const dashboard = await getPopupOrgDashboard(await getActiveTab());
      sendResponse({ ok: true, ...dashboard, logs: debugLogger.logs });
      return;
    }

    if (runtimeMessage.type === "open-extension-page") {
      const target = chrome.runtime.getURL(normalizeExtensionPagePath(runtimeMessage.path));
      const query = normalizeExtensionPageQuery(runtimeMessage.query);
      const nextUrl = query ? `${target}?${query}` : target;
      // App and Tool launchers in the popup always open a new browser tab so
      // the user's current Salesforce or extension page is never replaced.
      await chrome.tabs.create({ url: nextUrl });
      sendResponse({ ok: true, logs: debugLogger.logs });
      return;
    }

    throw new Error(`Unsupported message type: ${runtimeMessage.type}`);
  })().catch((error) => {
    debugLogger.error("Runtime message failed", error, {
      type: runtimeMessage.type,
      host: runtimeMessage.host
    });
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs: debugLogger.logs
    });
  });

  return true;
});
