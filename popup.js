import {
  createDefaultMetadataFolderCache,
  getOrgSummary,
  getPopupOrgDashboard,
  getSessionForHost,
  getUserSummary,
  loadAvailableSchemaMetadataTypes,
  loadInstalledPackageNamespaces,
  loadSchemaObjectStore,
  openExtensionPage,
  saveSchemaObjectStore,
  searchMetadataByText
} from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

const statusEl = document.getElementById("status");
const popupOrgSelectionEl = document.getElementById("popup-org-selection");
const popupMainScreenEl = document.getElementById("popup-main-screen");
const popupOrgRefreshButton = document.getElementById("popup-org-refresh");
const popupChangeOrgButton = document.getElementById("popup-change-org");
const popupOrgLoadingEl = document.getElementById("popup-org-loading");
const popupOrgEmptyEl = document.getElementById("popup-org-empty");
const popupOrgListEl = document.getElementById("popup-org-list");
const popupOrgStatusEl = document.getElementById("popup-org-status");
const popupOrgTemplateEl = document.getElementById("popup-org-template");
const orgSummaryEl = document.getElementById("org-summary");
const userSummaryEl = document.getElementById("user-summary");
const currentTabTitleEl = document.getElementById("current-tab-title");
const popupSearchInput = document.getElementById("popup-search-input");
const popupSearchButton = document.getElementById("popup-search-button");
const popupSearchSuggestionsEl = document.getElementById("popup-search-suggestions");
const popupSearchTabButton = document.getElementById("popup-search-tab");
const popupSearchSummaryEl = document.getElementById("popup-search-summary");
const popupSearchResultsEl = document.getElementById("popup-search-results");
const openSchemaButton = document.getElementById("open-schema");
const openOrgDifferencesButton = document.getElementById("open-org-differences");
const openManualButton = document.getElementById("open-manual");
const openDataExportButton = document.getElementById("open-data-export");
const openRestExplorerButton = document.getElementById("open-rest-explorer");
const openDocumentFoldersButton = document.getElementById("open-document-folders");
const openForceSheetButton = document.getElementById("open-force-sheet");
const openObjectSchemaButton = document.getElementById("open-object-schema");
const openPermissionExplorerButton = document.getElementById("open-permission-explorer");
const openRunApexButton = document.getElementById("open-run-apex");
const openMonitoringAuditButton = document.getElementById("open-monitoring-audit");
const openMonitoringEventLogsButton = document.getElementById("open-monitoring-event-logs");
const openMonitoringApiUsageButton = document.getElementById("open-monitoring-api-usage");
const openMonitoringLoginHistoryButton = document.getElementById("open-monitoring-login-history");
const popupVersionEl = document.getElementById("popup-version");
const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";

let session = null;
let latestOrg = null;
let latestUser = null;
let popupOrgDashboard = { current: null, orgs: [] };
let popupSearchEntries = [];
let popupSearchSuggestionItems = [];
let popupSearchSuggestionIndex = -1;
let popupSearchRequestId = 0;
let popupSearchActiveLimit = 0;

const POPUP_SEARCH_RESULT_LIMIT = 80;
const POPUP_SEARCH_MAX_RESULT_LIMIT = 200;
const POPUP_SEARCH_SNIPPET_LIMIT = 3;
const POPUP_SEARCH_SUGGESTION_LIMIT = 120;
const STARTUP_DISCOVERY_TIMEOUT_MS = 30000;
const POPUP_SEARCH_COMMON_TYPE_PRIORITY = new Map([
  // Tier 0 — Object (schema root)
  ["objects", 0],
  ["customobject", 0],
  ["entitydefinition", 0],
  ["object", 0],
  ["application", 0],
  ["customapplication", 0],
  // Tier 1 — Field (schema columns; picklist/helptext/formula results also land here)
  ["customfields", 1],
  ["customfield", 1],
  ["fielddefinition", 1],
  ["field", 1],
  // Tier 2 — Code (Apex / VF — imperative logic)
  ["apexclasses", 2],
  ["apexclass", 2],
  ["apex class", 2],
  ["apextriggers", 2],
  ["apextrigger", 2],
  ["apex trigger", 2],
  ["apexpages", 2],
  ["apexpage", 2],
  ["apex page", 2],
  ["apexcomponents", 2],
  ["apexcomponent", 2],
  ["apex component", 2],
  // Tier 3 — Component (declarative UI)
  ["lwcbundles", 3],
  ["lightningcomponentbundle", 3],
  ["lwc bundle", 3],
  ["aurabundles", 3],
  ["auradefinitionbundle", 3],
  ["aura bundle", 3],
  ["flexipages", 3],
  ["flexipage", 3],
  // Tier 4 — Automation
  ["flows", 4],
  ["flow", 4],
  ["workflows", 4],
  ["workflow", 4],
  // Tier 5 — Object Config (lives inside objects)
  ["validationrules", 5],
  ["validationrule", 5],
  ["validation rule", 5],
  ["recordtypes", 5],
  ["recordtype", 5],
  ["record type", 5],
  ["layouts", 5],
  ["layout", 5],
  ["listviews", 5],
  ["listview", 5],
  ["list view", 5],
  ["fieldsets", 5],
  ["fieldset", 5],
  ["field set", 5],
  ["compactlayouts", 5],
  ["compactlayout", 5],
  ["compact layout", 5],
  ["weblinks", 5],
  ["weblink", 5],
  ["web link", 5],
  ["businessprocesses", 5],
  ["businessprocess", 5],
  ["business process", 5],
  ["duplicaterules", 5],
  ["duplicaterule", 5],
  ["duplicate rule", 5],
  // Tier 6 — Global Config (org-wide shared resources)
  ["custommetadata", 6],
  ["custom metadata", 6],
  ["globalvaluesets", 6],
  ["globalvalueset", 6],
  ["global value set", 6],
  ["customlabels", 6],
  ["custom labels", 6],
  ["quickactions", 6],
  ["quickaction", 6],
  ["quick action", 6],
  ["tabs", 6],
  ["tab", 6],
  ["contentassets", 6],
  ["contentasset", 6],
  ["content asset", 6],
  ["staticresources", 6],
  ["staticresource", 6],
  ["static resource", 6],
  ["email", 6],
  ["emailtemplate", 6],
  ["email template", 6],
  // Tier 7 — Admin / Security
  ["permissionsets", 7],
  ["permissionset", 7],
  ["permission set", 7],
  ["profiles", 7],
  ["profile", 7],
  ["roles", 7],
  ["role", 7],
  ["sharingrules", 7],
  ["sharingrule", 7],
  ["sharing rules", 7],
  ["remotesitesettings", 7],
  ["remotesitesetting", 7],
  ["remote site setting", 7],
  ["namedcredentials", 7],
  ["namedcredential", 7],
  ["named credential", 7],
  ["authproviders", 7],
  ["authprovider", 7],
  ["auth provider", 7],
  ["connectedapps", 7],
  ["connectedapp", 7],
  ["connected app", 7],
  ["groups", 7],
  ["group", 7],
  ["settings", 7],
  ["setting", 7],
  // Tier 8 — Not Common (analytics / documents)
  ["reports", 8],
  ["report", 8],
  ["dashboards", 8],
  ["dashboard", 8],
  ["documents", 8],
  ["document", 8],
  ["contentdocuments", 8],
  ["contentdocument", 8],
  ["content document", 8],
]);

