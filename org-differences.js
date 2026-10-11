import {
  SALESFORCE_API_VERSION,
  getPopupOrgDashboard,
  getSessionForHost,
  listMetadataManifestMembers,
  listOutboundChangeSets,
  loadAvailableSchemaMetadataTypes,
  loadInstalledPackageNamespaces,
  retrieveMetadataNamedPackageZip,
  retrieveMetadataPackageZip
} from "./api.js";
import { readMetadataSourceZip } from "./metadata-zip-reader.js";
import { getChangedFileSideBySideRows } from "./metadata-line-diff.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

const params = new URLSearchParams(location.search);
const sessionStatusEl = document.getElementById("org-diff-session-status");
const modeEl = document.getElementById("org-diff-mode");
const leftOrgEl = document.getElementById("org-diff-left-org");
const rightOrgEl = document.getElementById("org-diff-right-org");
const leftChangeSetFieldEl = document.getElementById("org-diff-left-change-set-field");
const rightChangeSetFieldEl = document.getElementById("org-diff-right-change-set-field");
const leftChangeSetEl = document.getElementById("org-diff-left-change-set");
const rightChangeSetEl = document.getElementById("org-diff-right-change-set");
const leftStatusEl = document.getElementById("org-diff-left-status");
const rightStatusEl = document.getElementById("org-diff-right-status");
const languageWarningEl = document.getElementById("org-diff-language-warning");
const compareButton = document.getElementById("org-diff-compare");
const compareButtonLabel = document.getElementById("org-diff-compare-label");
const statusEl = document.getElementById("org-diff-status");
const progressEl = document.getElementById("org-diff-progress");
const progressBarEl = document.getElementById("org-diff-progress-bar");
const progressPercentEl = document.getElementById("org-diff-progress-percent");
const progressDetailEl = document.getElementById("org-diff-progress-detail");
const alertEl = document.getElementById("org-diff-alert");
const resultsEl = document.getElementById("org-diff-results");
const resultsSummaryEl = document.getElementById("org-diff-results-summary");
const filtersEl = document.getElementById("org-diff-filters");
const resultsListEl = document.getElementById("org-diff-results-list");
const detailPaneEl = document.getElementById("org-diff-detail-pane");
const detailEl = document.getElementById("org-diff-detail");
const detailContextEl = document.getElementById("org-diff-detail-context");
const detailContextStateEl = document.getElementById("org-diff-detail-context-state");
const detailFullscreenButton = document.getElementById("org-diff-detail-fullscreen");
const scopeDialog = document.getElementById("org-diff-scope-dialog");
const scopeModeEl = document.getElementById("org-diff-scope-mode");
const scopeSearchEl = document.getElementById("org-diff-scope-search");
const namespaceSearchEl = document.getElementById("org-diff-namespace-search");
const scopeTypesEl = document.getElementById("org-diff-scope-types");
const scopeCountEl = document.getElementById("org-diff-scope-count");
const scopeToggleButton = document.getElementById("org-diff-scope-toggle");
const scopeValidationEl = document.getElementById("org-diff-scope-validation");
const scopeCancelButton = document.getElementById("org-diff-scope-cancel");
const scopeConfirmButton = document.getElementById("org-diff-scope-confirm");
const scopeNamespacesEl = document.getElementById("org-diff-scope-namespaces");
const namespaceOptionsEl = document.getElementById("org-diff-namespace-options");
const namespaceToggleButton = document.getElementById("org-diff-namespace-toggle");
const namespaceEmptyEl = document.getElementById("org-diff-namespace-empty");
const includeUnmanagedEl = document.getElementById("org-diff-include-unmanaged");
const appLauncherEl = document.querySelector(".org-diff-app-launcher");
const appLauncherButton = document.getElementById("org-diff-app-launcher-button");
const appLauncherMenu = document.getElementById("org-diff-app-launcher-menu");
const appLauncherCloseButton = document.getElementById("org-diff-app-launcher-close");
const appLauncherLinks = Array.from(document.querySelectorAll(".org-diff-app-link, .org-diff-tool-link"));

const SUPPORTED_METADATA_TYPES = [
  { apiType: "CustomObject", label: "Custom Object" },
  { apiType: "ApexClass", label: "Apex Class" },
  { apiType: "ApexTrigger", label: "Apex Trigger" },
  { apiType: "ApexPage", label: "Apex Page" },
  { apiType: "ApexComponent", label: "Apex Component" },
  { apiType: "LightningComponentBundle", label: "Lightning Component Bundle" },
  { apiType: "AuraDefinitionBundle", label: "Aura Definition Bundle" },
  { apiType: "Flow", label: "Flow" }
];

const SOURCE_DIRECTORY_METADATA_TYPES = new Map([
  ["aura", "AuraDefinitionBundle"],
  ["classes", "ApexClass"],
  ["components", "ApexComponent"],
  ["flows", "Flow"],
  ["lwc", "LightningComponentBundle"],
  ["objects", "CustomObject"],
  ["pages", "ApexPage"],
  ["staticresources", "StaticResource"],
  ["triggers", "ApexTrigger"]
]);

const FILTERS = ["all", "different", "only-left", "only-right", "same", "unsupported"];
const MANIFEST_MEMBERS_PER_RETRIEVE = 4000;
const ORG_DIFF_RETRIEVE_POLL_INTERVAL_MS = 5000;
const ORG_DIFF_RETRIEVE_MAX_POLLS = 360;
const state = {
  orgs: [],
  sessions: new Map(),
  mode: "org-org",
  leftHost: "",
  rightHost: "",
  leftChangeSet: "",
  rightChangeSet: "",
  leftChangeSets: [],
  rightChangeSets: [],
  diffs: [],
  filter: "all",
  selectedPath: "",
  selectedPaths: new Set(),
  detailFullscreen: false,
  leftLabel: "",
  rightLabel: "",
  connectedHost: "",
  requestToken: 0,
  busy: false,
  scopeMode: "common",
  fullMetadataTypes: [],
  scopePackages: [],
  scopeLoadedFor: "",
  scopePackagesLoadedFor: "",
  scopeLoading: false,
  scopePackagesLoading: false,
  comparisonWarningCount: 0
};
let detailIntersectionObserver = null;

function syncAppLauncherLinks(host = "") {
  const currentPage = location.pathname.split("/").pop() || "org-differences.html";
  appLauncherLinks.forEach((link) => {
    const page = link.dataset.appPage || link.getAttribute("href") || "";
    const url = new URL(page, location.href);
    if (host) url.searchParams.set("host", host);
    link.href = url.href;
    const isCurrent = page === currentPage;
    link.classList.toggle("active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function setAppLauncherOpen(open, { restoreFocus = false } = {}) {
  appLauncherMenu.hidden = !open;
  appLauncherButton.setAttribute("aria-expanded", String(open));
  if (open) {
    requestAnimationFrame(() => appLauncherLinks[0]?.focus());
  } else if (restoreFocus) {
    appLauncherButton.focus();
  }
}

function initAppLauncher() {
  syncAppLauncherLinks(params.get("host") || "");
  appLauncherButton.addEventListener("click", () => {
    setAppLauncherOpen(appLauncherMenu.hidden);
  });
  appLauncherCloseButton.addEventListener("click", () => {
    setAppLauncherOpen(false, { restoreFocus: true });
  });
  appLauncherLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("aria-current") === "page") event.preventDefault();
      setAppLauncherOpen(false);
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!appLauncherMenu.hidden && !appLauncherEl.contains(event.target)) {
      setAppLauncherOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !appLauncherMenu.hidden) {
      event.preventDefault();
      setAppLauncherOpen(false, { restoreFocus: true });
    }
  });
}