function setExtensionVisible(isVisible) {
  document.body.classList.toggle("extension-hidden", !isVisible);
}

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

function setOrgSelectorStatus(message = "", isError = false) {
  if (!popupOrgStatusEl) return;
  popupOrgStatusEl.textContent = formatUserFacingMessage(message);
  popupOrgStatusEl.className = isError ? "status error" : "status";
}

function resetPopupScroll() {
  document.querySelector(".popup-shell > main")?.scrollTo?.({ top: 0 });
  window.scrollTo(0, 0);
}

function showOrgSelection() {
  document.activeElement?.blur?.();
  popupOrgSelectionEl.hidden = false;
  popupMainScreenEl.hidden = true;
  resetPopupScroll();
  window.requestAnimationFrame(resetPopupScroll);
}

function showMainScreen() {
  document.activeElement?.blur?.();
  popupOrgSelectionEl.hidden = true;
  popupMainScreenEl.hidden = false;
  resetPopupScroll();
  window.requestAnimationFrame(resetPopupScroll);
}

function setOrgSelectionBusy(isBusy) {
  popupOrgRefreshButton.disabled = isBusy;
  popupOrgListEl.querySelectorAll(".popup-org-select").forEach((button) => {
    button.disabled = isBusy;
  });
}

function renderPopupOrgCard(org = {}) {
  const card = popupOrgTemplateEl.content.firstElementChild.cloneNode(true);
  const isCurrent = Boolean(
    popupOrgDashboard.current?.key
    && popupOrgDashboard.current.key === org.key
  );
  card.classList.toggle("current", isCurrent);
  card.querySelector(".popup-org-name-row strong").textContent = org.organizationName || org.host;
  const currentBadge = card.querySelector(".popup-org-current");
  currentBadge.hidden = !isCurrent;
  currentBadge.textContent = t("popup.orgSelector.current");
  card.querySelector(".popup-org-username").textContent = org.username || org.displayName || org.host;
  card.querySelector("small").textContent = `${org.host} · ${t(org.isSandbox ? "popup.orgSelector.sandbox" : "popup.orgSelector.production")}`;
  const selectButton = card.querySelector(".popup-org-select");
  selectButton.textContent = t("popup.orgSelector.select");
  selectButton.addEventListener("click", () => void selectPopupOrg(org, selectButton));
  return card;
}

function renderPopupOrgDashboard() {
  popupOrgListEl.replaceChildren();
  const orgs = Array.isArray(popupOrgDashboard.orgs) ? popupOrgDashboard.orgs : [];
  popupOrgLoadingEl.hidden = true;
  popupOrgEmptyEl.hidden = orgs.length > 0;
  orgs.forEach((org) => popupOrgListEl.append(renderPopupOrgCard(org)));
}

function getCurrentPopupOrg() {
  const currentKey = popupOrgDashboard.current?.key;
  if (!currentKey) {
    return null;
  }
  return popupOrgDashboard.orgs.find((org) => org.key === currentKey) || null;
}

async function refreshPopupOrgDashboard(options = {}) {
  showOrgSelection();
  setOrgSelectorStatus();
  popupOrgLoadingEl.hidden = false;
  popupOrgEmptyEl.hidden = true;
  popupOrgListEl.replaceChildren();
  setOrgSelectionBusy(true);
  try {
    const dashboard = await getPopupOrgDashboard();
    popupOrgDashboard = {
      current: dashboard.current || null,
      orgs: Array.isArray(dashboard.orgs) ? dashboard.orgs : []
    };
    renderPopupOrgDashboard();
    const currentOrg = options.autoSelectCurrent ? getCurrentPopupOrg() : null;
    if (currentOrg) {
      const currentIndex = popupOrgDashboard.orgs.indexOf(currentOrg);
      const currentButton = popupOrgListEl.querySelectorAll(".popup-org-select")[currentIndex] || null;
      await selectPopupOrg(currentOrg, currentButton);
    }
  } catch (error) {
    popupOrgDashboard = { current: null, orgs: [] };
    popupOrgLoadingEl.hidden = true;
    popupOrgEmptyEl.hidden = false;
    setOrgSelectorStatus(error instanceof Error ? error.message : t("popup.orgSelector.loadFailed"), true);
  } finally {
    setOrgSelectionBusy(false);
  }
}

async function selectPopupOrg(org, button = null) {
  if (!org?.host) return;
  const originalLabel = button?.textContent || "";
  setOrgSelectionBusy(true);
  if (button) {
    button.textContent = t("popup.orgSelector.selecting");
  }
  setOrgSelectorStatus();
  try {
    await loadSalesforceSessionForHost(org.host);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDebugLogs("Salesforce org selection failed", error.debugLogs, message);
    setOrgSelectorStatus(message, true);
    if (button) {
      button.textContent = originalLabel;
    }
    setOrgSelectionBusy(false);
  }
}

function setCurrentTabTitle() {
  currentTabTitleEl.textContent = t("app.shortTitle");
}

function appendDebugLogs(title, logs = [], fallback = "") {
  console.warn(title, {
    logs: Array.isArray(logs) ? logs : [],
    fallback
  });
}

function rememberHost(host = "") {
  if (!host) {
    return;
  }

  try {
    window.localStorage.setItem(LAST_HOST_STORAGE_KEY, host);
  } catch (_error) {
    // Local storage can be unavailable in restricted extension contexts.
  }
}

function renderSummary(target, rows = []) {
  target.innerHTML = "";
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value === undefined || value === null || value === "" ? "N/A" : String(value);
    target.append(term, detail);
  });
}

function selectPopupTab(targetId) {
  const group = document.querySelector('[data-tab-group="main"]');
  if (!group) {
    return;
  }

  const buttons = Array.from(group.querySelectorAll(".tab-button[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel="main"]'));
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === targetId && !button.hidden);
  });
  panels.forEach((panel) => panel.classList.toggle("active", panel.id === targetId));
}

function activateTabGroup(group) {
  const groupName = group.dataset.tabGroup;
  const buttons = Array.from(group.querySelectorAll(".tab-button[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll(`[data-tab-panel="${groupName}"]`));
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.tabTarget || "";
      buttons.forEach((tabButton) => tabButton.classList.toggle("active", tabButton === button));
      panels.forEach((panel) => panel.classList.toggle("active", panel.id === targetId));
    });
  });
}

function activateTabs() {
  document.querySelectorAll("[data-tab-group]").forEach((group) => activateTabGroup(group));
}