function setStatus(element, message = "", error = false) {
  element.textContent = formatUserFacingMessage(message);
  element.classList.toggle("error", error);
}

function setAlert(message = "") {
  alertEl.textContent = formatUserFacingMessage(message);
  alertEl.hidden = !alertEl.textContent;
}

function setComparisonProgress(value, message, detail = "") {
  const progress = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  progressEl.hidden = false;
  progressBarEl.value = progress;
  progressBarEl.setAttribute("aria-label", t("orgDiff.progress.aria"));
  progressPercentEl.textContent = `${progress}%`;
  progressDetailEl.textContent = detail;
  setStatus(statusEl, message);
}

function hideComparisonProgress() {
  progressEl.hidden = true;
  progressBarEl.value = 0;
  progressPercentEl.textContent = "0%";
  progressDetailEl.textContent = "";
}

function orgOptionLabel(org) {
  return org.organizationName ? `${org.organizationName} (${org.host})` : org.host;
}

function dedupeOrgs(orgs = []) {
  const seen = new Set();
  return orgs.filter((org) => {
    const identity = String(org.organizationId || org.host || "").toLowerCase();
    const host = String(org.host || "").toLowerCase();
    if (!identity || !host || seen.has(identity) || seen.has(host)) return false;
    seen.add(identity);
    seen.add(host);
    return true;
  });
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function renderOrgSelectors() {
  leftOrgEl.replaceChildren();
  rightOrgEl.replaceChildren();
  state.orgs.forEach((org) => {
    appendOption(leftOrgEl, org.host, orgOptionLabel(org));
    appendOption(rightOrgEl, org.host, orgOptionLabel(org));
  });
  leftOrgEl.value = state.leftHost;
  rightOrgEl.value = state.rightHost;
  updateLanguageWarning();
}

function normalizeOrgLanguage(value = "") {
  return String(value || "").trim().replace(/_/g, "-").toLowerCase();
}

function updateLanguageWarning() {
  const leftOrg = state.orgs.find((org) => org.host === state.leftHost);
  const rightOrg = state.orgs.find((org) => org.host === state.rightHost);
  const leftLanguage = String(leftOrg?.salesforceUserLanguage || "").trim();
  const rightLanguage = String(rightOrg?.salesforceUserLanguage || "").trim();
  const hasMismatch = Boolean(
    leftLanguage
    && rightLanguage
    && normalizeOrgLanguage(leftLanguage) !== normalizeOrgLanguage(rightLanguage)
  );
  languageWarningEl.hidden = !hasMismatch;
  languageWarningEl.textContent = hasMismatch
    ? t("orgDiff.warning.userLanguage", { left: leftLanguage, right: rightLanguage })
    : "";
}

function getSession(host) {
  if (!state.sessions.has(host)) {
    state.sessions.set(host, getSessionForHost(host).catch((error) => {
      state.sessions.delete(host);
      throw error;
    }));
  }
  return state.sessions.get(host);
}

function clearResults() {
  stopDetailObserver();
  setDetailFullscreen(false);
  state.diffs = [];
  state.filter = "all";
  state.selectedPath = "";
  state.selectedPaths.clear();
  resultsEl.hidden = true;
  filtersEl.replaceChildren();
  resultsListEl.replaceChildren();
  detailEl.replaceChildren();
  setDetailContext("");
}

function invalidateResults() {
  state.requestToken += 1;
  state.busy = false;
  state.comparisonWarningCount = 0;
  hideComparisonProgress();
  clearResults();
  updateReadyStatus();
  setAlert("");
  updateCompareDisabled();
  return state.requestToken;
}

function updateCompareDisabled() {
  const hasOrgs = Boolean(state.leftHost && state.rightHost && state.leftHost !== state.rightHost);
  let hasScope = hasOrgs;
  if (state.mode === "change-set-org") hasScope = hasScope && Boolean(state.leftChangeSet);
  if (state.mode === "change-set-change-set") {
    hasScope = hasScope && Boolean(state.leftChangeSet && state.rightChangeSet);
  }
  compareButton.disabled = state.busy || !hasScope;
}

function updateCompareLabel() {
  compareButtonLabel.textContent = t(state.mode === "org-org" ? "orgDiff.compare.scope" : "orgDiff.compare.source");
}

function updateReadyStatus() {
  if (state.busy || !resultsEl.hidden) return;
  if (state.mode === "org-org") {
    setStatus(statusEl, t("orgDiff.status.confirmScope"));
    return;
  }
  const hasRequiredChangeSets = Boolean(
    state.leftChangeSet && (state.mode !== "change-set-change-set" || state.rightChangeSet)
  );
  setStatus(statusEl, t(hasRequiredChangeSets ? "orgDiff.status.ready" : "orgDiff.status.selectChangeSet"));
}

function setBusy(isBusy) {
  state.busy = isBusy;
  leftChangeSetEl.disabled = !state.leftChangeSets.length;
  rightChangeSetEl.disabled = !state.rightChangeSets.length;
  updateCompareDisabled();
}

function renderChangeSetSelect(side, changeSets = [], loading = false) {
  const select = side === "left" ? leftChangeSetEl : rightChangeSetEl;
  const selected = side === "left" ? state.leftChangeSet : state.rightChangeSet;
  select.replaceChildren();
  appendOption(select, "", loading ? t("orgDiff.changeSet.loading") : t("orgDiff.changeSet.select"));
  changeSets.forEach((changeSet) => appendOption(select, changeSet.name, changeSet.name));
  select.value = selected;
  select.disabled = loading || state.busy || !changeSets.length;
}

async function loadChangeSets(side, token) {
  const host = side === "left" ? state.leftHost : state.rightHost;
  const status = side === "left" ? leftStatusEl : rightStatusEl;
  if (side === "left") {
    state.leftChangeSet = "";
    state.leftChangeSets = [];
  } else {
    state.rightChangeSet = "";
    state.rightChangeSets = [];
  }
  renderChangeSetSelect(side, [], true);
  setStatus(status, t("orgDiff.changeSet.loading"));
  updateCompareDisabled();
  try {
    const session = await getSession(host);
    const changeSets = await listOutboundChangeSets(session.host, session.sid);
    if (token !== state.requestToken || host !== (side === "left" ? state.leftHost : state.rightHost)) return;
    if (side === "left") state.leftChangeSets = changeSets;
    else state.rightChangeSets = changeSets;
    renderChangeSetSelect(side, changeSets);
    setStatus(
      status,
      changeSets.length
        ? t("orgDiff.changeSet.loaded", { count: changeSets.length })
        : t("orgDiff.changeSet.empty")
    );
  } catch (error) {
    if (token !== state.requestToken) return;
    renderChangeSetSelect(side, []);
    setStatus(status, error instanceof Error ? error.message : String(error), true);
    setAlert(error instanceof Error ? error.message : String(error));
  }
  updateCompareDisabled();
}

function refreshModeControls() {
  const needsLeft = state.mode !== "org-org";
  const needsRight = state.mode === "change-set-change-set";
  leftChangeSetFieldEl.hidden = !needsLeft;
  rightChangeSetFieldEl.hidden = !needsRight;
  if (!needsLeft) {
    state.leftChangeSet = "";
    state.leftChangeSets = [];
    leftStatusEl.textContent = "";
  }
  if (!needsRight) {
    state.rightChangeSet = "";
    state.rightChangeSets = [];
    rightStatusEl.textContent = "";
  }
  const token = state.requestToken;
  if (needsLeft) void loadChangeSets("left", token);
  if (needsRight) void loadChangeSets("right", token);
  updateCompareLabel();
  updateReadyStatus();
  updateCompareDisabled();
}

function handleOrgChange(side) {
  const select = side === "left" ? leftOrgEl : rightOrgEl;
  const otherHost = side === "left" ? state.rightHost : state.leftHost;
  const previousHost = side === "left" ? state.leftHost : state.rightHost;
  if (select.value === otherHost) {
    select.value = previousHost;
    setAlert(t("orgDiff.error.sameOrg"));
    return;
  }
  if (side === "left") state.leftHost = select.value;
  else state.rightHost = select.value;
  invalidateResults();
  updateLanguageWarning();
  refreshModeControls();
}

function metadataTypeLabel(apiType = "") {
  return String(apiType || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function sourcePathType(path = "") {
  const directory = String(path).split("/").find(Boolean) || "other";
  const apiType = SOURCE_DIRECTORY_METADATA_TYPES.get(directory.toLocaleLowerCase());
  const label = metadataTypeLabel(apiType || directory);
  return {
    key: directory.toLocaleLowerCase(),
    directory,
    label: label ? `${label[0].toLocaleUpperCase()}${label.slice(1)}` : directory
  };
}

function expandMetadataTypes(metadataTypes = []) {
  const typeMap = new Map();
  metadataTypes.forEach((metadataType) => {
    const apiTypes = metadataType.metadataApiTypes?.length
      ? metadataType.metadataApiTypes
      : [metadataType.metadataApiType];
    apiTypes.filter(Boolean).forEach((apiType) => {
      if (!typeMap.has(apiType)) {
        typeMap.set(apiType, {
          apiType,
          label: metadataType.metadataApiTypes?.length ? metadataTypeLabel(apiType) : (metadataType.label || metadataTypeLabel(apiType))
        });
      }
    });
  });
  return [...typeMap.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function currentScopeTypes() {
  return state.scopeMode === "full" ? state.fullMetadataTypes : SUPPORTED_METADATA_TYPES;
}

function applyScopeSearch() {
  const searchText = scopeSearchEl.value.trim().toLocaleLowerCase();
  scopeTypesEl.querySelectorAll("label").forEach((label) => {
    label.hidden = Boolean(searchText) && !label.textContent.toLocaleLowerCase().includes(searchText);
  });
}

function renderScopeTypes() {
  scopeTypesEl.replaceChildren();
  currentScopeTypes().forEach((type) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "metadataTypes";
    checkbox.value = type.apiType;
    checkbox.checked = true;
    checkbox.addEventListener("change", updateScopeValidation);
    const text = document.createElement("span");
    text.textContent = type.label;
    label.append(checkbox, text);
    scopeTypesEl.appendChild(label);
  });
  applyScopeSearch();
}

function selectedScopeTypes() {
  return [...scopeTypesEl.querySelectorAll('input[name="metadataTypes"]:checked')].map((input) => input.value);
}

function updateScopeValidation() {
  const selected = selectedScopeTypes().length;
  const total = currentScopeTypes().length;
  const emptyTypes = selected === 0;
  const emptyNamespaceScope = !includeUnmanagedEl.checked && selectedScopeNamespaces().length === 0;
  const loading = state.scopeLoading || state.scopePackagesLoading;
  scopeConfirmButton.disabled = emptyTypes || emptyNamespaceScope || loading;
  scopeValidationEl.textContent = loading
    ? t("orgDiff.scope.loading")
    : emptyTypes
      ? t("orgDiff.scope.required")
      : emptyNamespaceScope ? t("orgDiff.scope.namespaceRequired") : "";
  scopeCountEl.textContent = t("orgDiff.scope.selected", { selected, total });
  scopeToggleButton.textContent = t(selected ? "common.clearAll" : "common.selectAll");
}

function selectedScopeNamespaces() {
  return [...namespaceOptionsEl.querySelectorAll('input[name="metadataNamespaces"]:checked')]
    .map((input) => input.value);
}

function applyNamespaceSearch() {
  const searchText = namespaceSearchEl.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  namespaceOptionsEl.querySelectorAll("label").forEach((label) => {
    const hidden = Boolean(searchText) && !label.textContent.toLocaleLowerCase().includes(searchText);
    label.hidden = hidden;
    if (!hidden) visibleCount += 1;
  });
  namespaceEmptyEl.textContent = t(state.scopePackages.length ? "orgDiff.scope.noNamespaceMatches" : "orgDiff.scope.noNamespaces");
  namespaceEmptyEl.hidden = state.scopePackagesLoading || visibleCount > 0;
}

function updateNamespaceToggle() {
  const selected = selectedScopeNamespaces().length;
  namespaceToggleButton.textContent = t(selected ? "common.clearAll" : "common.selectAll");
}

function renderScopeNamespaces() {
  const selectedNamespaces = new Set(selectedScopeNamespaces());
  scopeNamespacesEl.hidden = false;
  namespaceOptionsEl.replaceChildren();
  state.scopePackages.forEach((installedPackage) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "metadataNamespaces";
    checkbox.value = installedPackage.namespacePrefix;
    checkbox.checked = selectedNamespaces.has(installedPackage.namespacePrefix);
    checkbox.addEventListener("change", () => {
      updateNamespaceToggle();
      updateScopeValidation();
    });
    const copy = document.createElement("span");
    copy.className = "org-diff-namespace-copy";
    const name = document.createElement("strong");
    name.textContent = installedPackage.name || installedPackage.namespacePrefix;
    const detail = document.createElement("small");
    detail.textContent = installedPackage.version
      ? `${installedPackage.namespacePrefix} · ${installedPackage.version}`
      : installedPackage.namespacePrefix;
    copy.append(name, detail);
    label.append(checkbox, copy);
    namespaceOptionsEl.appendChild(label);
  });
  namespaceToggleButton.hidden = !state.scopePackages.length;
  updateNamespaceToggle();
  applyNamespaceSearch();
}

async function loadScopePackages() {
  const cacheKey = `${state.leftHost}|${state.rightHost}`;
  if (state.scopePackagesLoadedFor === cacheKey || state.scopePackagesLoading) return;
  state.scopePackages = [];
  state.scopePackagesLoading = true;
  renderScopeNamespaces();
  updateScopeValidation();
  try {
    const [leftSession, rightSession] = await Promise.all([
      getSession(state.leftHost),
      getSession(state.rightHost)
    ]);
    const [leftPackages, rightPackages] = await Promise.all([
      loadInstalledPackageNamespaces(leftSession.host, leftSession.sid),
      loadInstalledPackageNamespaces(rightSession.host, rightSession.sid)
    ]);
    const packageMap = new Map();
    [...leftPackages, ...rightPackages].forEach((installedPackage) => {
      if (!packageMap.has(installedPackage.namespacePrefix)) {
        packageMap.set(installedPackage.namespacePrefix, installedPackage);
      }
    });
    state.scopePackages = [...packageMap.values()].sort((left, right) => (
      String(left.name || left.namespacePrefix).localeCompare(String(right.name || right.namespacePrefix))
    ));
    state.scopePackagesLoadedFor = cacheKey;
  } catch (error) {
    setAlert(error instanceof Error ? error.message : String(error));
    state.scopePackages = [];
  } finally {
    state.scopePackagesLoading = false;
    renderScopeNamespaces();
    updateScopeValidation();
  }
}

async function loadFullScope() {
  const cacheKey = `${state.leftHost}|${state.rightHost}`;
  if (state.scopeLoadedFor === cacheKey && state.fullMetadataTypes.length) return;
  state.scopeLoading = true;
  updateScopeValidation();
  renderScopeNamespaces();
  try {
    const [leftSession, rightSession] = await Promise.all([
      getSession(state.leftHost),
      getSession(state.rightHost)
    ]);
    const [leftTypes, rightTypes] = await Promise.all([
      loadAvailableSchemaMetadataTypes(leftSession.host, leftSession.sid),
      loadAvailableSchemaMetadataTypes(rightSession.host, rightSession.sid)
    ]);
    state.fullMetadataTypes = expandMetadataTypes([...leftTypes, ...rightTypes]);
    state.scopeLoadedFor = cacheKey;
  } catch (error) {
    setAlert(error instanceof Error ? error.message : String(error));
    state.fullMetadataTypes = [];
  } finally {
    state.scopeLoading = false;
    renderScopeTypes();
    renderScopeNamespaces();
    updateScopeValidation();
  }
}

function openScopeDialog() {
  setAlert("");
  state.scopeMode = "common";
  scopeModeEl.querySelector('input[value="common"]').checked = true;
  scopeSearchEl.value = "";
  namespaceSearchEl.value = "";
  includeUnmanagedEl.checked = true;
  renderScopeTypes();
  renderScopeNamespaces();
  updateScopeValidation();
  void loadScopePackages();
  scopeDialog.showModal();
  requestAnimationFrame(() => scopeTypesEl.querySelector("input")?.focus());
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildPackageXml(typeEntries = []) {
  const version = SALESFORCE_API_VERSION.replace(/^v/, "");
  const types = typeEntries
    .filter((type) => type.apiType && type.members?.length)
    .map((type) => `  <types>${type.members.map((member) => `<members>${escapeXml(member)}</members>`).join("")}<name>${escapeXml(type.apiType)}</name></types>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types}\n  <version>${version}</version>\n</Package>`;
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function compareSources(leftSource, rightSource) {
  const leftFiles = new Map(leftSource.files.filter((file) => file.path !== "package.xml").map((file) => [file.path, file]));
  const rightFiles = new Map(rightSource.files.filter((file) => file.path !== "package.xml").map((file) => [file.path, file]));
  const paths = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort((left, right) => left.localeCompare(right));
  return paths.map((path) => {
    const left = leftFiles.get(path) || null;
    const right = rightFiles.get(path) || null;
    const sourceType = sourcePathType(path);
    let diffState;
    let reason = "";
    if (left?.binary || right?.binary) {
      diffState = "unsupported";
      reason = "orgDiff.detail.unsupported";
    } else if (!left) {
      diffState = "only-right";
    } else if (!right) {
      diffState = "only-left";
    } else if (normalizeText(left.content) === normalizeText(right.content)) {
      diffState = "same";
      reason = "orgDiff.detail.same";
    } else {
      diffState = "different";
    }
    return { path, sourceType, state: diffState, left, right, reason };
  });
}

function filterLabel(filter) {
  return t(`orgDiff.filter.${filter}`);
}

function visibleDiffs() {
  return state.filter === "all"
    ? state.diffs
    : state.diffs.filter((diff) => diff.state === state.filter);
}

function renderFilters() {
  filtersEl.replaceChildren();
  const visible = visibleDiffs();
  const selectedCount = visible.filter((diff) => state.selectedPaths.has(diff.path)).length;
  const selectAll = document.createElement("label");
  selectAll.className = "org-diff-select-all";
  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.checked = visible.length > 0 && selectedCount === visible.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < visible.length;
  selectAllCheckbox.disabled = !visible.length;
  selectAllCheckbox.setAttribute("aria-controls", "org-diff-results-list");
  const selectAllLabel = document.createElement("span");
  selectAllLabel.textContent = t("common.selectAll");
  selectAllCheckbox.addEventListener("change", () => {
    visible.forEach((diff) => {
      if (selectAllCheckbox.checked) state.selectedPaths.add(diff.path);
      else state.selectedPaths.delete(diff.path);
    });
    if (selectAllCheckbox.checked && !visible.some((diff) => diff.path === state.selectedPath)) {
      state.selectedPath = visible[0]?.path || "";
    }
    renderResultList();
    renderDetail();
  });
  selectAll.append(selectAllCheckbox, selectAllLabel);
  filtersEl.appendChild(selectAll);
  FILTERS.forEach((filter) => {
    const count = filter === "all" ? state.diffs.length : state.diffs.filter((diff) => diff.state === filter).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "org-diff-filter";
    button.dataset.filter = filter;
    button.setAttribute("aria-pressed", String(state.filter === filter));
    const label = document.createElement("span");
    label.textContent = filterLabel(filter);
    const badge = document.createElement("strong");
    badge.textContent = String(count);
    button.append(label, document.createTextNode(" "), badge);
    button.addEventListener("click", () => {
      state.filter = filter;
      const nextVisible = visibleDiffs();
      state.selectedPath = nextVisible.find((diff) => state.selectedPaths.has(diff.path))?.path
        || nextVisible[0]?.path
        || "";
      renderFilters();
      renderResultList();
      renderDetail();
    });
    filtersEl.appendChild(button);
  });
}

function renderResultList() {
  resultsListEl.replaceChildren();
  const visible = visibleDiffs();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "org-diff-detail-empty";
    empty.textContent = t("orgDiff.results.empty");
    resultsListEl.appendChild(empty);
    return;
  }
  const groups = new Map();
  visible.forEach((diff) => {
    if (!groups.has(diff.sourceType.key)) groups.set(diff.sourceType.key, []);
    groups.get(diff.sourceType.key).push(diff);
  });
  [...groups.entries()].forEach(([typeKey, diffs], groupIndex) => {
    const group = document.createElement("section");
    group.className = "org-diff-result-group";
    group.dataset.sourceType = typeKey;
    const heading = document.createElement("h3");
    heading.id = `org-diff-result-group-${groupIndex}`;
    heading.className = "org-diff-result-group-heading";
    heading.setAttribute("aria-label", t("orgDiff.resultGroup.aria", {
      type: `${diffs[0].sourceType.directory} — ${diffs[0].sourceType.label}`,
      count: diffs.length
    }));
    const groupLabel = document.createElement("span");
    groupLabel.className = "org-diff-result-group-label";
    const directory = document.createElement("span");
    directory.className = "org-diff-result-group-directory";
    directory.textContent = diffs[0].sourceType.directory;
    const type = document.createElement("small");
    type.className = "org-diff-result-group-type";
    type.textContent = diffs[0].sourceType.label;
    groupLabel.append(directory, type);
    const count = document.createElement("strong");
    count.textContent = String(diffs.length);
    heading.append(groupLabel, count);
    group.setAttribute("aria-labelledby", heading.id);
    group.appendChild(heading);
    diffs.forEach((diff) => {
      const row = document.createElement("div");
      row.className = "org-diff-result-row";
      row.dataset.path = diff.path;
      row.classList.toggle("active", state.selectedPath === diff.path);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "org-diff-result-select";
      checkbox.checked = state.selectedPaths.has(diff.path);
      checkbox.setAttribute("aria-label", t("orgDiff.selectFile", { path: diff.path }));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "org-diff-result-preview";
      button.setAttribute("aria-label", `${diff.path} — ${filterLabel(diff.state)}`);
      const path = document.createElement("span");
      path.className = "org-diff-result-path";
      path.textContent = diff.path;
      const badge = document.createElement("span");
      badge.className = `org-diff-result-state org-diff-state-${diff.state}`;
      badge.textContent = filterLabel(diff.state);
      button.append(path, badge);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedPaths.add(diff.path);
          state.selectedPath = diff.path;
        } else {
          state.selectedPaths.delete(diff.path);
          if (state.selectedPath === diff.path) {
            state.selectedPath = visibleDiffs().find((item) => state.selectedPaths.has(item.path))?.path || diff.path;
          }
        }
        resultsListEl.querySelectorAll(".org-diff-result-row").forEach((candidate) => {
          candidate.classList.toggle("active", candidate.dataset.path === state.selectedPath);
        });
        renderFilters();
        renderDetail();
        if (checkbox.checked) requestAnimationFrame(() => focusAllDiffItem(diff));
      });
      button.addEventListener("click", () => {
        const selectedVisible = visibleDiffs().some((item) => state.selectedPaths.has(item.path));
        if (selectedVisible) state.selectedPaths.add(diff.path);
        state.selectedPath = diff.path;
        renderFilters();
        renderResultList();
        renderDetail();
        if (selectedVisible) requestAnimationFrame(() => focusAllDiffItem(diff));
      });
      row.append(checkbox, button);
      group.appendChild(row);
    });
    resultsListEl.appendChild(group);
  });
}

function sourceColumn(label, rows, file) {
  const column = document.createElement("section");
  column.className = "org-diff-source-column";
  const title = document.createElement("h3");
  title.textContent = label;
  column.appendChild(title);
  if (!file) {
    const missing = document.createElement("p");
    missing.className = "org-diff-source-missing";
    missing.textContent = t("orgDiff.detail.notPresent");
    column.appendChild(missing);
  } else {
    const body = document.createElement("div");
    body.className = "org-diff-code-body";
    rows.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `org-diff-code-line ${entry.state || "normal"}`;
      const lineNumber = document.createElement("span");
      lineNumber.className = "org-diff-code-line-number";
      lineNumber.textContent = entry.lineNumber ? String(entry.lineNumber) : "";
      const code = document.createElement("code");
      code.className = "org-diff-code-line-content";
      code.textContent = entry.state === "omitted" ? "⋯" : entry.line || "\u200B";
      row.append(lineNumber, code);
      body.appendChild(row);
    });
    column.appendChild(body);
  }
  return column;
}

function syncSourceScroll(grid) {
  const bodies = [...grid.querySelectorAll(".org-diff-code-body")];
  let syncing = false;
  bodies.forEach((body) => body.addEventListener("scroll", () => {
    if (syncing) return;
    syncing = true;
    bodies.forEach((otherBody) => {
      if (otherBody === body) return;
      otherBody.scrollTop = body.scrollTop;
      otherBody.scrollLeft = body.scrollLeft;
    });
    requestAnimationFrame(() => { syncing = false; });
  }, { passive: true }));
}

function stopDetailObserver() {
  detailIntersectionObserver?.disconnect();
  detailIntersectionObserver = null;
}

function setDetailContext(label = "", diffState = "") {
  detailContextEl.textContent = label;
  detailContextStateEl.hidden = !diffState;
  detailContextStateEl.className = diffState
    ? `org-diff-detail-state org-diff-state-${diffState}`
    : "org-diff-detail-state";
  detailContextStateEl.textContent = diffState ? filterLabel(diffState) : "";
}

function updateDetailFullscreenButton() {
  const label = t(state.detailFullscreen
    ? "orgDiff.detail.exitFullscreen"
    : "orgDiff.detail.fullscreen");
  detailFullscreenButton.setAttribute("aria-label", label);
  detailFullscreenButton.setAttribute("title", label);
  detailFullscreenButton.setAttribute("aria-pressed", String(state.detailFullscreen));
}