function bindExtensionPageActions() {
  async function openWithValidatedSession(button, page) {
    const host = session?.host;
    if (!host) {
      setStatus(t("status.openSalesforce"), true);
      return;
    }

    button.disabled = true;
    setStatus(t("popup.status.checkingSession", { host }));
    try {
      const validatedSession = await getSessionForHost(host);
      if (!validatedSession?.sid) {
        throw new Error(t("status.sessionUnavailable"));
      }
      session = validatedSession;
      rememberHost(session.host);
      await openExtensionPage(page, { host: session.host });
      setStatus(t("popup.status.connected", { host: session.host }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendDebugLogs("Popup app session validation failed", error.debugLogs, message);
      setStatus(message, true);
    } finally {
      button.disabled = false;
    }
  }

  function bindOpen(button, page) {
    button?.addEventListener("click", () => void openWithValidatedSession(button, page));
  }

  bindOpen(openSchemaButton, "schema-viewer.html");
  bindOpen(openOrgDifferencesButton, "org-differences.html");
  bindOpen(openManualButton, "manual.html");
  bindOpen(openDataExportButton, "data-export.html");
  bindOpen(openRestExplorerButton, "rest-explorer.html");
  bindOpen(openDocumentFoldersButton, "document-folders.html");
  bindOpen(openForceSheetButton, "force-sheet.html");
  bindOpen(openObjectSchemaButton, "object-schema.html");
  bindOpen(openPermissionExplorerButton, "permission-explorer.html");
  bindOpen(openRunApexButton, "run-apex.html");
  bindOpen(openMonitoringAuditButton, "setup-audit-trail.html");
  bindOpen(openMonitoringEventLogsButton, "event-logs.html");
  bindOpen(openMonitoringApiUsageButton, "latest-api-usage.html");
  bindOpen(openMonitoringLoginHistoryButton, "login-history.html");

  if (popupVersionEl) {
    const version = (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.()?.version) || "";
    popupVersionEl.textContent = version ? `v${version}` : "";
    popupVersionEl.addEventListener("click", () => {
      const params = version ? { path: `versions/v${version}.md` } : {};
      if (session?.host) {
        params.host = session.host;
      }
      openExtensionPage("manual.html", params);
    });
  }
}

function normalizePopupSearchText(value = "") {
  return String(value || "").trim().toLocaleLowerCase();
}

function setPopupSearchTabVisible(isVisible) {
  if (!popupSearchTabButton) {
    return;
  }

  popupSearchTabButton.hidden = !isVisible;
  if (!isVisible && popupSearchTabButton.classList.contains("active")) {
    selectPopupTab("tools");
  }
}

function normalizePopupSearchLimit(value = POPUP_SEARCH_RESULT_LIMIT) {
  const parsed = Number(value);
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : POPUP_SEARCH_RESULT_LIMIT;
  return Math.max(1, Math.min(limit, POPUP_SEARCH_MAX_RESULT_LIMIT));
}

function getNextPopupSearchLimit(currentLimit = POPUP_SEARCH_RESULT_LIMIT) {
  return Math.min(
    POPUP_SEARCH_MAX_RESULT_LIMIT,
    normalizePopupSearchLimit(currentLimit) + POPUP_SEARCH_RESULT_LIMIT
  );
}

function updatePopupSearchSuggestions() {
  renderPopupSearchSuggestions(getPopupSearchSuggestionMatches(popupSearchInput?.value || ""));
}

function getPopupSearchSuggestionMatches(termValue = "") {
  const term = normalizePopupSearchText(termValue);
  if (!term) {
    return [];
  }

  const sourceEntries = popupSearchEntries.filter((entry) => (
    String(entry.name || "").toLocaleLowerCase().includes(term)
    || String(entry.apiName || "").toLocaleLowerCase().includes(term)
    || String(entry.label || "").toLocaleLowerCase().includes(term)
    || String(entry.objectApiName || "").toLocaleLowerCase().includes(term)
    || String(entry.typeLabel || "").toLocaleLowerCase().includes(term)
    || String(entry.metadataObject || "").toLocaleLowerCase().includes(term)
  ));
  const suggestions = new Map();

  sourceEntries.some((entry) => {
    [entry.name, entry.apiName, entry.label].forEach((value) => {
      const cleanValue = String(value || "").trim();
      if (!cleanValue || suggestions.has(cleanValue)) {
        return;
      }
      suggestions.set(cleanValue, {
        name: cleanValue,
        meta: entry.typeLabel || entry.metadataObject || "",
        priority: getPopupSearchTypePriority(entry)
      });
    });
    return suggestions.size >= POPUP_SEARCH_SUGGESTION_LIMIT;
  });

  return [...suggestions.values()]
    .sort((left, right) => {
      const priorityDiff = (Number(left.priority) || 20) - (Number(right.priority) || 20);
      if (priorityDiff) {
        return priorityDiff;
      }
      const leftName = String(left.name || "").toLocaleLowerCase();
      const rightName = String(right.name || "").toLocaleLowerCase();
      const leftStarts = leftName.startsWith(term);
      const rightStarts = rightName.startsWith(term);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .slice(0, POPUP_SEARCH_SUGGESTION_LIMIT);
}

function hidePopupSearchSuggestions() {
  popupSearchSuggestionItems = [];
  popupSearchSuggestionIndex = -1;
  if (popupSearchSuggestionsEl) {
    popupSearchSuggestionsEl.hidden = true;
    popupSearchSuggestionsEl.textContent = "";
  }
}

function renderPopupSearchSuggestions(items = []) {
  if (!popupSearchSuggestionsEl || !items.length) {
    hidePopupSearchSuggestions();
    return;
  }

  popupSearchSuggestionItems = items;
  popupSearchSuggestionIndex = Math.min(popupSearchSuggestionIndex, items.length - 1);
  popupSearchSuggestionsEl.textContent = "";

  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "data-export-inline-suggestion";
    button.classList.toggle("active", index === popupSearchSuggestionIndex);

    const name = document.createElement("span");
    name.className = "data-export-inline-suggestion-name";
    name.textContent = item.name;

    const meta = document.createElement("span");
    meta.className = "data-export-inline-suggestion-meta";
    meta.textContent = item.meta || "";

    button.append(name, meta);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      selectPopupSearchSuggestion(index);
    });
    popupSearchSuggestionsEl.appendChild(button);
  });
  popupSearchSuggestionsEl.hidden = false;
}

function setPopupSearchSuggestionIndex(index) {
  if (!popupSearchSuggestionItems.length || !popupSearchSuggestionsEl || popupSearchSuggestionsEl.hidden) {
    return;
  }

  popupSearchSuggestionIndex = (index + popupSearchSuggestionItems.length) % popupSearchSuggestionItems.length;
  Array.from(popupSearchSuggestionsEl.children).forEach((child, childIndex) => {
    child.classList.toggle("active", childIndex === popupSearchSuggestionIndex);
  });
  popupSearchSuggestionsEl.children[popupSearchSuggestionIndex]?.scrollIntoView({ block: "nearest" });
}

function selectPopupSearchSuggestion(index = popupSearchSuggestionIndex) {
  const item = popupSearchSuggestionItems[index];
  if (!item?.name || !popupSearchInput) {
    hidePopupSearchSuggestions();
    return;
  }

  popupSearchInput.value = item.name;
  hidePopupSearchSuggestions();
  popupSearchInput.focus();
  void runPopupSearch();
}

function handlePopupSearchKeydown(event) {
  const hasSuggestions = popupSearchSuggestionsEl
    && !popupSearchSuggestionsEl.hidden
    && popupSearchSuggestionItems.length > 0;
  if (hasSuggestions) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPopupSearchSuggestionIndex(popupSearchSuggestionIndex < 0 ? 0 : popupSearchSuggestionIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPopupSearchSuggestionIndex(popupSearchSuggestionIndex < 0 ? popupSearchSuggestionItems.length - 1 : popupSearchSuggestionIndex - 1);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && popupSearchSuggestionIndex >= 0) {
      event.preventDefault();
      selectPopupSearchSuggestion();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hidePopupSearchSuggestions();
      return;
    }
  }

  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  hidePopupSearchSuggestions();
  void runPopupSearch();
}

function formatPopupSearchWarningText(warnings = []) {
  const warningCount = Array.isArray(warnings) ? warnings.length : 0;
  if (!warningCount) {
    return "";
  }

  return " Some optional metadata types could not be searched.";
}