function setDetailFullscreen(open, { restoreFocus = false } = {}) {
  state.detailFullscreen = Boolean(open);
  detailPaneEl.classList.toggle("is-fullscreen", state.detailFullscreen);
  document.body.classList.toggle("org-diff-detail-fullscreen-open", state.detailFullscreen);
  updateDetailFullscreenButton();
  if (!state.detailFullscreen && restoreFocus) detailFullscreenButton.focus();
}

function createDiffItemHead(diff) {
  const head = document.createElement("div");
  head.className = "org-diff-detail-head org-diff-detail-item-head";
  const path = document.createElement("h3");
  path.className = "org-diff-detail-path";
  path.textContent = diff.path;
  const badge = document.createElement("span");
  badge.className = `org-diff-detail-state org-diff-state-${diff.state}`;
  badge.textContent = filterLabel(diff.state);
  head.append(path, badge);
  return head;
}

function populateDiffBody(container, diff) {
  if (container.dataset.rendered === "true") return;
  container.dataset.rendered = "true";
  container.replaceChildren();
  if (container.classList.contains("org-diff-detail-item-body")) {
    container.parentElement.querySelector(".org-diff-detail-item-head")?.remove();
    container.parentElement.prepend(createDiffItemHead(diff));
  }
  if (diff.state === "same" || diff.state === "unsupported") {
    const explanation = document.createElement("p");
    explanation.className = "org-diff-detail-empty";
    explanation.textContent = t(diff.reason);
    container.appendChild(explanation);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "org-diff-source-grid";
  const { sourceRows, changedRows } = getChangedFileSideBySideRows(
    normalizeText(diff.left?.content),
    normalizeText(diff.right?.content)
  );
  grid.append(
    sourceColumn(state.leftLabel, sourceRows, diff.left),
    sourceColumn(state.rightLabel, changedRows, diff.right)
  );
  syncSourceScroll(grid);
  container.appendChild(grid);
}

function createAllDiffItem(diff) {
  const item = document.createElement("article");
  item.className = "org-diff-detail-item";
  item.dataset.path = diff.path;
  item.classList.toggle("selected", state.selectedPath === diff.path);
  const body = document.createElement("div");
  body.className = "org-diff-detail-item-body";
  const loading = document.createElement("p");
  loading.className = "org-diff-detail-loading";
  loading.textContent = t("orgDiff.detail.loading");
  body.appendChild(loading);
  item.append(createDiffItemHead(diff), body);
  return item;
}

function observeAllDiffItems(items, diffsByPath) {
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => populateDiffBody(item.querySelector(".org-diff-detail-item-body"), diffsByPath.get(item.dataset.path)));
    return;
  }
  detailIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const item = entry.target;
      populateDiffBody(item.querySelector(".org-diff-detail-item-body"), diffsByPath.get(item.dataset.path));
      detailIntersectionObserver?.unobserve(item);
    });
  }, { root: detailEl, rootMargin: "360px 0px" });
  items.forEach((item) => detailIntersectionObserver.observe(item));
}