function getPopupSearchHighlightNeedles(term = "") {
  const cleanTerm = String(term || "").trim();
  if (!cleanTerm) {
    return [];
  }

  const needles = new Map([[cleanTerm.toLocaleLowerCase(), cleanTerm]]);
  cleanTerm.split(/\s+/).forEach((part) => {
    const cleanPart = part.trim();
    if (cleanPart && cleanPart !== cleanTerm) {
      needles.set(cleanPart.toLocaleLowerCase(), cleanPart);
    }
  });
  return [...needles.values()].sort((left, right) => right.length - left.length);
}

function appendPopupHighlightedText(target, value = "", term = "") {
  const text = String(value || "");
  const needles = getPopupSearchHighlightNeedles(term);
  if (!text || !needles.length) {
    target.textContent = text;
    return;
  }

  const lowerText = text.toLocaleLowerCase();
  const lowerNeedles = needles.map((needle) => needle.toLocaleLowerCase()).filter(Boolean);
  let index = 0;

  while (index < text.length) {
    let nextMatch = null;
    lowerNeedles.forEach((needle) => {
      const matchIndex = lowerText.indexOf(needle, index);
      if (matchIndex < 0) {
        return;
      }
      if (
        !nextMatch
        || matchIndex < nextMatch.index
        || (matchIndex === nextMatch.index && needle.length > nextMatch.length)
      ) {
        nextMatch = {
          index: matchIndex,
          length: needle.length
        };
      }
    });

    if (!nextMatch) {
      target.appendChild(document.createTextNode(text.slice(index)));
      break;
    }

    if (nextMatch.index > index) {
      target.appendChild(document.createTextNode(text.slice(index, nextMatch.index)));
    }

    const mark = document.createElement("mark");
    mark.textContent = text.slice(nextMatch.index, nextMatch.index + nextMatch.length);
    target.appendChild(mark);
    index = nextMatch.index + nextMatch.length;
  }
}

function popupSearchValueMatchesTerm(value = "", term = "") {
  const lowerValue = String(value || "").toLocaleLowerCase();
  const cleanTerm = String(term || "").trim();
  const parts = cleanTerm
    .split(/[.\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return lowerValue.includes(cleanTerm.toLocaleLowerCase())
      || parts.every((part) => lowerValue.includes(part.toLocaleLowerCase()));
  }
  return getPopupSearchHighlightNeedles(term).some((needle) => lowerValue.includes(needle.toLocaleLowerCase()));
}

function createPopupIconSvg(iconName = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const paths = {
    external: [
      "M15 3h6v6",
      "M10 14 21 3",
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
    ]
  };

  (paths[iconName] || []).forEach((pathText) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathText);
    svg.appendChild(path);
  });

  return svg;
}

function createPopupIconButton(iconName, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["icon-button", className].filter(Boolean).join(" ");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(createPopupIconSvg(iconName));
  return button;
}

function openExternalUrl(url = "") {
  if (!url) {
    return;
  }
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

function isSalesforceRecordId(value = "") {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || "").trim());
}

function getPopupSearchObjectApiName(result = {}) {
  const fullName = String(result.fullName || result.name || "").trim();
  const fullNameObject = fullName.includes(".") ? fullName.split(".").slice(0, -1).join(".") : "";
  return String(
    result.objectApiName
    || result.record?.EntityDefinition?.QualifiedApiName
    || fullNameObject
    || ""
  ).trim();
}

function getPopupSearchChildApiName(result = {}) {
  const fullName = String(result.fullName || result.name || "").trim();
  const fullNameChild = fullName.includes(".") ? fullName.split(".").pop() : "";
  return String(result.apiName || fullNameChild || result.name || "").trim();
}

function isCustomFieldApiName(value = "") {
  return /__(?:c|pc|x)$/i.test(String(value || "").trim());
}

function getFirstPopupSearchValue(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
}

function pushPopupSearchUniqueText(parts, value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return;
  }
  const key = text.toLocaleLowerCase();
  if (parts.some((part) => String(part || "").toLocaleLowerCase() === key)) {
    return;
  }
  parts.push(text);
}

function createPopupSearchSnippetField(label = "", ...values) {
  return {
    label,
    value: getFirstPopupSearchValue(...values)
  };
}

function getPopupSearchMetadataObjectKey(result = {}) {
  return String(
    result.metadataApiType
    || result.metadataObject
    || result.typeLabel
    || result.type
    || ""
  ).trim();
}

function formatPopupSearchStatus(value = "") {
  if (value === true || value === "true") {
    return "Active";
  }
  if (value === false || value === "false") {
    return "Inactive";
  }
  return String(value || "").trim();
}

function createPopupSearchResultPresentation(result = {}) {
  const record = result.record && typeof result.record === "object" ? result.record : {};
  const metadataObject = getPopupSearchMetadataObjectKey(result);
  const objectApiName = getPopupSearchObjectApiName(result);
  const childApiName = getPopupSearchChildApiName(result);
  const label = getFirstPopupSearchValue(
    result.label,
    record.MasterLabel,
    record.Label,
    record.Subject,
    record.Title
  );
  const fullName = getFirstPopupSearchValue(result.fullName, result.name, result.apiName, record.FullName);
  const baseName = fullName || childApiName || label || result.id || "";
  const infoParts = [];
  const snippetFields = [];
  const addInfo = (value = "") => pushPopupSearchUniqueText(infoParts, value);
  const addSnippet = (snippetLabel = "", ...values) => {
    snippetFields.push(createPopupSearchSnippetField(snippetLabel, ...values));
  };

  addSnippet("Name", result.name, record.Name);
  addSnippet("API Name", result.apiName, record.QualifiedApiName);
  addSnippet("Full Name", result.fullName, record.fullName, record.FullName);
  addSnippet("Label", label);
  addSnippet("Object API", objectApiName);
  addSnippet("DeveloperName", result.developerName, record.DeveloperName);

  switch (metadataObject) {
    case "CustomObject":
    case "EntityDefinition":
      addInfo(label !== baseName ? label : "");
      addInfo(record.PluralLabel);
      addSnippet("Plural Label", record.PluralLabel);
      addSnippet("Namespace", record.NamespacePrefix);
      return {
        name: objectApiName || baseName,
        infoText: infoParts.join(" · ") || "Object metadata",
        snippetFields
      };

    case "CustomField":
    case "FieldDefinition":
      addInfo(label !== baseName ? label : "");
      addInfo(objectApiName);
      addInfo(record.DataType);
      addSnippet("Field API", childApiName);
      addSnippet("Data Type", record.DataType);
      addSnippet("Namespace", record.NamespacePrefix);
      addSnippet("Description", record.Description);
      addSnippet("Help Text", record.InlineHelpText || record.Metadata?.inlineHelpText);
      addSnippet("Formula", record.Metadata?.formula);
      const picklistValues = (record.Metadata?.valueSet?.valueSetDefinition?.value || [])
        .map((v) => String(v.label || v.fullName || "").trim())
        .filter(Boolean)
        .slice(0, 10)
        .join(", ");
      addSnippet("Picklist Values", picklistValues || record.Metadata?.valueSet?.valueSetName);
      return {
        name: fullName || (objectApiName && childApiName ? `${objectApiName}.${childApiName}` : childApiName || baseName),
        infoText: infoParts.join(" · ") || "Field metadata",
        snippetFields
      };

    case "RecordType":
      addInfo(objectApiName);
      addInfo(label !== baseName ? label : "");
      addSnippet("Record Type", childApiName);
      addSnippet("Object API", objectApiName, record.SobjectType);
      return {
        name: fullName || (objectApiName && childApiName ? `${objectApiName}.${childApiName}` : childApiName || baseName),
        infoText: infoParts.join(" · ") || "Record type metadata",
        snippetFields
      };

    case "ValidationRule":
      addInfo(objectApiName);
      addInfo(formatPopupSearchStatus(record.Active));
      addSnippet("Validation Rule", record.ValidationName, childApiName);
      addSnippet("Object API", objectApiName);
      addSnippet("Active", formatPopupSearchStatus(record.Active));
      return {
        name: fullName || (objectApiName && childApiName ? `${objectApiName}.${childApiName}` : childApiName || baseName),
        infoText: infoParts.join(" · ") || "Validation rule metadata",
        snippetFields
      };

    case "WebLink":
      addInfo(label !== baseName ? label : "");
      addInfo(objectApiName);
      addSnippet("Label", label, record.MasterLabel);
      addSnippet("Object API", objectApiName);
      addSnippet("URL", record.Url);
      return {
        name: fullName || (objectApiName && childApiName ? `${objectApiName}.${childApiName}` : childApiName || baseName),
        infoText: infoParts.join(" · ") || "Button, link, or action metadata",
        snippetFields
      };

    case "Layout":
      addInfo(objectApiName);
      addInfo(record.ManageableState);
      addSnippet("Layout", childApiName);
      addSnippet("Object API", objectApiName);
      addSnippet("State", record.ManageableState);
      return {
        name: fullName || baseName,
        infoText: infoParts.join(" · ") || "Layout metadata",
        snippetFields
      };

    case "PermissionSet":
      addInfo(label !== baseName ? label : "");
      addInfo(record.NamespacePrefix);
      addSnippet("Permission Set", record.Name);
      addSnippet("Label", label, record.Label);
      addSnippet("Namespace", record.NamespacePrefix);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Permission set metadata",
        snippetFields
      };

    case "Profile":
      addInfo(label !== baseName ? label : "");
      addSnippet("Profile", record.Name);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Profile metadata",
        snippetFields
      };

    case "Flow":
      addInfo(record.Status);
      addInfo(record.ProcessType);
      addInfo(record.VersionNumber ? `Version ${record.VersionNumber}` : "");
      addSnippet("Status", record.Status);
      addSnippet("Process Type", record.ProcessType);
      addSnippet("Version", record.VersionNumber);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Flow metadata",
        snippetFields
      };

    case "ApexClass":
    case "ApexTrigger":
      addInfo(record.Status);
      addInfo(record.ApiVersion ? `API ${record.ApiVersion}` : "");
      addSnippet("Status", record.Status);
      addSnippet("API Version", record.ApiVersion);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || metadataObject,
        snippetFields
      };

    case "ApexPage":
    case "ApexComponent":
    case "LightningComponentBundle":
    case "AuraDefinitionBundle":
      addInfo(label !== baseName ? label : "");
      addInfo(record.ApiVersion ? `API ${record.ApiVersion}` : "");
      addInfo(record.Description);
      addSnippet("Master Label", record.MasterLabel);
      addSnippet("Description", record.Description);
      addSnippet("API Version", record.ApiVersion);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || metadataObject,
        snippetFields
      };

    case "StaticResource":
      addInfo(record.ContentType);
      addInfo(record.NamespacePrefix);
      addSnippet("Content Type", record.ContentType);
      addSnippet("Namespace", record.NamespacePrefix);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Static resource metadata",
        snippetFields
      };

    case "EmailTemplate":
      addInfo(label !== baseName ? label : "");
      addInfo(record.FolderName);
      addSnippet("Subject", record.Subject);
      addSnippet("Folder", record.FolderName);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Email template metadata",
        snippetFields
      };

    case "Document":
    case "Report":
    case "Dashboard":
      addInfo(label !== baseName ? label : "");
      addInfo(record.FolderName);
      addSnippet("Folder", record.FolderName);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || metadataObject,
        snippetFields
      };

    case "ContentDocument":
      addInfo(record.FileType);
      addInfo(record.LatestPublishedVersionId);
      addSnippet("Title", record.Title);
      addSnippet("File Type", record.FileType);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || "Content document",
        snippetFields
      };

    default:
      addInfo(label !== baseName ? label : "");
      addInfo(objectApiName);
      addInfo(metadataObject && metadataObject !== result.typeLabel ? metadataObject : "");
      addSnippet("File Name", record.fileName);
      addSnippet("Namespace", record.namespacePrefix || record.NamespacePrefix);
      return {
        name: baseName,
        infoText: infoParts.join(" · ") || metadataObject || result.typeLabel || "",
        snippetFields
      };
  }
}

function getPopupSearchResultLabel(result = {}) {
  return createPopupSearchResultPresentation(result).infoText;
}

function getPopupSearchSalesforceUrl(result = {}) {
  if (!session?.host) {
    return "";
  }

  const baseUrl = `https://${session.host}`;
  const metadataObject = String(result.metadataApiType || result.metadataObject || "").trim();
  const recordId = String(result.id || result.record?.Id || "").trim();
  const objectApiName = getPopupSearchObjectApiName(result);
  const childApiName = getPopupSearchChildApiName(result);

  if (metadataObject === "CustomObject" || result.type === "object") {
    const objectName = objectApiName || childApiName;
    return objectName
      ? `${baseUrl}/lightning/setup/ObjectManager/${encodeURIComponent(objectName)}/Details/view`
      : "";
  }

  if (metadataObject === "CustomField" || result.type === "field") {
    const fieldRouteId = isSalesforceRecordId(recordId)
      ? recordId
      : isCustomFieldApiName(childApiName)
        ? ""
        : childApiName;
    return objectApiName && fieldRouteId
      ? `${baseUrl}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/FieldsAndRelationships/${encodeURIComponent(fieldRouteId)}/view`
      : "";
  }

  if (metadataObject === "RecordType") {
    return objectApiName && isSalesforceRecordId(recordId)
      ? `${baseUrl}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/RecordTypes/${encodeURIComponent(recordId)}/view`
      : "";
  }

  if (metadataObject === "ValidationRule") {
    return objectApiName && isSalesforceRecordId(recordId)
      ? `${baseUrl}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/ValidationRules/${encodeURIComponent(recordId)}/view`
      : "";
  }

  if (metadataObject === "WebLink") {
    return objectApiName && isSalesforceRecordId(recordId)
      ? `${baseUrl}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/ButtonsLinksActions/${encodeURIComponent(recordId)}/view`
      : "";
  }

  return isSalesforceRecordId(recordId)
    ? `${baseUrl}/${encodeURIComponent(recordId)}`
    : "";
}

function getPopupSearchTypeLabel(result = {}) {
  return String(result.typeLabel || result.metadataObject || result.type || "Metadata").trim() || "Metadata";
}

function getPopupSearchTypePriority(result = {}) {
  const candidates = [
    result.metadataType,
    result.metadataObject,
    result.metadataApiType,
    result.typeLabel,
    result.type,
    result.meta
  ]
    .map((value) => String(value || "").trim().toLocaleLowerCase())
    .filter(Boolean);
  const priorities = candidates
    .map((candidate) => POPUP_SEARCH_COMMON_TYPE_PRIORITY.get(candidate))
    .filter((priority) => Number.isFinite(priority));
  return priorities.length ? Math.min(...priorities) : 20;
}