function focusAllDiffItem(diff) {
  const items = [...detailEl.querySelectorAll(".org-diff-detail-item")];
  const item = items.find((candidate) => candidate.dataset.path === diff.path);
  items.forEach((candidate) => candidate.classList.toggle("selected", candidate === item));
  if (!item) {
    renderDetail();
    return;
  }
  populateDiffBody(item.querySelector(".org-diff-detail-item-body"), diff);
  item.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderDetail() {
  stopDetailObserver();
  delete detailEl.dataset.rendered;
  detailEl.replaceChildren();
  const visible = visibleDiffs();
  const selected = visible.filter((diff) => state.selectedPaths.has(diff.path));
  detailEl.classList.toggle("show-all", selected.length > 0);
  detailEl.setAttribute("aria-live", selected.length ? "off" : "polite");
  if (selected.length) {
    setDetailContext(selected.length === 1
      ? t("orgDiff.detail.oneCount")
      : t("orgDiff.detail.allCount", { count: selected.length }));
    const fragment = document.createDocumentFragment();
    const items = selected.map((diff) => createAllDiffItem(diff));
    items.forEach((item) => fragment.appendChild(item));
    detailEl.appendChild(fragment);
    observeAllDiffItems(items, new Map(selected.map((diff) => [diff.path, diff])));
    return;
  }
  const diff = state.diffs.find((item) => item.path === state.selectedPath);
  if (!diff) {
    setDetailContext(t("orgDiff.detail.select"));
    const empty = document.createElement("p");
    empty.className = "org-diff-detail-empty";
    empty.textContent = t("orgDiff.detail.select");
    detailEl.appendChild(empty);
    return;
  }
  setDetailContext(diff.path, diff.state);
  populateDiffBody(detailEl, diff);
}

function endpointLabel(host, changeSetName) {
  return changeSetName ? `${host} › ${changeSetName}` : host;
}

function renderComparison() {
  if (!state.diffs.some((diff) => diff.path === state.selectedPath)) {
    state.selectedPath = state.diffs[0]?.path || "";
  }
  resultsSummaryEl.textContent = `${state.leftLabel}  vs  ${state.rightLabel}`;
  resultsEl.hidden = false;
  renderFilters();
  renderResultList();
  renderDetail();
}

function manifestMemberCount(typeEntries = []) {
  return typeEntries.reduce((total, type) => total + (Array.isArray(type.members) ? type.members.length : 0), 0);
}

function splitManifestTypes(typeEntries = [], memberLimit = MANIFEST_MEMBERS_PER_RETRIEVE) {
  const limit = Math.max(1, Math.floor(Number(memberLimit) || MANIFEST_MEMBERS_PER_RETRIEVE));
  const batches = [];
  let batch = [];
  let batchSize = 0;
  const pushBatch = () => {
    if (batch.length) batches.push(batch);
    batch = [];
    batchSize = 0;
  };
  typeEntries.forEach((type) => {
    const members = Array.isArray(type.members) ? type.members : [];
    for (let offset = 0; offset < members.length;) {
      if (batchSize === limit) pushBatch();
      const count = Math.min(limit - batchSize, members.length - offset);
      batch.push({ apiType: type.apiType, members: members.slice(offset, offset + count) });
      batchSize += count;
      offset += count;
    }
  });
  pushBatch();
  return batches;
}

function isRetrieveFileLimitError(error) {
  return /LIMIT_EXCEEDED[\s\S]*Too many files in retrieve call|Too many files in retrieve call[\s\S]*limit is:\s*10000/i
    .test(error instanceof Error ? error.message : String(error || ""));
}

function splitLimitedManifestBatch(typeEntries = []) {
  const count = manifestMemberCount(typeEntries);
  if (count < 2) return [];
  return splitManifestTypes(typeEntries, Math.ceil(count / 2));
}

async function retrieveManifestArchives(session, manifest, options = {}) {
  const packageXml = buildPackageXml(manifest.types);
  if (!manifest.types.length) {
    return { archives: [], packageXml };
  }
  const batches = splitManifestTypes(manifest.types);
  const archives = [];
  let completed = 0;
  for (let index = 0; index < batches.length;) {
    const batch = batches[index];
    options.onBatchUpdate?.({ phase: "start", completed, current: completed + 1, total: batches.length });
    try {
      const retrieve = await retrieveMetadataPackageZip(
        session.host,
        session.sid,
        buildPackageXml(batch),
        options
      );
      archives.push(retrieve.blob);
      completed += 1;
      index += 1;
      options.onBatchUpdate?.({ phase: "complete", completed, current: completed, total: batches.length });
    } catch (error) {
      if (!isRetrieveFileLimitError(error)) throw error;
      const smallerBatches = splitLimitedManifestBatch(batch);
      if (smallerBatches.length < 2) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} The remaining metadata member cannot be split further.`);
      }
      batches.splice(index, 1, ...smallerBatches);
      options.onBatchUpdate?.({ phase: "split", completed, current: completed + 1, total: batches.length });
    }
  }
  return { archives, packageXml };
}

async function readManifestArchives(retrieve) {
  if (!retrieve.archives.length) return { files: [], packageXml: retrieve.packageXml };
  const sources = await Promise.all(retrieve.archives.map((archive) => readMetadataSourceZip(archive)));
  const filesByPath = new Map();
  sources.forEach((source) => source.files.forEach((file) => {
    if (file.path === "package.xml") return;
    const existing = filesByPath.get(file.path);
    if (!existing) {
      filesByPath.set(file.path, file);
      return;
    }
    if (existing.binary !== file.binary || existing.size !== file.size || existing.content !== file.content) {
      throw new Error(`Retrieved archive batches contain conflicting source for ${file.path}.`);
    }
  }));
  const packageFile = {
    path: "package.xml",
    archivePath: "package.xml",
    content: retrieve.packageXml,
    binary: false,
    size: new TextEncoder().encode(retrieve.packageXml).byteLength,
    readOnly: true
  };
  return {
    packageXml: retrieve.packageXml,
    files: [packageFile, ...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
  };
}

async function runComparison(scope = {}) {
  const token = invalidateResults();
  setBusy(true);
  const snapshot = {
    mode: state.mode,
    leftHost: state.leftHost,
    rightHost: state.rightHost,
    leftChangeSet: state.leftChangeSet,
    rightChangeSet: state.rightChangeSet
  };
  let progressValue = 5;
  const retrieveDetails = new Map();
  const updateRunProgress = (value, message, detail = "") => {
    if (token !== state.requestToken) return;
    progressValue = Math.max(progressValue, value);
    setComparisonProgress(progressValue, message, detail);
  };
  const progressSideLabel = (side) => {
    const isLeft = side === "left";
    const host = isLeft ? snapshot.leftHost : snapshot.rightHost;
    const changeSet = isLeft
      ? (snapshot.mode === "org-org" ? "" : snapshot.leftChangeSet)
      : (snapshot.mode === "change-set-change-set" ? snapshot.rightChangeSet : "");
    return `${t(isLeft ? "orgDiff.source" : "orgDiff.target")} (${endpointLabel(host, changeSet)})`;
  };
  const progressDetailsText = () => [...retrieveDetails.values()].join(" ");
  const retrieveOptions = (side, stageValue) => ({
    pollIntervalMs: ORG_DIFF_RETRIEVE_POLL_INTERVAL_MS,
    maxPolls: ORG_DIFF_RETRIEVE_MAX_POLLS,
    onRestart() {
      retrieveDetails.set(side, t("orgDiff.progress.retrieveRestart", {
        side: progressSideLabel(side)
      }));
      updateRunProgress(stageValue, t(
        snapshot.mode === "change-set-org" && side === "left"
          ? "orgDiff.progress.retrievingSource"
          : snapshot.mode === "change-set-org"
            ? "orgDiff.progress.retrievingTarget"
            : "orgDiff.progress.retrievingBoth"
      ), progressDetailsText());
    },
    onProgress(progress) {
      retrieveDetails.set(side, t("orgDiff.progress.polling", {
        side: progressSideLabel(side),
        attempt: progress.attempt,
        elapsed: `${Math.max(0, Math.ceil(Number(progress.elapsedMs || 0) / 1000))}s`,
        limit: `${Math.ceil(Number(progress.maxWaitMs || 0) / 60000)}m`
      }));
      updateRunProgress(stageValue, t(
        snapshot.mode === "change-set-org" && side === "left"
          ? "orgDiff.progress.retrievingSource"
          : snapshot.mode === "change-set-org"
            ? "orgDiff.progress.retrievingTarget"
            : "orgDiff.progress.retrievingBoth"
      ), progressDetailsText());
    }
  });
  const markArchiveReceived = (side, value, { empty = false, batchCount = 1 } = {}) => {
    const key = empty
      ? "orgDiff.progress.empty"
      : batchCount > 1 ? "orgDiff.progress.batchesReceived" : "orgDiff.progress.received";
    retrieveDetails.set(side, t(key, { side: progressSideLabel(side), count: batchCount }));
    updateRunProgress(value, t(
      snapshot.mode === "change-set-org" && side === "left"
        ? "orgDiff.progress.retrievingSource"
        : snapshot.mode === "change-set-org"
          ? "orgDiff.progress.retrievingTarget"
          : "orgDiff.progress.retrievingBoth"
    ), progressDetailsText());
  };
  setComparisonProgress(progressValue, t("orgDiff.progress.preparing"));
  try {
    const [leftSession, rightSession] = await Promise.all([
      getSession(snapshot.leftHost),
      getSession(snapshot.rightHost)
    ]);
    if (token !== state.requestToken) return;
    let leftSource;
    let rightSource;
    if (snapshot.mode === "org-org") {
      updateRunProgress(10, t("orgDiff.progress.listing"));
      const namespaces = Array.isArray(scope.namespaces) ? scope.namespaces : [];
      const apiTypes = scope.apiTypes || [];
      const includeUnmanagedMetadata = scope.includeUnmanagedMetadata !== false;
      const listingCompleted = { left: 0, right: 0 };
      const listingTotal = Math.max(1, apiTypes.length * 2);
      const manifestOptions = (side) => ({
        installedPackageNamespaces: namespaces,
        includeUnmanagedMetadata,
        onProgress(progress) {
          listingCompleted[side] = progress.completed;
          const completed = listingCompleted.left + listingCompleted.right;
          updateRunProgress(
            10 + Math.round((completed / listingTotal) * 20),
            t("orgDiff.progress.listing"),
            t("orgDiff.progress.listingDetail", { completed, total: listingTotal })
          );
        }
      });
      const [leftManifest, rightManifest] = await Promise.all([
        listMetadataManifestMembers(leftSession.host, leftSession.sid, apiTypes, manifestOptions("left")),
        listMetadataManifestMembers(rightSession.host, rightSession.sid, apiTypes, manifestOptions("right"))
      ]);
      if (token !== state.requestToken) return;
      updateRunProgress(30, t("orgDiff.progress.retrievingBoth"));
      const archivesReceived = new Set();
      const retrieveSide = async (side, session, manifest) => {
        const options = {
          ...retrieveOptions(side, 35),
          onBatchUpdate(batch) {
            const key = batch.phase === "split" ? "orgDiff.progress.batchSplit" : "orgDiff.progress.batch";
            retrieveDetails.set(side, t(key, {
              side: progressSideLabel(side),
              current: batch.current,
              total: batch.total
            }));
            const completedRatio = batch.total ? batch.completed / batch.total : 0;
            updateRunProgress(
              35 + Math.round(completedRatio * 10),
              t("orgDiff.progress.retrievingBoth"),
              progressDetailsText()
            );
          }
        };
        const retrieve = await retrieveManifestArchives(session, manifest, options);
        archivesReceived.add(side);
        markArchiveReceived(side, 35 + (archivesReceived.size * 15), {
          empty: !retrieve.archives.length,
          batchCount: retrieve.archives.length
        });
        return retrieve;
      };
      const [leftRetrieve, rightRetrieve] = await Promise.all([
        retrieveSide("left", leftSession, leftManifest),
        retrieveSide("right", rightSession, rightManifest)
      ]);
      if (token !== state.requestToken) return;
      updateRunProgress(70, t("orgDiff.progress.reading"), progressDetailsText());
      [leftSource, rightSource] = await Promise.all([
        readManifestArchives(leftRetrieve),
        readManifestArchives(rightRetrieve)
      ]);
      state.comparisonWarningCount = leftManifest.warnings.length + rightManifest.warnings.length;
    } else if (snapshot.mode === "change-set-org") {
      updateRunProgress(10, t("orgDiff.progress.retrievingSource"));
      const leftRetrieve = await retrieveMetadataNamedPackageZip(
        leftSession.host,
        leftSession.sid,
        snapshot.leftChangeSet,
        retrieveOptions("left", 15)
      );
      markArchiveReceived("left", 30);
      if (token !== state.requestToken) return;
      updateRunProgress(40, t("orgDiff.progress.readingSource"), progressDetailsText());
      leftSource = await readMetadataSourceZip(leftRetrieve.blob);
      updateRunProgress(50, t("orgDiff.progress.retrievingTarget"), progressDetailsText());
      const rightRetrieve = await retrieveMetadataPackageZip(
        rightSession.host,
        rightSession.sid,
        leftSource.packageXml,
        retrieveOptions("right", 55)
      );
      markArchiveReceived("right", 70);
      if (token !== state.requestToken) return;
      updateRunProgress(80, t("orgDiff.progress.reading"), progressDetailsText());
      rightSource = await readMetadataSourceZip(rightRetrieve.blob);
    } else {
      updateRunProgress(20, t("orgDiff.progress.retrievingBoth"));
      const archivesReceived = new Set();
      const retrieveSide = async (side, session, packageName) => {
        const retrieve = await retrieveMetadataNamedPackageZip(
          session.host,
          session.sid,
          packageName,
          retrieveOptions(side, 25)
        );
        archivesReceived.add(side);
        markArchiveReceived(side, 25 + (archivesReceived.size * 20));
        return retrieve;
      };
      const [leftRetrieve, rightRetrieve] = await Promise.all([
        retrieveSide("left", leftSession, snapshot.leftChangeSet),
        retrieveSide("right", rightSession, snapshot.rightChangeSet)
      ]);
      if (token !== state.requestToken) return;
      updateRunProgress(70, t("orgDiff.progress.reading"), progressDetailsText());
      [leftSource, rightSource] = await Promise.all([
        readMetadataSourceZip(leftRetrieve.blob),
        readMetadataSourceZip(rightRetrieve.blob)
      ]);
    }
    if (token !== state.requestToken) return;
    state.leftLabel = endpointLabel(snapshot.leftHost, snapshot.mode === "org-org" ? "" : snapshot.leftChangeSet);
    state.rightLabel = endpointLabel(snapshot.rightHost, snapshot.mode === "change-set-change-set" ? snapshot.rightChangeSet : "");
    updateRunProgress(90, t("orgDiff.progress.comparing"));
    state.diffs = compareSources(leftSource, rightSource);
    renderComparison();
    setComparisonProgress(
      100,
      state.comparisonWarningCount
        ? t("orgDiff.scope.skipped", { count: state.comparisonWarningCount })
        : t("orgDiff.status.complete", { count: state.diffs.length }),
      ""
    );
  } catch (error) {
    if (token !== state.requestToken) return;
    clearResults();
    hideComparisonProgress();
    setStatus(statusEl, "");
    setAlert(error instanceof Error ? error.message : String(error));
  } finally {
    if (token === state.requestToken) setBusy(false);
  }
}

modeEl.addEventListener("change", (event) => {
  if (event.target.name !== "orgDiffMode") return;
  state.mode = event.target.value;
  invalidateResults();
  refreshModeControls();
});

leftOrgEl.addEventListener("change", () => handleOrgChange("left"));
rightOrgEl.addEventListener("change", () => handleOrgChange("right"));
leftChangeSetEl.addEventListener("change", () => {
  state.leftChangeSet = leftChangeSetEl.value;
  invalidateResults();
});
rightChangeSetEl.addEventListener("change", () => {
  state.rightChangeSet = rightChangeSetEl.value;
  invalidateResults();
});

compareButton.addEventListener("click", () => {
  if (state.mode === "org-org") openScopeDialog();
  else void runComparison();
});

scopeToggleButton.addEventListener("click", () => {
  const shouldSelect = selectedScopeTypes().length === 0;
  scopeTypesEl.querySelectorAll('input[name="metadataTypes"]').forEach((input) => {
    input.checked = shouldSelect;
  });
  updateScopeValidation();
});

scopeModeEl.addEventListener("change", (event) => {
  if (event.target.name !== "orgDiffScopeMode") return;
  state.scopeMode = event.target.value;
  scopeSearchEl.value = "";
  if (state.scopeMode === "full") {
    renderScopeTypes();
    renderScopeNamespaces();
    updateScopeValidation();
    void loadFullScope();
  } else {
    renderScopeTypes();
    renderScopeNamespaces();
    updateScopeValidation();
  }
});

scopeSearchEl.addEventListener("input", applyScopeSearch);
namespaceSearchEl.addEventListener("input", applyNamespaceSearch);

namespaceToggleButton.addEventListener("click", () => {
  const shouldSelect = selectedScopeNamespaces().length === 0;
  namespaceOptionsEl.querySelectorAll('input[name="metadataNamespaces"]').forEach((input) => {
    input.checked = shouldSelect;
  });
  updateNamespaceToggle();
  updateScopeValidation();
});

includeUnmanagedEl.addEventListener("change", updateScopeValidation);

scopeCancelButton.addEventListener("click", () => {
  scopeDialog.close();
  requestAnimationFrame(() => compareButton.focus());
});

scopeConfirmButton.addEventListener("click", () => {
  const apiTypes = selectedScopeTypes();
  if (!apiTypes.length) return;
  const namespaces = selectedScopeNamespaces();
  const includeUnmanagedMetadata = includeUnmanagedEl.checked;
  scopeDialog.close();
  void runComparison({ apiTypes, namespaces, includeUnmanagedMetadata });
});

async function init() {
  renderScopeTypes();
  renderScopeNamespaces();
  updateScopeValidation();
  try {
    const dashboard = await getPopupOrgDashboard();
    state.orgs = dedupeOrgs(dashboard.orgs || []);
    const requestedHost = params.get("host") || dashboard.current?.host || "";
    state.leftHost = state.orgs.find((org) => org.host === requestedHost)?.host || state.orgs[0]?.host || "";
    state.rightHost = state.orgs.find((org) => org.host !== state.leftHost)?.host || "";
    renderOrgSelectors();
    if (!state.leftHost || !state.rightHost) {
      setStatus(sessionStatusEl, t("orgDiff.error.needsTwo"), true);
      setAlert(t("orgDiff.error.needsTwo"));
      updateCompareDisabled();
      return;
    }
    const session = await getSession(state.leftHost);
    state.connectedHost = session.host;
    syncAppLauncherLinks(state.connectedHost);
    setStatus(sessionStatusEl, t("orgDiff.status.connected", { host: session.host }));
    refreshModeControls();
  } catch (error) {
    setStatus(sessionStatusEl, error instanceof Error ? error.message : String(error), true);
    setAlert(error instanceof Error ? error.message : String(error));
    updateCompareDisabled();
  }
}

detailFullscreenButton.addEventListener("click", () => {
  setDetailFullscreen(!state.detailFullscreen);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.detailFullscreen) return;
  event.preventDefault();
  setDetailFullscreen(false, { restoreFocus: true });
});

window.addEventListener("app-language-change", () => {
  progressBarEl.setAttribute("aria-label", t("orgDiff.progress.aria"));
  updateDetailFullscreenButton();
  if (state.connectedHost) setStatus(sessionStatusEl, t("orgDiff.status.connected", { host: state.connectedHost }));
  updateCompareLabel();
  updateLanguageWarning();
  updateScopeValidation();
  if (state.diffs.length) {
    renderComparison();
    setStatus(
      statusEl,
      state.comparisonWarningCount
        ? t("orgDiff.scope.skipped", { count: state.comparisonWarningCount })
        : t("orgDiff.status.complete", { count: state.diffs.length })
    );
  } else {
    updateReadyStatus();
  }
});

updateDetailFullscreenButton();
initAppLauncher();
void init();