function comparePopupSearchResultRows(left = {}, right = {}) {
  const leftName = String(left.name || left.apiName || left.fullName || "").trim();
  const rightName = String(right.name || right.apiName || right.fullName || "").trim();
  return getPopupSearchTypePriority(left) - getPopupSearchTypePriority(right)
    || leftName.localeCompare(rightName, undefined, {
      numeric: true,
      sensitivity: "base"
    })
    || getPopupSearchResultLabel(left).localeCompare(getPopupSearchResultLabel(right), undefined, {
      numeric: true,
      sensitivity: "base"
    });
}

function addPopupSnippetCandidate(snippets, seen, label = "", value = "", term = "") {
  const cleanLabel = String(label || "").trim();
  const text = String(value || "").trim();
  const snippet = `${cleanLabel}: ${text}`;
  const valueKey = text.toLocaleLowerCase();
  const snippetKey = snippet.toLocaleLowerCase();
  if (!cleanLabel || !text || seen.has(valueKey) || seen.has(snippetKey) || !popupSearchValueMatchesTerm(text, term)) {
    return;
  }

  seen.add(valueKey);
  seen.add(snippetKey);
  snippets.push({
    label: cleanLabel,
    snippet
  });
}

function getPopupSnippetValueKey(label = "", snippet = "") {
  const cleanLabel = String(label || "").trim();
  const text = String(snippet || "").trim();
  const prefix = cleanLabel ? `${cleanLabel}:` : "";
  return prefix && text.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? text.slice(prefix.length).trim().toLocaleLowerCase()
    : text.toLocaleLowerCase();
}

function getPopupSearchResultSnippets(result = {}, term = "") {
  const presentation = createPopupSearchResultPresentation(result);
  const snippets = [];
  const seen = new Set();
  (Array.isArray(result.matches) ? result.matches : []).forEach((match) => {
    const snippet = String(match?.snippet || "").trim();
    const label = String(match?.label || "Match").trim();
    const valueKey = getPopupSnippetValueKey(label, snippet);
    const snippetKey = snippet.toLocaleLowerCase();
    if (!snippet || seen.has(valueKey) || seen.has(snippetKey)) {
      return;
    }
    seen.add(valueKey);
    seen.add(snippetKey);
    snippets.push({
      label,
      snippet
    });
  });

  const record = result.record && typeof result.record === "object" ? result.record : {};
  presentation.snippetFields.forEach(({ label, value }) => addPopupSnippetCandidate(snippets, seen, label, value, term));
  [
    ["Name", result.name],
    ["API Name", result.apiName],
    ["Full Name", result.fullName],
    ["Label", result.label],
    ["Object API", result.objectApiName],
    ["DeveloperName", result.developerName || record.DeveloperName],
    ["Record Name", record.Name],
    ["Master Label", record.MasterLabel],
    ["Qualified API", record.QualifiedApiName],
    ["Validation Name", record.ValidationName],
    ["File Name", record.fileName],
    ["Folder", record.FolderName],
    ["Subject", record.Subject],
    ["Description", record.Description],
    ["Status", record.Status],
    ["Content Type", record.ContentType]
  ].forEach(([label, value]) => addPopupSnippetCandidate(snippets, seen, label, value, term));

  return snippets.slice(0, POPUP_SEARCH_SNIPPET_LIMIT);
}

function renderPopupSearchResultSnippets(result = {}, term = "") {
  const snippets = getPopupSearchResultSnippets(result, term);
  if (!snippets.length) {
    return null;
  }

  const list = document.createElement("div");
  list.className = "popup-search-result-snippets";
  snippets.forEach((match) => {
    const row = document.createElement("div");
    row.className = "popup-search-result-snippet";
    appendPopupHighlightedText(row, match.snippet || match.label, term);
    list.appendChild(row);
  });
  return list;
}

function createPopupSearchResultElement(result = {}, cleanTerm = "") {
  const presentation = createPopupSearchResultPresentation(result);
  const item = document.createElement("div");
  item.className = "popup-search-result";

  const mainButton = document.createElement("button");
  mainButton.type = "button";
  mainButton.className = "popup-search-result-main";
  mainButton.addEventListener("click", () => {
    if (popupSearchInput) {
      popupSearchInput.value = presentation.name || result.name;
      hidePopupSearchSuggestions();
    }
  });

  const name = document.createElement("span");
  name.className = "popup-search-result-name";
  appendPopupHighlightedText(name, presentation.name, cleanTerm);

  const label = document.createElement("span");
  label.className = "popup-search-result-label";
  appendPopupHighlightedText(label, presentation.infoText, cleanTerm);

  mainButton.append(name, label);
  const snippets = renderPopupSearchResultSnippets(result, cleanTerm);

  const salesforceUrl = getPopupSearchSalesforceUrl(result);
  const openButton = createPopupIconButton("external", "Open in Salesforce", "secondary popup-search-result-open");
  openButton.disabled = !salesforceUrl;
  openButton.addEventListener("click", () => openExternalUrl(salesforceUrl));

  item.append(mainButton, openButton);
  if (snippets) {
    item.appendChild(snippets);
  }
  return item;
}

function groupPopupSearchResultsByType(results = []) {
  const groups = new Map();
  results.forEach((result) => {
    const typeLabel = getPopupSearchTypeLabel(result);
    if (!groups.has(typeLabel)) {
      groups.set(typeLabel, []);
    }
    groups.get(typeLabel).push(result);
  });
  return [...groups.entries()].sort(([leftType, leftResults], [rightType, rightResults]) => {
    const leftPriority = Math.min(...leftResults.map((result) => getPopupSearchTypePriority(result)));
    const rightPriority = Math.min(...rightResults.map((result) => getPopupSearchTypePriority(result)));
    return leftPriority - rightPriority
      || leftType.localeCompare(rightType, undefined, {
        numeric: true,
        sensitivity: "base"
      });
  });
}

function getPopupSearchEntryKey(result = {}) {
  return [
    result.metadataObject || result.typeLabel || result.type || "metadata",
    result.name || result.apiName || result.fullName || result.id || ""
  ].join(":").toLocaleLowerCase();
}

function mergePopupSearchResultRecord(existing = {}, incoming = {}) {
  const matches = [];
  const seenMatches = new Set();
  const existingId = String(existing.id || "").trim();
  const incomingId = String(incoming.id || "").trim();
  const existingRecord = existing.record && typeof existing.record === "object" ? existing.record : {};
  const incomingRecord = incoming.record && typeof incoming.record === "object" ? incoming.record : {};
  const existingRecordId = String(existingRecord.Id || existingRecord.id || "").trim();
  const incomingRecordId = String(incomingRecord.Id || incomingRecord.id || "").trim();
  [
    ...(Array.isArray(existing.matches) ? existing.matches : []),
    ...(Array.isArray(incoming.matches) ? incoming.matches : [])
  ].forEach((match) => {
    const snippet = String(match?.snippet || "").trim();
    const label = String(match?.label || "").trim();
    const key = `${label}:${snippet}`.toLocaleLowerCase();
    if (!snippet || seenMatches.has(key)) {
      return;
    }
    seenMatches.add(key);
    matches.push(match);
  });

  return {
    ...existing,
    ...incoming,
    id: isSalesforceRecordId(incomingId) || !isSalesforceRecordId(existingId)
      ? incoming.id
      : existing.id,
    record: {
      ...existingRecord,
      ...incomingRecord,
      Id: isSalesforceRecordId(incomingRecordId) || !isSalesforceRecordId(existingRecordId)
        ? incomingRecord.Id
        : existingRecord.Id
    },
    matches
  };
}

function mergePopupSearchEntries(currentEntries = [], incomingEntries = [], limit = POPUP_SEARCH_RESULT_LIMIT) {
  const byKey = new Map();
  currentEntries.forEach((entry) => {
    const key = getPopupSearchEntryKey(entry);
    if (key) {
      byKey.set(key, entry);
    }
  });

  let addedCount = 0;
  (Array.isArray(incomingEntries) ? incomingEntries : []).forEach((entry) => {
    if (!entry || !(entry.name || entry.apiName || entry.fullName || entry.id)) {
      return;
    }
    const key = getPopupSearchEntryKey(entry);
    if (!key || byKey.has(key)) {
      if (key && byKey.has(key)) {
        byKey.set(key, mergePopupSearchResultRecord(byKey.get(key), entry));
      }
      return;
    }
    byKey.set(key, entry);
    addedCount += 1;
  });

  return {
    addedCount,
    records: [...byKey.values()]
      .sort(comparePopupSearchResultRows)
      .slice(0, Math.max(1, Number(limit) || POPUP_SEARCH_RESULT_LIMIT))
  };
}

function addPopupSearchWarnings(targetWarnings = [], incomingWarnings = []) {
  (Array.isArray(incomingWarnings) ? incomingWarnings : []).forEach((warning) => {
    const text = String(warning || "").trim();
    if (text && !targetWarnings.includes(text)) {
      targetWarnings.push(text);
    }
  });
}

function renderPopupSearchResults(term = "", results = [], warnings = [], options = {}) {
  if (!popupSearchSummaryEl || !popupSearchResultsEl) {
    return;
  }

  popupSearchResultsEl.innerHTML = "";
  const cleanTerm = String(term || "").trim();
  const currentLimit = normalizePopupSearchLimit(options.limit || popupSearchActiveLimit || POPUP_SEARCH_RESULT_LIMIT);
  if (!cleanTerm) {
    popupSearchSummaryEl.textContent = t("popup.search.empty");
    return;
  }

  if (!results.length) {
    popupSearchSummaryEl.textContent = options.isSearching
      ? `Searching metadata for "${cleanTerm}"...`
      : `No metadata results for "${cleanTerm}".${formatPopupSearchWarningText(warnings)}`;
    return;
  }

  const groups = groupPopupSearchResultsByType(results);
  const summaryPrefix = options.isSearching ? "Searching... " : "";
  const isCapped = !options.isSearching && results.length >= currentLimit && currentLimit < POPUP_SEARCH_MAX_RESULT_LIMIT;
  popupSearchSummaryEl.textContent = `${summaryPrefix}${results.length} metadata result${results.length === 1 ? "" : "s"} across ${groups.length} type${groups.length === 1 ? "" : "s"} for "${cleanTerm}".${isCapped ? ` Showing first ${currentLimit}. More may exist.` : ""}`;
  groups.forEach(([typeLabel, groupResults]) => {
    const group = document.createElement("section");
    group.className = "popup-search-result-group";

    const heading = document.createElement("div");
    heading.className = "popup-search-result-group-heading";

    const title = document.createElement("span");
    title.textContent = typeLabel;

    const count = document.createElement("span");
    count.className = "popup-search-result-group-count";
    count.textContent = String(groupResults.length);

    heading.append(title, count);
    group.appendChild(heading);
    [...groupResults]
      .sort(comparePopupSearchResultRows)
      .forEach((result) => group.appendChild(createPopupSearchResultElement(result, cleanTerm)));
    popupSearchResultsEl.appendChild(group);
  });

  if (isCapped) {
    const nextLimit = getNextPopupSearchLimit(currentLimit);
    const actions = document.createElement("div");
    actions.className = "popup-search-more-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary popup-search-more-button";
    button.textContent = `Show up to ${nextLimit} results`;
    button.addEventListener("click", () => void runPopupSearch({ limit: nextLimit }));

    actions.appendChild(button);
    popupSearchResultsEl.appendChild(actions);
  }
}

function renderPopupSearchLoading(term = "") {
  if (!popupSearchSummaryEl || !popupSearchResultsEl) {
    return;
  }

  popupSearchResultsEl.innerHTML = "";
  popupSearchSummaryEl.textContent = term
    ? `Searching metadata for "${term}"...`
    : t("popup.search.empty");
}

async function runPopupSearch(options = {}) {
  const term = popupSearchInput?.value?.trim() || "";
  const resultLimit = normalizePopupSearchLimit(options.limit || POPUP_SEARCH_RESULT_LIMIT);
  popupSearchActiveLimit = resultLimit;
  hidePopupSearchSuggestions();
  if (!term) {
    popupSearchRequestId += 1;
    popupSearchActiveLimit = POPUP_SEARCH_RESULT_LIMIT;
    setPopupSearchTabVisible(false);
    renderPopupSearchResults();
    return;
  }

  const requestId = popupSearchRequestId + 1;
  popupSearchRequestId = requestId;
  setPopupSearchTabVisible(true);
  selectPopupTab("search");
  if (!session?.host) {
    popupSearchEntries = [];
    renderPopupSearchResults(term, []);
    setStatus(t("status.openSalesforce"), true);
    return;
  }

  popupSearchEntries = [];
  renderPopupSearchLoading(term);
  setStatus(`Searching metadata for "${term}" up to ${resultLimit} results...`);
  try {
    const progressWarnings = [];
    const handleProgress = (progress = {}) => {
      if (requestId !== popupSearchRequestId) {
        return;
      }

      addPopupSearchWarnings(progressWarnings, progress.warnings || []);
      const merged = mergePopupSearchEntries(popupSearchEntries, progress.records || [], resultLimit);
      if (!merged.addedCount) {
        return;
      }

      popupSearchEntries = merged.records;
      setPopupSearchTabVisible(true);
      selectPopupTab("search");
      renderPopupSearchResults(term, popupSearchEntries, progressWarnings, { isSearching: true, limit: resultLimit });
      const typeText = progress.typeLabel || progress.metadataObject || progress.metadataType || "metadata";
      setStatus(`Searching metadata for "${term}"... ${popupSearchEntries.length} result${popupSearchEntries.length === 1 ? "" : "s"} found so far. Latest: ${typeText}.`);
    };
    const result = await searchMetadataByText(session.host, session.sid, term, {
      includeInstalledPackages: true,
      limit: resultLimit,
      metadataCatalogTimeoutMs: 45000,
      onProgress: handleProgress
    });
    if (requestId !== popupSearchRequestId) {
      return;
    }
    popupSearchEntries = mergePopupSearchEntries(popupSearchEntries, result?.records || [], resultLimit).records;
    renderPopupSearchResults(term, popupSearchEntries, result?.warnings || [], { limit: resultLimit });
    const nextLimit = getNextPopupSearchLimit(resultLimit);
    const cappedText = popupSearchEntries.length >= resultLimit && resultLimit < POPUP_SEARCH_MAX_RESULT_LIMIT
      ? ` Showing first ${resultLimit}; use Show more for up to ${nextLimit}.`
      : "";
    setStatus(`Metadata search returned ${popupSearchEntries.length} result${popupSearchEntries.length === 1 ? "" : "s"}.${cappedText}`);
  } catch (error) {
    if (requestId !== popupSearchRequestId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    appendDebugLogs("Popup metadata search failed", error.debugLogs, message);
    popupSearchEntries = [];
    hidePopupSearchSuggestions();
    setPopupSearchTabVisible(true);
    selectPopupTab("search");
    if (popupSearchSummaryEl) {
      popupSearchSummaryEl.textContent = `Metadata search failed: ${message}`;
    }
    if (popupSearchResultsEl) {
      popupSearchResultsEl.innerHTML = "";
    }
    setStatus(message, true);
  }
}

function bindPopupSearch() {
  popupSearchButton?.addEventListener("click", () => void runPopupSearch());
  popupSearchInput?.addEventListener("input", () => {
    updatePopupSearchSuggestions();
    if (!popupSearchInput.value.trim()) {
      popupSearchRequestId += 1;
      setPopupSearchTabVisible(false);
      renderPopupSearchResults();
    }
  });
  popupSearchInput?.addEventListener("focus", updatePopupSearchSuggestions);
  popupSearchInput?.addEventListener("blur", () => {
    window.setTimeout(hidePopupSearchSuggestions, 120);
  });
  popupSearchInput?.addEventListener("keydown", handlePopupSearchKeydown);
}

function renderLoadedSummaries() {
  if (!session) {
    return;
  }

  if (latestOrg) {
    renderSummary(orgSummaryEl, [
      [t("org.host"), session.host],
      [t("org.orgName"), latestOrg?.Name],
      [t("org.orgId"), latestOrg?.Id],
      [t("org.instance"), latestOrg?.InstanceName],
      [t("org.type"), latestOrg?.OrganizationType],
      [t("org.sandbox"), String(latestOrg?.IsSandbox)]
    ]);
  } else {
    renderSummary(orgSummaryEl, [
      [t("org.host"), session.host],
      ["Status", t("status.unavailable")]
    ]);
  }

  if (latestUser) {
    renderSummary(userSummaryEl, [
      [t("user.username"), latestUser?.preferred_username],
      [t("user.name"), latestUser?.name],
      [t("user.email"), latestUser?.email],
      [t("user.userId"), latestUser?.user_id],
      [t("org.orgId"), latestUser?.organization_id]
    ]);
  } else {
    renderSummary(userSummaryEl, [["Status", t("status.unavailable")]]);
  }
}

async function cacheStartupDiscoveryData(org = null) {
  if (!session?.host || !session?.sid) {
    return;
  }

  try {
    setStatus(t("popup.status.loadingDiscovery", { host: session.host }));
    const [metadataTypesResult, installedPackagesResult] = await Promise.allSettled([
      loadAvailableSchemaMetadataTypes(session.host, session.sid, {
        timeoutMs: STARTUP_DISCOVERY_TIMEOUT_MS
      }),
      loadInstalledPackageNamespaces(session.host, session.sid, {
        timeoutMs: STARTUP_DISCOVERY_TIMEOUT_MS
      })
    ]);
    const cachedStore = await loadSchemaObjectStore(session.host);
    const availableMetadataTypes = metadataTypesResult.status === "fulfilled" && metadataTypesResult.value?.length
      ? metadataTypesResult.value
      : cachedStore.availableMetadataTypes || [];
    const installedPackages = installedPackagesResult.status === "fulfilled"
      ? installedPackagesResult.value
      : cachedStore.installedPackages || cachedStore.subscriberPackages || [];
    const installedPackageNamespaces = installedPackages
      .map((installedPackage) => installedPackage.namespacePrefix)
      .filter(Boolean);
    const orgNamespace = installedPackages
      .find((installedPackage) => String(installedPackage.id || "").startsWith("org:"))
      ?.namespacePrefix || "";
    const defaultMetadataFolders = createDefaultMetadataFolderCache(availableMetadataTypes);
    const nextStore = {
      host: session.host,
      apiVersion: cachedStore.apiVersion || "",
      generatedAt: "",
      objectCount: 0,
      fieldCount: 0,
      metadataTypes: [],
      metadataItemCount: 0,
      errors: [],
      map: {},
      metadata: {},
      details: {},
      orgSummary: org || cachedStore.orgSummary || null,
      availableMetadataTypes,
      installedPackages,
      subscriberPackages: installedPackages,
      installedPackageNamespaces,
      defaultMetadataFolders,
      defaultNamespaceScope: cachedStore.defaultNamespaceScope || orgNamespace || "none",
      discoveryCachedAt: new Date().toISOString()
    };
    if (Array.isArray(cachedStore.defaultMetadataFolderNames)) {
      nextStore.defaultMetadataFolderNames = cachedStore.defaultMetadataFolderNames;
    }
    await saveSchemaObjectStore(session.host, nextStore);
    const warningParts = [
      metadataTypesResult.status === "rejected" ? t("popup.status.metadataDiscoveryFailed") : "",
      installedPackagesResult.status === "rejected" ? t("popup.status.packageDiscoveryFailed") : ""
    ].filter(Boolean);
    setStatus(warningParts.length
      ? t("popup.status.discoveryWarnings", { host: session.host, warnings: warningParts.join(", ") })
      : t("popup.status.discoverySaved", { host: session.host }));
  } catch (error) {
    appendDebugLogs("Startup discovery cache failed", error.debugLogs, error instanceof Error ? error.message : String(error));
    setStatus(t("popup.status.discoveryFailed", { host: session.host }), true);
  }
}

async function loadSalesforceSessionForHost(host) {
  session = await getSessionForHost(host);
  rememberHost(session.host);
  setExtensionVisible(true);
  setCurrentTabTitle();
  setStatus(t("popup.status.connected", { host: session.host }));
  showMainScreen();

  const [orgResult, userResult] = await Promise.allSettled([
    getOrgSummary(session.host, session.sid),
    getUserSummary(session.host, session.sid)
  ]);
  latestOrg = orgResult.status === "fulfilled" ? orgResult.value : null;
  latestUser = userResult.status === "fulfilled" ? userResult.value : null;

  if (orgResult.status === "rejected") {
    const message = orgResult.reason instanceof Error ? orgResult.reason.message : String(orgResult.reason);
    appendDebugLogs("Salesforce org summary failed", orgResult.reason?.debugLogs, message);
  }
  if (userResult.status === "rejected") {
    const message = userResult.reason instanceof Error ? userResult.reason.message : String(userResult.reason);
    appendDebugLogs("Salesforce user summary failed", userResult.reason?.debugLogs, message);
  }

  renderLoadedSummaries();
  void cacheStartupDiscoveryData(latestOrg);
}

async function init() {
  activateTabs();
  bindExtensionPageActions();
  bindPopupSearch();
  popupOrgRefreshButton?.addEventListener("click", () => void refreshPopupOrgDashboard());
  popupChangeOrgButton?.addEventListener("click", () => void refreshPopupOrgDashboard());
  setExtensionVisible(true);
  setCurrentTabTitle();
  await refreshPopupOrgDashboard({ autoSelectCurrent: true });
}

window.addEventListener("app-language-change", () => {
  setCurrentTabTitle();
  renderLoadedSummaries();
  renderPopupOrgDashboard();
  if (session?.host && !statusEl.classList.contains("error")) {
    setStatus(t("popup.status.connected", { host: session.host }));
  }
});

void init();
