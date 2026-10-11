import {
  buildSchemaObjectStore,
  clearSchemaObjectStore,
  deployMetadataSourceFiles,
  deployMetadataXml,
  deploySourceFileContent,
  getActiveSession,
  getMetadataItemDetail,
  getSchemaMetadataTypes,
  getSessionForHost,
  getSObjectDescribe,
  loadAvailableSchemaMetadataTypes,
  loadInstalledPackageNamespaces,
  loadSchemaObjectStore,
  listOutboundChangeSets,
  retrieveMetadataNamedPackageZip,
  retrieveMetadataPackageZip,
  salesforceRequest,
  saveSchemaObjectStore,
  searchMetadataByText,
  SALESFORCE_API_VERSION,
  SCHEMA_METADATA_TYPES
} from "./api.js";
import { t } from "./i18n.js";
import { confirmOrgMutation, ORG_RISK } from "./org-safety.js";
import { recordOperation } from "./operation-history.js";
import {
  isDefaultSourcePath,
  isLegacySourceRootPath,
  normalizeSourcePath,
  SOURCE_DEFAULT_PREFIX,
  SOURCE_DEFAULT_ROOT,
  SOURCE_PROJECT_ROOT,
  stripDefaultSourcePrefix,
  toDefaultSourcePath
} from "./metadata-source-paths.js";
import { readMetadataSourceZip } from "./metadata-zip-reader.js";
import { getChangedFileSideBySideRows } from "./metadata-line-diff.js";

const params = new URLSearchParams(window.location.search);
const schemaRuntimeMode = document.body?.dataset.schemaMode === "package-xml" ? "package-xml" : "metadata-folder";
const isPackageXmlPage = schemaRuntimeMode === "package-xml";
const isMetadataFolderReadOnly = schemaRuntimeMode === "metadata-folder";
const schemaRuntimeFeatureLabel = isPackageXmlPage ? "Package XML" : "Metadata Folders";
document.body?.classList.toggle("metadata-folder-read-only", isMetadataFolderReadOnly);
if (document.body) {
  document.body.dataset.readOnly = String(isMetadataFolderReadOnly);
}
const statusEl = document.getElementById("status");
const schemaShellEl = document.querySelector(".metadata-admin-shell");
const schemaBreadcrumbEl = document.getElementById("schema-breadcrumb");
const schemaDetailsToggleEl = document.getElementById("schema-details-toggle");
const schemaChangeSetsTabEl = document.getElementById("schema-tab-change-sets");
const schemaChangeSetsPanelEl = document.getElementById("schema-change-sets-panel");
const schemaChangeSetCountEl = document.getElementById("schema-change-set-count");
const schemaChangeSetsRefreshEl = document.getElementById("schema-change-sets-refresh");
const schemaChangeSetListEl = document.getElementById("schema-change-set-list");
const outboundChangeSetSummaryEl = document.getElementById("schema-change-set-summary");
const outboundChangeSetSourceListEl = document.getElementById("schema-change-set-source-list");
const schemaWorkbenchEl = document.querySelector(".schema-workbench");
const schemaColumnResizerEl = document.getElementById("schema-column-resizer");
const explorerFilterInput = document.getElementById("schema-explorer-filter");
const explorerFindButton = document.getElementById("schema-explorer-find");
const schemaFileFilterInput = document.getElementById("schema-file-filter");
const schemaFileFilterSuggestionsEl = document.getElementById("schema-file-filter-suggestions");
const schemaFileFilterButton = document.getElementById("schema-file-filter-button");
const schemaFolderSearchInput = document.getElementById("schema-folder-search");
const schemaFolderSearchButton = document.getElementById("schema-folder-search-button");
const workspaceFoldersMenuEl = document.getElementById("schema-workspace-folders");
const workspaceFoldersSummaryEl = document.getElementById("schema-workspace-folders-summary");
const workspaceFoldersOptionsEl = document.getElementById("schema-workspace-folders-options");
const workspaceNamespacesMenuEl = document.getElementById("schema-workspace-namespaces");
const workspaceNamespacesSummaryEl = document.getElementById("schema-workspace-namespaces-summary");
const workspaceNamespacesOptionsEl = document.getElementById("schema-workspace-namespaces-options");
const searchMetadataTypesMenuEl = document.getElementById("schema-search-metadata-types");
const searchMetadataTypesSummaryEl = document.getElementById("schema-search-metadata-types-summary");
const searchMetadataTypesOptionsEl = document.getElementById("schema-search-metadata-types-options");
const searchInstalledPackagesMenuEl = document.getElementById("schema-search-installed-packages");
const searchInstalledPackagesSummaryEl = document.getElementById("schema-search-installed-packages-summary");
const searchInstalledPackagesOptionsEl = document.getElementById("schema-search-installed-packages-options");
const retrieveMetadataButton = document.getElementById("retrieve-metadata");
const clearSchemaButton = document.getElementById("clear-schema");
const reloadFolderTreeButton = document.getElementById("schema-reload-folder-tree");
const explorerTabButton = document.getElementById("schema-tab-explorer");
const filesNavBackButton = document.getElementById("schema-files-nav-back");
const filesNavForwardButton = document.getElementById("schema-files-nav-forward");
const searchTabButton = document.getElementById("schema-tab-search");
const changedTabButton = document.getElementById("schema-tab-changed");
const packageTabButton = document.getElementById("schema-tab-package");
const explorerTabPanel = document.getElementById("schema-explorer-panel");
const searchTabPanel = document.getElementById("schema-search-panel");
const changedTabPanel = document.getElementById("schema-changed-files-panel");
const packageTabPanel = document.getElementById("schema-package-panel");
const changedFilesListEl = document.getElementById("schema-changed-files-list");
const changedFilesCountEl = document.getElementById("schema-changed-count");
const changedCheckAllInput = document.getElementById("schema-changed-check-all");
const deploySelectedChangedButton = document.getElementById("schema-deploy-selected-changed");
const validateSelectedChangedButton = document.getElementById("schema-validate-selected-changed");
const discardSelectedChangedButton = document.getElementById("schema-discard-selected-changed");
const schemaSummaryEl = document.getElementById("schema-summary");
const schemaTreeEl = document.getElementById("schema-tree");
const schemaSearchResultsTreeEl = document.getElementById("schema-search-results-tree");
const schemaPackageTreeEl = document.getElementById("schema-package-tree");
const searchClearButton = document.getElementById("schema-search-clear");
const schemaBodySearchInput = document.getElementById("schema-body-search");
const schemaBodySearchButton = document.getElementById("schema-body-search-button");
const schemaBodySearchResultsEl = document.getElementById("schema-body-search-results");
const schemaBodySearchIncludeDetails = document.getElementById("schema-body-search-include-details");
const schemaDetailEl = document.getElementById("schema-detail");
const workspaceSettingsButton = document.getElementById("schema-workspace-settings-button");
const workspaceSettingsPopupEl = document.getElementById("schema-workspace-settings-popup");
const workspaceSettingsPanelEl = workspaceSettingsPopupEl?.querySelector(".schema-workspace-settings-panel");
const workspaceSettingsCloseButton = document.getElementById("schema-workspace-settings-close");

let session = null;
let schemaStore = null;
let selectedNode = null;
let pendingDetailLineFocus = null;
let detailRequestId = 0;
let scheduledDetailRenderTimer = 0;
let scheduledDetailRenderFrame = 0;
let scheduledDetailRenderIdle = 0;
let scheduledDetailRenderToken = 0;
let detailFormat = "xml";
let sourceTreeFileCountCache = new WeakMap();
let sourceTreeKnownSizeCache = new WeakMap();
const sourceTreeVirtualRenderers = new Set();
const sourceTreeVirtualRendererStates = new WeakMap();
const sourceTreeVirtualBoundTargets = new WeakSet();
let sourceTreeVirtualRenderFrame = 0;
let lastRenderedTreeRows = [];
let compactMetadataSourceRoot = null;
let compactMetadataIndexMeta = null;
let explorerSourceTreeCache = null;
let explorerSourceTreeCacheSignature = "";
let fileFilterSuggestionsSignature = "";
let fileFilterSuggestionOptions = [];
let fileFilterSuggestionItems = [];
let fileFilterSuggestionIndex = -1;
const openObjectKeys = new Set();
const closedSourceFolderKeys = new Set();
const describeCache = new Map();
const metadataDetailCache = new Map();
const toolingSourceDetailCache = new Map();
const searchDetailEntryCache = new Map();
let activeSearchTerm = "";
let activeSearchIncludeAllNamespaces = false;
let activeSearchInstalledPackageNamespaces = [];
let activeFileFilterSearchRequestId = 0;
let activeIndexSearchRequestId = 0;
let activeFolderIndexSearchRequestId = 0;
let activeSearchOpenRequestId = 0;
let searchMetadataTypeFilterText = "";
let searchInstalledPackageFilterText = "";
let schemaFileFilterTerm = "";
let schemaFolderSearchTerm = "";
let schemaBodySearchTerm = "";
let schemaBodySearchRequestId = 0;
let schemaBodySearchEntries = [];
let availableMetadataTypes = [...SCHEMA_METADATA_TYPES];
let availableInstalledPackages = [];
let workspaceNamespaceLoadPromise = null;
let activeSourceFolderPath = "";
let metadataActionInProgress = false;
let activeSidebarTab = "explorer";
let packageSelectionTreeDirty = true;
let packageRetrievedSelectionSignature = "";
let packageCreateActiveFolderPath = "";
let packageCreatePreviewMode = false;
let packageCreateSourcePath = "";
let packageCreateFolderFilterTerm = "";
let packageCreateFolderFilterShouldFocus = false;
let packageCreateItemFilterTerm = "";
let packageCreateItemFilterShouldFocus = false;
const sourceNavigationBackStack = [];
const sourceNavigationForwardStack = [];
let sourceNavigationSuppressRecord = false;
const selectedPackageMembers = new Set();
const folderRetrieveInProgress = new Set();
const folderNamespaceScopeByPath = new Map();
const editedDetailFileContents = new Map();
const detailFileBaselineContents = new Map();
const changedDetailFiles = new Map();
const localSourceEntries = new Map();
const myOrgSearchLocalPaths = new Set();
const myOrgBranchTreeLocalPaths = new Set();
const deletedSourcePaths = new Set();
const objectMetadataDetailCache = new Map();
let selectedChangedFileKey = "";
const selectedChangedFileKeys = new Set();
let changedDeployInProgress = false;
let searchPanelRenderFrame = 0;
let searchHighlightTermOverride = "";
let searchResultReachedMax = false;
let workspaceSettingsReturnFocus = null;
let preserveExplorerFileFilterOnNextReveal = false;

const SCHEMA_UI_SETTINGS_STORAGE_KEY = "schema-viewer-ui-settings";
const FEATURE_RUNTIME_SETTING_FILE_KEY = "feature-settings.json";
const SCHEMA_SIDEBAR_WIDTH_STORAGE_KEY = "schema-viewer-sidebar-width";
const SCHEMA_DETAILS_COLLAPSED_STORAGE_KEY = "schema-viewer-details-collapsed";
const SESSION_LOAD_TIMEOUT_MS = 15000;
const METADATA_TYPE_LOAD_TIMEOUT_MS = 15000;
const INSTALLED_PACKAGE_LOAD_TIMEOUT_MS = 10000;
const SOURCE_BASE_FOLDERS = ["objects"];
const STARTUP_COMMON_METADATA_FOLDERS = [
  "objects",
  "classes",
  "triggers",
  "pages",
  "components",
  "lwc",
  "aura",
  "flows"
];
const PACKAGE_XML_API_VERSION = "66.0";
const SEARCH_METADATA_TYPE_SELECTION_LIMIT = 4;
const SEARCH_SERVER_MAX_RESULTS = 200;
const SEARCH_SERVER_CONCURRENCY = 4;
const FILE_FILTER_SUGGESTION_LIMIT = 40;
const FILE_DETAIL_SOURCE_REQUEST_CONCURRENCY = 2;
const METADATA_DETAIL_CACHE_LIMIT = 24;
const SEARCH_DETAIL_ENTRY_CACHE_LIMIT = 120;
const COMPACT_METADATA_INDEX_DB_PREFIX = "sf-metadata-folder-index";
const COMPACT_METADATA_INDEX_RECORD_STORE = "records";
const COMPACT_METADATA_INDEX_META_STORE = "meta";
const COMPACT_METADATA_INDEX_DB_VERSION = 15;
const COMPACT_METADATA_INDEX_FORMAT_VERSION = 15;
const COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED = false;
const COMPACT_METADATA_INDEX_KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-!#$%&()+,.=@[]^{}~;:";
const COMPACT_METADATA_FOLDER_KEY_LENGTH = 3;
const COMPACT_METADATA_FILE_KEY_LENGTH = 3;
const MANIFEST_FOLDER_SOURCE_PATH = "manifest";
const PACKAGE_XML_SOURCE_PATH = "manifest/package.xml";
const MANIFEST_LOCAL_SOURCE_ORIGIN = "manifest-local";
const WORKSPACE_PACKAGE_SOURCE_ORIGIN = "workspace-package";
const OBJECT_SOURCE_FOLDER_NAME = "objects";
const OBJECT_STANDARD_GROUP_NAME = "standard objects";
const OBJECT_CUSTOM_GROUP_NAME = "custom objects";
const SOURCE_DEFAULT_ROOT_SORT_RANK = 0;
const SOURCE_NAMESPACE_ROOT_SORT_RANK = 1;
const CACHE_ACTIVE_MINUTES = 30;
const METADATA_XML_SOURCE_METADATA_TYPE_IDS = new Set([
  "objects",
  "CustomObject",
  "flows",
  "Flow"
]);
const PACKAGE_METADATA_API_TYPE_BY_ID = {
  apexClasses: "ApexClass",
  apexPages: "ApexPage",
  apexTriggers: "ApexTrigger",
  apexComponents: "ApexComponent",
  lwcBundles: "LightningComponentBundle",
  auraBundles: "AuraDefinitionBundle",
  flows: "Flow",
  staticResources: "StaticResource"
};

const SOURCE_BODY_SEARCH_FIELD_BY_TYPE = {
  apexClasses: "Body",
  apexPages: "Markup",
  apexTriggers: "Body",
  apexComponents: "Markup"
};

const SEARCH_CODE_FILE_METADATA_TYPE_IDS = [
  "apexClasses",
  "apexPages",
  "apexComponents",
  "apexTriggers"
];
const SEARCH_SETTING_FILE_METADATA_TYPE_IDS = [
  "objects",
  "tabs",
  "layouts",
  "customMetadata"
];
const DEFAULT_SEARCH_METADATA_TYPE_IDS = SEARCH_CODE_FILE_METADATA_TYPE_IDS;

const SEARCH_METADATA_TYPE_ALIASES_BY_ID = {
  apexClasses: ["Apex Class"],
  apexPages: ["Visualforce", "Visualforce Page", "Visualforce Pages"],
  apexComponents: ["Visualforce Component", "Visualforce Components"],
  apexTriggers: ["Apex Trigger"],
  auraBundles: ["Aura", "Aura Component"],
  lwcBundles: ["LWC", "Lightning Web Component"],
  flows: ["Flow", "Process Builder"],
  objects: ["Object", "Custom Object", "Custom Field", "Validation Rule"],
  workflows: ["Workflow", "Workflow Rule"]
};

const SEARCH_RENDERED_MATCH_ROWS_PER_FILE = 8;
const SEARCH_MATCH_HIGHLIGHT_LIMIT_PER_ROW = 8;
const FOLDER_DETAIL_TABLE_RENDER_BATCH_SIZE = 120;
const SOURCE_TREE_VIRTUAL_ROW_HEIGHT = 32;
const SOURCE_TREE_INDENT_REM = 1;
const SOURCE_TREE_VIRTUAL_BUFFER_ROWS = 20;
const SOURCE_TREE_VIRTUAL_MAX_MOUNTED_ROWS = 120;
const SOURCE_TREE_VIRTUAL_DETACHED_ROW_POOL_LIMIT = 30;
const SOURCE_TREE_TYPEAHEAD_RESET_MS = 500;

const EXCLUDED_METADATA_FOLDER_IDS = new Set([
  "dashboards",
  "Dashboard",
  "DashboardFolder",
  "reports",
  "Report",
  "ReportFolder",
  "reportTypes",
  "ReportType"
]);

const EXCLUDED_PACKAGE_XML_FOLDER_IDS = new Set([
  "email",
  "EmailFolder",
  "EmailTemplate",
  "flowDefinitions",
  "FlowDefinition",
  "objectTranslations",
  "ObjectTranslation"
]);

const DEFAULT_DEV_PACKAGE_MANIFEST_ENTRIES = [
  { type: "ApexClass", member: "*" },
  { type: "ApexComponent", member: "*" },
  { type: "ApexPage", member: "*" },
  { type: "ApexTrigger", member: "*" },
  { type: "AuraDefinitionBundle", member: "*" },
  { type: "CustomApplication", member: "*" },
  { type: "CustomMetadata", member: "*" },
  { type: "CustomTab", member: "*" },
  { type: "FlexiPage", member: "*" },
  { type: "Flow", member: "*" },
  { type: "GlobalValueSet", member: "*" },
  { type: "Layout", member: "*" },
  { type: "LightningComponentBundle", member: "*" },
  { type: "PermissionSet", member: "*" },
  { type: "Profile", member: "*" }
];

// Conservative package.xml wildcard support. Object child metadata is fetched
// explicitly because CustomObject:* does not mean all source-format object files.
const PACKAGE_XML_WILDCARD_METADATA_TYPES = new Set([
  "ApexClass",
  "ApexComponent",
  "ApexPage",
  "ApexTrigger",
  "ApprovalProcess",
  "AssignmentRules",
  "AuraDefinitionBundle",
  "AutoResponseRules",
  "ContentAsset",
  "CustomApplication",
  "CustomLabels",
  "CustomMetadata",
  "CustomTab",
  "DuplicateRule",
  "EscalationRules",
  "FlexiPage",
  "Flow",
  "GlobalValueSet",
  "Group",
  "Layout",
  "LightningComponentBundle",
  "PermissionSet",
  "Profile",
  "QuickAction",
  "Role",
  "SharingRules",
  "StaticResource",
  "Workflow"
]);

const COMMON_STANDARD_OBJECT_API_NAMES = new Set([
  "Account",
  "Asset",
  "Campaign",
  "CampaignMember",
  "Case",
  "Contact",
  "Contract",
  "Event",
  "Lead",
  "Opportunity",
  "OpportunityLineItem",
  "Order",
  "OrderItem",
  "Pricebook2",
  "PricebookEntry",
  "Product2",
  "Quote",
  "QuoteLineItem",
  "Task",
  "User"
]);

const STATIC_SOURCE_FOLDER_BY_METADATA_TYPE = {
  apexClasses: "classes",
  apexPages: "pages",
  apexTriggers: "triggers",
  apexComponents: "components",
  businessProcesses: "objects",
  compactLayouts: "objects",
  customFields: "objects",
  fieldSets: "objects",
  listViews: "objects",
  lwcBundles: "lwc",
  auraBundles: "aura",
  recordTypes: "objects",
  validationRules: "objects",
  webLinks: "objects",
  flows: "flows",
  staticResources: "staticresources"
};

const DEFAULT_RUNTIME_SETTING_FILES = {
  [FEATURE_RUNTIME_SETTING_FILE_KEY]: {},
  "session/defaults.json": {
    sessionLoadTimeoutMs: SESSION_LOAD_TIMEOUT_MS,
    metadataTypeLoadTimeoutMs: METADATA_TYPE_LOAD_TIMEOUT_MS,
    installedPackageLoadTimeoutMs: INSTALLED_PACKAGE_LOAD_TIMEOUT_MS
  },
  "cache/defaults.json": {
    activeMinutes: CACHE_ACTIVE_MINUTES,
    metadataDetailCacheLimit: METADATA_DETAIL_CACHE_LIMIT,
    searchDetailEntryCacheLimit: SEARCH_DETAIL_ENTRY_CACHE_LIMIT
  },
  "workspace/defaults.json": {
    startupCommonMetadataFolders: STARTUP_COMMON_METADATA_FOLDERS,
    sourceBaseFolders: SOURCE_BASE_FOLDERS
  },
  "search/defaults.json": {
    metadataTypeSelectionLimit: SEARCH_METADATA_TYPE_SELECTION_LIMIT,
    serverMaxResults: SEARCH_SERVER_MAX_RESULTS,
    serverConcurrency: SEARCH_SERVER_CONCURRENCY,
    fileDetailSourceRequestConcurrency: FILE_DETAIL_SOURCE_REQUEST_CONCURRENCY
  },
  "package/defaults.json": {
    apiVersion: PACKAGE_XML_API_VERSION,
    wildcardMetadataTypes: [...PACKAGE_XML_WILDCARD_METADATA_TYPES]
  }
};

const RETIRED_RUNTIME_SETTING_FILE_KEYS = new Set([
  "system/defaults.json"
]);

const RETIRED_RUNTIME_SETTING_PROPERTIES_BY_FILE = {
  [FEATURE_RUNTIME_SETTING_FILE_KEY]: new Set([
    "ObjectUseEntityDefinition"
  ])
};

const DEFAULT_SCHEMA_UI_SETTINGS = {
  searchMetadataTypes: null,
  searchIncludeAllNamespaces: false,
  searchInstalledPackageNamespaces: [],
  searchFolderDefaults: null,
  workspaceIncludeAllNamespaces: false,
  workspaceInstalledPackageNamespaces: [],
  metadataFolderDefaults: STARTUP_COMMON_METADATA_FOLDERS,
  manifestLocalFiles: [],
  runtimeSettingOverrides: {},
  namespaceDefaultVersion: 4
};

let schemaUiSettings = loadSchemaUiSettings();
let storedSidebarWidth = 0;
let detailsCollapsed = false;
let outboundChangeSets = [];
let outboundChangeSetsLoaded = false;
let outboundChangeSetsLoading = false;
let selectedOutboundChangeSetName = "";
let outboundChangeSetSource = null;
let outboundChangeSetSourceLoading = false;
let outboundChangeSetRequestId = 0;
let selectedOutboundChangeSetSourcePath = "";
let searchRequestInProgress = false;

const METADATA_API_SOURCE_CONFIG = {
  applications: ["applications", "app"],
  businessProcesses: ["objects", "businessProcess"],
  contentassets: ["contentassets", "asset"],
  compactLayouts: ["objects", "compactLayout"],
  customFields: ["objects", "field"],
  customMetadata: ["customMetadata", "md"],
  duplicateRules: ["duplicateRules", "duplicateRule"],
  email: ["email", "email"],
  flexipages: ["flexipages", "flexipage"],
  globalValueSets: ["globalValueSets", "globalValueSet"],
  groups: ["groups", "group"],
  labels: ["labels", "labels"],
  layouts: ["layouts", "layout"],
  listViews: ["objects", "listView"],
  recordTypes: ["objects", "recordType"],
  validationRules: ["objects", "validationRule"],
  fieldSets: ["objects", "fieldSet"],
  flows: ["flows", "flow"],
  flowDefinitions: ["flowDefinitions", "flowDefinition"],
  permissionsets: ["permissionsets", "permissionset"],
  profiles: ["profiles", "profile"],
  quickActions: ["quickActions", "quickAction"],
  remoteSiteSettings: ["remoteSiteSettings", "remoteSite"],
  roles: ["roles", "role"],
  settings: ["settings", "settings"],
  sharingRules: ["sharingRules", "sharingRules"],
  tabs: ["tabs", "tab"],
  webLinks: ["objects", "webLink"],
  workflows: ["workflows", "workflow"]
};

function formatUserFacingMessage(message = "") {
  // Keep Salesforce's own vocabulary; see ui-messages.js for why.
  return String(message || "");
}

function setStatus(message, isError = false) {
  const displayMessage = formatUserFacingMessage(message);
  if (session?.host) {
    // The header is the persistent session indicator. Keep it stable while
    // operational progress and errors are shown in the adjacent summary.
    statusEl.textContent = t("schemaStatus.connectedHeader", { host: session.host });
    statusEl.className = "status";
    if (displayMessage) {
      setSchemaSummary(displayMessage, isError);
    }
    return;
  }

  statusEl.textContent = displayMessage;
  statusEl.className = isError ? "status error" : "status";
}

function setSchemaSummary(message, isError = false) {
  schemaSummaryEl.textContent = formatUserFacingMessage(message);
  schemaSummaryEl.className = isError ? "small schema-status error" : "small schema-status";
  schemaSummaryEl.removeAttribute("aria-busy");
}

function setSearchProgressSummary(message, options = {}) {
  const displayMessage = formatUserFacingMessage(message);
  const percent = Number.isFinite(options.percent) ? Math.max(0, Math.min(100, options.percent)) : null;
  schemaSummaryEl.innerHTML = "";
  schemaSummaryEl.className = options.isError ? "small schema-status schema-search-progress error" : "small schema-status schema-search-progress";
  schemaSummaryEl.setAttribute("aria-busy", "true");

  const bar = document.createElement("div");
  bar.className = "schema-search-progress-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuetext", displayMessage || "Searching");
  if (percent !== null) {
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(percent)));
  } else {
    bar.classList.add("indeterminate");
  }

  const fill = document.createElement("span");
  fill.className = "schema-search-progress-fill";
  if (percent !== null) {
    fill.style.width = `${percent}%`;
  }

  const label = document.createElement("span");
  label.className = "schema-search-progress-label";
  label.textContent = displayMessage || "Searching";

  bar.append(fill, label);
  schemaSummaryEl.appendChild(bar);
}

function getStartupLoadingOverlay() {
  let overlay = document.getElementById("schema-startup-loading");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.id = "schema-startup-loading";
  overlay.className = "schema-startup-loading";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="schema-startup-loading-card" role="status" aria-live="polite">
      <div class="schema-startup-loading-kicker">${schemaRuntimeFeatureLabel}</div>
      <h2 class="schema-startup-loading-title">Loading workspace</h2>
      <p class="schema-startup-loading-message">Preparing metadata folder...</p>
      <div class="schema-startup-loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
        <span class="schema-startup-loading-fill"></span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function setStartupLoading(message = "Loading metadata folder...", options = {}) {
  const displayMessage = formatUserFacingMessage(message);
  const overlay = getStartupLoadingOverlay();
  overlay.hidden = false;
  const titleEl = overlay.querySelector(".schema-startup-loading-title");
  const messageEl = overlay.querySelector(".schema-startup-loading-message");
  const barEl = overlay.querySelector(".schema-startup-loading-bar");
  const fillEl = overlay.querySelector(".schema-startup-loading-fill");
  const percent = Number.isFinite(options.percent)
    ? Math.max(0, Math.min(100, options.percent))
    : null;

  if (titleEl && options.title) {
    titleEl.textContent = formatUserFacingMessage(options.title);
  }
  if (messageEl) {
    messageEl.textContent = displayMessage;
  }
  if (barEl) {
    if (percent === null) {
      barEl.removeAttribute("aria-valuenow");
      barEl.classList.add("indeterminate");
    } else {
      barEl.setAttribute("aria-valuenow", String(Math.round(percent)));
      barEl.classList.remove("indeterminate");
    }
  }
  if (fillEl && percent !== null) {
    fillEl.style.width = `${percent}%`;
  }
}

function hideStartupLoading() {
  const overlay = document.getElementById("schema-startup-loading");
  if (overlay) {
    overlay.hidden = true;
  }
}

function updateSearchRunButtonState() {
  if (explorerFindButton) {
    explorerFindButton.disabled = searchRequestInProgress;
    explorerFindButton.classList.toggle("searching", searchRequestInProgress);
    explorerFindButton.setAttribute("aria-busy", String(searchRequestInProgress));
  }

  if (schemaFolderSearchButton) {
    schemaFolderSearchButton.disabled = searchRequestInProgress;
    schemaFolderSearchButton.classList.toggle("searching", searchRequestInProgress);
    schemaFolderSearchButton.setAttribute("aria-busy", String(searchRequestInProgress));
  }
}

function hasSearchSidebarTab() {
  return Boolean(searchTabButton && searchTabPanel && schemaSearchResultsTreeEl);
}

function withStartupTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout])
    .finally(() => window.clearTimeout(timeoutId));
}

function normalizeSchemaUiSettings(parsedSettings = {}) {
  const parsed = parsedSettings && typeof parsedSettings === "object" ? parsedSettings : {};
  const parsedNamespaceDefaultVersion = Number(parsed.namespaceDefaultVersion || 0);
  const settings = {
    ...DEFAULT_SCHEMA_UI_SETTINGS,
    ...parsed
  };
  settings.manifestLocalFiles = normalizePersistedManifestLocalFiles(parsed.manifestLocalFiles);
  if (parsedNamespaceDefaultVersion !== DEFAULT_SCHEMA_UI_SETTINGS.namespaceDefaultVersion) {
    settings.workspaceIncludeAllNamespaces = parsed.workspaceIncludeAllNamespaces === true
      || parsed.searchIncludeAllNamespaces === true;
    settings.workspaceInstalledPackageNamespaces = Array.isArray(parsed.workspaceInstalledPackageNamespaces)
      ? parsed.workspaceInstalledPackageNamespaces
      : Array.isArray(parsed.searchInstalledPackageNamespaces)
        ? parsed.searchInstalledPackageNamespaces
        : [];
    settings.searchIncludeAllNamespaces = false;
    settings.searchInstalledPackageNamespaces = [];
    settings.searchFolderDefaults = Array.isArray(parsed.searchFolderDefaults)
      ? parsed.searchFolderDefaults
      : null;
    settings.runtimeSettingOverrides = parsed.runtimeSettingOverrides
      && typeof parsed.runtimeSettingOverrides === "object"
      ? parsed.runtimeSettingOverrides
      : {};
    settings.namespaceDefaultVersion = parsedNamespaceDefaultVersion;
  }
  return settings;
}

function loadSchemaUiSettings() {
  return normalizeSchemaUiSettings();
}

function createPersistedBlankManifestContent() {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">",
    `  <version>${PACKAGE_XML_API_VERSION}</version>`,
    "</Package>"
  ].join("\n");
}

function normalizePersistedManifestLocalFile(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const rawPath = normalizeMyOrgResultPath(record.path || "");
  const pathBaseName = getSourceBaseName(rawPath);
  const fileName = normalizeManifestFileName(record.fileName || record.name || pathBaseName || "manifest.xml");
  const path = rawPath.startsWith(`${MANIFEST_FOLDER_SOURCE_PATH}/`)
    && rawPath !== PACKAGE_XML_SOURCE_PATH
    && /\.xml$/i.test(rawPath)
      ? rawPath
      : `${MANIFEST_FOLDER_SOURCE_PATH}/${fileName}`;
  if (!path || path === PACKAGE_XML_SOURCE_PATH) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    path,
    name: getSourceBaseName(path),
    fileName: getSourceBaseName(path),
    content: typeof record.content === "string" ? record.content : createPersistedBlankManifestContent(),
    label: record.label || "Custom Manifest",
    localUid: record.localUid || createManifestLocalUid(),
    createdAt: record.createdAt || now,
    lastModifiedDate: record.lastModifiedDate || record.updatedAt || now
  };
}

function normalizePersistedManifestLocalFiles(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }
  const seenPaths = new Set();
  return records
    .map((record) => normalizePersistedManifestLocalFile(record))
    .filter((record) => {
      if (!record || seenPaths.has(record.path)) {
        return false;
      }
      seenPaths.add(record.path);
      return true;
    });
}

function getPersistedManifestLocalFilesFromEntries() {
  return [...localSourceEntries.values()]
    .filter((entry) => entry?.kind === "file" && entry.sourceOrigin === MANIFEST_LOCAL_SOURCE_ORIGIN)
    .sort((left, right) => (left.path || "").localeCompare(right.path || ""))
    .map((entry) => ({
      path: entry.path || "",
      name: entry.name || getSourceBaseName(entry.path || ""),
      fileName: entry.fileName || getSourceBaseName(entry.path || ""),
      content: entry.content || "",
      label: entry.label || "Custom Manifest",
      localUid: entry.localUid || "",
      createdAt: entry.createdAt || "",
      lastModifiedDate: entry.lastModifiedDate || ""
    }));
}

function savePersistedManifestLocalFiles() {
  schemaUiSettings = {
    ...schemaUiSettings,
    manifestLocalFiles: getPersistedManifestLocalFilesFromEntries()
  };
  saveSchemaUiSettings();
}

function restorePersistedManifestLocalFiles() {
  const records = normalizePersistedManifestLocalFiles(schemaUiSettings.manifestLocalFiles);
  let restoredCount = 0;
  records.forEach((record) => {
    if (!record?.path) {
      return;
    }
    localSourceEntries.set(record.path, {
      kind: "file",
      path: record.path,
      name: record.name || getSourceBaseName(record.path),
      parentPath: MANIFEST_FOLDER_SOURCE_PATH,
      content: record.content || createPersistedBlankManifestContent(),
      metadataType: "manifest",
      typeLabel: "Manifest",
      label: record.label || "Custom Manifest",
      fileName: record.fileName || getSourceBaseName(record.path),
      contentKind: "xml",
      sourceOrigin: MANIFEST_LOCAL_SOURCE_ORIGIN,
      localUid: record.localUid || createManifestLocalUid(),
      autoRetrieve: false,
      createdAt: record.createdAt || "",
      lastModifiedDate: record.lastModifiedDate || ""
    });
    restoredCount += 1;
  });
  if (restoredCount) {
    invalidateExplorerSourceTreeCache();
  }
  return restoredCount;
}

async function getRuntimePreferenceValue(id = "") {
  try {
    const rawValue = globalThis.localStorage?.getItem(id);
    return rawValue ? JSON.parse(rawValue) : undefined;
  } catch (_error) {
    return undefined;
  }
}

async function setRuntimePreferenceValue(id = "", value = null) {
  try {
    logRuntimeTraceTransaction({
      direction: "user -> localStorage",
      target: "runtime-preferences",
      action: "put",
      id,
      value
    });
    globalThis.localStorage?.setItem(id, JSON.stringify(value));
    return true;
  } catch (_error) {
    return false;
  }
}

async function loadRuntimeUiPreferences() {
  try {
    const [storedSettings, sidebarWidth, collapsedDetails] = await Promise.all([
      getRuntimePreferenceValue(SCHEMA_UI_SETTINGS_STORAGE_KEY),
      getRuntimePreferenceValue(SCHEMA_SIDEBAR_WIDTH_STORAGE_KEY),
      getRuntimePreferenceValue(SCHEMA_DETAILS_COLLAPSED_STORAGE_KEY)
    ]);
    schemaUiSettings = normalizeSchemaUiSettings(storedSettings);
    const width = Number(sidebarWidth || 0);
    storedSidebarWidth = Number.isFinite(width) ? width : 0;
    detailsCollapsed = collapsedDetails === true;
  } catch (_error) {
    schemaUiSettings = normalizeSchemaUiSettings();
    storedSidebarWidth = 0;
    detailsCollapsed = false;
  }
}

function saveSchemaUiSettings() {
  void setRuntimePreferenceValue(SCHEMA_UI_SETTINGS_STORAGE_KEY, schemaUiSettings).catch(() => {});
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
  }
  return value;
}

function getRuntimeSettingFileDefaults(fileKey = FEATURE_RUNTIME_SETTING_FILE_KEY) {
  return cloneJsonValue(DEFAULT_RUNTIME_SETTING_FILES[fileKey] || {});
}

function getRuntimeSettingFileOverrides(fileKey = FEATURE_RUNTIME_SETTING_FILE_KEY) {
  if (RETIRED_RUNTIME_SETTING_FILE_KEYS.has(fileKey)) {
    return {};
  }
  const overrides = schemaUiSettings.runtimeSettingOverrides;
  if (!overrides || typeof overrides !== "object") {
    return {};
  }
  const fileOverrides = overrides[fileKey];
  if (!fileOverrides || typeof fileOverrides !== "object" || Array.isArray(fileOverrides)) {
    return {};
  }
  const retiredProperties = RETIRED_RUNTIME_SETTING_PROPERTIES_BY_FILE[fileKey] || new Set();
  return Object.fromEntries(
    Object.entries(fileOverrides)
      .filter(([propertyName]) => !retiredProperties.has(propertyName))
      .map(([propertyName, value]) => [propertyName, cloneJsonValue(value)])
  );
}

function getRuntimeSettingFile(fileKey = FEATURE_RUNTIME_SETTING_FILE_KEY) {
  return {
    ...getRuntimeSettingFileDefaults(fileKey),
    ...getRuntimeSettingFileOverrides(fileKey)
  };
}

function getRuntimeSetting(fileKey, propertyName, fallbackValue) {
  const value = getRuntimeSettingFile(fileKey)[propertyName];
  return typeof value === "undefined" ? fallbackValue : value;
}

function getRuntimeNumberSetting(fileKey, propertyName, fallbackValue, options = {}) {
  const value = Number(getRuntimeSetting(fileKey, propertyName, fallbackValue));
  const min = Number.isFinite(options.min) ? options.min : -Infinity;
  const max = Number.isFinite(options.max) ? options.max : Infinity;
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(min, Math.min(max, value));
}

function getRuntimeStringSetting(fileKey, propertyName, fallbackValue) {
  const value = getRuntimeSetting(fileKey, propertyName, fallbackValue);
  return typeof value === "string" && value ? value : fallbackValue;
}

function getRuntimeArraySetting(fileKey, propertyName, fallbackValue = []) {
  const value = getRuntimeSetting(fileKey, propertyName, fallbackValue);
  return Array.isArray(value) ? value : fallbackValue;
}

function getRuntimeBooleanSetting(fileKey, propertyName, fallbackValue = false) {
  const value = getRuntimeSetting(fileKey, propertyName, fallbackValue);
  return typeof value === "boolean" ? value : fallbackValue;
}

function getCacheActiveMinutes() {
  return getRuntimeNumberSetting("cache/defaults.json", "activeMinutes", CACHE_ACTIVE_MINUTES, {
    min: 0,
    max: 1440
  });
}

function getSessionLoadTimeoutMs() {
  return SESSION_LOAD_TIMEOUT_MS;
}

function getMetadataTypeLoadTimeoutMs() {
  return METADATA_TYPE_LOAD_TIMEOUT_MS;
}

function getInstalledPackageLoadTimeoutMs() {
  return INSTALLED_PACKAGE_LOAD_TIMEOUT_MS;
}

function getStartupCommonMetadataFolders() {
  return getRuntimeArraySetting("workspace/defaults.json", "startupCommonMetadataFolders", STARTUP_COMMON_METADATA_FOLDERS)
    .map((folderName) => String(folderName || "").trim())
    .filter(Boolean);
}

function getSourceBaseFolders() {
  return getRuntimeArraySetting("workspace/defaults.json", "sourceBaseFolders", SOURCE_BASE_FOLDERS)
    .map((folderName) => String(folderName || "").trim())
    .filter(Boolean);
}

function getObjectUseEntityDefinition() {
  return false;
}

function createRuntimeTraceSchemaStoreSummary(store = {}) {
  return {
    host: store.host || "",
    generatedAt: store.generatedAt || "",
    discoveryCachedAt: store.discoveryCachedAt || "",
    objectCount: Number(store.objectCount || 0),
    fieldCount: Number(store.fieldCount || 0),
    metadataItemCount: Number(store.metadataItemCount || 0),
    metadataTypeCount: Array.isArray(store.metadataTypes) ? store.metadataTypes.length : 0,
    availableMetadataTypeCount: Array.isArray(store.availableMetadataTypes) ? store.availableMetadataTypes.length : 0,
    installedPackageCount: Array.isArray(store.installedPackages) ? store.installedPackages.length : 0,
    detailCount: store.details && typeof store.details === "object" ? Object.keys(store.details).length : 0,
    errorCount: Array.isArray(store.errors) ? store.errors.length : 0
  };
}

function logRuntimeTraceTransaction(transaction = {}) {
  void transaction;
}

function createRuntimeTraceSourceNodeSummary(node = {}) {
  return {
    name: node.name || "",
    path: node.path || node.selection?.sourcePath || "",
    kind: node.kind || "",
    childCount: Array.isArray(node.children) ? node.children.length : 0,
    lazyChildren: Boolean(node.lazyChildrenFactory),
    lazyChildrenLoaded: node.lazyChildrenLoaded === true
  };
}

function createRuntimeTraceSelectionSummary(selection = {}) {
  return {
    type: selection.type || "",
    sourcePath: selection.sourcePath || "",
    metadataType: selection.metadataType || "",
    objectKey: selection.objectKey || "",
    fieldKey: selection.fieldKey || "",
    itemKey: selection.itemKey || ""
  };
}

function logRuntimeTraceMethodRun(method, detail = {}) {
  void method;
  void detail;
}

function logRuntimeTraceFolderMethodRun(method, detail = {}, options = {}) {
  void method;
  void detail;
  void options;
}

function getSearchMetadataTypeSelectionLimit() {
  return Math.floor(getRuntimeNumberSetting("search/defaults.json", "metadataTypeSelectionLimit", SEARCH_METADATA_TYPE_SELECTION_LIMIT, {
    min: 0,
    max: 100
  }));
}

function getSearchServerMaxResults() {
  return Math.floor(getRuntimeNumberSetting("search/defaults.json", "serverMaxResults", SEARCH_SERVER_MAX_RESULTS, {
    min: 1,
    max: 5000
  }));
}

function getSearchServerConcurrency() {
  return Math.floor(getRuntimeNumberSetting("search/defaults.json", "serverConcurrency", SEARCH_SERVER_CONCURRENCY, {
    min: 1,
    max: 16
  }));
}

function getFileDetailSourceRequestConcurrency() {
  return Math.floor(getRuntimeNumberSetting("search/defaults.json", "fileDetailSourceRequestConcurrency", FILE_DETAIL_SOURCE_REQUEST_CONCURRENCY, {
    min: 1,
    max: 8
  }));
}

function getMetadataDetailCacheLimit() {
  return METADATA_DETAIL_CACHE_LIMIT;
}

function getSearchDetailEntryCacheLimit() {
  return SEARCH_DETAIL_ENTRY_CACHE_LIMIT;
}

function getCompactMetadataIndexKeyAlphabet() {
  return COMPACT_METADATA_INDEX_KEY_ALPHABET;
}

function getCompactMetadataFolderKeyLength() {
  return COMPACT_METADATA_FOLDER_KEY_LENGTH;
}

function getCompactMetadataFileKeyLength() {
  return COMPACT_METADATA_FILE_KEY_LENGTH;
}

function getPackageXmlApiVersion() {
  return getRuntimeStringSetting("package/defaults.json", "apiVersion", PACKAGE_XML_API_VERSION);
}

function getPackageXmlWildcardMetadataTypeSet() {
  return new Set(
    getRuntimeArraySetting("package/defaults.json", "wildcardMetadataTypes", [...PACKAGE_XML_WILDCARD_METADATA_TYPES])
      .map((metadataType) => String(metadataType || "").trim())
      .filter(Boolean)
  );
}

function setsHaveSameValues(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function setContainsAllValues(container = [], values = []) {
  const containerSet = new Set(container);
  return [...new Set(values)].every((value) => containerSet.has(value));
}

function invalidateFolderSearchCache() {
  activeFolderIndexSearchRequestId += 1;
  activeIndexSearchRequestId += 1;
  updateSearchRunButtonState();
}

function getDefaultMetadataFolderNames() {
  const folderNames = Array.isArray(schemaUiSettings.metadataFolderDefaults)
    ? schemaUiSettings.metadataFolderDefaults
    : getStartupCommonMetadataFolders();
  return [...new Set(
    folderNames
      .map((folderName) => String(folderName || "").trim())
      .filter(Boolean)
  )];
}

function getWorkspaceFolderNameSet() {
  return new Set(getDefaultMetadataFolderNames());
}

function getSearchFolderCandidates() {
  const workspaceFolderNames = getWorkspaceFolderNameSet();
  return getMetadataFolderSelectionEntries()
    .filter((folder) => workspaceFolderNames.has(folder.name));
}

function getValidSearchFolderNames(folderNames = []) {
  const candidateNames = new Set(getSearchFolderCandidates().map((folder) => folder.name));
  return [...new Set(folderNames)]
    .map((folderName) => String(folderName || "").trim())
    .filter((folderName) => folderName && candidateNames.has(folderName));
}

function getDefaultSearchFolderNames() {
  const candidates = getSearchFolderCandidates();
  const codeFolderNames = new Set(
    DEFAULT_SEARCH_METADATA_TYPE_IDS
      .map((metadataTypeId) => getSourceFolderForMetadataType(metadataTypeId))
      .filter(Boolean)
  );
  const defaultFolderNames = candidates
    .filter((folder) => codeFolderNames.has(folder.name))
    .map((folder) => folder.name);
  return defaultFolderNames.length
    ? defaultFolderNames
    : candidates.map((folder) => folder.name);
}

function getSelectedSearchFolderNames() {
  if (Array.isArray(schemaUiSettings.searchFolderDefaults)) {
    const validFolderNames = getValidSearchFolderNames(schemaUiSettings.searchFolderDefaults);
    if (validFolderNames.length || schemaUiSettings.searchFolderDefaults.length === 0) {
      return validFolderNames;
    }
  }

  return getDefaultSearchFolderNames();
}

function getCachedDefaultMetadataFolderNames(store = schemaStore) {
  const folderNames = Array.isArray(store?.defaultMetadataFolderNames)
    ? store.defaultMetadataFolderNames
    : [];
  return [...new Set(
    folderNames
      .map((folderName) => String(folderName || "").trim())
      .filter(Boolean)
  )];
}

function hasCachedDefaultMetadataFolderNames(store = schemaStore) {
  return Array.isArray(store?.defaultMetadataFolderNames);
}

function getValidDefaultMetadataFolderNames(folderNames = [], options = {}) {
  const availableFolderNames = new Set(createDefaultMetadataFolderCache(availableMetadataTypes).map((folder) => folder.name));
  const validFolderNames = [...new Set(folderNames)]
    .map((folderName) => String(folderName || "").trim())
    .filter((folderName) => folderName && (!availableFolderNames.size || availableFolderNames.has(folderName)));
  return validFolderNames.length || options.fallbackToStartup === false
    ? validFolderNames
    : getStartupCommonMetadataFolders();
}

function isUsingHardcodedMetadataFolderDefaults() {
  return setsHaveSameValues(getDefaultMetadataFolderNames(), getStartupCommonMetadataFolders());
}

function getNamespaceSelectionFromScopeKey(scopeKey = "") {
  const scope = String(scopeKey || "").trim();
  if (scope === "all") {
    return {
      includeAllNamespaces: true,
      namespaces: []
    };
  }
  if (!scope || scope === "none") {
    return {
      includeAllNamespaces: false,
      namespaces: []
    };
  }
  return {
    includeAllNamespaces: false,
    namespaces: getValidInstalledPackageNamespaces(scope.split(","))
  };
}

function isUsingDefaultNamespaceSelection() {
  return schemaUiSettings.workspaceIncludeAllNamespaces !== true
    && getSelectedWorkspaceInstalledPackageNamespaces().length === 0;
}

function syncSchemaUiSettingsWithCachedDefaults(store = schemaStore) {
  let nextSettings = { ...schemaUiSettings };
  let didChange = false;

  const cachedFolderNames = getCachedDefaultMetadataFolderNames(store);
  if (hasCachedDefaultMetadataFolderNames(store) && isUsingHardcodedMetadataFolderDefaults()) {
    nextSettings = {
      ...nextSettings,
      metadataFolderDefaults: getValidDefaultMetadataFolderNames(cachedFolderNames, { fallbackToStartup: false })
    };
    didChange = true;
  } else {
    const validFolderNames = getValidDefaultMetadataFolderNames(nextSettings.metadataFolderDefaults || [], {
      fallbackToStartup: false
    });
    if (!setsHaveSameValues(validFolderNames, nextSettings.metadataFolderDefaults || [])) {
      nextSettings = {
        ...nextSettings,
        metadataFolderDefaults: validFolderNames
      };
      didChange = true;
    }
  }

  if (store?.defaultNamespaceScope && isUsingDefaultNamespaceSelection()) {
    const namespaceSelection = getNamespaceSelectionFromScopeKey(store.defaultNamespaceScope);
    if (namespaceSelection.includeAllNamespaces || namespaceSelection.namespaces.length) {
      nextSettings = {
        ...nextSettings,
        workspaceIncludeAllNamespaces: namespaceSelection.includeAllNamespaces,
        workspaceInstalledPackageNamespaces: namespaceSelection.namespaces,
        namespaceDefaultVersion: DEFAULT_SCHEMA_UI_SETTINGS.namespaceDefaultVersion
      };
      didChange = true;
    }
  }

  if (didChange) {
    schemaUiSettings = nextSettings;
    saveSchemaUiSettings();
  }
}

function setDefaultMetadataFolderSelected(folderName = "", selected = false) {
  const cleanFolderName = String(folderName || "").trim();
  if (!cleanFolderName) {
    return;
  }

  const folderNames = new Set(getDefaultMetadataFolderNames());
  if (selected) {
    folderNames.add(cleanFolderName);
  } else {
    folderNames.delete(cleanFolderName);
  }
  schemaUiSettings = {
    ...schemaUiSettings,
    metadataFolderDefaults: getValidDefaultMetadataFolderNames([...folderNames], { fallbackToStartup: false })
      .sort((left, right) => left.localeCompare(right))
  };
  syncSearchSelectionsToWorkspace();
  saveSchemaUiSettings();
  invalidateFolderSearchCache();
}

function normalizeMyOrgResultPath(path = "") {
  return String(path || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
}

function normalizeMyOrgResultCandidateUri(path = "") {
  const text = String(path || "").trim();
  if (!text) {
    return "";
  }
  let normalized = text;
  if (/^https?:\/\/|^\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized, "https://example.invalid");
      normalized = parsed.pathname || "";
    } catch (_error) {
      normalized = normalized.replace(/^https?:\/\/[^/]+/i, "");
    }
  }

  normalized = normalized
    .replace(/[#?].*$/, "")
    .replace(/\\/g, "/")
    .trim();
  return normalizeMyOrgResultPath(normalized);
}

function normalizeSearchResultSourcePath(item = {}) {
  const isRecordId = (value) => /^[a-zA-Z0-9]{15,18}$/.test(String(value || "").trim());
  const requestedPath = normalizeMyOrgResultPath(item.path || item.sourcePath || "");
  if (requestedPath) {
    const requestedSegments = requestedPath.split("/").filter(Boolean);
    const requestedTail = requestedSegments[requestedSegments.length - 1] || "";
    const looksLikeRecordPath = requestedSegments.length <= 1 && isRecordId(requestedTail);
    if (!looksLikeRecordPath) {
      return requestedPath;
    }
  }

  const uriCandidates = [
    item.path,
    item.requestURI,
    item.requestUri,
    item.requestPath,
    item.pathInfo,
    item.fileName,
    item.metadataName,
    item.Name,
    item.url,
    item.uri,
    item.name,
    item.fullName,
    item.FullName,
    item.id
  ];
  const metadataType = String(item.metadataType || "").trim();
  const typeConfig = getMetadataApiSourceConfig(metadataType);
  const folder = typeConfig?.folder || "";
  const suffix = (typeConfig?.suffix || "").toLowerCase();

  for (const candidate of uriCandidates) {
    const normalized = normalizeMyOrgResultCandidateUri(candidate);
    if (!normalized) {
      continue;
    }

    if (normalized === SOURCE_DEFAULT_ROOT || normalized.startsWith(SOURCE_DEFAULT_PREFIX)) {
      return normalized;
    }

    const lastSegment = normalized.split("/").filter(Boolean).pop() || "";
    if (!lastSegment) {
      continue;
    }
    if (isRecordId(lastSegment)) {
      continue;
    }

    const lastSegmentLower = lastSegment.toLowerCase();
    const hasExpectedSuffix = suffix ? lastSegmentLower.endsWith(`.${suffix}`) : false;
    const hasKnownSourceExtension = /\.[a-z0-9_-]+$/i.test(lastSegmentLower);
    if (!folder) {
      if (hasKnownSourceExtension) {
        return normalized;
      }
      continue;
    }

    const segments = normalized.split("/").filter(Boolean);
    if (hasExpectedSuffix || hasKnownSourceExtension) {
      if (segments.length >= 2) {
        const folderIndex = folder ? segments.lastIndexOf(folder) : -1;
        if (folderIndex >= 0) {
          return `${SOURCE_DEFAULT_PREFIX}${segments.slice(folderIndex).join("/")}`;
        }
      }
      return `${SOURCE_DEFAULT_PREFIX}${folder ? `${folder}/` : ""}${lastSegment}`;
    }

    return `${SOURCE_DEFAULT_PREFIX}${folder ? `${folder}/` : ""}${lastSegment}${suffix ? `.${suffix}` : ""}`;
  }

  const fallbackName = String(item.name || item.fullName || item.FullName || item.metadataName || "").trim();
  if (!fallbackName || !folder) {
    return "";
  }

  const fallbackSegment = toSourceFileSegment(fallbackName, "metadata");
  const normalizedSuffix = suffix ? toSourceFileSegment(suffix, "").toLowerCase() : "";
  const fallbackNameHasSuffix = normalizedSuffix && fallbackSegment.toLowerCase().endsWith(`.${normalizedSuffix}`);
  const safeFallbackName = fallbackNameHasSuffix ? fallbackSegment : `${fallbackSegment}${normalizedSuffix ? `.${normalizedSuffix}` : ""}`;
  return `${SOURCE_DEFAULT_PREFIX}${folder}/${safeFallbackName}`;
}

function getRelativeMetadataFileName(sourcePath = "") {
  return stripDefaultSourcePrefix(normalizeMyOrgResultPath(sourcePath));
}

function getMetadataRelativePathParts(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  if (!normalizedPath) {
    return [];
  }
  if (normalizedPath.startsWith(SOURCE_DEFAULT_PREFIX)) {
    return normalizedPath.slice(SOURCE_DEFAULT_PREFIX.length).split("/").filter(Boolean);
  }

  const mainPrefix = `${SOURCE_PROJECT_ROOT}/main/`;
  if (!normalizedPath.startsWith(mainPrefix)) {
    return normalizedPath.split("/").filter(Boolean);
  }

  const segments = normalizedPath.slice(mainPrefix.length).split("/").filter(Boolean);
  if (segments[0] === "default") {
    return segments.slice(1);
  }
  const defaultIndex = segments.indexOf("default");
  return defaultIndex === -1 ? segments : segments.slice(defaultIndex + 1);
}

function getCanonicalMetadataRelativePath(sourcePath = "") {
  const parts = getMetadataRelativePathParts(sourcePath);
  if (!parts.length) {
    return "";
  }
  if (parts[0] === OBJECT_SOURCE_FOLDER_NAME && getObjectSourceBucketPathSegmentSet().has(parts[1] || "")) {
    const objectFolder = parts[2] || "";
    const objectApiName = objectFolder.replace(/\.object$/i, "");
    const restParts = parts.slice(3);
    return [OBJECT_SOURCE_FOLDER_NAME, objectApiName, ...restParts].filter(Boolean).join("/");
  }
  return parts.join("/");
}

function inferObjectMetadataFromSourcePath(sourcePath = "") {
  const relativePath = getCanonicalMetadataRelativePath(sourcePath);
  const objectMatch = relativePath.match(/^objects\/([^/]+)\/\1\.object-meta\.xml$/i)
    || relativePath.match(/^objects\/([^/]+)\/[^/]+\.object-meta\.xml$/i);
  if (objectMatch) {
    return {
      metadataApiType: "CustomObject",
      fullName: objectMatch[1]
    };
  }

  const childRules = [
    ["CustomField", /^objects\/([^/]+)\/fields\/(.+)\.field-meta\.xml$/i],
    ["ValidationRule", /^objects\/([^/]+)\/validationRules\/(.+)\.validationRule-meta\.xml$/i],
    ["RecordType", /^objects\/([^/]+)\/recordTypes\/(.+)\.recordType-meta\.xml$/i],
    ["FieldSet", /^objects\/([^/]+)\/fieldSets\/(.+)\.fieldSet-meta\.xml$/i],
    ["ListView", /^objects\/([^/]+)\/listViews\/(.+)\.listView-meta\.xml$/i],
    ["CompactLayout", /^objects\/([^/]+)\/compactLayouts\/(.+)\.compactLayout-meta\.xml$/i],
    ["BusinessProcess", /^objects\/([^/]+)\/businessProcesses\/(.+)\.businessProcess-meta\.xml$/i],
    ["WebLink", /^objects\/([^/]+)\/webLinks\/(.+)\.webLink-meta\.xml$/i]
  ];
  for (const [metadataApiType, pattern] of childRules) {
    const match = relativePath.match(pattern);
    if (match) {
      return {
        metadataApiType,
        fullName: `${match[1]}.${match[2]}`
      };
    }
  }

  return {
    metadataApiType: "",
    fullName: ""
  };
}

function inferMetadataApiTypeFromSourcePath(sourcePath = "", metadataType = "") {
  if (metadataType === "objects" || getCanonicalMetadataRelativePath(sourcePath).startsWith("objects/")) {
    return inferObjectMetadataFromSourcePath(sourcePath).metadataApiType;
  }

  const metadataTypeDefinition = getAvailableMetadataType(metadataType) || {};
  const fallbackTypes = {
    flows: "Flow",
    flowDefinitions: "FlowDefinition"
  };
  return metadataTypeDefinition.metadataApiType || PACKAGE_METADATA_API_TYPE_BY_ID[metadataType] || fallbackTypes[metadataType] || "";
}

function inferMetadataFullNameFromSourcePath(sourcePath = "", metadataType = "", metadataApiType = "") {
  const relativePath = getCanonicalMetadataRelativePath(sourcePath);
  if (!relativePath) {
    return "";
  }

  if (metadataType === "objects" || relativePath.startsWith("objects/")) {
    return inferObjectMetadataFromSourcePath(sourcePath).fullName;
  }

  const config = getMetadataApiSourceConfig(metadataType);
  if (!config?.folder || !relativePath.startsWith(`${config.folder}/`)) {
    return "";
  }

  if (metadataType === "lwcBundles" || metadataType === "auraBundles") {
    return relativePath.slice(config.folder.length + 1).split("/").filter(Boolean)[0] || "";
  }

  let fullName = relativePath.slice(config.folder.length + 1);
  if (config.suffix && fullName.endsWith(`.${config.suffix}-meta.xml`)) {
    fullName = fullName.slice(0, -`.${config.suffix}-meta.xml`.length);
  } else if (config.suffix && fullName.endsWith(`.${config.suffix}`)) {
    fullName = fullName.slice(0, -`.${config.suffix}`.length);
  } else if (fullName.endsWith("-meta.xml")) {
    fullName = fullName.slice(0, -"-meta.xml".length);
  } else if (fullName.endsWith(".xml")) {
    fullName = fullName.slice(0, -".xml".length);
  }

  return fullName || metadataApiType;
}

function getMyOrgSearchResultKey(result = {}) {
  return String(
    result.path
    || result.sourcePath
    || result.id
    || `${result.metadataType || "metadata"}:${result.name || ""}`
  ).toLocaleLowerCase();
}

function getMyOrgSearchMatchKey(match = {}) {
  return [
    Number(match.lineNumber || 0),
    String(match.label || ""),
    String(match.text || match.snippet || "").trim()
  ].join("|").toLocaleLowerCase();
}

function recomputeMyOrgSearchResultMatchCount(result = {}) {
  return (result.matches || []).reduce((total, match) => (
    total + (Number(match.count || 0) || 0)
  ), 0);
}

function mergeMyOrgSearchResultItems(resultGroups = []) {
  const merged = new Map();

  for (const group of resultGroups) {
    for (const item of group || []) {
      const key = getMyOrgSearchResultKey(item);
      if (!key) {
        continue;
      }

      if (!merged.has(key)) {
        merged.set(key, {
          ...item,
          matches: [...(item.matches || [])],
          content: item.content || ""
        });
        continue;
      }

      const existing = merged.get(key);
      const seenMatches = new Set((existing.matches || []).map((match) => getMyOrgSearchMatchKey(match)));
      for (const match of item.matches || []) {
        const matchKey = getMyOrgSearchMatchKey(match);
        if (seenMatches.has(matchKey)) {
          continue;
        }
        existing.matches.push(match);
        seenMatches.add(matchKey);
      }

      merged.set(key, {
        ...existing,
        ...item,
        matches: existing.matches,
        content: existing.content || item.content || "",
        matchCount: recomputeMyOrgSearchResultMatchCount(existing)
      });
    }
  }

  return [...merged.values()].map((item) => ({
    ...item,
    matchCount: recomputeMyOrgSearchResultMatchCount(item)
  }));
}

function getMyOrgSearchMatchCount(match = {}) {
  const value = Number(match.count || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getMyOrgSearchMatchContribution(result = {}) {
  const matches = Array.isArray(result.matches) ? result.matches : [];
  if (!matches.length) {
    return 0;
  }
  return matches.reduce((total, match) => total + getMyOrgSearchMatchCount(match), 0);
}

function trimMyOrgSearchResultsByMatchCount(results = [], maxMatchCount = 0) {
  const normalizedMax = Number(maxMatchCount || 0);
  const max = Number.isFinite(normalizedMax) && normalizedMax > 0 ? Math.floor(normalizedMax) : Number.POSITIVE_INFINITY;
  if (max === Number.POSITIVE_INFINITY) {
    return {
      results: (results || []).map((result) => ({
        ...result,
        matches: Array.isArray(result.matches) ? [...result.matches] : [],
        matchCount: result.matchCount
      })),
      resultMatchCount: getMyOrgSearchResultTotalMatchCount(results),
      isTruncated: false
    };
  }

  const trimmed = [];
  let remaining = max;
  let totalMatchCount = 0;
  for (const item of results) {
    if (remaining <= 0) {
      break;
    }

    const currentResult = {
      ...item,
      matches: Array.isArray(item.matches) ? [...item.matches] : []
    };
    const matchContribution = getMyOrgSearchMatchContribution(currentResult);
    if (matchContribution <= remaining) {
      trimmed.push(currentResult);
      remaining -= matchContribution;
      totalMatchCount += matchContribution;
      continue;
    }

    const limitedMatches = [];
    for (const match of currentResult.matches) {
      const matchCount = getMyOrgSearchMatchCount(match);
      if (remaining <= 0) {
        break;
      }
      if (matchCount > remaining) {
        limitedMatches.push({
          ...match,
          count: remaining
        });
        totalMatchCount += remaining;
        remaining = 0;
        break;
      }
      limitedMatches.push(match);
      totalMatchCount += matchCount;
      remaining -= matchCount;
    }

    if (limitedMatches.length) {
      currentResult.matches = limitedMatches;
      currentResult.matchCount = limitedMatches.reduce((total, match) => total + getMyOrgSearchMatchCount(match), 0);
      trimmed.push(currentResult);
    }
    break;
  }

  return {
    results: trimmed,
    resultMatchCount: totalMatchCount,
    isTruncated: remaining <= 0 && totalMatchCount >= max && totalMatchCount < getMyOrgSearchResultTotalMatchCount(results)
  };
}

function getMyOrgSearchResultTotalMatchCount(results = []) {
  return results.reduce((total, result) => total + getMyOrgSearchMatchContribution(result), 0);
}

function combineMyOrgFilesSearchResults(results = [], options = {}) {
  const completedResults = results.filter(Boolean);
  const mergedResults = mergeMyOrgSearchResultItems(completedResults.map((result) => result.results || []));
  const warnings = [
    ...(options.warnings || []),
    ...completedResults.flatMap((result) => result.warnings || [])
  ];
  const searchedTypes = [...new Set(completedResults.flatMap((result) => result.searchedTypes || []))];
  const skippedTypes = [...new Set(completedResults.flatMap((result) => result.skippedTypes || []))];
  const requestId = options.requestId || completedResults.map((result) => result.requestId).find(Boolean) || "";
  const branchName = options.branchName || completedResults.map((result) => result.branchName).find(Boolean) || "";
  const query = options.query || completedResults.map((result) => result.query).find(Boolean) || "";
  const modes = new Set(completedResults.map((result) => result.mode).filter(Boolean));
  const hasNameResults = modes.has("extension-metadata-name-search") || modes.has("extension-name-and-source-search");
  const hasSourceResults = modes.has("extension-source-search") || modes.has("extension-name-and-source-search");
  const mode = options.mode
    || (hasNameResults && hasSourceResults
      ? "extension-name-and-source-search"
      : hasSourceResults
        ? "extension-source-search"
        : "extension-metadata-name-search");
  const maxResults = Math.max(0, Number(options.maxResults || 0) || 0);
  const displayMaxResults = maxResults > 0 ? maxResults : getSearchServerMaxResults();
  const totalMatchCount = getMyOrgSearchResultTotalMatchCount(mergedResults);
  const trimmed = trimMyOrgSearchResultsByMatchCount(mergedResults, maxResults || Number.POSITIVE_INFINITY);
  const limitedResults = trimmed.results;
  const limitedMatchCount = trimmed.resultMatchCount;
  const truncatedByClient = maxResults > 0 && trimmed.isTruncated;
  const message = options.message
    || (mode === "extension-metadata-name-search"
      ? `Extension name search completed. ${limitedMatchCount} matching items.`
      : mode === "extension-source-search"
        ? `Extension source-body search completed. ${limitedMatchCount} matching items.`
        : `Extension name/path and source search completed. ${limitedMatchCount} matching items.`);
  const truncatedMessage = truncatedByClient
    ? ` Showing first ${displayMaxResults} matches only for UI performance. Reduce metadata folders or use a more specific search term to get more focused results.`
    : "";
  if (truncatedByClient) {
    warnings.unshift({
      metadataType: "server",
      message: `Search returned more than ${displayMaxResults} matches. Only first ${displayMaxResults} are shown.`
    });
  }

  return {
    status: "completed",
    mode,
    requestId,
    branchName,
    query,
    completedAt: new Date().toISOString(),
    searchedTypes,
    skippedTypes,
    resultCount: limitedMatchCount,
    matchCount: totalMatchCount,
    truncated: completedResults.some((result) => result.truncated === true) || truncatedByClient,
    message: `${message}${truncatedMessage}`,
    results: limitedResults,
    warnings
  };
}

function getMyOrgSearchModeLabel(mode = "") {
  switch (String(mode || "")) {
    case "extension-metadata-name-search":
      return "Extension name search";
    case "extension-source-search":
      return "Extension source-body search";
    case "extension-name-and-source-search":
      return "Extension name/path and source search";
    default:
      return String(mode || "");
  }
}

function isInternalMyOrgResultSourceMarker(value = "") {
  return /^(?:tooling-query|tooling-sosl|sosl)$/i.test(String(value || "").trim());
}

function hasInternalMyOrgResultSourceContent(entry = {}) {
  return isInternalMyOrgResultSourceMarker(entry.content);
}

function getMyOrgResultSourceLabel(value = "") {
  switch (String(value || "").trim()) {
    case "tooling-query":
      return "Tooling API";
    case "tooling-sosl":
      return "Tooling API search";
    case "sosl":
      return "Salesforce search";
    default:
      return String(value || "");
  }
}

function clearMyOrgSearchLocalFiles() {
  let didChange = false;
  myOrgSearchLocalPaths.forEach((path) => {
    didChange = localSourceEntries.delete(path) || didChange;
    searchDetailEntryCache.delete(path);
  });
  myOrgSearchLocalPaths.clear();
  if (didChange) {
    invalidateExplorerSourceTreeCache();
  }
}

function getMyOrgResultSourceContent(item = {}) {
  return [
    item.content,
    item.body,
    item.Body,
    item.Markup,
    item.Source
  ].find((value) => typeof value === "string" && value.length > 0) || "";
}

function normalizeMyOrgObjectChildFullName(metadataApiType = "", fullName = "") {
  const text = String(fullName || "").trim();
  if (!text) {
    return "";
  }
  if (metadataApiType !== "CustomField") {
    return text;
  }
  const splitIndex = text.lastIndexOf(".");
  if (splitIndex < 0) {
    return text.replace(/_(c|pc|x|mdt)$/i, "__$1");
  }
  const objectName = text.slice(0, splitIndex);
  const fieldName = text.slice(splitIndex + 1).replace(/_(c|pc|x|mdt)$/i, "__$1");
  return `${objectName}.${fieldName}`;
}

function getSearchSummaryFullNameCandidate(entry = {}) {
  const content = String(entry.content || "");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => (
      !line.startsWith("#")
      && !/^Search:/i.test(line)
      && /^[A-Za-z0-9_.$-]+(?:\.[A-Za-z0-9_.$-]+)+$/.test(line)
    )) || "";
}

function getMyOrgSearchEntryIdentity(entry = {}) {
  const sourcePath = normalizeSearchResultSourcePath(entry);
  const metadataApiType = entry.metadataApiType || inferMetadataApiTypeFromSourcePath(sourcePath || "", entry.metadataType || "");
  const inferredFullName = inferMetadataFullNameFromSourcePath(sourcePath || "", entry.metadataType || "", metadataApiType);
  const entryName = String(entry.name || "").trim();
  const nameCandidate = /\.(xml|cls|trigger|page|component)$/i.test(entryName) ? "" : entryName;
  const namedFullName = entry.fullName
    || entry.metadataName
    || getSearchSummaryFullNameCandidate(entry)
    || nameCandidate
    || "";
  const fullName = normalizeMyOrgObjectChildFullName(
    metadataApiType,
    namedFullName || inferredFullName
  );
  return {
    metadataApiType,
    fullName
  };
}

function findMyOrgSourceResultForEntry(result = {}, entry = {}) {
  const entryPath = normalizeSearchResultSourcePath(entry);
  const identity = getMyOrgSearchEntryIdentity(entry);
  const fullName = String(identity.fullName || "").toLocaleLowerCase();
  const metadataApiType = String(identity.metadataApiType || "").toLocaleLowerCase();
  const results = Array.isArray(result.results) ? result.results : [];
  const exactMatch = results.find((item) => {
    const itemPath = normalizeSearchResultSourcePath(item);
    if (entryPath && itemPath === entryPath) {
      return true;
    }
    const itemFullName = String(item.fullName || item.FullName || item.name || "").toLocaleLowerCase();
    const itemMetadataApiType = String(item.metadataApiType || "").toLocaleLowerCase();
    return fullName && itemFullName === fullName && (!metadataApiType || !itemMetadataApiType || itemMetadataApiType === metadataApiType);
  }) || null;
  if (exactMatch) {
    return exactMatch;
  }
  return results.find((item) => getMyOrgResultSourceContent(item).length > 0) || null;
}

async function loadLocalSearchEntrySource(entry = {}) {
  const content = getMyOrgResultSourceContent(entry);
  if (content && entry.contentKind !== "search-summary") {
    return {
      item: entry,
      content
    };
  }

  if ((entry.contentKind === "search-summary" || hasInternalMyOrgResultSourceContent(entry)) && entry.metadataType) {
    const item = createLocalSearchMetadataItem(entry);
    const cacheKey = getLocalSearchMetadataCacheKey(entry);
    let detail = cacheKey ? getBoundedCacheValue(metadataDetailCache, cacheKey) : null;
    if (!detail) {
      detail = await getMetadataItemDetail(session.host, session.sid, entry.metadataType, item.id || item.key, {
        apiVersion: schemaStore?.apiVersion,
        record: item.record
      });
      setBoundedCacheValue(metadataDetailCache, cacheKey, detail, getMetadataDetailCacheLimit());
    }

    const sourceFiles = createMetadataSourceFiles(entry.metadataType, detail, item);
    const entryPath = normalizeMyOrgResultPath(entry.path || "");
    const sourceFile = sourceFiles.find((file) => normalizeMyOrgResultPath(file.path || "") === entryPath)
      || sourceFiles.find((file) => getSourceBaseName(file.path || "") === getSourceBaseName(entryPath))
      || sourceFiles.find((file) => !String(file.path || "").endsWith("-meta.xml"))
      || sourceFiles[0];
    if (sourceFile && typeof sourceFile.content === "string") {
      return {
        item: {
          ...entry,
          ...item.record,
          id: item.id || entry.recordId || "",
          name: item.apiName || entry.metadataName || entry.name || "",
          path: sourceFile.path || entry.path,
          metadataType: entry.metadataType,
          metadataApiType: entry.metadataApiType,
          fullName: item.record?.fullName || entry.fullName || item.apiName || "",
          apiVersion: item.record?.ApiVersion || entry.apiVersion || "",
          status: item.record?.Status || entry.status || "",
          deployInfo: sourceFile.deployInfo || null
        },
        content: sourceFile.content
      };
    }
  }

  if (!content) {
    throw new Error("This search result does not include source content. Open the result again after loading its metadata detail.");
  }

  return {
    item: entry,
    content
  };
}

function updateLocalSearchEntrySource(entry = {}, item = {}, content = "") {
  const path = normalizeSearchResultSourcePath(item) || normalizeSearchResultSourcePath(entry) || normalizeMyOrgResultPath(item.path || entry.path || "");
  if (!path) {
    return entry;
  }
  const metadataApiType = item.metadataApiType || entry.metadataApiType || inferMetadataApiTypeFromSourcePath(path, item.metadataType || entry.metadataType || "");
  const fullName = item.fullName
    || item.FullName
    || entry.fullName
    || inferMetadataFullNameFromSourcePath(path, item.metadataType || entry.metadataType || "", metadataApiType)
    || "";
  const updatedEntry = {
    ...entry,
    kind: "file",
    path,
    name: getSourceBaseName(path),
    parentPath: getParentSourcePath(path),
    content,
    recordId: item.id || entry.recordId || "",
    metadataType: item.metadataType || entry.metadataType || "",
    typeLabel: item.typeLabel || entry.typeLabel || "",
    metadataApiType,
    metadataName: item.name || entry.metadataName || fullName || "",
    label: item.label || entry.label || "",
    fullName,
    fileName: item.fileName || entry.fileName || getRelativeMetadataFileName(path),
    apiVersion: item.apiVersion || entry.apiVersion || "",
    status: item.status || entry.status || "",
    namespacePrefix: item.namespacePrefix || entry.namespacePrefix || "",
    lastModifiedDate: item.lastModifiedDate || entry.lastModifiedDate || "",
    deployInfo: createMyOrgSearchDeployInfo(item.metadataType || entry.metadataType || "", item.id || entry.recordId || ""),
    contentKind: "source"
  };
  if (entry.path && entry.path !== path) {
    localSourceEntries.delete(entry.path);
    searchDetailEntryCache.delete(entry.path);
  }
  localSourceEntries.set(path, updatedEntry);
  if (selectedNode?.type === "localFile" && selectedNode.sourcePath === entry.path && entry.path !== path) {
    selectedNode = {
      ...selectedNode,
      sourcePath: path
    };
  }
  if (myOrgSearchLocalPaths.has(entry.path || path)) {
    myOrgSearchLocalPaths.delete(entry.path || path);
    myOrgSearchLocalPaths.add(path);
  }
  return updatedEntry;
}

function createMyOrgSearchDeployInfo(metadataType = "", recordId = "") {
  const id = String(recordId || "").trim();
  if (!id) {
    return null;
  }

  const deployTargets = {
    apexClasses: { sobject: "ApexClass", field: "Body" },
    apexTriggers: { sobject: "ApexTrigger", field: "Body" },
    apexPages: { sobject: "ApexPage", field: "Markup" },
    apexComponents: { sobject: "ApexComponent", field: "Markup" },
    lwcBundles: { sobject: "LightningComponentResource", field: "Source" },
    auraBundles: { sobject: "AuraDefinition", field: "Source" }
  };
  const target = deployTargets[metadataType];
  return target
    ? {
      kind: "toolingSource",
      sobject: target.sobject,
      id,
      field: target.field
    }
    : null;
}

function isFolderOnlyPathSearchMatch(value = "", term = activeSearchTerm) {
  const text = normalizeMyOrgResultPath(value);
  const needle = String(term || "").trim().toLocaleLowerCase();
  if (!text || !needle || !text.includes("/")) {
    return false;
  }

  return text.toLocaleLowerCase().includes(needle)
    && !getSourceBaseName(text).toLocaleLowerCase().includes(needle);
}

function applySchemaUiSettings() {
  document.body.classList.remove("schema-theme-dark");
  document.body.classList.add("schema-theme-light");
}

function getStoredSidebarWidth() {
  return Number.isFinite(storedSidebarWidth) ? storedSidebarWidth : 0;
}

// The divider now sizes the file-details column from the right; the tree takes
// whatever is left. The stored preference keeps its key so existing values are
// reused rather than discarded on upgrade.
function setSidebarWidth(width, options = {}) {
  if (!schemaWorkbenchEl) {
    return;
  }

  const workbenchWidth = schemaWorkbenchEl.getBoundingClientRect().width;
  const dividerWidth = schemaColumnResizerEl?.getBoundingClientRect?.().width || 7;
  const availableWidth = Math.max(0, workbenchWidth - dividerWidth);
  // The detail pane is on the right. Keeping it between 30% and 70% means
  // either the explorer or detail side can occupy up to 70% of the workspace.
  const minWidth = availableWidth * 0.3;
  const maxWidth = availableWidth * 0.7;
  const nextWidth = Math.min(Math.max(width, minWidth), maxWidth);
  schemaWorkbenchEl.style.setProperty("--schema-detail-width", `${Math.round(nextWidth)}px`);
  storedSidebarWidth = Math.round(nextWidth);
  // localStorage writes are synchronous, so persisting on every pointermove
  // stutters the drag. The live drag skips it and the drag end stores once.
  if (options.persist !== false) {
    void setRuntimePreferenceValue(SCHEMA_SIDEBAR_WIDTH_STORAGE_KEY, storedSidebarWidth).catch(() => {});
  }
}

function getDetailPanelWidth() {
  return schemaDetailEl?.getBoundingClientRect?.().width || 430;
}

function initializeSidebarResizer() {
  const storedWidth = getStoredSidebarWidth();
  if (storedWidth) {
    setSidebarWidth(storedWidth);
  }

  if (!schemaWorkbenchEl || !schemaColumnResizerEl) {
    return;
  }

  let dragStartX = 0;
  let dragStartWidth = 0;

  function stopResize(pointerId) {
    const wasDragging = schemaColumnResizerEl.classList.contains("dragging");
    schemaColumnResizerEl.classList.remove("dragging");
    document.body.classList.remove("schema-resizing-columns");
    if (wasDragging) {
      setSidebarWidth(getDetailPanelWidth());
    }
    try {
      schemaColumnResizerEl.releasePointerCapture(pointerId);
    } catch (_error) {
      // Pointer capture can already be released by the browser.
    }
  }

  schemaColumnResizerEl.addEventListener("pointerdown", (event) => {
    dragStartX = event.clientX;
    dragStartWidth = getDetailPanelWidth();
    schemaColumnResizerEl.classList.add("dragging");
    document.body.classList.add("schema-resizing-columns");
    schemaColumnResizerEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  schemaColumnResizerEl.addEventListener("pointermove", (event) => {
    if (!schemaColumnResizerEl.classList.contains("dragging")) {
      return;
    }

    // Dragging left widens the details column.
    setSidebarWidth(dragStartWidth - (event.clientX - dragStartX), { persist: false });
  });

  schemaColumnResizerEl.addEventListener("pointerup", (event) => stopResize(event.pointerId));
  schemaColumnResizerEl.addEventListener("pointercancel", (event) => stopResize(event.pointerId));
  schemaColumnResizerEl.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    setSidebarWidth(getDetailPanelWidth() + (event.key === "ArrowLeft" ? 24 : -24));
    event.preventDefault();
  });
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────
// Continues from the <h1> app title, so it renders path segments only. The
// force-app/main/default wrappers are transparent in the tree and dropped here
// for the same reason.
function renderSchemaBreadcrumb(sourcePath = "") {
  if (!schemaBreadcrumbEl) {
    return;
  }

  const fullPath = normalizeSourcePath(sourcePath);
  // The wrappers render no tree row, so they get no crumb either. Selecting
  // one of them (the startup selection is the project root) shows no path.
  const segments = isLegacySourceRootPath(fullPath)
    ? []
    : stripDefaultSourcePrefix(fullPath).split("/").filter(Boolean);
  // Crumb paths are rebuilt from the original path, not re-derived from the
  // trimmed segments: only paths that actually sat under force-app/main/default
  // get that wrapper back. Re-adding it unconditionally sent paths outside it
  // (manifest/package.xml and friends) to a folder that does not exist.
  const fullSegments = fullPath.split("/").filter(Boolean);
  const strippedSegmentCount = fullSegments.length - segments.length;

  const parts = [];
  segments.forEach((segment, index) => {
    const separator = document.createElement("span");
    separator.className = "schema-crumb-sep";
    separator.textContent = "›";
    parts.push(separator);

    const isLast = index === segments.length - 1;
    // Crumbs navigate the tree on the left: clicking one reveals and selects
    // that folder, so the header and the explorer stay in step.
    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = isLast ? "schema-crumb schema-crumb-current" : "schema-crumb";
    crumb.textContent = segment;
    const crumbPath = fullSegments.slice(0, strippedSegmentCount + index + 1).join("/");
    crumb.title = crumbPath;
    crumb.addEventListener("click", () => {
      setSidebarTab("explorer");
      revealSourcePathInExplorer(crumbPath);
    });
    parts.push(crumb);
  });

  schemaBreadcrumbEl.replaceChildren(...parts);
  schemaBreadcrumbEl.title = segments.length ? fullPath : "";
}

// ── File details panel: docked, collapsible from the rail ──────────────────
function setDetailsCollapsed(collapsed, options = {}) {
  detailsCollapsed = collapsed === true;
  schemaShellEl?.classList.toggle("details-collapsed", detailsCollapsed);
  schemaDetailsToggleEl?.setAttribute("aria-expanded", String(!detailsCollapsed));
  if (options.persist !== false) {
    void setRuntimePreferenceValue(SCHEMA_DETAILS_COLLAPSED_STORAGE_KEY, detailsCollapsed).catch(() => {});
  }
}

function initializeDetailsToggle() {
  setDetailsCollapsed(detailsCollapsed, { persist: false });
  schemaDetailsToggleEl?.addEventListener("click", () => {
    setDetailsCollapsed(!detailsCollapsed);
  });
}

function syncOutboundChangeSetControls() {
  if (schemaChangeSetsRefreshEl) {
    schemaChangeSetsRefreshEl.disabled = outboundChangeSetsLoading
      || outboundChangeSetSourceLoading;
  }
}

function setOutboundChangeSetSummary(message, isError = false) {
  if (!outboundChangeSetSummaryEl) return;
  outboundChangeSetSummaryEl.textContent = message;
  outboundChangeSetSummaryEl.classList.toggle("error", isError);
}

function renderOutboundChangeSetSourceDetail(file = null) {
  if (!file) {
    renderEmptyDetail(t("schema.changeSetSelect"));
    return;
  }
  const title = createDetailTitle(
    file.path.split("/").pop() || file.path,
    file.path,
    selectedOutboundChangeSetName,
    "file"
  );
  if (file.binary) {
    const message = document.createElement("p");
    message.className = "schema-detail-empty";
    message.textContent = t("schema.changeSetBinarySource");
    schemaDetailEl.replaceChildren(title, message);
    return;
  }
  const sourceFiles = document.createElement("div");
  sourceFiles.className = "schema-source-files";
  sourceFiles.appendChild(createSourceFileElement({ ...file, readOnly: true }));
  schemaDetailEl.replaceChildren(title, sourceFiles);
}

function renderOutboundChangeSetSourceList() {
  if (!outboundChangeSetSourceListEl) return;
  const files = outboundChangeSetSource?.files || [];
  if (!files.length) {
    outboundChangeSetSourceListEl.replaceChildren();
    return;
  }
  outboundChangeSetSourceListEl.replaceChildren(...files.map((file) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "schema-change-set-source-row";
    row.classList.toggle("selected", file.path === selectedOutboundChangeSetSourcePath);
    const path = document.createElement("span");
    path.className = "schema-change-set-source-path";
    path.textContent = file.path;
    const size = document.createElement("span");
    size.className = "schema-change-set-source-size";
    size.textContent = file.binary
      ? t("schema.changeSetBinary")
      : t("schema.changeSetSourceBytes", { count: file.size });
    row.append(path, size);
    row.addEventListener("click", () => {
      selectedOutboundChangeSetSourcePath = file.path;
      renderOutboundChangeSetSourceList();
      renderOutboundChangeSetSourceDetail(file);
    });
    return row;
  }));
}

function clearOutboundChangeSetSelection(options = {}) {
  outboundChangeSetRequestId += 1;
  selectedOutboundChangeSetName = "";
  selectedOutboundChangeSetSourcePath = "";
  outboundChangeSetSource = null;
  outboundChangeSetSourceLoading = false;
  setOutboundChangeSetSummary(t("schema.changeSetSelect"));
  if (options.render !== false) {
    renderOutboundChangeSets();
    renderOutboundChangeSetSourceList();
    if (activeSidebarTab === "changeSets") {
      renderEmptyDetail(t("schema.changeSetSelect"));
    }
  }
  syncOutboundChangeSetControls();
}

function renderOutboundChangeSets(message = "") {
  if (!schemaChangeSetListEl) {
    return;
  }
  if (message) {
    const empty = document.createElement("p");
    empty.className = "schema-change-set-empty";
    empty.textContent = message;
    schemaChangeSetListEl.replaceChildren(empty);
  } else {
    const rows = outboundChangeSets.map((changeSet) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "schema-change-set-row";
      row.classList.toggle("selected", changeSet.name === selectedOutboundChangeSetName);
      row.setAttribute("aria-pressed", String(changeSet.name === selectedOutboundChangeSetName));
      row.disabled = outboundChangeSetSourceLoading;

      const name = document.createElement("span");
      name.className = "schema-change-set-row-name";
      name.textContent = changeSet.name;
      const status = document.createElement("span");
      status.className = "schema-change-set-row-status";
      status.textContent = changeSet.status;
      const modified = document.createElement("span");
      modified.className = "schema-change-set-row-modified";
      modified.textContent = changeSet.modifiedDate || changeSet.modifiedBy
        ? t("schema.changeSetModified", {
          date: changeSet.modifiedDate || "—",
          user: changeSet.modifiedBy || "—"
        })
        : changeSet.description;
      row.append(name, status, modified);
      row.addEventListener("click", () => void selectOutboundChangeSet(changeSet.name));
      return row;
    });
    schemaChangeSetListEl.replaceChildren(...rows);
  }

  const count = outboundChangeSets.length;
  if (schemaChangeSetCountEl) {
    schemaChangeSetCountEl.textContent = String(count);
    schemaChangeSetCountEl.hidden = count === 0;
  }
  syncOutboundChangeSetControls();
}

async function loadOutboundChangeSets(options = {}) {
  if (!session?.host || !session?.sid || outboundChangeSetsLoading) {
    return;
  }
  if (outboundChangeSetsLoaded && options.force !== true) {
    renderOutboundChangeSets(outboundChangeSets.length ? "" : t("schema.changeSetsEmpty"));
    return;
  }
  if (options.force === true) {
    clearOutboundChangeSetSelection();
  }
  outboundChangeSetsLoading = true;
  renderOutboundChangeSets(t("schema.changeSetsLoading"));
  try {
    outboundChangeSets = await listOutboundChangeSets(session.host, session.sid, { timeoutMs: 15000 });
    outboundChangeSetsLoaded = true;
    renderOutboundChangeSets(outboundChangeSets.length ? "" : t("schema.changeSetsEmpty"));
    setStatus(t("schema.changeSetsLoaded", { count: outboundChangeSets.length }));
  } catch (error) {
    outboundChangeSets = [];
    outboundChangeSetsLoaded = false;
    const message = error instanceof Error ? error.message : String(error);
    renderOutboundChangeSets(message);
    setStatus(message, true);
  } finally {
    outboundChangeSetsLoading = false;
    syncOutboundChangeSetControls();
  }
}

async function selectOutboundChangeSet(packageName = "") {
  if (!session?.host || !session?.sid || !packageName || outboundChangeSetSourceLoading) {
    return;
  }
  outboundChangeSetRequestId += 1;
  const requestId = outboundChangeSetRequestId;
  selectedOutboundChangeSetName = packageName;
  selectedOutboundChangeSetSourcePath = "";
  outboundChangeSetSource = null;
  outboundChangeSetSourceLoading = true;
  setOutboundChangeSetSummary(t("schema.changeSetSourceLoading", { name: packageName }));
  renderOutboundChangeSets();
  renderOutboundChangeSetSourceList();
  syncOutboundChangeSetControls();
  try {
    setStatus(t("schema.changeSetSourceLoading", { name: packageName }));
    const result = await retrieveMetadataNamedPackageZip(session.host, session.sid, packageName, {
      apiVersion: schemaStore?.apiVersion || SALESFORCE_API_VERSION,
      onProgress(progress) {
        if (requestId === outboundChangeSetRequestId) {
          setOutboundChangeSetSummary(`${packageName}: ${progress.status || "Queued"} (${progress.attempt}/${progress.maxPolls})`);
        }
      }
    });
    const source = await readMetadataSourceZip(result.blob);
    if (requestId !== outboundChangeSetRequestId || selectedOutboundChangeSetName !== packageName) return;
    outboundChangeSetSource = source;
    selectedOutboundChangeSetSourcePath = source.files.find((file) => !file.binary)?.path || "";
    const message = t("schema.changeSetSourceLoaded", { name: packageName, count: source.files.length });
    setOutboundChangeSetSummary(message);
    setStatus(message);
    renderOutboundChangeSetSourceList();
    const selectedFile = source.files.find((file) => file.path === selectedOutboundChangeSetSourcePath) || null;
    if (activeSidebarTab === "changeSets") {
      renderOutboundChangeSetSourceDetail(selectedFile);
    }
  } catch (error) {
    if (requestId !== outboundChangeSetRequestId) return;
    const message = error instanceof Error ? error.message : String(error);
    setOutboundChangeSetSummary(t("schema.changeSetSourceFailed", { name: packageName, message }), true);
    setStatus(message, true);
  } finally {
    if (requestId === outboundChangeSetRequestId) {
      outboundChangeSetSourceLoading = false;
      renderOutboundChangeSets();
      syncOutboundChangeSetControls();
    }
  }
}

function setSidebarTab(activeTab) {
  const previousSidebarTab = activeSidebarTab;
  activeSidebarTab = activeTab;
  const tabs = [
    ["explorer", explorerTabButton, explorerTabPanel],
    ...(!isMetadataFolderReadOnly ? [["changed", changedTabButton, changedTabPanel]] : []),
    ["package", packageTabButton, packageTabPanel],
    ["changeSets", schemaChangeSetsTabEl, schemaChangeSetsPanelEl],
    ["search", searchTabButton, searchTabPanel]
  ].filter(([, button, panel]) => button && panel);

  if (!tabs.some(([tabName]) => tabName === activeTab)) {
    activeTab = "explorer";
    activeSidebarTab = activeTab;
  }
  if (previousSidebarTab === "changeSets" && activeTab !== "changeSets") {
    clearOutboundChangeSetSelection({ render: false });
  }
  tabs.forEach(([tabName, button, panel]) => {
    const isActive = activeTab === tabName;
    button?.classList.toggle("active", isActive);
    button?.setAttribute("aria-selected", String(isActive));
    if (panel) {
      panel.hidden = !isActive;
      panel.classList.toggle("active", isActive);
    }
  });

  packageSelectionTreeDirty = true;

  if (activeSidebarTab === "explorer") {
    const didRevealSelectedFile = previousSidebarTab !== "explorer" && revealSelectedSourcePathInExplorer();
    renderSchema({
      renderDetail: !didRevealSelectedFile,
      scrollSelectedIntoView: didRevealSelectedFile
    });
    void ensureFilesTabWorkspaceFoldersLoaded();
  } else if (activeSidebarTab === "search" && hasSearchSidebarTab()) {
    renderBodySearchPanel();
  } else if (activeSidebarTab === "changed") {
    renderChangedFilesList();
  } else if (activeSidebarTab === "package") {
    renderPackageXmlTree();
  } else if (activeSidebarTab === "changeSets") {
    renderOutboundChangeSets(outboundChangeSets.length ? "" : t("schema.changeSetsLoading"));
    renderOutboundChangeSetSourceList();
    const selectedFile = outboundChangeSetSource?.files?.find(
      (file) => file.path === selectedOutboundChangeSetSourcePath
    ) || null;
    renderOutboundChangeSetSourceDetail(selectedFile);
    void loadOutboundChangeSets();
  }
}

function getSelectedMetadataTypeIds() {
  return [];
}

function updateMetadataSelectionState() {
  const selectedCount = selectedPackageMembers.size || getSelectedMetadataTypeIds().length;

  if (retrieveMetadataButton) {
    retrieveMetadataButton.disabled = metadataActionInProgress || !session?.sid || selectedCount === 0;
  }
  if (clearSchemaButton) {
    clearSchemaButton.disabled = metadataActionInProgress || !session?.host;
  }
  if (reloadFolderTreeButton) {
    reloadFolderTreeButton.disabled = metadataActionInProgress || !session?.sid;
  }
  updateSearchRunButtonState();
}

function renderMetadataSelectionIfVisible(options = {}) {
  packageSelectionTreeDirty = true;
  updateMetadataSelectionState({
    ...options,
    renderManifest: false
  });
}

function getAvailableMetadataType(metadataTypeId) {
  return availableMetadataTypes.find((metadataType) => metadataType.id === metadataTypeId);
}

function isInlineMetadataFolderSelector() {
  return Boolean(
    searchMetadataTypesMenuEl?.closest(".schema-toolbar-controls")
    || searchMetadataTypesMenuEl?.closest(".schema-metadata-folder-controls")
  );
}

function getSearchMetadataTypeCandidates() {
  const workspaceFolderNames = getWorkspaceFolderNameSet();
  return availableMetadataTypes
    .filter((metadataType) => (
      metadataType?.id
      && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataType.id)
      && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataType.metadataObject)
      && workspaceFolderNames.has(getSourceFolderForMetadataDefinition(metadataType))
    ))
    .sort((left, right) => (
      String(getSourceFolderForMetadataDefinition(left)).localeCompare(String(getSourceFolderForMetadataDefinition(right)), undefined, { sensitivity: "base" })
      || String(left.label || left.id).localeCompare(String(right.label || right.id), undefined, { sensitivity: "base" })
    ));
}

function getValidSearchMetadataTypeIds(metadataTypeIds = []) {
  const candidateIds = new Set(getSearchMetadataTypeCandidates().map((metadataType) => metadataType.id));
  return [...new Set(metadataTypeIds)]
    .map((metadataTypeId) => String(metadataTypeId || "").trim())
    .filter((metadataTypeId) => metadataTypeId && candidateIds.has(metadataTypeId))
    .slice(0, getSearchMetadataTypeSelectionLimit());
}

function getDefaultSearchMetadataTypeIds() {
  const defaultIds = getValidSearchMetadataTypeIds(DEFAULT_SEARCH_METADATA_TYPE_IDS);
  return defaultIds.length
    ? defaultIds
    : getSearchMetadataTypeCandidates().map((metadataType) => metadataType.id);
}

function getSelectedSearchMetadataTypeIds() {
  const selectedFolderNames = new Set(getSelectedSearchFolderNames());
  return availableMetadataTypes
    .filter((metadataType) => (
      selectedFolderNames.has(getSourceFolderForMetadataDefinition(metadataType))
      && isRetrievableFolderMetadataType(metadataType.id)
    ))
    .map((metadataType) => metadataType.id)
    .filter(Boolean);
}

function getSelectedSearchMetadataTypeSet() {
  return new Set(getSelectedSearchMetadataTypeIds());
}

function getRetrievedMetadataTypeSet() {
  return new Set((schemaStore?.metadataTypes || []).filter(Boolean));
}

function isRetrievableFolderMetadataType(metadataTypeId = "") {
  const metadataType = getAvailableMetadataType(metadataTypeId) || {};
  return Boolean(metadataTypeId)
    && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataTypeId)
    && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataType.metadataObject);
}

function getMetadataFolderSelectionTypeIds(folderName = "") {
  return getMetadataTypesForSourceFolder(folderName)
    .filter((metadataTypeId) => isRetrievableFolderMetadataType(metadataTypeId));
}

function getMetadataFolderSelectionEntries() {
  return createDefaultMetadataFolderCache(availableMetadataTypes)
    .map((folder) => ({
      ...folder,
      metadataTypeIds: getMetadataFolderSelectionTypeIds(folder.name)
    }))
    .filter((folder) => folder.metadataTypeIds.length > 0);
}

function getRetrievedMetadataFolderNameSet() {
  const retrievedTypes = getRetrievedMetadataTypeSet();
  const folderNames = getMetadataFolderSelectionEntries()
    .filter((folder) => folder.metadataTypeIds.some((metadataTypeId) => retrievedTypes.has(metadataTypeId)))
    .map((folder) => folder.name)
    .filter(Boolean);
  return new Set(folderNames);
}

function isMetadataFolderFullyRetrieved(folder = {}) {
  const retrievedTypes = getRetrievedMetadataTypeSet();
  const metadataTypeIds = folder.metadataTypeIds || getMetadataFolderSelectionTypeIds(folder.name);
  return metadataTypeIds.length > 0 && metadataTypeIds.every((metadataTypeId) => retrievedTypes.has(metadataTypeId));
}

function isMetadataFolderPartiallyRetrieved(folder = {}) {
  const retrievedTypes = getRetrievedMetadataTypeSet();
  const metadataTypeIds = folder.metadataTypeIds || getMetadataFolderSelectionTypeIds(folder.name);
  return metadataTypeIds.some((metadataTypeId) => retrievedTypes.has(metadataTypeId))
    && !isMetadataFolderFullyRetrieved(folder);
}

function isSearchMetadataTypeSelected(metadataTypeId = "") {
  if (!metadataTypeId) {
    return true;
  }

  if (isInlineMetadataFolderSelector()) {
    return getRetrievedMetadataTypeSet().has(metadataTypeId);
  }

  return getSelectedSearchMetadataTypeSet().has(metadataTypeId);
}

function getSearchMetadataTypeAliases(metadataTypeId = "") {
  return SEARCH_METADATA_TYPE_ALIASES_BY_ID[metadataTypeId] || [];
}

function getMetadataTypeSearchValues(metadataType = {}) {
  return [
    metadataType.label,
    metadataType.id,
    metadataType.itemLabel,
    metadataType.xmlName,
    metadataType.metadataObject,
    metadataType.directoryName,
    metadataType.sourceFolder,
    ...getSearchMetadataTypeAliases(metadataType.id)
  ].filter(Boolean);
}

function getNodeSearchMetadataTypeIds(node = {}) {
  const ids = [];
  if (node.selection?.metadataType) {
    ids.push(node.selection.metadataType);
  }
  ids.push(...getMetadataTypesForSourcePath(node.path || node.selection?.sourcePath || ""));
  return [...new Set(ids.filter(Boolean))];
}

function sourceNodeMatchesSearchMetadataTypes(node = {}) {
  if (!hasActiveSearch()) {
    return true;
  }

  const metadataTypeIds = getNodeSearchMetadataTypeIds(node);
  if (metadataTypeIds.length) {
    return metadataTypeIds.some((metadataTypeId) => isSearchMetadataTypeSelected(metadataTypeId));
  }

  return !isForceAppSourcePath(node.path || node.selection?.sourcePath || "");
}

function updateSearchMetadataTypesSummary() {
  if (!searchMetadataTypesSummaryEl) {
    return;
  }

  const selectedCount = getSelectedSearchFolderNames().length;
  const totalCount = getSearchFolderCandidates().length;
  const label = "Search Folders";
  searchMetadataTypesSummaryEl.textContent = selectedCount === 0
    ? `${label}: None`
    : `${label}: ${selectedCount}/${totalCount}`;
}

function setSearchMetadataTypeSelection(metadataTypeIds = [], options = {}) {
  schemaUiSettings = {
    ...schemaUiSettings,
    searchMetadataTypes: getValidSearchMetadataTypeIds(metadataTypeIds)
  };
  saveSchemaUiSettings();
  if (options.renderSelector === false) {
    updateSearchMetadataTypesSummary();
  } else {
    renderSearchMetadataTypeSelector();
  }

  if (hasActiveSearch()) {
    clearSearchDetailCaches();
    setStatus(t("schemaStatus.metadataTypeChanged"));
    setSchemaSummary(t("schemaStatus.metadataTypeChanged"));
  }
}

function setSearchFolderSelection(folderNames = [], options = {}) {
  schemaUiSettings = {
    ...schemaUiSettings,
    searchFolderDefaults: getValidSearchFolderNames(folderNames)
  };
  saveSchemaUiSettings();
  invalidateFolderSearchCache();
  if (options.renderSelector === false) {
    updateSearchMetadataTypesSummary();
  } else {
    renderSearchMetadataTypeSelector();
  }

  if (schemaFolderSearchTerm) {
    if (activeSidebarTab === "search") {
      renderSearchPanel();
    }
    setStatus(t("schemaStatus.searchFolderChanged"));
    setSchemaSummary(t("schemaStatus.searchFolderChangedClickSearch"));
  }
}

function createSearchFolderActionButton(label, folderNames) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-search-type-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSearchFolderSelection(folderNames);
  });
  return button;
}

function createSearchMetadataTypeActionButton(label, metadataTypeIds) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-search-type-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSearchMetadataTypeSelection(metadataTypeIds);
  });
  return button;
}

function getSearchMetadataTypeFilterValues(metadataType = {}) {
  const sourceFolder = getSourceFolderForMetadataDefinition(metadataType);
  return [
    sourceFolder,
    metadataType.directoryName,
    metadataType.sourceFolder,
    metadataType.label,
    metadataType.id,
    metadataType.itemLabel,
    metadataType.xmlName,
    metadataType.metadataObject,
    ...getSearchMetadataTypeAliases(metadataType.id)
  ].filter(Boolean);
}

function metadataTypeMatchesFilter(searchText = "", filterText = searchMetadataTypeFilterText) {
  const needle = String(filterText || "").trim().toLocaleLowerCase();
  if (!needle) {
    return true;
  }

  return String(searchText || "").toLocaleLowerCase().includes(needle);
}

function applySearchMetadataTypeFilter() {
  const filterText = searchMetadataTypeFilterText;
  [searchMetadataTypesOptionsEl, workspaceFoldersOptionsEl].forEach((optionsEl) => {
    optionsEl?.querySelectorAll(".schema-search-type-option").forEach((option) => {
      const isSelected = option.dataset.selected === "true" || option.querySelector("input")?.checked;
      option.hidden = !isSelected && !metadataTypeMatchesFilter(option.dataset.metadataTypeSearchText, filterText);
    });
  });
}

function updateSearchMetadataTypeFilter(value = "") {
  searchMetadataTypeFilterText = value;
  applySearchMetadataTypeFilter();
}

function createSearchMetadataTypeFilterInput() {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-search-type-filter";
  input.placeholder = t("schemaUi.filterNameOrLabel");
  input.setAttribute("aria-label", t("schemaUi.filterTypesAria"));
  input.value = searchMetadataTypeFilterText;
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      event.stopPropagation();
    }
  });
  input.addEventListener("input", () => updateSearchMetadataTypeFilter(input.value));
  input.addEventListener("search", () => updateSearchMetadataTypeFilter(input.value));
  return input;
}

function createMetadataFolderSelectionActionButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-search-type-action";
  button.textContent = label;
  button.disabled = metadataActionInProgress;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  return button;
}

function setAllMetadataFolderDefaultsSelected() {
  const folderNames = getMetadataFolderSelectionEntries()
    .map((folder) => folder.name)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  schemaUiSettings = {
    ...schemaUiSettings,
    metadataFolderDefaults: getValidDefaultMetadataFolderNames(folderNames, { fallbackToStartup: false })
  };
  syncSearchSelectionsToWorkspace();
  saveSchemaUiSettings();
  invalidateFolderSearchCache();
  renderWorkspaceSettingsSelectors();
  updateMetadataSelectionState({ renderManifest: false });
  setStatus(t("schemaStatus.selectedAllFolders"));
  setSchemaSummary(t("schemaStatus.selectedAllFolders"));
}

function setCommonMetadataFolderDefaultsSelected() {
  const commonFolderNames = getValidDefaultMetadataFolderNames(getStartupCommonMetadataFolders(), {
    fallbackToStartup: false
  });
  schemaUiSettings = {
    ...schemaUiSettings,
    metadataFolderDefaults: commonFolderNames
  };
  syncSearchSelectionsToWorkspace();
  saveSchemaUiSettings();
  invalidateFolderSearchCache();
  renderWorkspaceSettingsSelectors();
  updateMetadataSelectionState({ renderManifest: false });
  setStatus(t("schemaStatus.selectedCommonFolders"));
  setSchemaSummary(t("schemaStatus.selectedCommonFolders"));
}

function clearAllMetadataFolderDefaultsSelected() {
  schemaUiSettings = {
    ...schemaUiSettings,
    metadataFolderDefaults: []
  };
  syncSearchSelectionsToWorkspace();
  saveSchemaUiSettings();
  invalidateFolderSearchCache();

  renderWorkspaceSettingsSelectors();
  updateMetadataSelectionState({ renderManifest: false });
  renderMetadataSelectionIfVisible({ renderManifest: false });
  setStatus(t("schemaStatus.clearedFolderSelection"));
  setSchemaSummary(t("schemaStatus.clearedFolderSelectionReload"));
}

function setMetadataFolderRetrieved(folder = {}, shouldRetrieve = false) {
  const folderName = folder.name || "";
  if (!folderName) {
    setStatus(t("schemaStatus.noFolderSelected"), true);
    renderSearchMetadataTypeSelector();
    return;
  }

  setDefaultMetadataFolderSelected(folderName, shouldRetrieve);
  renderWorkspaceSettingsSelectors();
  renderMetadataSelectionIfVisible({ renderManifest: false });
  updateMetadataSelectionState({ renderManifest: false });
  const actionText = shouldRetrieve ? "Added" : "Removed";
  setStatus(t("schemaStatus.folderAction", { action: actionText, folder: folderName, direction: t(shouldRetrieve ? "schemaStatus.retrievedTo" : "schemaStatus.retrievedFrom") }));
  setSchemaSummary(t("schemaStatus.workspaceFolderChanged"));
}

function renderMetadataFolderSelector() {
  const folders = getMetadataFolderSelectionEntries();
  const retrievedFolderNames = getRetrievedMetadataFolderNameSet();
  const defaultFolderNames = new Set(getDefaultMetadataFolderNames());
  searchMetadataTypesOptionsEl.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "schema-search-type-actions";
  actions.append(
    createMetadataFolderSelectionActionButton("All", setAllMetadataFolderDefaultsSelected),
    createMetadataFolderSelectionActionButton("Common", setCommonMetadataFolderDefaultsSelected),
    createMetadataFolderSelectionActionButton("Clear", clearAllMetadataFolderDefaultsSelected),
    createSearchMetadataTypeFilterInput()
  );
  searchMetadataTypesOptionsEl.appendChild(actions);

  const list = document.createElement("div");
  list.className = "schema-search-type-list";
  const orderedFolders = [
    ...folders.filter((folder) => retrievedFolderNames.has(folder.name) || defaultFolderNames.has(folder.name)),
    ...folders.filter((folder) => !retrievedFolderNames.has(folder.name) && !defaultFolderNames.has(folder.name))
  ];

  orderedFolders.forEach((folder) => {
    const isDefault = defaultFolderNames.has(folder.name);
    const isSelected = isDefault;
    const filterText = [
      folder.name,
      folder.label,
      ...folder.metadataTypes.flatMap((metadataType) => [
        metadataType.id,
        metadataType.label,
        metadataType.itemLabel,
        metadataType.metadataApiType,
        metadataType.directoryName
      ])
    ].filter(Boolean).join(" ");

    const label = document.createElement("label");
    label.className = "schema-search-type-option";
    label.dataset.metadataTypeId = folder.metadataTypeIds.join(",");
    label.dataset.metadataTypeLabel = folder.label || "";
    label.dataset.metadataTypeFolder = folder.name || "";
    label.dataset.metadataTypeSearchText = filterText;
    label.dataset.selected = isSelected ? "true" : "false";
    label.classList.toggle("selected", isSelected);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = folder.name || "";
    checkbox.checked = isSelected;
    checkbox.indeterminate = !isSelected && isMetadataFolderPartiallyRetrieved(folder);
    checkbox.disabled = metadataActionInProgress || folderRetrieveInProgress.has(folder.path || `${SOURCE_DEFAULT_PREFIX}${folder.name}`);
    checkbox.addEventListener("change", () => {
      label.dataset.selected = checkbox.checked ? "true" : "false";
      label.classList.toggle("selected", checkbox.checked);
      void setMetadataFolderRetrieved(folder, checkbox.checked);
    });

    const text = document.createElement("span");
    text.className = "schema-search-type-option-text";
    const primary = document.createElement("span");
    primary.className = "schema-search-type-option-primary";
    primary.textContent = folder.name || "folder";
    const secondary = document.createElement("span");
    secondary.className = "schema-search-type-option-secondary";
    secondary.textContent = [
      folder.label || `${folder.metadataTypeIds.length} metadata type${folder.metadataTypeIds.length === 1 ? "" : "s"}`,
      isDefault ? "default" : ""
    ].filter(Boolean).join(" · ");
    text.append(primary, secondary);

    label.append(checkbox, text);
    list.appendChild(label);
  });
  searchMetadataTypesOptionsEl.appendChild(list);
  applySearchMetadataTypeFilter();
  updateSearchMetadataTypesSummary();
}

function renderSearchMetadataTypeSelector() {
  if (!searchMetadataTypesOptionsEl) {
    return;
  }

  const candidates = getSearchFolderCandidates();
  const selectedFolderNames = new Set(getSelectedSearchFolderNames());
  searchMetadataTypesOptionsEl.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "schema-search-type-actions";
  actions.append(
    createSearchFolderActionButton("All", candidates.map((folder) => folder.name)),
    createSearchFolderActionButton("Clear", []),
    createSearchMetadataTypeFilterInput()
  );
  searchMetadataTypesOptionsEl.appendChild(actions);

  const list = document.createElement("div");
  list.className = "schema-search-type-list";
  if (!candidates.length) {
    const empty = document.createElement("div");
    empty.className = "schema-search-type-empty";
    empty.textContent = t("schemaUi.noFoldersSelected");
    list.appendChild(empty);
  }

  const orderedCandidates = [
    ...candidates.filter((folder) => selectedFolderNames.has(folder.name)),
    ...candidates.filter((folder) => !selectedFolderNames.has(folder.name))
  ];
  orderedCandidates.forEach((folder) => {
    const filterText = [
      folder.name,
      folder.label,
      ...folder.metadataTypes.flatMap((metadataType) => [
        metadataType.id,
        metadataType.label,
        metadataType.itemLabel,
        metadataType.metadataApiType,
        metadataType.directoryName
      ])
    ].filter(Boolean).join(" ");
    const label = document.createElement("label");
    label.className = "schema-search-type-option";
    label.dataset.metadataTypeId = (folder.metadataTypeIds || []).join(",");
    label.dataset.metadataTypeLabel = folder.label || "";
    label.dataset.metadataTypeFolder = folder.name || "";
    label.dataset.metadataTypeSearchText = filterText;
    label.dataset.selected = selectedFolderNames.has(folder.name) ? "true" : "false";
    label.classList.toggle("selected", selectedFolderNames.has(folder.name));

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = folder.name || "";
    checkbox.checked = selectedFolderNames.has(folder.name);
    checkbox.addEventListener("change", () => {
      const nextFolderNames = new Set(getSelectedSearchFolderNames());
      if (checkbox.checked) {
        nextFolderNames.add(folder.name);
      } else {
        nextFolderNames.delete(folder.name);
      }
      label.dataset.selected = checkbox.checked ? "true" : "false";
      label.classList.toggle("selected", checkbox.checked);
      setSearchFolderSelection([...nextFolderNames], { renderSelector: false });
      applySearchMetadataTypeFilter();
    });

    const text = document.createElement("span");
    text.className = "schema-search-type-option-text";
    const primary = document.createElement("span");
    primary.className = "schema-search-type-option-primary";
    primary.textContent = folder.name || "folder";
    const secondary = document.createElement("span");
    secondary.className = "schema-search-type-option-secondary";
    secondary.textContent = folder.label || `${folder.metadataTypeIds.length} metadata type${folder.metadataTypeIds.length === 1 ? "" : "s"}`;
    text.append(primary, secondary);

    label.append(checkbox, text);
    list.appendChild(label);
  });
  searchMetadataTypesOptionsEl.appendChild(list);
  applySearchMetadataTypeFilter();
  updateSearchMetadataTypesSummary();
}

function getAvailableInstalledPackageNamespaceCandidates() {
  const packageByNamespace = new Map();
  [
    ...(Array.isArray(availableInstalledPackages) ? availableInstalledPackages : []),
    ...(Array.isArray(schemaStore?.installedPackages) ? schemaStore.installedPackages : []),
    ...(Array.isArray(schemaStore?.subscriberPackages) ? schemaStore.subscriberPackages : [])
  ].forEach((installedPackage) => {
    const namespacePrefix = String(installedPackage?.namespacePrefix || "").trim();
    if (namespacePrefix && !packageByNamespace.has(namespacePrefix)) {
      packageByNamespace.set(namespacePrefix, {
        ...installedPackage,
        namespacePrefix
      });
    }
  });
  [
    ...(Array.isArray(schemaStore?.installedPackageNamespaces) ? schemaStore.installedPackageNamespaces : []),
    ...(Array.isArray(schemaUiSettings?.workspaceInstalledPackageNamespaces) ? schemaUiSettings.workspaceInstalledPackageNamespaces : [])
  ].forEach((namespacePrefix) => {
    const namespaceName = String(namespacePrefix || "").trim();
    if (namespaceName && !packageByNamespace.has(namespaceName)) {
      packageByNamespace.set(namespaceName, {
        id: namespaceName,
        namespacePrefix: namespaceName,
        name: namespaceName,
        version: ""
      });
    }
  });
  return [...packageByNamespace.values()].sort((left, right) => (
    String(left.name || left.namespacePrefix).localeCompare(String(right.name || right.namespacePrefix), undefined, { sensitivity: "base" })
  ));
}

function getValidInstalledPackageNamespaces(namespaces = [], installedPackages = getAvailableInstalledPackageNamespaceCandidates()) {
  const availableNamespaces = new Set(installedPackages.map((installedPackage) => installedPackage.namespacePrefix));
  return [...new Set(namespaces)]
    .map((namespacePrefix) => String(namespacePrefix || "").trim())
    .filter((namespacePrefix) => namespacePrefix && availableNamespaces.has(namespacePrefix));
}

function getValidWorkspaceInstalledPackageNamespaces(namespaces = []) {
  return getValidInstalledPackageNamespaces(namespaces, availableInstalledPackages);
}

function getWorkspaceNamespaceCandidates() {
  return getAvailableInstalledPackageNamespaceCandidates();
}

async function ensureWorkspaceNamespaceCandidatesLoaded() {
  if (getWorkspaceNamespaceCandidates().length || !session?.host || !session?.sid) {
    return getWorkspaceNamespaceCandidates();
  }
  if (workspaceNamespaceLoadPromise) {
    return workspaceNamespaceLoadPromise;
  }

  setStatus(t("schemaStatus.loadingNamespaces"));
  workspaceNamespaceLoadPromise = loadInstalledPackageNamespaces(session.host, session.sid, {
    timeoutMs: getInstalledPackageLoadTimeoutMs()
  })
    .then((installedPackages) => {
      availableInstalledPackages = installedPackages;
      renderWorkspaceInstalledPackageSelector();
      renderSearchInstalledPackageSelector();
      if (installedPackages.length) {
        setStatus(t("schemaStatus.loadedNamespaces", { count: installedPackages.length }));
      } else {
        setStatus(t("schemaStatus.noNamespaceFound"));
      }
      return installedPackages;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(t("schemaStatus.namespacesLoadFailed", { message: message }), true);
      return [];
    })
    .finally(() => {
      workspaceNamespaceLoadPromise = null;
    });

  renderWorkspaceInstalledPackageSelector();
  return workspaceNamespaceLoadPromise;
}

function getSelectedWorkspaceInstalledPackageNamespaces() {
  return getValidWorkspaceInstalledPackageNamespaces(schemaUiSettings.workspaceInstalledPackageNamespaces);
}

function getWorkspaceIncludeAllNamespaces() {
  return schemaUiSettings.workspaceIncludeAllNamespaces === true;
}

function getSearchNamespaceCandidates() {
  if (getWorkspaceIncludeAllNamespaces()) {
    return availableInstalledPackages;
  }

  const workspaceNamespaces = new Set(getSelectedWorkspaceInstalledPackageNamespaces());
  return availableInstalledPackages.filter((installedPackage) => workspaceNamespaces.has(installedPackage.namespacePrefix));
}

function getValidSearchInstalledPackageNamespaces(namespaces = []) {
  return getValidInstalledPackageNamespaces(namespaces, getSearchNamespaceCandidates());
}

function getSelectedSearchInstalledPackageNamespaces() {
  return getSelectedWorkspaceInstalledPackageNamespaces();
}

function getSearchIncludeAllNamespaces() {
  return getWorkspaceIncludeAllNamespaces();
}

function syncSearchSelectionsToWorkspace() {
  let didChange = false;
  let shouldInvalidateSearch = false;
  let nextSettings = { ...schemaUiSettings };

  if (Array.isArray(nextSettings.searchFolderDefaults)) {
    const validSearchFolderNames = getValidSearchFolderNames(nextSettings.searchFolderDefaults);
    if (!setsHaveSameValues(validSearchFolderNames, nextSettings.searchFolderDefaults)) {
      nextSettings = {
        ...nextSettings,
        searchFolderDefaults: validSearchFolderNames
      };
      didChange = true;
      shouldInvalidateSearch = true;
    }
  }

  if (
    nextSettings.searchIncludeAllNamespaces === true
    || (nextSettings.searchInstalledPackageNamespaces || []).length
  ) {
    nextSettings = {
      ...nextSettings,
      searchIncludeAllNamespaces: false,
      searchInstalledPackageNamespaces: []
    };
    didChange = true;
  }

  if (didChange) {
    schemaUiSettings = nextSettings;
    saveSchemaUiSettings();
    if (shouldInvalidateSearch) {
      invalidateFolderSearchCache();
    }
  }
}

function getOrgNamespacePrefixList() {
  return [...getOrgNamespacePrefixes()].filter(Boolean);
}

function ensureSearchIncludesInstalledPackagesByDefault() {
  const selectedWorkspaceNamespaces = Array.isArray(schemaUiSettings.workspaceInstalledPackageNamespaces)
    ? schemaUiSettings.workspaceInstalledPackageNamespaces
    : [];
  const validWorkspaceNamespaces = getValidWorkspaceInstalledPackageNamespaces(selectedWorkspaceNamespaces);
  const hasInvalidWorkspaceNamespaces = selectedWorkspaceNamespaces.length !== validWorkspaceNamespaces.length
    || selectedWorkspaceNamespaces.some((namespacePrefix, index) => namespacePrefix !== validWorkspaceNamespaces[index]);
  const includeAllWorkspaceNamespaces = schemaUiSettings.workspaceIncludeAllNamespaces === true;
  const shouldApplyNamespaceDefault = Number(schemaUiSettings.namespaceDefaultVersion || 0) !== DEFAULT_SCHEMA_UI_SETTINGS.namespaceDefaultVersion;
  const shouldUseOrgNamespaceDefault = shouldApplyNamespaceDefault
    && !includeAllWorkspaceNamespaces
    && validWorkspaceNamespaces.length === 0;
  const defaultOrgNamespaces = shouldUseOrgNamespaceDefault
    ? getValidWorkspaceInstalledPackageNamespaces(getOrgNamespacePrefixList())
    : [];
  const nextWorkspaceNamespaces = includeAllWorkspaceNamespaces
    ? []
    : (defaultOrgNamespaces.length ? defaultOrgNamespaces : validWorkspaceNamespaces);

  const hasSearchNamespaceDefaults = schemaUiSettings.searchIncludeAllNamespaces === true
    || (schemaUiSettings.searchInstalledPackageNamespaces || []).length > 0;

  if (
    hasInvalidWorkspaceNamespaces
    || hasSearchNamespaceDefaults
    || shouldApplyNamespaceDefault
    || !setsHaveSameValues(nextWorkspaceNamespaces, selectedWorkspaceNamespaces)
  ) {
    schemaUiSettings = {
      ...schemaUiSettings,
      workspaceIncludeAllNamespaces: includeAllWorkspaceNamespaces,
      workspaceInstalledPackageNamespaces: nextWorkspaceNamespaces,
      searchIncludeAllNamespaces: false,
      searchInstalledPackageNamespaces: [],
      namespaceDefaultVersion: DEFAULT_SCHEMA_UI_SETTINGS.namespaceDefaultVersion
    };
    saveSchemaUiSettings();
  }
}

function getActiveSearchInstalledPackageNamespaceSet() {
  return new Set(activeSearchInstalledPackageNamespaces);
}

function getOrgNamespacePrefixes() {
  return new Set(
    availableInstalledPackages
      .filter((installedPackage) => String(installedPackage.id || "").startsWith("org:"))
      .map((installedPackage) => String(installedPackage.namespacePrefix || "").trim())
      .filter(Boolean)
  );
}

function getSearchNamespaceScopeLabel(namespaces = [], includeAllNamespaces = false) {
  if (includeAllNamespaces) {
    return "all namespaces";
  }
  return namespaces.length
    ? `${namespaces.length} namespace${namespaces.length === 1 ? "" : "s"}`
    : "";
}

function updateSearchInstalledPackagesSummary() {
  if (!searchInstalledPackagesSummaryEl) {
    return;
  }

  if (getSearchIncludeAllNamespaces()) {
    searchInstalledPackagesSummaryEl.textContent = t("schemaUi.searchNamespaceAll");
    return;
  }

  const selectedCount = getSelectedSearchInstalledPackageNamespaces().length;
  const totalCount = getSearchNamespaceCandidates().length;
  if (!totalCount || !selectedCount) {
    searchInstalledPackagesSummaryEl.textContent = t("schemaUi.searchNamespaceNone");
    return;
  }

  searchInstalledPackagesSummaryEl.textContent = selectedCount === totalCount
    ? t("schemaUi.searchNamespaceListed")
    : t("schemaUi.searchNamespaceCount", { count: selectedCount });
}

function clearSchemaStoreForNamespaceScopeChange(options = {}) {
  activeSourceFolderPath = "";
  clearCompactMetadataSourceTreeCache();
  schemaStore = createFolderListOnlySchemaStore(schemaStore);
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = {};
  metadataDetailCache.clear();
  toolingSourceDetailCache.clear();
  describeCache.clear();
  clearSearchDetailCaches();
  folderRetrieveInProgress.clear();
  folderNamespaceScopeByPath.clear();
  openObjectKeys.clear();
  closedSourceFolderKeys.clear();
  selectedPackageMembers.clear();
  packageSelectionTreeDirty = true;
  clearSourceNavigationHistory();
  clearMyOrgSearchLocalFiles();
  if (selectedNode?.sourcePath || selectedNode?.type === "metadataType" || selectedNode?.type === "metadataItem") {
    selectedNode = null;
  }
  renderWorkspaceSettingsSelectors();
  updateMetadataSelectionState({ renderManifest: false });
  if (options.render !== false) {
    renderMetadataSelectionIfVisible({ renderManifest: false });
    renderSchema({ renderDetail: false });
  }
}

function reloadActiveSourceFolderForNamespaceChange() {
  if (hasActiveSearch()) {
    return false;
  }

  metadataActionInProgress = false;
  clearSchemaStoreForNamespaceScopeChange({ render: false });
  setStatus(t("schemaStatus.namespaceChangedReloading"));
  setSchemaSummary(t("schemaStatus.namespaceChangedReloading"));
  void ensureFilesTabWorkspaceFoldersLoaded({ force: true });
  return true;
}

function setSearchInstalledPackageSelection(namespaces = [], options = {}) {
  setWorkspaceInstalledPackageSelection(namespaces, {
    includeAllNamespaces: options.includeAllNamespaces === true
  });
  renderSearchInstalledPackageSelector();
  if (activeSidebarTab === "search") {
    renderSearchPanel();
  }
}

function createSearchInstalledPackageActionButton(label, namespaces, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-search-type-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSearchInstalledPackageSelection(namespaces, options);
  });
  return button;
}

function namespaceMatchesFilter(searchText = "", filterText = searchInstalledPackageFilterText) {
  const needle = String(filterText || "").trim().toLocaleLowerCase();
  if (!needle) {
    return true;
  }

  return String(searchText || "").toLocaleLowerCase().includes(needle);
}

function applySearchInstalledPackageFilter() {
  const filterText = searchInstalledPackageFilterText;
  [searchInstalledPackagesOptionsEl, workspaceNamespacesOptionsEl].forEach((optionsEl) => {
    optionsEl?.querySelectorAll(".schema-search-type-option").forEach((option) => {
      const isSelected = option.dataset.selected === "true" || option.querySelector("input")?.checked;
      option.hidden = !isSelected && !namespaceMatchesFilter(option.dataset.namespaceSearchText, filterText);
    });
  });
}

function updateSearchInstalledPackageFilter(value = "") {
  searchInstalledPackageFilterText = value;
  applySearchInstalledPackageFilter();
}

function createSearchInstalledPackageFilterInput() {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-search-type-filter";
  input.placeholder = t("schemaUi.filterNamespace");
  input.setAttribute("aria-label", t("schemaUi.filterNamespacesAria"));
  input.value = searchInstalledPackageFilterText;
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      event.stopPropagation();
    }
  });
  input.addEventListener("input", () => updateSearchInstalledPackageFilter(input.value));
  input.addEventListener("search", () => updateSearchInstalledPackageFilter(input.value));
  return input;
}

function renderSearchInstalledPackageSelector() {
  if (!searchInstalledPackagesOptionsEl) {
    return;
  }

  const candidates = getSearchNamespaceCandidates();
  const selectedNamespaces = new Set(getSelectedSearchInstalledPackageNamespaces());
  const includeAllNamespaces = getSearchIncludeAllNamespaces();
  searchInstalledPackagesOptionsEl.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "schema-search-type-actions";
  actions.append(
    createSearchInstalledPackageActionButton(
      "All",
      candidates.map((installedPackage) => installedPackage.namespacePrefix).filter(Boolean),
      { includeAllNamespaces: true }
    ),
    createSearchInstalledPackageActionButton("Clear", []),
    createSearchInstalledPackageFilterInput()
  );
  searchInstalledPackagesOptionsEl.appendChild(actions);

  const list = document.createElement("div");
  list.className = "schema-search-type-list";
  if (!candidates.length) {
    const empty = document.createElement("div");
    empty.className = "schema-search-type-empty";
    empty.textContent = workspaceNamespaceLoadPromise
      ? t("schemaStatus.loadingNamespaces")
      : "No workspace namespaces available.";
    list.appendChild(empty);
  }

  const selectedInstalledPackages = [];
  const unselectedInstalledPackages = [];
  candidates.forEach((installedPackage) => {
    if (includeAllNamespaces || selectedNamespaces.has(installedPackage.namespacePrefix)) {
      selectedInstalledPackages.push(installedPackage);
    } else {
      unselectedInstalledPackages.push(installedPackage);
    }
  });
  const orderedInstalledPackages = selectedInstalledPackages.concat(unselectedInstalledPackages);
  orderedInstalledPackages.forEach((installedPackage) => {
    const filterText = [
      installedPackage.name,
      installedPackage.namespacePrefix,
      installedPackage.version,
      installedPackage.id
    ].filter(Boolean).join(" ");
    const label = document.createElement("label");
    label.className = "schema-search-type-option";
    const isSelected = includeAllNamespaces || selectedNamespaces.has(installedPackage.namespacePrefix);
    label.dataset.selected = isSelected ? "true" : "false";
    label.dataset.namespaceSearchText = filterText;
    label.classList.toggle("selected", isSelected);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = installedPackage.namespacePrefix || "";
    checkbox.checked = isSelected;
    checkbox.addEventListener("change", () => {
      const nextNamespaces = new Set(
        getSearchIncludeAllNamespaces()
          ? candidates.map((candidate) => candidate.namespacePrefix).filter(Boolean)
          : getSelectedSearchInstalledPackageNamespaces()
      );
      if (checkbox.checked) {
        nextNamespaces.add(installedPackage.namespacePrefix);
      } else {
        nextNamespaces.delete(installedPackage.namespacePrefix);
      }
      setSearchInstalledPackageSelection([...nextNamespaces]);
    });

    const text = document.createElement("span");
    text.className = "schema-search-type-option-text";
    const primary = document.createElement("span");
    primary.className = "schema-search-type-option-primary";
    primary.textContent = installedPackage.name || installedPackage.namespacePrefix;
    const secondary = document.createElement("span");
    secondary.className = "schema-search-type-option-secondary";
    secondary.textContent = [
      installedPackage.namespacePrefix,
      installedPackage.version ? `v${installedPackage.version}` : ""
    ].filter(Boolean).join(" · ");
    text.append(primary, secondary);

    label.append(checkbox, text);
    list.appendChild(label);
  });
  searchInstalledPackagesOptionsEl.appendChild(list);
  applySearchInstalledPackageFilter();
  updateSearchInstalledPackagesSummary();
}

function updateWorkspaceFoldersSummary() {
  if (!workspaceFoldersSummaryEl) {
    return;
  }

  const selectedCount = getDefaultMetadataFolderNames().length;
  const totalCount = getMetadataFolderSelectionEntries().length;
  workspaceFoldersSummaryEl.textContent = selectedCount === 0
    ? t("schemaUi.workspaceFoldersNone")
    : t("schemaUi.workspaceFoldersCount", { selected: selectedCount, total: totalCount });
}

function renderWorkspaceFolderSelector() {
  if (!workspaceFoldersOptionsEl) {
    return;
  }

  const folders = getMetadataFolderSelectionEntries();
  const retrievedFolderNames = getRetrievedMetadataFolderNameSet();
  const defaultFolderNames = new Set(getDefaultMetadataFolderNames());
  workspaceFoldersOptionsEl.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "schema-search-type-actions";
  actions.append(
    createMetadataFolderSelectionActionButton("Common", setCommonMetadataFolderDefaultsSelected),
    createMetadataFolderSelectionActionButton("Clear", clearAllMetadataFolderDefaultsSelected),
    createSearchMetadataTypeFilterInput()
  );
  workspaceFoldersOptionsEl.appendChild(actions);

  const list = document.createElement("div");
  list.className = "schema-search-type-list";
  const orderedFolders = [
    ...folders.filter((folder) => retrievedFolderNames.has(folder.name) || defaultFolderNames.has(folder.name)),
    ...folders.filter((folder) => !retrievedFolderNames.has(folder.name) && !defaultFolderNames.has(folder.name))
  ];

  orderedFolders.forEach((folder) => {
    const isDefault = defaultFolderNames.has(folder.name);
    const isSelected = isDefault;
    const filterText = [
      folder.name,
      folder.label,
      ...folder.metadataTypes.flatMap((metadataType) => [
        metadataType.id,
        metadataType.label,
        metadataType.itemLabel,
        metadataType.metadataApiType,
        metadataType.directoryName
      ])
    ].filter(Boolean).join(" ");

    const label = document.createElement("label");
    label.className = "schema-search-type-option";
    label.dataset.metadataTypeId = folder.metadataTypeIds.join(",");
    label.dataset.metadataTypeLabel = folder.label || "";
    label.dataset.metadataTypeFolder = folder.name || "";
    label.dataset.metadataTypeSearchText = filterText;
    label.dataset.selected = isSelected ? "true" : "false";
    label.classList.toggle("selected", isSelected);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = folder.name || "";
    checkbox.checked = isSelected;
    checkbox.indeterminate = !isSelected && isMetadataFolderPartiallyRetrieved(folder);
    checkbox.disabled = metadataActionInProgress || folderRetrieveInProgress.has(folder.path || `${SOURCE_DEFAULT_PREFIX}${folder.name}`);
    checkbox.addEventListener("change", () => {
      label.dataset.selected = checkbox.checked ? "true" : "false";
      label.classList.toggle("selected", checkbox.checked);
      void setMetadataFolderRetrieved(folder, checkbox.checked);
    });

    const text = document.createElement("span");
    text.className = "schema-search-type-option-text";
    const primary = document.createElement("span");
    primary.className = "schema-search-type-option-primary";
    primary.textContent = folder.name || "folder";
    const secondary = document.createElement("span");
    secondary.className = "schema-search-type-option-secondary";
    secondary.textContent = [
      folder.label || `${folder.metadataTypeIds.length} metadata type${folder.metadataTypeIds.length === 1 ? "" : "s"}`,
      isDefault ? "workspace" : ""
    ].filter(Boolean).join(" · ");
    text.append(primary, secondary);

    label.append(checkbox, text);
    list.appendChild(label);
  });
  workspaceFoldersOptionsEl.appendChild(list);
  applySearchMetadataTypeFilter();
  updateWorkspaceFoldersSummary();
}

function updateWorkspaceNamespacesSummary() {
  if (!workspaceNamespacesSummaryEl) {
    return;
  }

  if (getWorkspaceIncludeAllNamespaces()) {
    workspaceNamespacesSummaryEl.textContent = t("schemaUi.workspaceNamespacesAll");
    return;
  }

  const selectedCount = getSelectedWorkspaceInstalledPackageNamespaces().length;
  const totalCount = getWorkspaceNamespaceCandidates().length;
  if (!totalCount || !selectedCount) {
    workspaceNamespacesSummaryEl.textContent = t("schemaUi.workspaceNamespacesNone");
    return;
  }

  workspaceNamespacesSummaryEl.textContent = selectedCount === totalCount
    ? t("schemaUi.workspaceNamespacesListed")
    : t("schemaUi.workspaceNamespacesCount", { count: selectedCount });
}

function setWorkspaceInstalledPackageSelection(namespaces = [], options = {}) {
  const includeAllNamespaces = options.includeAllNamespaces === true;
  schemaUiSettings = {
    ...schemaUiSettings,
    workspaceIncludeAllNamespaces: includeAllNamespaces,
    workspaceInstalledPackageNamespaces: includeAllNamespaces
      ? []
      : getValidWorkspaceInstalledPackageNamespaces(namespaces),
    namespaceDefaultVersion: DEFAULT_SCHEMA_UI_SETTINGS.namespaceDefaultVersion
  };
  syncSearchSelectionsToWorkspace();
  saveSchemaUiSettings();
  invalidateFolderSearchCache();
  renderWorkspaceInstalledPackageSelector();
  renderSearchInstalledPackageSelector();
  clearSchemaStoreForNamespaceScopeChange({ render: false });
  renderMetadataSelectionIfVisible({ renderManifest: false });
  renderSchema({ renderDetail: false });
  setStatus(t("schemaStatus.namespaceChangedReloadFolders"));
  setSchemaSummary(t("schemaStatus.namespaceChangedReloadFolders"));
  void cacheOpenMetadataDiscovery();
}

function createWorkspaceInstalledPackageActionButton(label, namespaces, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-search-type-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceInstalledPackageSelection(namespaces, options);
  });
  return button;
}

function renderWorkspaceInstalledPackageSelector() {
  if (!workspaceNamespacesOptionsEl) {
    return;
  }

  const candidates = getWorkspaceNamespaceCandidates();
  const selectedNamespaces = new Set(getSelectedWorkspaceInstalledPackageNamespaces());
  const includeAllNamespaces = getWorkspaceIncludeAllNamespaces();
  workspaceNamespacesOptionsEl.innerHTML = "";

  const actions = document.createElement("div");
  actions.className = "schema-search-type-actions";
  actions.append(
    createWorkspaceInstalledPackageActionButton(
      "All",
      candidates.map((installedPackage) => installedPackage.namespacePrefix).filter(Boolean),
      { includeAllNamespaces: true }
    ),
    createWorkspaceInstalledPackageActionButton("Clear", []),
    createSearchInstalledPackageFilterInput()
  );
  workspaceNamespacesOptionsEl.appendChild(actions);

  const list = document.createElement("div");
  list.className = "schema-search-type-list";
  if (!candidates.length) {
    const empty = document.createElement("div");
    empty.className = "schema-search-type-empty";
    empty.textContent = workspaceNamespaceLoadPromise
      ? t("schemaStatus.loadingNamespaces")
      : "No namespace rows found. Unmanaged metadata is included with None.";
    list.appendChild(empty);
  }

  const selectedInstalledPackages = [];
  const unselectedInstalledPackages = [];
  candidates.forEach((installedPackage) => {
    const isSelected = includeAllNamespaces || selectedNamespaces.has(installedPackage.namespacePrefix);
    if (isSelected) {
      selectedInstalledPackages.push(installedPackage);
    } else {
      unselectedInstalledPackages.push(installedPackage);
    }
  });
  selectedInstalledPackages.concat(unselectedInstalledPackages).forEach((installedPackage) => {
    const filterText = [
      installedPackage.name,
      installedPackage.namespacePrefix,
      installedPackage.version,
      installedPackage.id
    ].filter(Boolean).join(" ");
    const isSelected = includeAllNamespaces || selectedNamespaces.has(installedPackage.namespacePrefix);
    const label = document.createElement("label");
    label.className = "schema-search-type-option";
    label.dataset.selected = isSelected ? "true" : "false";
    label.dataset.namespaceSearchText = filterText;
    label.classList.toggle("selected", isSelected);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = installedPackage.namespacePrefix || "";
    checkbox.checked = isSelected;
    checkbox.addEventListener("change", () => {
      const nextNamespaces = new Set(
        getWorkspaceIncludeAllNamespaces()
          ? candidates.map((candidate) => candidate.namespacePrefix).filter(Boolean)
          : getSelectedWorkspaceInstalledPackageNamespaces()
      );
      if (checkbox.checked) {
        nextNamespaces.add(installedPackage.namespacePrefix);
      } else {
        nextNamespaces.delete(installedPackage.namespacePrefix);
      }
      setWorkspaceInstalledPackageSelection([...nextNamespaces]);
    });

    const text = document.createElement("span");
    text.className = "schema-search-type-option-text";
    const primary = document.createElement("span");
    primary.className = "schema-search-type-option-primary";
    primary.textContent = installedPackage.name || installedPackage.namespacePrefix;
    const secondary = document.createElement("span");
    secondary.className = "schema-search-type-option-secondary";
    secondary.textContent = [
      installedPackage.namespacePrefix,
      installedPackage.version ? `v${installedPackage.version}` : ""
    ].filter(Boolean).join(" · ");
    text.append(primary, secondary);

    label.append(checkbox, text);
    list.appendChild(label);
  });
  workspaceNamespacesOptionsEl.appendChild(list);
  applySearchInstalledPackageFilter();
  updateWorkspaceNamespacesSummary();
}

function hasInlineWorkspaceSettingsSelectors() {
  return Boolean(
    workspaceFoldersMenuEl
    || workspaceNamespacesMenuEl
    || searchMetadataTypesMenuEl?.closest(".schema-toolbar-controls")
    || searchInstalledPackagesMenuEl?.closest(".schema-toolbar-controls")
    || searchMetadataTypesMenuEl?.closest(".schema-metadata-folder-controls")
    || searchInstalledPackagesMenuEl?.closest(".schema-metadata-folder-controls")
  );
}

function renderWorkspaceSettingsSelectors(options = {}) {
  if (options.force !== true && !hasInlineWorkspaceSettingsSelectors() && !isWorkspaceSettingsOpen()) {
    return;
  }

  syncSearchSelectionsToWorkspace();
  renderWorkspaceFolderSelector();
  renderWorkspaceInstalledPackageSelector();
  renderSearchMetadataTypeSelector();
  renderSearchInstalledPackageSelector();
}

function getPackageXmlMetadataApiTypes(metadataType = {}) {
  const metadataApiTypes = Array.isArray(metadataType.metadataApiTypes) && metadataType.metadataApiTypes.length
    ? metadataType.metadataApiTypes
    : metadataType.metadataApiType
      ? [metadataType.metadataApiType]
      : [PACKAGE_METADATA_API_TYPE_BY_ID[metadataType.id] || metadataType.id].filter(Boolean);

  if (metadataType.id === "settings" || metadataApiTypes.some((metadataApiType) => isSettingsMetadataApiType(metadataApiType))) {
    return ["Settings"];
  }

  return metadataApiTypes;
}

function isSettingsMetadataApiType(metadataApiType = "") {
  const typeName = String(metadataApiType || "").trim();
  return typeName !== "Settings" && typeName.endsWith("Settings");
}

function getSettingsPackageMember(metadataApiType = "") {
  return String(metadataApiType || "").trim().replace(/Settings$/, "");
}

function normalizePackageManifestEntry(entry = {}) {
  const type = String(entry.type || "").trim();
  const member = String(entry.member || "").trim();
  if (!type || !member) {
    return { type: "", member: "" };
  }

  if (isSettingsMetadataApiType(type)) {
    return {
      type: "Settings",
      member: member === "*" ? getSettingsPackageMember(type) : member
    };
  }

  return { type, member };
}

function escapePackageXmlText(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function getPackageSelectionKey(entry = {}) {
  const normalizedEntry = normalizePackageManifestEntry(entry);
  return JSON.stringify([normalizedEntry.type || "", normalizedEntry.member || ""]);
}

function getPackageCreateSourcePath() {
  return normalizeMyOrgResultPath(packageCreateSourcePath || PACKAGE_XML_SOURCE_PATH) || PACKAGE_XML_SOURCE_PATH;
}

function getPackageCreateFileName() {
  return getSourceBaseName(getPackageCreateSourcePath()) || "package.xml";
}

function isPackageWorkspaceManifestPath(sourcePath = "") {
  return normalizeMyOrgResultPath(sourcePath || PACKAGE_XML_SOURCE_PATH) === PACKAGE_XML_SOURCE_PATH;
}

function isManifestLocalXmlBuilderPath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  return isManifestLocalFilePath(path) && /\.xml$/i.test(path);
}

function getManifestLocalPackageEntries(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  const entry = localSourceEntries.get(path);
  if (!entry?.content) {
    return [];
  }
  try {
    return parsePackageXmlManifestEntries(entry.content);
  } catch (error) {
    setStatus(t("schemaStatus.invalidSource", { fileName: getSourceBaseName(path), message: error instanceof Error ? error.message : String(error) }), true);
    return [];
  }
}

function parsePackageSelectionKey(key = "") {
  try {
    const [type, member] = JSON.parse(key);
    return { type, member };
  } catch (_error) {
    return { type: "", member: "" };
  }
}

function updateSelectedPackageMember(key, isSelected) {
  if (!key) {
    return;
  }

  if (isSelected) {
    selectedPackageMembers.add(key);
  } else {
    selectedPackageMembers.delete(key);
  }
  persistActivePackageManifest();
}

function removeSelectedPackageMembersByType(apiTypes = []) {
  const typeSet = new Set(apiTypes.filter(Boolean));
  if (!typeSet.size) {
    return;
  }

  [...selectedPackageMembers].forEach((key) => {
    const { type } = parsePackageSelectionKey(key);
    if (typeSet.has(type)) {
      selectedPackageMembers.delete(key);
    }
  });
}

function getPackageManifestEntriesForSelection(selection = {}) {
  if (!selection?.type) {
    return [];
  }

  if (selection.type === "localFile") {
    const sourcePath = selection.sourcePath || "";
    const entry = localSourceEntries.get(sourcePath) || {};
    const metadataType = entry.metadataType || getMetadataTypesForSourcePath(sourcePath)[0] || "";
    const metadataApiType = entry.metadataApiType || inferMetadataApiTypeFromSourcePath(sourcePath, metadataType);
    const member = entry.metadataName
      || entry.fullName
      || inferMetadataFullNameFromSourcePath(sourcePath, metadataType, metadataApiType);
    const packageEntry = normalizePackageManifestEntry({ type: metadataApiType, member });
    return packageEntry.type && packageEntry.member ? [packageEntry] : [];
  }

  if (selection.type === "object") {
    const objectApiName = getObjectApiName(selection.objectKey);
    return objectApiName ? [{ type: "CustomObject", member: objectApiName }] : [];
  }

  if (selection.type === "field") {
    const objectApiName = getObjectApiName(selection.objectKey);
    const fieldApiName = splitSchemaKey(selection.fieldKey).apiName;
    return objectApiName && fieldApiName
      ? [{ type: "CustomField", member: `${objectApiName}.${fieldApiName}` }]
      : [];
  }

  if (selection.type !== "metadataItem") {
    return [];
  }

  const group = findMetadataGroup(selection.metadataType);
  const item = findMetadataItem(selection.metadataType, selection.itemKey);
  if (!group || !item) {
    return [];
  }

  const type = item.record?.metadataApiType
    || group.metadataObject
    || getPackageXmlMetadataApiTypes(getAvailableMetadataType(group.id) || group)[0];
  const member = item.apiName || splitSchemaKey(item.key).apiName || item.id;
  const entry = normalizePackageManifestEntry({ type, member });
  return entry.type && entry.member ? [entry] : [];
}

function getPackageManifestEntriesForSourcePath(sourcePath = "", node = {}) {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path || isManifestSourcePath(path)) {
    return [];
  }

  if (node.kind === "folder" && isObjectSourceLeafFolderPath(path)) {
    const objectName = getSourceBaseName(path).replace(/\.object$/i, "");
    const entry = normalizePackageManifestEntry({ type: "CustomObject", member: objectName });
    return entry.type && entry.member ? [entry] : [];
  }

  if (node.kind !== "file") {
    return [];
  }

  const metadataType = node.selection?.metadataType || getMetadataTypesForSourcePath(path)[0] || getMetadataFolderNameFromPath(path);
  const metadataApiType = node.metadataApiType || inferMetadataApiTypeFromSourcePath(path, metadataType);
  const member = node.metadataName
    || node.fullName
    || inferMetadataFullNameFromSourcePath(path, metadataType, metadataApiType);
  const entry = normalizePackageManifestEntry({ type: metadataApiType, member });
  return entry.type && entry.member ? [entry] : [];
}

function getPackageManifestEntriesForNode(node = {}) {
  if (node.lazyChildrenFactory && !node.lazyChildrenLoaded) {
    ensureSourceTreeLazyChildren(node);
  }
  const ownEntries = [
    ...getPackageManifestEntriesForSelection(node.selection),
    ...getPackageManifestEntriesForSourcePath(node.path || node.selection?.sourcePath || "", node)
  ];
  const childEntries = (node.children || []).flatMap((child) => getPackageManifestEntriesForNode(child));
  return [...ownEntries, ...childEntries];
}

function getSelectedPackageManifestEntries() {
  return [...selectedPackageMembers]
    .map((key) => parsePackageSelectionKey(key))
    .map((entry) => normalizePackageManifestEntry(entry))
    .filter((entry) => entry.type && entry.member)
    .sort((left, right) => left.type.localeCompare(right.type) || left.member.localeCompare(right.member));
}

function getPackageManifestEntriesForDetail() {
  return getSelectedPackageManifestEntries();
}

function createPackageXmlManifest(entries = []) {
  const membersByType = new Map();
  entries.map((entry) => normalizePackageManifestEntry(entry)).forEach((entry) => {
    if (!entry.type || !entry.member) {
      return;
    }
    const members = membersByType.get(entry.type) || new Set();
    members.add(entry.member);
    membersByType.set(entry.type, members);
  });

  const typeRows = [...membersByType.entries()].map(([apiType, members]) => [
    "  <types>",
    ...[...members].sort((left, right) => left.localeCompare(right)).map((member) => (
      `    <members>${escapePackageXmlText(member)}</members>`
    )),
    `    <name>${escapePackageXmlText(apiType)}</name>`,
    "  </types>"
  ].join("\n"));

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">",
    ...typeRows,
    `  <version>${getPackageXmlApiVersion()}</version>`,
    "</Package>"
  ].join("\n");
}

function persistActiveLocalPackageManifest() {
  const sourcePath = getPackageCreateSourcePath();
  if (!isManifestLocalXmlBuilderPath(sourcePath)) {
    return;
  }
  const entry = localSourceEntries.get(sourcePath);
  if (!entry || entry.kind !== "file") {
    return;
  }
  localSourceEntries.set(sourcePath, {
    ...entry,
    content: createPackageXmlManifest(getSelectedPackageManifestEntries()),
    contentKind: "xml",
    lastModifiedDate: new Date().toISOString()
  });
  searchDetailEntryCache.delete(sourcePath);
  invalidateExplorerSourceTreeCache();
  savePersistedManifestLocalFiles();
}

function syncWorkspacePackageManifestFile() {
  const existingEntry = localSourceEntries.get(PACKAGE_XML_SOURCE_PATH);
  const now = new Date().toISOString();
  createLocalSourceEntry(PACKAGE_XML_SOURCE_PATH, "file", createPackageXmlManifest(getSelectedPackageManifestEntries()), {
    ...(existingEntry || {}),
    typeLabel: "Manifest",
    label: "Current workspace XML",
    fileName: "package.xml",
    metadataType: "manifest",
    contentKind: "xml",
    sourceOrigin: WORKSPACE_PACKAGE_SOURCE_ORIGIN,
    localUid: existingEntry?.localUid || "workspace-package-xml",
    autoRetrieve: false,
    createdAt: existingEntry?.createdAt || now,
    lastModifiedDate: now
  });
  searchDetailEntryCache.delete(PACKAGE_XML_SOURCE_PATH);
}

function persistActivePackageManifest() {
  if (isPackageWorkspaceManifestPath(getPackageCreateSourcePath())) {
    syncWorkspacePackageManifestFile();
    return;
  }
  persistActiveLocalPackageManifest();
}

function parsePackageXmlManifestEntries(xml = "") {
  const document = new DOMParser().parseFromString(String(xml || ""), "application/xml");
  const parseError = document.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error(parseError.textContent || "Invalid manifest.xml.");
  }

  const typeNodes = Array.from(document.getElementsByTagName("*"))
    .filter((element) => element.localName === "types" || element.nodeName === "types");
  const entries = [];

  typeNodes.forEach((typeNode) => {
    const typeName = Array.from(typeNode.children)
      .find((child) => child.localName === "name" || child.nodeName === "name")
      ?.textContent
      ?.trim();
    if (!typeName) {
      return;
    }

    Array.from(typeNode.children)
      .filter((child) => child.localName === "members" || child.nodeName === "members")
      .map((child) => child.textContent.trim())
      .filter(Boolean)
      .forEach((member) => {
        entries.push({
          type: typeName,
          member
        });
      });
  });

  return entries.map((entry) => normalizePackageManifestEntry(entry));
}

function updatePackageManifestEditState(file = null) {
  const manifestFile = file || schemaDetailEl.querySelector(".schema-package-manifest-file");
  if (!manifestFile) {
    return;
  }

  const editor = manifestFile.querySelector(".schema-editable-code-editor");
  const header = schemaDetailEl.querySelector(".schema-detail-head");
  const badge = header?.querySelector(".schema-count");
  let errorEl = schemaDetailEl.querySelector(".schema-manifest-error");
  if (!errorEl) {
    errorEl = document.createElement("div");
    errorEl.className = "schema-manifest-error";
    header?.after(errorEl);
  }

  try {
    const entries = parsePackageXmlManifestEntries(editor?.value || "");
    manifestFile.classList.remove("error");
    errorEl.hidden = true;
    errorEl.textContent = "";
    syncPackageSelectionFromManifestEntries(entries);
    if (badge) {
      badge.textContent = `${entries.length} ${entries.length === 1 ? "file" : "files"}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manifestFile.classList.add("error");
    errorEl.hidden = false;
    errorEl.textContent = formatUserFacingMessage(message);
    if (badge) {
      badge.textContent = t("schemaUi.invalidXml");
    }
  }
}

function syncPackageSelectionFromManifestEntries(entries = []) {
  const nextKeys = new Set(entries.map((entry) => getPackageSelectionKey(entry)).filter(Boolean));
  const hasSameKeys = nextKeys.size === selectedPackageMembers.size
    && [...nextKeys].every((key) => selectedPackageMembers.has(key));
  if (hasSameKeys) {
    return;
  }

  selectedPackageMembers.clear();
  nextKeys.forEach((key) => selectedPackageMembers.add(key));
  updateMetadataSelectionState({ renderManifest: false });
}

function getRetrievedPackageSelectionEntries() {
  return getPackageManifestEntriesForNode(getPackageDefaultFolderNode());
}

function getPackageSelectionSignatureFromEntries(entries = []) {
  return entries
    .map((entry) => getPackageSelectionKey(entry))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join("\n");
}

function syncPackageSelectionWithRetrievedFolders(options = {}) {
  const entries = getRetrievedPackageSelectionEntries();
  const signature = getPackageSelectionSignatureFromEntries(entries);
  if (options.force !== true && signature === packageRetrievedSelectionSignature) {
    packageSelectionTreeDirty = false;
    return false;
  }

  packageRetrievedSelectionSignature = signature;
  selectedPackageMembers.clear();
  signature.split("\n").filter(Boolean).forEach((key) => {
    selectedPackageMembers.add(key);
  });
  packageSelectionTreeDirty = false;
  return true;
}

function getCurrentPackageManifestXml() {
  const manifestFile = schemaDetailEl.querySelector(".schema-package-manifest-file");
  const editor = manifestFile?.querySelector?.(".schema-editable-code-editor");
  if (typeof editor?.value === "string") {
    return editor.value;
  }
  return createPackageXmlManifest(getPackageManifestEntriesForDetail());
}

function createMetadataZipDownloadName() {
  const hostSegment = String(session?.host || "salesforce")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "salesforce";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${hostSegment}-metadata-${timestamp}.zip`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function retrievePackageManifestZip() {
  if (!session?.host || !session?.sid) {
    setStatus(t("schemaStatus.missingSession"), true);
    return;
  }

  const retrieveButton = schemaDetailEl.querySelector(".schema-package-retrieve-zip-button");
  try {
    const packageXml = getCurrentPackageManifestXml();
    if (retrieveButton) {
      retrieveButton.disabled = true;
    }
    metadataActionInProgress = true;
    setStatus(t("schemaStatus.preparingDownload"));
    setSchemaSummary(t("schemaStatus.preparingDownload"));
    const result = await retrieveMetadataPackageZip(session.host, session.sid, packageXml, {
      apiVersion: schemaStore?.apiVersion || getPackageXmlApiVersion(),
      onProgress(progress) {
        const status = progress.status || "Queued";
        setSchemaSummary(t("schemaStatus.downloadProgress", { status: status, attempt: progress.attempt, maxPolls: progress.maxPolls }));
      }
    });
    downloadBlob(result.blob, createMetadataZipDownloadName());
    setStatus(t("schemaStatus.downloadComplete"));
    setSchemaSummary(t("schemaStatus.downloadComplete"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
  } finally {
    metadataActionInProgress = false;
    if (retrieveButton) {
      retrieveButton.disabled = !getPackageManifestEntriesForDetail().length;
    }
  }
}

function renderPackageManifestDetail() {
  detailRequestId += 1;
  const entries = getPackageManifestEntriesForDetail();

  schemaDetailEl.innerHTML = "";
  const header = createDetailTitle("package.xml", "manifest", `${entries.length} members`, "file", {
    includeFormatSelect: false
  });

  const manifestFile = createXmlFile("package.xml", createPackageXmlManifest(entries));
  manifestFile.classList.add("editing", "schema-package-manifest-file");
  schemaDetailEl.append(
    header,
    manifestFile
  );
  const actions = header.querySelector(".schema-detail-actions");
  const retrieveZipButton = createDetailButton("Download ZIP", "secondary schema-package-retrieve-zip-button");
  retrieveZipButton.disabled = !entries.length;
  retrieveZipButton.title = entries.length ? "Download selected metadata as a ZIP file." : "Select metadata members to download.";
  retrieveZipButton.addEventListener("click", () => void retrievePackageManifestZip());
  actions?.appendChild(retrieveZipButton);
  updatePackageManifestEditState(manifestFile);
}

function isPackageXmlMetadataType(metadataType = {}) {
  const metadataTypeId = metadataType.id || "";
  const metadataObject = metadataType.metadataObject || metadataType.metadataApiType || "";
  return Boolean(metadataTypeId)
    && !EXCLUDED_PACKAGE_XML_FOLDER_IDS.has(metadataTypeId)
    && !EXCLUDED_PACKAGE_XML_FOLDER_IDS.has(metadataObject)
    && Boolean(getSourceFolderForMetadataDefinition(metadataType));
}

function getPackageXmlMetadataTypeCandidates() {
  const candidatesById = new Map();
  [...availableMetadataTypes, ...getMetadataGroups()].forEach((metadataType) => {
    const definition = getAvailableMetadataType(metadataType.id) || metadataType;
    if (isPackageXmlMetadataType(definition)) {
      candidatesById.set(definition.id, definition);
    }
  });

  return [...candidatesById.values()].sort((left, right) => (
    String(getSourceFolderForMetadataDefinition(left)).localeCompare(String(getSourceFolderForMetadataDefinition(right)), undefined, { sensitivity: "base" })
    || String(left.label || left.id).localeCompare(String(right.label || right.id), undefined, { sensitivity: "base" })
  ));
}

function getPackageXmlSourceFolderNames() {
  return new Set(
    getPackageXmlMetadataTypeCandidates()
      .map((metadataType) => getSourceFolderForMetadataDefinition(metadataType))
      .filter(Boolean)
  );
}

function createPackageVisibleGroups() {
  const candidateIds = new Set(getPackageXmlMetadataTypeCandidates().map((metadataType) => metadataType.id));
  return createAllSourceVisibleGroups(
    getMetadataGroups().filter((group) => (
      candidateIds.has(group.id) && getGroupItemCount(group) > 0
    ))
  ).filter((visibleGroup) => visibleGroup.visibleItemCount > 0);
}

function getPackageDefaultFolderNode() {
  return createSourceExplorerTree(createPackageVisibleGroups());
}

function getPackageDefaultFolderChildren() {
  const packageFolderNames = getPackageXmlSourceFolderNames();
  return (getPackageDefaultFolderNode()?.children || []).filter((child) => (
    child.kind === "folder"
    && packageFolderNames.has(getMetadataFolderNameFromPath(child.path || "") || child.name || "")
  ));
}

function isWorkspaceMetadataFolderRootPath(sourcePath = "", folderName = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path || !folderName) {
    return false;
  }
  if (path === folderName || path === `${SOURCE_DEFAULT_PREFIX}${folderName}`) {
    return true;
  }

  const parentPath = getParentSourcePath(path);
  return parentPath === SOURCE_DEFAULT_ROOT || getParentSourcePath(parentPath) === `${SOURCE_PROJECT_ROOT}/main`;
}

function collectPackageWorkspaceFolderNodes(node = {}, packageFolderNames = new Set(), folderByName = new Map()) {
  if (!node) {
    return folderByName;
  }

  const folderName = getMetadataFolderNameFromPath(node.path || "") || node.name || "";
  if (
    node.kind === "folder"
    && packageFolderNames.has(folderName)
    && isWorkspaceMetadataFolderRootPath(node.path || "", folderName)
  ) {
    if (!folderByName.has(folderName)) {
      folderByName.set(folderName, createSourceTreeNode(folderName, `${SOURCE_DEFAULT_PREFIX}${folderName}`, "folder", {
        keepEmpty: true,
        secondary: getSourceFolderLabel(folderName),
        searchValues: getSourceFolderSearchValues(folderName)
      }));
    }
    const targetFolder = folderByName.get(folderName);
    const clone = cloneSourceTreeNode(node);
    targetFolder.children.push(...(clone.children || []));
    targetFolder.sourceFileCount = (Number(targetFolder.sourceFileCount || 0) || 0)
      + (Number(clone.sourceFileCount || 0) || countSourceSelections(clone));
    return folderByName;
  }

  (node.children || []).forEach((child) => collectPackageWorkspaceFolderNodes(child, packageFolderNames, folderByName));
  return folderByName;
}

function getPackageWorkspaceFolderChildren() {
  const packageFolderNames = getPackageXmlSourceFolderNames();
  return [...collectPackageWorkspaceFolderNodes(getBaseExplorerSourceTree(), packageFolderNames).values()]
    .map((node) => sortSourceChildren(node));
}

function getPackageXmlMetadataTypesForSourceFolder(folderName = "") {
  return getPackageXmlMetadataTypeCandidates()
    .filter((metadataType) => getSourceFolderForMetadataDefinition(metadataType) === folderName);
}

function getPackageXmlMetadataTypeIdsForSourceFolder(folderName = "") {
  return getPackageXmlMetadataTypesForSourceFolder(folderName)
    .map((metadataType) => metadataType.id)
    .filter(Boolean);
}

function getPackageWildcardEntriesForMetadataTypes(metadataTypes = []) {
  if (!metadataTypes.length || metadataTypes.some((metadataType) => metadataType.inFolder)) {
    return [];
  }

  const apiTypes = metadataTypes.flatMap((metadataType) => getPackageXmlMetadataApiTypes(metadataType));
  const wildcardMetadataTypes = getPackageXmlWildcardMetadataTypeSet();
  if (!apiTypes.length || apiTypes.some((apiType) => !wildcardMetadataTypes.has(apiType))) {
    return [];
  }

  return [...new Set(apiTypes)]
    .map((type) => ({ type, member: "*" }));
}

function getPackageWildcardEntriesForSourceFolder(folderName = "") {
  return getPackageWildcardEntriesForMetadataTypes(getPackageXmlMetadataTypesForSourceFolder(folderName));
}

function getFolderSearchIndexValues(node = {}) {
  const sourcePath = node.path || node.selection?.sourcePath || "";
  if (!sourcePath) {
    return [];
  }

  const localEntry = localSourceEntries.get(sourcePath);
  const indexEntries = searchDetailEntryCache.get(sourcePath) || [];
  return [
    localEntry?.metadataType,
    localEntry?.typeLabel,
    localEntry?.metadataName,
    localEntry?.label,
    ...indexEntries.flatMap((entry) => [entry.label, entry.value, entry.searchTerm])
  ].filter((value) => value !== undefined && value !== null && value !== "");
}

function matchesFixedSearchText(value = "", searchTerm = "") {
  const terms = getSearchTerms(searchTerm);
  if (!terms.length) {
    return true;
  }

  const haystack = String(value || "").toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function sourceNodeMatchesFolderSearch(node = {}, term = "") {
  const searchTerm = String(term || "").trim();
  if (!searchTerm) {
    return true;
  }

  const values = [
    node.name,
    node.label,
    node.path,
    node.secondary,
    getSourceNodeDisplaySecondary(node),
    ...(Array.isArray(node.searchValues) ? node.searchValues : []),
    ...getFolderSearchIndexValues(node)
  ]
    .filter((value) => value !== undefined && value !== null && value !== "");

  return values.some((value) => matchesFixedSearchText(value, searchTerm));
}

function getSourceFileNameApiCandidates(fileName = "") {
  const name = String(fileName || "").trim();
  if (!name) {
    return [];
  }

  return [
    name,
    name.replace(/-meta\.xml$/i, ""),
    name.replace(/\.[^.]+$/i, "")
  ]
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSourceNodeApiNameValues(node = {}) {
  const selection = node.selection || {};
  const sourcePath = normalizeMyOrgResultPath(node.path || selection.sourcePath || "");
  const metadataType = selection.metadataType || getMetadataFolderNameFromPath(sourcePath);
  const inferredFullName = sourcePath
    ? inferMetadataFullNameFromSourcePath(
      sourcePath,
      metadataType,
      inferMetadataApiTypeFromSourcePath(sourcePath, metadataType)
    )
    : "";
  const sourceBaseName = getSourceBaseName(sourcePath || node.name || "");
  const splitValues = [
    selection.objectKey,
    selection.fieldKey,
    selection.itemKey,
    inferredFullName
  ].flatMap((value) => {
    const parts = splitSchemaKey(value);
    return [parts.apiName, parts.label];
  });

  return [
    ...splitValues,
    inferredFullName,
    ...getSourceFileNameApiCandidates(node.name),
    ...getSourceFileNameApiCandidates(sourceBaseName)
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function getSourceNodeFileFilterValues(node = {}) {
  const display = getSourceNodeDisplayParts(node);
  return [
    node.name,
    node.label,
    getSourceBaseName(node.path || ""),
    node.secondary,
    node.metaText,
    display.primary,
    display.secondary,
    getSourceNodeRecordLabel(node),
    getSourceFolderDisplayLabel(node),
    ...getSourceNodeApiNameValues(node),
    ...(Array.isArray(node.searchValues) ? node.searchValues : [])
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function sourceNodeMatchesFileNameFilter(node = {}, term = "") {
  const searchTerm = String(term || "").trim();
  if (!searchTerm) {
    return true;
  }

  return [
    ...getSourceNodeFileFilterValues(node),
  ]
    .some((value) => matchesFixedSearchText(value, searchTerm));
}

function isFileFilterSuggestionValue(value = "") {
  const text = String(value || "").trim();
  return Boolean(text) && !text.includes("/") && !isDefaultSourcePath(text) && !isLegacySourceRootPath(text);
}

const SOURCE_SUBFOLDER_DISPLAY_LABELS = {
  businessProcesses: "Business Processes",
  compactLayouts: "Compact Layouts",
  fields: "Fields",
  fieldSets: "Field Sets",
  listViews: "List Views",
  recordTypes: "Record Types",
  validationRules: "Validation Rules",
  webLinks: "Web Links"
};

function normalizeSourceDisplaySecondary(value = "", primary = "") {
  const text = String(value || "").trim();
  const primaryText = String(primary || "").trim();
  return text && text !== primaryText ? text : "";
}

function getSourceSelectionDisplayLabel(selection = {}, sourcePath = "") {
  if (selection.type === "field") {
    return splitSchemaKey(selection.fieldKey).label || "";
  }

  if (selection.type === "object") {
    return splitSchemaKey(selection.objectKey).label || "";
  }

  if (selection.type === "metadataItem") {
    const item = findMetadataItem(selection.metadataType, selection.itemKey);
    return item?.label || splitSchemaKey(selection.itemKey).label || "";
  }

  if (selection.type === "localFile") {
    const entry = localSourceEntries.get(selection.sourcePath || sourcePath);
    return entry?.label || entry?.metadataName || entry?.typeLabel || entry?.metadataType || "";
  }

  return "";
}

function isObjectSourceNode(node = {}) {
  return node.selection?.type === "object"
    || isObjectSourceLeafFolderPath(node.path || "")
    || /\.object$/i.test(node.name || "");
}

function isGenericObjectSourceLabel(node = {}, value = "") {
  return isObjectSourceNode(node) && String(value || "").trim() === "Object";
}

function getLocalSourceDisplayLabel(sourcePath = "") {
  const entry = localSourceEntries.get(sourcePath);
  return entry?.label || entry?.metadataName || entry?.typeLabel || entry?.metadataType || entry?.contentKind || "";
}

function getSourceFolderDisplayLabel(node = {}) {
  if (node.kind !== "folder") {
    return "";
  }

  const folderName = node.name || getSourceBaseName(node.path || "");
  return getSourceFolderLabel(folderName)
    || SOURCE_SUBFOLDER_DISPLAY_LABELS[folderName]
    || "";
}

function getSourceSearchValueDisplayLabel(node = {}) {
  const primary = node.name || getSourceBaseName(node.path || "");
  const values = Array.isArray(node.searchValues) ? node.searchValues : [];
  const parsedLabel = values
    .map((value) => splitSchemaKey(value).label)
    .map((value) => normalizeSourceDisplaySecondary(value, primary))
    .find(Boolean);
  if (parsedLabel) {
    return parsedLabel;
  }

  return values
    .map((value) => String(value || "").trim())
    .filter(isFileFilterSuggestionValue)
    .map((value) => normalizeSourceDisplaySecondary(value, primary))
    .find(Boolean) || "";
}

function getSourceNodeExplicitLabel(node = {}) {
  return [
    node.label,
    node.kind === "folder" ? getSourceFolderDisplayLabel(node) : "",
    getSourceSelectionDisplayLabel(node.selection || {}, node.path || ""),
    getLocalSourceDisplayLabel(node.path || ""),
    node.kind === "folder" && !isGenericObjectSourceLabel(node, node.secondary) ? node.secondary : ""
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function getSourceNodeRecordLabel(node = {}) {
  return [
    node.label,
    getSourceSelectionDisplayLabel(node.selection || {}, node.path || ""),
    getLocalSourceDisplayLabel(node.path || ""),
    !isGenericObjectSourceLabel(node, node.secondary) ? node.secondary : ""
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function getSourceNodeDisplaySecondary(node = {}) {
  return getSourceNodeDisplayParts(node).secondary;
}

function getSourceNodeDisplayParts(node = {}) {
  const name = node.name || getSourceBaseName(node.path || "");
  const explicitLabel = normalizeSourceDisplaySecondary(getSourceNodeExplicitLabel(node), name);
  if (explicitLabel) {
    return {
      primary: explicitLabel,
      secondary: name
    };
  }

  const primary = name;
  const folderLabel = node.kind === "folder" ? getSourceFolderDisplayLabel(node) : "";
  const secondary = [
    node.kind === "folder" ? node.secondary : "",
    folderLabel,
    node.kind === "file" ? node.secondary : "",
    node.kind === "file" ? node.metaText : "",
    getSourceSearchValueDisplayLabel(node)
  ]
    .map((value) => normalizeSourceDisplaySecondary(value, primary))
    .find(Boolean);
  return {
    primary,
    secondary: secondary || getParentSourcePath(node.path || "") || ""
  };
}

function sourceTreePathShowsOnlyName(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  return path === MANIFEST_FOLDER_SOURCE_PATH
    || path.startsWith(`${MANIFEST_FOLDER_SOURCE_PATH}/`);
}

function isRetiredMyFoldersPath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  return path === "My Folders" || path.startsWith("My Folders/");
}

function getSourceTreeNodeDisplayParts(node = {}) {
  if (sourceTreePathShowsOnlyName(node.path || node.selection?.sourcePath || "")) {
    return {
      primary: node.name || getSourceBaseName(node.path || ""),
      secondary: ""
    };
  }
  return getSourceNodeDisplayParts(node);
}

function getSourceNodeNameAndLabelValues(node = {}) {
  return getSourceNodeFileFilterValues(node)
    .filter(isFileFilterSuggestionValue);
}

function filterSourceTreeByFileName(node = {}, term = "", isRoot = false) {
  const matches = sourceNodeMatchesFileNameFilter(node, term);
  const children = matches && !isRoot
    ? (node.children || [])
    : (node.children || [])
      .map((child) => filterSourceTreeByFileName(child, term))
      .filter(Boolean);

  if (isRoot || matches || children.length) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function openFilteredSourceTreeFileAncestors(node = {}, limit = 250) {
  let openedCount = 0;
  const visit = (currentNode = {}) => {
    if (!currentNode || openedCount >= limit) {
      return;
    }
    if (currentNode.kind === "file" && currentNode.path) {
      openSourcePathAncestors(currentNode.path);
      openedCount += 1;
    }
    (currentNode.children || []).forEach(visit);
  };
  visit(node);
  return openedCount;
}

function collectFileFilterSuggestions(node = {}, suggestions = new Map()) {
  const display = getSourceTreeNodeDisplayParts(node);
  const nodeName = node.name || getSourceBaseName(node.path || node.selection?.sourcePath || "");
  const addSuggestion = (value = "", meta = "") => {
    const name = String(value || "").trim();
    if (!name || suggestions.has(name)) {
      return;
    }
    suggestions.set(name, {
      name,
      meta: normalizeSourceDisplaySecondary(meta, name)
    });
  };

  addSuggestion(display.primary, display.secondary || nodeName);
  addSuggestion(nodeName, display.primary);

  (node.children || []).forEach((child) => {
    collectFileFilterSuggestions(child, suggestions);
  });

  return suggestions;
}

function updateFileFilterSuggestions(sourceRoot = {}) {
  if (!schemaFileFilterSuggestionsEl) {
    return;
  }

  const signature = getExplorerSourceTreeCacheSignature();
  if (signature && fileFilterSuggestionsSignature === signature) {
    return;
  }
  fileFilterSuggestionsSignature = signature;

  fileFilterSuggestionOptions = [...collectFileFilterSuggestions(sourceRoot).values()]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  updateFileFilterInlineSuggestions();
}

function ensureFileFilterSuggestionOptions() {
  if (fileFilterSuggestionOptions.length) {
    return;
  }

  const sourceRoot = getBaseExplorerSourceTree();
  fileFilterSuggestionOptions = [...collectFileFilterSuggestions(sourceRoot).values()]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function hideFileFilterInlineSuggestions() {
  fileFilterSuggestionItems = [];
  fileFilterSuggestionIndex = -1;
  if (schemaFileFilterSuggestionsEl) {
    schemaFileFilterSuggestionsEl.hidden = true;
    schemaFileFilterSuggestionsEl.textContent = "";
  }
}

function getFileFilterInlineSuggestionMatches(term = "") {
  const searchTerm = String(term || "").trim().toLocaleLowerCase();
  if (!searchTerm) {
    return [];
  }

  return fileFilterSuggestionOptions
    .filter((item) => {
      const name = String(item.name || "").toLocaleLowerCase();
      const meta = String(item.meta || "").toLocaleLowerCase();
      return name.startsWith(searchTerm) || name.includes(searchTerm) || meta.includes(searchTerm);
    })
    .sort((left, right) => {
      const leftName = String(left.name || "").toLocaleLowerCase();
      const rightName = String(right.name || "").toLocaleLowerCase();
      const leftStarts = leftName.startsWith(searchTerm);
      const rightStarts = rightName.startsWith(searchTerm);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .slice(0, FILE_FILTER_SUGGESTION_LIMIT);
}

function renderFileFilterInlineSuggestions(items = []) {
  if (!schemaFileFilterSuggestionsEl || !items.length) {
    hideFileFilterInlineSuggestions();
    return;
  }

  fileFilterSuggestionItems = items;
  fileFilterSuggestionIndex = Math.min(fileFilterSuggestionIndex, items.length - 1);
  schemaFileFilterSuggestionsEl.textContent = "";

  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "data-export-inline-suggestion";
    button.classList.toggle("active", index === fileFilterSuggestionIndex);

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
      selectFileFilterInlineSuggestion(index);
    });
    schemaFileFilterSuggestionsEl.append(button);
  });

  schemaFileFilterSuggestionsEl.hidden = false;
}

function updateFileFilterInlineSuggestions() {
  ensureFileFilterSuggestionOptions();
  fileFilterSuggestionIndex = -1;
  renderFileFilterInlineSuggestions(getFileFilterInlineSuggestionMatches(schemaFileFilterInput?.value || ""));
}

function setFileFilterInlineSuggestionIndex(index) {
  if (!fileFilterSuggestionItems.length || !schemaFileFilterSuggestionsEl || schemaFileFilterSuggestionsEl.hidden) {
    return;
  }

  fileFilterSuggestionIndex = (index + fileFilterSuggestionItems.length) % fileFilterSuggestionItems.length;
  Array.from(schemaFileFilterSuggestionsEl.children).forEach((child, childIndex) => {
    child.classList.toggle("active", childIndex === fileFilterSuggestionIndex);
  });
  schemaFileFilterSuggestionsEl.children[fileFilterSuggestionIndex]?.scrollIntoView({ block: "nearest" });
}

function selectFileFilterInlineSuggestion(index = fileFilterSuggestionIndex) {
  const item = fileFilterSuggestionItems[index];
  if (!item?.name || !schemaFileFilterInput) {
    hideFileFilterInlineSuggestions();
    return;
  }

  schemaFileFilterInput.value = item.name;
  hideFileFilterInlineSuggestions();
  schemaFileFilterInput.focus();
  void runFileNameFilter();
}

function handleFileFilterKeydown(event) {
  const hasSuggestions = schemaFileFilterSuggestionsEl
    && !schemaFileFilterSuggestionsEl.hidden
    && fileFilterSuggestionItems.length > 0;
  if (hasSuggestions) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFileFilterInlineSuggestionIndex(fileFilterSuggestionIndex < 0 ? 0 : fileFilterSuggestionIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFileFilterInlineSuggestionIndex(fileFilterSuggestionIndex < 0 ? fileFilterSuggestionItems.length - 1 : fileFilterSuggestionIndex - 1);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && fileFilterSuggestionIndex >= 0) {
      event.preventDefault();
      selectFileFilterInlineSuggestion();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideFileFilterInlineSuggestions();
      return;
    }
  }

  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  hideFileFilterInlineSuggestions();
  void runFileNameFilter();
}

function getExplorerSourceTreeCacheSignature() {
  const defaultFolders = getDefaultMetadataFolderNames().join(",");
  const localPaths = [...localSourceEntries.keys()].sort().join("|");
  const compactGeneratedAt = compactMetadataIndexMeta?.generatedAt || "";
  const compactCount = compactMetadataIndexMeta?.count || 0;
  const schemaGeneratedAt = schemaStore?.generatedAt || "";
  const schemaMetadataTypes = (schemaStore?.metadataTypes || []).join(",");
  const namespaceScope = schemaStore?.defaultNamespaceScope || "";
  return [
    compactGeneratedAt,
    compactCount,
    schemaGeneratedAt,
    schemaMetadataTypes,
    namespaceScope,
    defaultFolders,
    localPaths
  ].join("::");
}

function invalidateExplorerSourceTreeCache(options = {}) {
  explorerSourceTreeCache = null;
  explorerSourceTreeCacheSignature = "";
  if (options.keepSuggestions !== true) {
    fileFilterSuggestionsSignature = "";
    fileFilterSuggestionOptions = [];
    hideFileFilterInlineSuggestions();
  }
}

function filterSourceTreeByFolderSearch(node = {}, term = "", isRoot = false) {
  const children = (node.children || [])
    .map((child) => filterSourceTreeByFolderSearch(child, term))
    .filter(Boolean);
  const matches = sourceNodeMatchesFolderSearch(node, term);

  if (isRoot || matches || children.length) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function getBaseExplorerSourceTree() {
  const signature = getExplorerSourceTreeCacheSignature();
  if (explorerSourceTreeCache && explorerSourceTreeCacheSignature === signature) {
    return explorerSourceTreeCache;
  }

  let sourceRoot;
  const compactSourceRoot = getCompactMetadataSourceTree();
  if (compactSourceRoot) {
    sourceRoot = hideEmptySourceFolders(excludeManifestSourceTreePaths(compactSourceRoot, true), true);
  } else {
    const groups = getMetadataGroups();
    if (schemaStore?.generatedAt && groups.length) {
      sourceRoot = hideEmptySourceFolders(createSourceExplorerTree(createAllSourceVisibleGroups(groups), {
        showDefaultSourceRoot: true,
        sourceRootPath: SOURCE_DEFAULT_ROOT,
        sourceRootName: SOURCE_DEFAULT_ROOT.split("/")[0],
        includeEmptyDefaultFolders: true,
        emptyDefaultFolderNames: getDefaultMetadataFolderNames(),
        includePackageManifest: false
      }), true);
    } else {
      const visibleGroups = [];
      sourceRoot = hideEmptySourceFolders(createSourceExplorerTree(visibleGroups, {
        showDefaultSourceRoot: true,
        sourceRootPath: SOURCE_DEFAULT_ROOT,
        sourceRootName: SOURCE_DEFAULT_ROOT.split("/")[0],
        includeEmptyDefaultFolders: true,
        emptyDefaultFolderNames: getDefaultMetadataFolderNames(),
        includePackageManifest: false
      }), true);
    }
  }

  explorerSourceTreeCache = sourceRoot;
  explorerSourceTreeCacheSignature = signature;
  return sourceRoot;
}

function getExplorerSourceTree() {
  const sourceRoot = getBaseExplorerSourceTree();
  return schemaFileFilterTerm
    ? filterSourceTreeByFileName(sourceRoot, schemaFileFilterTerm, true)
    : sourceRoot;
}

function createPackageXmlSourceTree() {
  const root = createSourceTreeNode("workspace", "", "root", { alwaysOpen: true });
  applyLocalSourceOverlay(root, {
    includeEntry: (entry) => isManifestSourcePath(entry?.path)
  });
  addPackageManifestExplorerNode(root);
  return sortSourceChildren(root);
}

function getSearchBaseExplorerSourceTree() {
  const selectedFolderNames = new Set(getSelectedSearchFolderNames());
  const groups = getMetadataGroups();
  const visibleGroups = schemaStore?.generatedAt && groups.length
    ? createAllSourceVisibleGroups(groups)
      .filter((visibleGroup) => selectedFolderNames.has(getSourceFolderForVisibleGroup(visibleGroup)))
    : [];
  return hideEmptySourceFolders(createSourceExplorerTree(visibleGroups), true);
}

function filterSourceTreeBySearchSelection(node = {}, isRoot = false) {
  const selectedFolderNames = new Set(getSelectedSearchFolderNames());
  const children = (node.children || [])
    .map((child) => filterSourceTreeBySearchSelection(child))
    .filter(Boolean);
  const folderName = getMetadataFolderNameFromPath(node.path || node.selection?.sourcePath || "");
  const matches = !folderName || selectedFolderNames.has(folderName);

  if (isRoot || matches || children.length) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function getSearchSourceTree() {
  const sourceRoot = filterSourceTreeBySearchSelection(getSearchBaseExplorerSourceTree(), true);
  return schemaFolderSearchTerm
    ? filterSourceTreeByFolderSearch(sourceRoot, schemaFolderSearchTerm, true)
    : sourceRoot;
}

function appendBodyHighlightedText(target, text, term = "") {
  const str = String(text || "");
  const needle = String(term || "").trim().toLowerCase();
  if (!str || !needle) {
    target.appendChild(document.createTextNode(str));
    return;
  }
  let index = 0;
  const lower = str.toLowerCase();
  while (index < str.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) {
      target.appendChild(document.createTextNode(str.slice(index)));
      break;
    }
    if (found > index) {
      target.appendChild(document.createTextNode(str.slice(index, found)));
    }
    const mark = document.createElement("mark");
    mark.textContent = str.slice(found, found + needle.length);
    target.appendChild(mark);
    index = found + needle.length;
  }
}

function createBodySearchExternalSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"].forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
}

function getBodySearchSalesforceUrl(result = {}) {
  const id = String(result.id || "").trim();
  return id ? getSalesforceRecordUrl(id) : "";
}

function renderBodySearchSnippets(result = {}, term = "") {
  const matches = Array.isArray(result.matches) ? result.matches : [];
  if (!matches.length) return null;
  const container = document.createElement("div");
  container.className = "popup-search-result-snippets";
  matches.forEach(({ label = "", snippet = "" }) => {
    if (!snippet) return;
    const row = document.createElement("div");
    row.className = "popup-search-result-snippet";
    appendBodyHighlightedText(row, label ? `${label}: ${snippet}` : snippet, term);
    container.appendChild(row);
  });
  return container.childElementCount ? container : null;
}

function renderBodySearchResultCard(result = {}, term = "") {
  const card = document.createElement("div");
  card.className = "popup-search-result";

  const typePart = result.typeLabel || result.type || "";
  const nsPart = result.record?.NamespacePrefix || "";
  const infoText = [typePart, nsPart].filter(Boolean).join(" · ");

  const mainBtn = document.createElement("button");
  mainBtn.type = "button";
  mainBtn.className = "popup-search-result-main";
  mainBtn.addEventListener("click", () => {
    const url = getBodySearchSalesforceUrl(result);
    if (url) openExternalUrl(url);
  });

  const nameEl = document.createElement("span");
  nameEl.className = "popup-search-result-name";
  appendBodyHighlightedText(nameEl, result.name || result.apiName || result.id || "", term);

  const labelEl = document.createElement("span");
  labelEl.className = "popup-search-result-label";
  labelEl.textContent = infoText;

  mainBtn.append(nameEl, labelEl);

  const salesforceUrl = getBodySearchSalesforceUrl(result);
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "icon-button secondary popup-search-result-open";
  openBtn.title = t("schemaUi.openInSalesforce");
  openBtn.setAttribute("aria-label", t("schemaUi.openInSalesforce"));
  openBtn.disabled = !salesforceUrl;
  openBtn.appendChild(createBodySearchExternalSvg());
  openBtn.addEventListener("click", () => openExternalUrl(salesforceUrl));

  card.append(mainBtn, openBtn);
  const snippets = renderBodySearchSnippets(result, term);
  if (snippets) card.appendChild(snippets);
  return card;
}

function renderBodySearchResults(results = [], term = "", options = {}) {
  const container = schemaBodySearchResultsEl;
  if (!container) return;
  container.textContent = "";
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-search-empty";
    empty.textContent = options.isSearching
      ? `Searching for "${term}"…`
      : term
        ? `No results for "${term}".`
        : "Search metadata body by API name, label, description, or code content.";
    container.appendChild(empty);
    return;
  }
  results.forEach((result) => container.appendChild(renderBodySearchResultCard(result, term)));
}

function renderBodySearchPanel() {
  renderBodySearchResults(schemaBodySearchEntries, schemaBodySearchTerm);
}

async function runBodySearch() {
  if (!session?.host || !session?.sid) return;
  const term = String(schemaBodySearchInput?.value || "").trim();
  schemaBodySearchTerm = term;

  if (!term) {
    schemaBodySearchEntries = [];
    renderBodySearchResults([], "");
    if (searchClearButton) searchClearButton.hidden = true;
    return;
  }

  if (searchClearButton) searchClearButton.hidden = false;
  const requestId = schemaBodySearchRequestId + 1;
  schemaBodySearchRequestId = requestId;
  schemaBodySearchEntries = [];
  renderBodySearchResults([], term, { isSearching: true });

  const handleProgress = (progress = {}) => {
    if (requestId !== schemaBodySearchRequestId) return;
    schemaBodySearchEntries = progress.records || [];
    renderBodySearchResults(schemaBodySearchEntries, term, { isSearching: true });
  };

  try {
    const result = await searchMetadataByText(session.host, session.sid, term, {
      includeInstalledPackages: true,
      limit: 50,
      metadataCatalogTimeoutMs: 45000,
      includeDeepSearch: schemaBodySearchIncludeDetails?.checked === true,
      onProgress: handleProgress
    });
    if (requestId !== schemaBodySearchRequestId) return;
    schemaBodySearchEntries = result?.records || [];
    renderBodySearchResults(schemaBodySearchEntries, term);
  } catch (error) {
    if (requestId !== schemaBodySearchRequestId) return;
    schemaBodySearchEntries = [];
    renderBodySearchResults([], term);
    const empty = schemaBodySearchResultsEl?.querySelector(".schema-empty");
    if (empty) empty.textContent = `Search failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runFolderTreeSearch() {
  schemaFolderSearchTerm = String(schemaFolderSearchInput?.value || "").trim();
  const searchTerm = schemaFolderSearchTerm;
  activeSearchTerm = "";
  activeSearchIncludeAllNamespaces = false;
  activeSearchInstalledPackageNamespaces = [];
  searchResultReachedMax = false;
  activeIndexSearchRequestId += 1;
  activeFolderIndexSearchRequestId += 1;
  clearMyOrgSearchLocalFiles();
  if (searchTerm) {
    setStatus(t("schemaStatus.searchFilesTerm", { term: searchTerm }));
    setSchemaSummary(t("schemaStatus.showingFileMatches", { term: searchTerm }));
  } else {
    setStatus(t("schemaStatus.searchFilesCleared"));
    setSchemaSummary(t("schemaStatus.folderListLoaded"));
  }
  renderSearchPanel();
  updateSearchRunButtonState();
}

async function runFileNameFilter() {
  schemaFileFilterTerm = String(schemaFileFilterInput?.value || "").trim();
  activeFileFilterSearchRequestId += 1;
  clearMyOrgSearchLocalFiles();
  if (schemaFileFilterTerm) {
    setStatus(t("schemaStatus.findFileOrFolder", { term: schemaFileFilterTerm }));
    setSchemaSummary(t("schemaStatus.filteringNames", { term: schemaFileFilterTerm }));
  } else {
    setStatus(t("schemaStatus.nameFindCleared"));
    setSchemaSummary(t("schemaStatus.folderListLoaded"));
  }
  renderSchema({ renderDetail: false });
  if (schemaFileFilterTerm) {
    setSchemaSummary(t("schemaStatus.showingNameMatches", { term: schemaFileFilterTerm }));
  }
}

function clearFileNameFilterIfInputEmpty() {
  const nextTerm = String(schemaFileFilterInput?.value || "").trim();
  if (!nextTerm && schemaFileFilterTerm) {
    void runFileNameFilter();
  }
}

function getPackageWildcardEntriesForNode(node = {}) {
  const folderName = getMetadataFolderNameFromPath(node.path || "") || node.name || "";
  return getPackageWildcardEntriesForSourceFolder(folderName);
}

function getPackageWildcardSelectionKeys(node = {}) {
  return getPackageWildcardEntriesForNode(node).map((entry) => getPackageSelectionKey(entry));
}

async function retrievePackageXmlSourceFolder(node = {}, options = {}) {
  if (node.autoRetrieve === false) {
    return false;
  }

  if (!session?.host || !session?.sid) {
    return false;
  }

  const folderName = getMetadataFolderNameFromPath(node.path || "") || node.name || "";
  const sourcePath = node.path || (folderName ? `${SOURCE_DEFAULT_PREFIX}${folderName}` : "");
  const namespaceOptions = getSelectedRetrieveNamespaceOptions();
  const namespaceScopeKey = getNamespaceScopeKey(namespaceOptions);
  const namespaceScopeChanged = folderNamespaceScopeByPath.get(sourcePath) !== namespaceScopeKey;
  const metadataTypes = getFolderMetadataTypesForNamespaceScope(
    sourcePath,
    getPackageXmlMetadataTypeIdsForSourceFolder(folderName),
    namespaceOptions
  );
  if (!metadataTypes.length || folderRetrieveInProgress.has(sourcePath || folderName)) {
    return false;
  }

  const retrieveKey = sourcePath || folderName;
  folderRetrieveInProgress.add(retrieveKey);
  metadataActionInProgress = true;
  updateMetadataSelectionState();
  try {
    const { includeInstalledPackages, installedPackageNamespaces } = namespaceOptions;
    const packageLabel = getInstalledPackageRetrieveLabel(installedPackageNamespaces, includeInstalledPackages);
    const loaded = await retrieveMetadataTypes(metadataTypes, folderName || t("schemaStatus.labelFolder"), {
      namesOnly: true,
      objectNamesOnly: metadataTypes.includes("objects"),
      includeInstalledPackages,
      installedPackageNamespaces,
      persist: false,
      render: false,
      loadSearchSupport: false,
      clearSearchDetails: true,
      getBaseStore: () => (
        namespaceScopeChanged
          ? createStoreWithoutMetadataTypes(schemaStore, metadataTypes)
          : schemaStore
      ),
      statusPrefix: options.statusPrefix || t("schemaStatus.prefixPackageXmlLoad"),
      summaryPrefix: options.summaryPrefix || t("schemaStatus.prefixPackageXmlLoading"),
      completionMessage: options.completionMessage || t("schemaStatus.loadedNames", { name: folderName || t("schemaStatus.labelFolder"), packageLabel })
    });
    if (loaded) {
      folderNamespaceScopeByPath.set(sourcePath, namespaceScopeKey);
      if (options.render !== false) {
        renderSchema({ renderDetail: false });
        if (selectedNode?.type === "packageCreate") {
          renderPackageXmlCreateDetail();
        }
      }
    }
    return loaded;
  } finally {
    folderRetrieveInProgress.delete(retrieveKey);
    metadataActionInProgress = false;
    updateMetadataSelectionState();
  }
}

function getPackageCreateFolderPath(node = {}) {
  return node.path || (node.name ? `${SOURCE_DEFAULT_PREFIX}${node.name}` : "");
}

function getPackageCreateFolderNodes() {
  const packageFolderNames = getPackageXmlSourceFolderNames();
  const folderByName = new Map();
  getPackageWorkspaceFolderChildren().forEach((node) => {
    const folderName = getMetadataFolderNameFromPath(node.path || "") || node.name || "";
    if (packageFolderNames.has(folderName)) {
      folderByName.set(folderName, node);
    }
  });
  getPackageDefaultFolderChildren().forEach((node) => {
    const folderName = getMetadataFolderNameFromPath(node.path || "") || node.name || "";
    if (packageFolderNames.has(folderName) && !folderByName.has(folderName)) {
      folderByName.set(folderName, node);
    }
  });

  packageFolderNames.forEach((folderName) => {
    if (folderByName.has(folderName)) {
      return;
    }
    folderByName.set(folderName, createSourceTreeNode(folderName, `${SOURCE_DEFAULT_PREFIX}${folderName}`, "folder", {
      keepEmpty: true,
      secondary: getSourceFolderLabel(folderName),
      searchValues: getSourceFolderSearchValues(folderName)
    }));
  });

  return [...packageFolderNames]
    .sort((left, right) => String(left).localeCompare(String(right), undefined, { sensitivity: "base" }))
    .map((folderName) => folderByName.get(folderName));
}

function packageCreateFolderMatchesFilter(node = {}, filterTerm = "") {
  const term = String(filterTerm || "").trim();
  if (!term) {
    return true;
  }
  return [
    node.name,
    node.label,
    node.secondary,
    getSourceFolderLabel(getMetadataFolderNameFromPath(node.path || "") || node.name || ""),
    ...(Array.isArray(node.searchValues) ? node.searchValues : [])
  ]
    .filter(Boolean)
    .some((value) => matchesFixedSearchText(value, term));
}

function getPackageCreateActiveFolderNode(folders = null) {
  const folderNodes = Array.isArray(folders) ? folders : getPackageCreateFolderNodes();
  if (!folderNodes.length) {
    packageCreateActiveFolderPath = "";
    return null;
  }

  const activeNode = packageCreateActiveFolderPath
    ? folderNodes.find((node) => getPackageCreateFolderPath(node) === packageCreateActiveFolderPath)
    : null;
  if (activeNode) {
    return activeNode;
  }

  packageCreateActiveFolderPath = getPackageCreateFolderPath(folderNodes[0]);
  return folderNodes[0];
}

function getUniquePackageManifestEntries(entries = []) {
  const entriesByKey = new Map();
  entries.forEach((entry) => {
    const normalizedEntry = normalizePackageManifestEntry(entry);
    const key = getPackageSelectionKey(normalizedEntry);
    if (key && normalizedEntry.type && normalizedEntry.member && !entriesByKey.has(key)) {
      entriesByKey.set(key, normalizedEntry);
    }
  });
  return [...entriesByKey.values()].sort((left, right) => (
    left.type.localeCompare(right.type) || left.member.localeCompare(right.member)
  ));
}

function getPackageCreateEntriesForNode(node = {}) {
  return getUniquePackageManifestEntries(getPackageManifestEntriesForNode(node));
}

function collectPackageEntryDisplayLabels(node = {}, displayByKey = new Map()) {
  const display = getSourceNodeDisplayParts(node);
  getPackageManifestEntriesForSelection(node.selection)
    .map((entry) => getPackageSelectionKey(entry))
    .filter(Boolean)
    .forEach((key) => {
      if (!displayByKey.has(key)) {
        displayByKey.set(key, display.secondary || getSourceNodeRecordLabel(node) || node.label || node.secondary || "");
      }
    });
  (node.children || []).forEach((child) => collectPackageEntryDisplayLabels(child, displayByKey));
  return displayByKey;
}

function getPackageCreateItemRows(node = {}) {
  const displayByKey = collectPackageEntryDisplayLabels(node);
  return getPackageCreateEntriesForNode(node).map((entry) => ({
    entry,
    key: getPackageSelectionKey(entry),
    label: displayByKey.get(getPackageSelectionKey(entry)) || ""
  }));
}

function packageCreateItemMatchesFilter(item = {}, filterTerm = "") {
  const term = String(filterTerm || "").trim();
  if (!term) {
    return true;
  }
  return matchesFixedSearchText(item.entry?.member || "", term);
}

function getPackageEntrySelectionState(entries = []) {
  const keys = getUniquePackageManifestEntries(entries)
    .map((entry) => getPackageSelectionKey(entry))
    .filter(Boolean);
  const selectedCount = keys.filter((key) => selectedPackageMembers.has(key)).length;
  return {
    total: keys.length,
    selectedCount,
    checked: keys.length > 0 && selectedCount === keys.length,
    indeterminate: selectedCount > 0 && selectedCount < keys.length
  };
}

function setPackageEntriesSelected(entries = [], isSelected = false) {
  getUniquePackageManifestEntries(entries)
    .map((entry) => getPackageSelectionKey(entry))
    .filter(Boolean)
    .forEach((key) => updateSelectedPackageMember(key, isSelected));
}

function getPackageCreateFolderSelectionState(node = {}) {
  return getPackageEntrySelectionState(getPackageCreateEntriesForNode(node));
}

function getPackageBuilderListScrollKey(list) {
  const listKey = list?.dataset?.packageBuilderList || "";
  if (!listKey) {
    return "";
  }

  if (listKey === "items") {
    return `${listKey}:${list.dataset.packageBuilderFolderPath || ""}`;
  }

  return listKey;
}

function capturePackageBuilderScrollState() {
  if (!schemaDetailEl?.querySelector(".schema-package-builder")) {
    return null;
  }

  const listScroll = new Map();
  schemaDetailEl.querySelectorAll(".schema-package-builder-list[data-package-builder-list]").forEach((list) => {
    const key = getPackageBuilderListScrollKey(list);
    if (key) {
      listScroll.set(key, {
        left: list.scrollLeft,
        top: list.scrollTop
      });
    }
  });

  return {
    detailLeft: schemaDetailEl.scrollLeft,
    detailTop: schemaDetailEl.scrollTop,
    listScroll
  };
}

function restorePackageBuilderScrollState(scrollState) {
  if (!scrollState) {
    return;
  }

  schemaDetailEl.scrollLeft = scrollState.detailLeft || 0;
  schemaDetailEl.scrollTop = scrollState.detailTop || 0;
  schemaDetailEl.querySelectorAll(".schema-package-builder-list[data-package-builder-list]").forEach((list) => {
    const key = getPackageBuilderListScrollKey(list);
    const position = key ? scrollState.listScroll?.get(key) : null;
    if (position) {
      list.scrollLeft = position.left;
      list.scrollTop = position.top;
    }
  });
}

function renderPackageXmlCreateDetail() {
  if (packageCreatePreviewMode) {
    renderPackageXmlCreatePreviewDetail();
    return;
  }
  renderPackageXmlCreateSelectionDetail();
}

function createPackageBuilderActionButton(label, handler) {
  const button = createDetailButton(label, "secondary schema-package-builder-action");
  button.addEventListener("click", () => {
    void handler();
  });
  return button;
}

function createPackageBuilderColumn(titleText, countText = "", actions = [], options = {}) {
  const column = document.createElement("section");
  column.className = "schema-package-builder-column";

  const head = document.createElement("div");
  head.className = "schema-package-builder-column-head";

  const title = document.createElement("div");
  title.className = "schema-package-builder-column-title";
  const titleLabel = document.createElement("h3");
  titleLabel.textContent = titleText;
  title.appendChild(titleLabel);
  if (countText) {
    const count = document.createElement("span");
    count.textContent = countText;
    title.appendChild(count);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "schema-package-builder-actions";
  actions.forEach((action) => actionRow.appendChild(action));

  const body = document.createElement("div");
  body.className = "schema-package-builder-list";
  if (options.listKey) {
    body.dataset.packageBuilderList = options.listKey;
  }
  if (options.folderPath) {
    body.dataset.packageBuilderFolderPath = options.folderPath;
  }

  head.append(title, actionRow);
  column.append(head, body);
  return {
    column,
    body
  };
}

function createPackageBuilderItemFilter() {
  const filter = document.createElement("div");
  filter.className = "schema-package-builder-filter";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-package-builder-filter-input";
  input.value = packageCreateItemFilterTerm;
  input.placeholder = t("schemaUi.filterMetadataName");
  input.setAttribute("aria-label", t("schemaUi.filterManifestItemAria"));
  input.addEventListener("input", () => {
    packageCreateItemFilterTerm = input.value;
    packageCreateItemFilterShouldFocus = true;
    renderPackageXmlCreateDetail();
  });
  input.addEventListener("search", () => {
    packageCreateItemFilterTerm = input.value;
    packageCreateItemFilterShouldFocus = true;
    renderPackageXmlCreateDetail();
  });

  filter.appendChild(input);
  return filter;
}

function createPackageBuilderFolderFilter() {
  const filter = document.createElement("div");
  filter.className = "schema-package-builder-filter";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-package-builder-filter-input";
  input.value = packageCreateFolderFilterTerm;
  input.placeholder = t("schemaUi.filterFolderNameOrLabel");
  input.setAttribute("aria-label", t("schemaUi.filterPackageFoldersAria"));
  input.addEventListener("input", () => {
    packageCreateFolderFilterTerm = input.value;
    packageCreateFolderFilterShouldFocus = true;
    renderPackageXmlCreateDetail();
  });
  input.addEventListener("search", () => {
    packageCreateFolderFilterTerm = input.value;
    packageCreateFolderFilterShouldFocus = true;
    renderPackageXmlCreateDetail();
  });

  filter.appendChild(input);
  return filter;
}

function createPackageBuilderFolderRow(node = {}) {
  const row = document.createElement("div");
  const folderPath = getPackageCreateFolderPath(node);
  const isActive = folderPath === packageCreateActiveFolderPath;
  row.className = "schema-package-builder-row schema-package-builder-folder-row";
  row.classList.toggle("active", isActive);

  const state = getPackageCreateFolderSelectionState(node);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.checked;
  checkbox.indeterminate = state.indeterminate;
  checkbox.disabled = state.total === 0;
  checkbox.setAttribute("aria-label", `Select ${node.name || "folder"}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => {
    setPackageEntriesSelected(getPackageCreateEntriesForNode(node), checkbox.checked);
    renderPackageXmlCreateDetail();
  });

  const nameButton = document.createElement("button");
  nameButton.type = "button";
  nameButton.className = "schema-package-builder-name-button";
  const text = document.createElement("span");
  text.className = "schema-package-builder-folder-text";
  const name = document.createElement("span");
  name.className = "schema-package-builder-folder-name";
  name.textContent = node.name || "folder";
  const label = document.createElement("span");
  label.className = "schema-package-builder-folder-label";
  label.textContent = node.secondary || getSourceFolderLabel(getMetadataFolderNameFromPath(node.path || "") || node.name || "") || "";
  text.append(name, label);
  nameButton.appendChild(text);
  nameButton.addEventListener("click", () => {
    void openPackageCreateFolder(node);
  });

  const meta = document.createElement("span");
  meta.className = "schema-package-builder-row-meta";
  meta.textContent = `${state.selectedCount}/${state.total}`;

  row.append(checkbox, nameButton, meta);
  return row;
}

function createPackageBuilderItemRow(item = {}) {
  const row = document.createElement("label");
  row.className = "schema-package-builder-row schema-package-builder-item-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.key ? selectedPackageMembers.has(item.key) : false;
  checkbox.disabled = !item.key;
  checkbox.addEventListener("change", () => {
    updateSelectedPackageMember(item.key, checkbox.checked);
    renderPackageXmlCreateDetail();
  });

  const text = document.createElement("span");
  text.className = "schema-package-builder-item-text";
  const member = document.createElement("span");
  member.className = "schema-package-builder-item-member";
  member.textContent = item.entry.member || "member";
  const label = document.createElement("span");
  label.className = "schema-package-builder-item-label";
  label.textContent = item.label || "";
  text.append(member, label);

  row.append(checkbox, text);
  return row;
}

function renderPackageXmlCreateSelectionDetail() {
  detailRequestId += 1;
  packageCreatePreviewMode = false;
  const scrollState = capturePackageBuilderScrollState();
  const sourcePath = getPackageCreateSourcePath();
  const manifestFileName = getPackageCreateFileName();
  const isWorkspaceManifest = isPackageWorkspaceManifestPath(sourcePath);
  const folders = getPackageCreateFolderNodes();
  const filteredFolders = folders.filter((folder) => packageCreateFolderMatchesFilter(folder, packageCreateFolderFilterTerm));
  const currentActiveFolder = getPackageCreateActiveFolderNode(folders);
  const currentActiveFolderPath = currentActiveFolder ? getPackageCreateFolderPath(currentActiveFolder) : "";
  const activeFolder = filteredFolders.length
    ? filteredFolders.find((folder) => getPackageCreateFolderPath(folder) === currentActiveFolderPath)
      || filteredFolders[0]
    : null;
  if (activeFolder) {
    packageCreateActiveFolderPath = getPackageCreateFolderPath(activeFolder);
  }
  const activeItems = activeFolder ? getPackageCreateItemRows(activeFolder) : [];
  const filteredActiveItems = activeItems.filter((item) => packageCreateItemMatchesFilter(item, packageCreateItemFilterTerm));
  const selectedCount = getSelectedPackageManifestEntries().length;

  schemaDetailEl.innerHTML = "";
  const header = createDetailTitle(manifestFileName, isWorkspaceManifest ? "Current workspace XML" : "Select metadata folders and files", `${selectedCount} members`, "file", {
    includeFormatSelect: false
  });
  const actions = header.querySelector(".schema-detail-actions");
  const previewButton = createDetailButton("Preview XML", "secondary schema-package-preview-button");
  previewButton.addEventListener("click", () => {
    packageCreatePreviewMode = true;
    renderPackageXmlCreateDetail();
  });
  actions?.append(previewButton);

  const builder = document.createElement("div");
  builder.className = "schema-package-builder";

  const folderCountText = packageCreateFolderFilterTerm.trim()
    ? `${filteredFolders.length} of ${folders.length}`
    : `${folders.length}`;
  const folderColumn = createPackageBuilderColumn("Folders", folderCountText, [
    createPackageBuilderActionButton("Select All", () => {
      setPackageEntriesSelected(filteredFolders.flatMap((folder) => getPackageCreateEntriesForNode(folder)), true);
      renderPackageXmlCreateDetail();
    }),
    createPackageBuilderActionButton("Clear All", () => {
      setPackageEntriesSelected(filteredFolders.flatMap((folder) => getPackageCreateEntriesForNode(folder)), false);
      renderPackageXmlCreateDetail();
    })
  ], {
    listKey: "folders"
  });
  folderColumn.column.classList.add("has-filter");
  folderColumn.column.insertBefore(createPackageBuilderFolderFilter(), folderColumn.body);

  if (!folders.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-package-builder-empty";
    empty.textContent = t("schemaUi.noFoldersLoaded");
    folderColumn.body.appendChild(empty);
  } else if (!filteredFolders.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-package-builder-empty";
    empty.textContent = t("schemaUi.noMatchingFolders");
    folderColumn.body.appendChild(empty);
  } else {
    filteredFolders.forEach((folder) => {
      folderColumn.body.appendChild(createPackageBuilderFolderRow(folder));
    });
  }

  const itemState = getPackageEntrySelectionState(filteredActiveItems.map((item) => item.entry));
  const itemCountText = activeFolder
    ? packageCreateItemFilterTerm.trim()
      ? `${itemState.selectedCount}/${itemState.total} of ${activeItems.length}`
      : `${itemState.selectedCount}/${itemState.total}`
    : "";
  const itemColumn = createPackageBuilderColumn(
    activeFolder?.name ? `${activeFolder.name} Files` : "Files",
    itemCountText,
    [
      createPackageBuilderActionButton("Select All", () => {
        setPackageEntriesSelected(filteredActiveItems.map((item) => item.entry), true);
        renderPackageXmlCreateDetail();
      }),
      createPackageBuilderActionButton("Clear All", () => {
        setPackageEntriesSelected(filteredActiveItems.map((item) => item.entry), false);
        renderPackageXmlCreateDetail();
      })
    ],
    {
      folderPath: packageCreateActiveFolderPath,
      listKey: "items"
    }
  );
  itemColumn.column.classList.add("has-filter");
  itemColumn.column.insertBefore(createPackageBuilderItemFilter(), itemColumn.body);

  if (!activeFolder) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-package-builder-empty";
    empty.textContent = t("schemaUi.selectFolder");
    itemColumn.body.appendChild(empty);
  } else if (!activeItems.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-package-builder-empty";
    empty.textContent = t("schemaUi.noFilesInFolder");
    itemColumn.body.appendChild(empty);
  } else if (!filteredActiveItems.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-package-builder-empty";
    empty.textContent = t("schemaUi.noMatchingNames");
    itemColumn.body.appendChild(empty);
  } else {
    filteredActiveItems.forEach((item) => {
      itemColumn.body.appendChild(createPackageBuilderItemRow(item));
    });
  }

  builder.append(folderColumn.column, itemColumn.column);
  schemaDetailEl.append(header, builder);
  restorePackageBuilderScrollState(scrollState);
  if (packageCreateItemFilterShouldFocus) {
    packageCreateItemFilterShouldFocus = false;
    const filterInput = itemColumn.column.querySelector(".schema-package-builder-filter-input");
    filterInput?.focus();
    filterInput?.setSelectionRange?.(filterInput.value.length, filterInput.value.length);
  } else if (packageCreateFolderFilterShouldFocus) {
    packageCreateFolderFilterShouldFocus = false;
    const filterInput = folderColumn.column.querySelector(".schema-package-builder-filter-input");
    filterInput?.focus();
    filterInput?.setSelectionRange?.(filterInput.value.length, filterInput.value.length);
  }
  setStatus(t("schemaStatus.packageXmlReady"));
  setSchemaSummary(t("schemaStatus.membersSelected", { count: selectedCount, manifestFileName, members: t(selectedCount === 1 ? "schemaStatus.memberOne" : "schemaStatus.memberMany") }));
}

async function copyPackageXmlPreview(xml = getCurrentPackageManifestXml()) {
  try {
    await copyTextToClipboard(xml);
    const fileName = getPackageCreateFileName();
    setStatus(t("schemaStatus.copiedFile", { fileName: fileName }));
    setSchemaSummary(t("schemaStatus.copiedFileClipboard", { fileName: fileName }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(t("schemaStatus.copyFailed", { message: message }), true);
    setSchemaSummary(t("schemaStatus.copyFailed", { message: message }), true);
  }
}

function renderPackageXmlCreatePreviewDetail() {
  detailRequestId += 1;
  const entries = getPackageManifestEntriesForDetail();
  const xml = createPackageXmlManifest(entries);
  const sourcePath = getPackageCreateSourcePath();
  const manifestFileName = getPackageCreateFileName();
  const isWorkspaceManifest = isPackageWorkspaceManifestPath(sourcePath);
  schemaDetailEl.innerHTML = "";
  const header = createDetailTitle(manifestFileName, isWorkspaceManifest ? "Current workspace XML" : "Preview XML", `${entries.length} members`, "file", {
    includeFormatSelect: false
  });
  const actions = header.querySelector(".schema-detail-actions");
  const copyButton = createDetailButton("Copy", "secondary schema-package-copy-button");
  copyButton.addEventListener("click", () => void copyPackageXmlPreview());
  const backButton = createDetailButton("Back to XML Builder", "secondary schema-package-back-button");
  backButton.addEventListener("click", () => {
    packageCreatePreviewMode = false;
    renderPackageXmlCreateDetail();
  });
  actions?.append(copyButton, backButton);

  const manifestFile = createEditableFile(manifestFileName, xml, {
    className: "schema-xml-file schema-package-manifest-file",
    nameClassName: "schema-xml-file-name",
    format: "xml",
    readOnly: true
  });
  manifestFile.dataset.sourcePath = sourcePath;
  schemaDetailEl.append(header, manifestFile);
  setStatus(t("schemaStatus.manifestPreviewReady", { manifestFileName: manifestFileName }));
  setSchemaSummary(t("schemaStatus.previewingMembers", { manifestFileName, count: entries.length, members: t(entries.length === 1 ? "schemaStatus.memberOne" : "schemaStatus.memberMany") }));
}

async function openPackageCreateFolder(node = {}) {
  packageCreateActiveFolderPath = getPackageCreateFolderPath(node);
  packageCreatePreviewMode = false;
  renderPackageXmlCreateDetail();
  const loaded = await retrievePackageXmlSourceFolder(node, {
    render: false,
    statusPrefix: t("schemaStatus.prefixPackageXmlLoad"),
    summaryPrefix: t("schemaStatus.prefixPackageXmlLoading")
  });
  if (loaded && selectedNode?.type === "packageCreate") {
    renderPackageXmlCreateDetail();
  }
}

function expandPackageWildcardSelectionsForBuilder() {
  getPackageCreateFolderNodes().forEach((folder) => {
    const wildcardKeys = getPackageWildcardSelectionKeys(folder);
    const selectedWildcardKeys = wildcardKeys.filter((key) => selectedPackageMembers.has(key));
    if (!selectedWildcardKeys.length) {
      return;
    }

    selectedWildcardKeys.forEach((key) => selectedPackageMembers.delete(key));
    setPackageEntriesSelected(getPackageCreateEntriesForNode(folder), true);
  });
}

function preparePackageXmlCreateDetail(options = {}) {
  packageCreateSourcePath = normalizeMyOrgResultPath(options.sourcePath || PACKAGE_XML_SOURCE_PATH) || PACKAGE_XML_SOURCE_PATH;
  if (isPackageWorkspaceManifestPath(packageCreateSourcePath)) {
    syncPackageSelectionWithRetrievedFolders({ force: true });
  } else if (isManifestLocalXmlBuilderPath(packageCreateSourcePath)) {
    syncPackageSelectionFromManifestEntries(getManifestLocalPackageEntries(packageCreateSourcePath));
  }
  expandPackageWildcardSelectionsForBuilder();
  if (isPackageWorkspaceManifestPath(packageCreateSourcePath)) {
    syncWorkspacePackageManifestFile();
  }
  packageCreatePreviewMode = options.previewXml === true;
  const activeFolder = getPackageCreateActiveFolderNode();
  packageCreateActiveFolderPath = activeFolder ? getPackageCreateFolderPath(activeFolder) : "";
}

function openPackageXmlCreateDetail() {
  if (!session?.host) {
    setStatus(t("schemaStatus.missingSession"), true);
    return;
  }

  setSelectedNode({
    type: "packageCreate",
    sourcePath: PACKAGE_XML_SOURCE_PATH,
    previewXml: true
  });
}

function getSourceFolderForMetadataDefinition(metadataType = {}) {
  return STATIC_SOURCE_FOLDER_BY_METADATA_TYPE[metadataType.id]
    || metadataType.sourceFolder
    || metadataType.directoryName
    || metadataType.id
    || "";
}

function getSourceDefaultFolders() {
  const folders = new Set(getSourceBaseFolders());
  availableMetadataTypes.forEach((metadataType) => {
    const folderName = getSourceFolderForMetadataDefinition(metadataType);
    if (folderName) {
      folders.add(folderName);
    }
  });

  return [...folders].sort((left, right) => left.localeCompare(right));
}

function createDefaultMetadataFolderCache(metadataTypes = availableMetadataTypes) {
  const folders = new Map();
  getSourceBaseFolders().forEach((folderName) => {
    folders.set(folderName, {
      name: folderName,
      path: `${SOURCE_DEFAULT_PREFIX}${folderName}`,
      label: "",
      metadataTypes: []
    });
  });

  metadataTypes.forEach((metadataType) => {
    const folderName = getSourceFolderForMetadataDefinition(metadataType);
    if (!folderName) {
      return;
    }

    if (!folders.has(folderName)) {
      folders.set(folderName, {
        name: folderName,
        path: `${SOURCE_DEFAULT_PREFIX}${folderName}`,
        label: "",
        metadataTypes: []
      });
    }

    folders.get(folderName).metadataTypes.push({
      id: metadataType.id || "",
      label: metadataType.label || "",
      itemLabel: metadataType.itemLabel || "",
      metadataApiType: metadataType.metadataApiType || "",
      metadataApiTypes: Array.isArray(metadataType.metadataApiTypes) ? [...metadataType.metadataApiTypes] : [],
      directoryName: metadataType.directoryName || "",
      suffix: metadataType.suffix || "",
      sourceFolder: getSourceFolderForMetadataDefinition(metadataType),
      inFolder: metadataType.inFolder === true
    });
  });

  return [...folders.values()]
    .map((folder) => ({
      ...folder,
      label: [...new Set(folder.metadataTypes.map((metadataType) => metadataType.label).filter(Boolean))]
        .slice(0, 2)
        .join(", "),
      metadataTypes: folder.metadataTypes.sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getMetadataTypesForSourceFolder(folderName) {
  return availableMetadataTypes
    .filter((metadataType) => getSourceFolderForMetadataDefinition(metadataType) === folderName)
    .map((metadataType) => metadataType.id);
}

function getMetadataDefinitionsForSourceFolder(folderName) {
  return availableMetadataTypes
    .filter((metadataType) => getSourceFolderForMetadataDefinition(metadataType) === folderName);
}

function clearMyOrgBranchTreeLocalFiles() {
  if (!myOrgBranchTreeLocalPaths.size) {
    return;
  }

  const pathsToRemove = new Set(myOrgBranchTreeLocalPaths);
  myOrgBranchTreeLocalPaths.clear();
  for (const [path, entry] of [...localSourceEntries.entries()]) {
    const isTreePath = [...pathsToRemove].some((treePath) => (
      path === treePath || path.startsWith(`${treePath}/`)
    ));
    const isTreeParentPath = !!entry?.parentPath && [...pathsToRemove].some((treePath) => (
      entry.parentPath === treePath || entry.parentPath.startsWith(`${treePath}/`)
    ));
    if (isTreePath || isTreeParentPath) {
      localSourceEntries.delete(path);
      if (path !== entry?.parentPath) {
        continue;
      }
    }
  }
}

function getSourceFolderLabel(folderName) {
  const labels = [...new Set(
    getMetadataDefinitionsForSourceFolder(folderName)
      .map((metadataType) => metadataType.label || metadataType.itemLabel || metadataType.xmlName || metadataType.id)
      .filter(Boolean)
  )];
  return labels.slice(0, 2).join(", ");
}

function getSourceFolderSearchValues(folderName) {
  const values = [
    folderName
  ];
  getMetadataDefinitionsForSourceFolder(folderName).forEach((metadataType) => {
    values.push(
      ...getMetadataTypeSearchValues(metadataType)
    );
  });
  return values.filter(Boolean);
}

function getMetadataFolderNameFromPath(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  if (normalizedPath.startsWith(SOURCE_DEFAULT_PREFIX)) {
    return normalizedPath.slice(SOURCE_DEFAULT_PREFIX.length).split("/").filter(Boolean)[0] || "";
  }

  const mainPrefix = `${SOURCE_PROJECT_ROOT}/main/`;
  if (!normalizedPath.startsWith(mainPrefix)) {
    return "";
  }

  const segments = normalizedPath.slice(mainPrefix.length).split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }
  return segments[0] === "default" ? segments[1] || "" : segments[1] || "";
}

function isDefaultMetadataFolderPath(sourcePath = "") {
  const folderName = getMetadataFolderNameFromPath(sourcePath);
  return Boolean(folderName && sourcePath === `${SOURCE_DEFAULT_PREFIX}${folderName}`);
}

function getMetadataTypesForSourcePath(sourcePath = "") {
  const folderName = getMetadataFolderNameFromPath(sourcePath);
  return [...new Set(getMetadataTypesForSourceFolder(folderName))];
}

function getUnloadedMetadataTypes(metadataTypes = []) {
  const loadedTypes = new Set(schemaStore?.metadataTypes || []);
  return [...new Set(metadataTypes)].filter((metadataType) => !loadedTypes.has(metadataType));
}

function formatRetrieveProgress(progress = {}) {
  const detail = progress.detail || progress.label || "Retrieving metadata";
  return `${progress.percent || 0}% · ${detail}`;
}

function splitSchemaKey(key) {
  const text = String(key || "");
  const separatorIndex = text.indexOf(": ");
  if (separatorIndex === -1) {
    return {
      apiName: text,
      label: ""
    };
  }

  return {
    apiName: text.slice(0, separatorIndex),
    label: text.slice(separatorIndex + 2)
  };
}

function getFieldKeys(fieldMap) {
  if (Array.isArray(fieldMap)) {
    return fieldMap;
  }

  if (fieldMap && typeof fieldMap === "object") {
    return Object.keys(fieldMap);
  }

  return [];
}

function formatGeneratedAt(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getSchemaStoreCacheTimestamp(store = {}) {
  const timestampValue = store?.discoveryCachedAt || store?.generatedAt || "";
  const timestamp = Date.parse(timestampValue);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getSchemaStoreCacheAgeMs(store = {}) {
  const timestamp = getSchemaStoreCacheTimestamp(store);
  return timestamp ? Date.now() - timestamp : Infinity;
}

function isSchemaStoreCacheFresh(store = {}) {
  if (!store?.generatedAt) {
    return false;
  }

  const cachedFolderNames = Array.isArray(store.defaultMetadataFolderNames)
    ? store.defaultMetadataFolderNames
    : [];
  if (!setsHaveSameValues(cachedFolderNames, getDefaultMetadataFolderNames())) {
    return false;
  }

  if (store.defaultNamespaceScope && store.defaultNamespaceScope !== getNamespaceScopeKey(getSelectedRetrieveNamespaceOptions())) {
    return false;
  }

  const activeMinutes = getCacheActiveMinutes();
  if (activeMinutes <= 0) {
    return false;
  }

  return getSchemaStoreCacheAgeMs(store) <= activeMinutes * 60 * 1000;
}

function isSchemaDiscoveryCacheFresh(store = {}) {
  const hasDiscoveryData = Array.isArray(store?.availableMetadataTypes) && store.availableMetadataTypes.length > 0
    && Array.isArray(store?.defaultMetadataFolders) && store.defaultMetadataFolders.length > 0;
  if (!hasDiscoveryData) {
    return false;
  }

  const activeMinutes = getCacheActiveMinutes();
  if (activeMinutes <= 0) {
    return false;
  }

  return getSchemaStoreCacheAgeMs(store) <= activeMinutes * 60 * 1000;
}

function getSchemaDiscoveryCacheValidation(store = {}) {
  if (!store || typeof store !== "object") {
    return {
      valid: false,
      reason: "missing discovery cache"
    };
  }
  if (!isSchemaDiscoveryCacheFresh(store)) {
    return {
      valid: false,
      reason: `discovery cache invalid or older than ${getCacheActiveMinutes()} min`
    };
  }
  return {
    valid: true,
    reason: "valid"
  };
}

function formatCacheAge(store = {}) {
  const ageMs = getSchemaStoreCacheAgeMs(store);
  if (!Number.isFinite(ageMs)) {
    return "no timestamp";
  }
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) {
    return `${seconds}s old`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s old`;
}

function getSchemaFolderCacheValidation(store = {}) {
  if (!store || typeof store !== "object" || !store.generatedAt) {
    return {
      valid: false,
      reason: "missing saved workspace folders"
    };
  }
  if (!isSchemaStoreCacheFresh(store)) {
    return {
      valid: false,
      reason: `saved workspace folders are older than ${getCacheActiveMinutes()} min`
    };
  }
  return {
    valid: true,
    reason: "valid"
  };
}

function getWorkspaceFolderNameCacheValidation(store = schemaStore) {
  const folderCacheStatus = getSchemaFolderCacheValidation(store);
  if (!folderCacheStatus.valid) {
    return folderCacheStatus;
  }

  const missingFolderNames = getDeferredWorkspaceFolderNames(store);
  if (missingFolderNames.length) {
    return {
      valid: false,
      reason: `missing default Files folders for ${missingFolderNames.join(", ")}`
    };
  }

  const missingObjectRelatedMetadataTypes = getMissingObjectRelatedMetadataTypes(store);
  if (missingObjectRelatedMetadataTypes.length) {
    return {
      valid: false,
      reason: `missing object child metadata for ${missingObjectRelatedMetadataTypes.join(", ")}`
    };
  }

  return {
    valid: true,
    reason: "valid"
  };
}

async function clearAllMetadataFolderCaches(reason = "") {
  if (COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED) {
    await deleteCompactMetadataIndexDatabasesForHosts(session?.host ? [session.host] : [], { includeAll: true });
  }
  clearCompactMetadataSourceTreeCache();
  invalidateFolderSearchCache();
  if (reason) {
    setSchemaSummary(t("schemaStatus.clearedCache"));
  }
}

async function pruneExpiredMetadataFolderCaches(currentHost = "") {
  if (!COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED) {
    return;
  }
  const currentDbName = currentHost ? getCompactMetadataIndexDbName(currentHost) : "";
  const databaseNames = await getCompactMetadataIndexDatabaseNames([], { includeAll: true });
  const staleDatabaseNames = databaseNames.filter((name) => name && name !== currentDbName);
  await Promise.allSettled(staleDatabaseNames.map((name) => deleteIndexedDbDatabase(name)));
}

function createFolderListOnlySchemaStore(store = {}) {
  return {
    ...store,
    generatedAt: "",
    objectCount: 0,
    fieldCount: 0,
    map: {},
    metadata: {},
    metadataTypes: [],
    metadataItemCount: 0,
    details: {},
    errors: []
  };
}

function getCompactMetadataIndexDbName(host = "") {
  const hostKey = String(host || "unknown").replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
  return `${COMPACT_METADATA_INDEX_DB_PREFIX}_${hostKey}`;
}

function waitForIndexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
  });
}

function waitForIndexedDbTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage update failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage update was stopped."));
  });
}

function openCompactMetadataIndexDb(host = "") {
  if (!window.indexedDB) {
    return Promise.reject(new Error("Browser storage is not available."));
  }

  const request = window.indexedDB.open(getCompactMetadataIndexDbName(host), COMPACT_METADATA_INDEX_DB_VERSION);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    if (!db.objectStoreNames.contains(COMPACT_METADATA_INDEX_RECORD_STORE)) {
      db.createObjectStore(COMPACT_METADATA_INDEX_RECORD_STORE, { keyPath: "K" });
    }
    if (!db.objectStoreNames.contains(COMPACT_METADATA_INDEX_META_STORE)) {
      db.createObjectStore(COMPACT_METADATA_INDEX_META_STORE, { keyPath: "id" });
    }
    if (event.oldVersion > 0 && event.oldVersion < COMPACT_METADATA_INDEX_DB_VERSION) {
      request.transaction?.objectStore(COMPACT_METADATA_INDEX_RECORD_STORE).clear();
      request.transaction?.objectStore(COMPACT_METADATA_INDEX_META_STORE).clear();
    }
  };
  return waitForIndexedDbRequest(request);
}

async function getCompactMetadataStoreRecords(host = "", storeNames = []) {
  const db = await openCompactMetadataIndexDb(host);
  try {
    const transaction = db.transaction(storeNames, "readonly");
    const transactionDone = waitForIndexedDbTransaction(transaction);
    const requests = storeNames.map((storeName) => transaction.objectStore(storeName).getAll());
    const results = await Promise.all(requests.map((request) => waitForIndexedDbRequest(request)));
    await transactionDone;
    return Object.fromEntries(storeNames.map((storeName, index) => [storeName, results[index] || []]));
  } finally {
    db.close();
  }
}

function deleteIndexedDbDatabase(name = "") {
  if (!name || !window.indexedDB) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => resolve();
    try {
      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = finish;
      request.onerror = finish;
      request.onblocked = () => window.setTimeout(finish, 500);
    } catch (_error) {
      finish();
    }
  });
}

async function getCompactMetadataIndexDatabaseNames(hosts = [], options = {}) {
  const names = new Set(
    [...new Set(hosts)]
      .filter(Boolean)
      .map((host) => getCompactMetadataIndexDbName(host))
  );
  if (options.includeAll === true && window.indexedDB?.databases) {
    try {
      const databases = await window.indexedDB.databases();
      databases
        .map((database) => database?.name || "")
        .filter((name) => name.startsWith(`${COMPACT_METADATA_INDEX_DB_PREFIX}_`))
        .forEach((name) => names.add(name));
    } catch (_error) {
      // Some browsers expose databases() but reject it in extension contexts.
    }
  }
  return [...names];
}

async function deleteCompactMetadataIndexDatabasesForHosts(hosts = [], options = {}) {
  const databaseNames = await getCompactMetadataIndexDatabaseNames(hosts, options);
  await Promise.allSettled(databaseNames.map((name) => deleteIndexedDbDatabase(name)));
}

function encodeCompactMetadataIndexKey(index, keyLength, label = "Metadata index") {
  const alphabet = getCompactMetadataIndexKeyAlphabet();
  const base = alphabet.length;
  const maxValue = base ** keyLength;
  if (index >= maxValue) {
    throw new Error(`${label} exceeded ${maxValue} keys.`);
  }

  let value = index;
  let key = "";
  for (let position = 0; position < keyLength; position += 1) {
    key = alphabet[value % base] + key;
    value = Math.floor(value / base);
  }
  return key;
}

function encodeCompactMetadataFolderKey(index) {
  return encodeCompactMetadataIndexKey(index, getCompactMetadataFolderKeyLength(), "Metadata folder index");
}

function encodeCompactMetadataFileKey(index) {
  return encodeCompactMetadataIndexKey(index, getCompactMetadataFileKeyLength(), "Metadata folder file index");
}

function createCompactMetadataFileReferenceKey(folderKey = "", fileKey = "") {
  return `${folderKey}${fileKey}`;
}

function createCompactMetadataNodeSelection(node = {}) {
  const selection = node.selection || {};
  if (!selection.type) {
    return null;
  }

  return {
    t: selection.type || "",
    m: selection.metadataType || "",
    o: selection.objectKey || "",
    f: selection.fieldKey || "",
    i: selection.itemKey || ""
  };
}

function createCompactMetadataNodeModifiedInfo(node = {}) {
  const lastModifiedDate = getFirstNonEmptyString(
    node.lastModifiedDate,
    node.selection?.lastModifiedDate
  );
  const lastModifiedByName = getFirstNonEmptyString(
    node.lastModifiedByName,
    node.selection?.lastModifiedByName
  );
  if (!lastModifiedDate && !lastModifiedByName) {
    return null;
  }

  return {
    d: lastModifiedDate,
    b: lastModifiedByName
  };
}

function expandCompactMetadataModifiedInfo(compactModifiedInfo = null) {
  if (!compactModifiedInfo || typeof compactModifiedInfo !== "object") {
    return {};
  }

  return {
    lastModifiedDate: compactModifiedInfo.d || "",
    lastModifiedByName: compactModifiedInfo.b || ""
  };
}

function expandCompactMetadataFileSelection(compactSelection = null, sourcePath = "") {
  if (!compactSelection || typeof compactSelection !== "object" || !compactSelection.t) {
    return null;
  }

  return {
    type: compactSelection.t || "",
    metadataType: compactSelection.m || "",
    objectKey: compactSelection.o || "",
    fieldKey: compactSelection.f || "",
    itemKey: compactSelection.i || "",
    sourcePath
  };
}

function getCompactMetadataNodeKind(node = {}) {
  if (node.kind !== "file") {
    return null;
  }
  return node.metaText || node.selection?.metadataType || node.contentKind || "file";
}

function getCompactMetadataNodeLabel(node = {}) {
  if (node.label) {
    return node.label;
  }

  const selection = node.selection || {};
  if (selection.type === "field") {
    return splitSchemaKey(selection.fieldKey).label || null;
  }
  if (selection.type === "object") {
    return splitSchemaKey(selection.objectKey).label || null;
  }
  if (selection.type === "metadataItem") {
    return splitSchemaKey(selection.itemKey).label || null;
  }
  return node.secondary || null;
}

function createCompactMetadataFileEntry(node = {}) {
  return [
    node.name || "file",
    getCompactMetadataNodeKind(node),
    getCompactMetadataNodeLabel(node),
    createCompactMetadataNodeSelection(node),
    createCompactMetadataNodeModifiedInfo(node)
  ];
}

function createCompactMetadataIndexSnapshot(store = schemaStore, options = {}) {
  const previousStore = schemaStore;
  schemaStore = store;
  try {
    const root = createSourceExplorerTree(createAllSourceVisibleGroups(getMetadataGroups()), {
      showDefaultSourceRoot: true,
      sourceRootPath: SOURCE_DEFAULT_ROOT,
      sourceRootName: SOURCE_DEFAULT_ROOT.split("/")[0],
      includeEmptyDefaultFolders: true,
      emptyDefaultFolderNames: getDefaultMetadataFolderNames(),
      includeLocalOverlay: options.includeLocalOverlay !== false,
      includePackageManifest: options.includePackageManifest !== false
    });
    const records = [];
    const pathKeyByPath = new Map();
    let nextFolderKeyIndex = 0;

    function visit(node = {}, parentKey = null) {
      ensureSourceTreeLazyChildren(node);
      const key = encodeCompactMetadataFolderKey(nextFolderKeyIndex);
      nextFolderKeyIndex += 1;
      const record = {
        K: key,
        N: node.name || "workspace",
        P: parentKey,
        T: getCompactMetadataNodeKind(node),
        L: getCompactMetadataNodeLabel(node),
        M: createCompactMetadataNodeModifiedInfo(node)
      };
      records.push(record);
      let nextFileIndex = 0;

      (node.children || []).forEach((child) => {
        if (child.kind === "file") {
          const fileKey = encodeCompactMetadataFileKey(nextFileIndex);
          nextFileIndex += 1;
          record.F = record.F || {};
          record.F[fileKey] = createCompactMetadataFileEntry(child);
          if (child.path) {
            pathKeyByPath.set(normalizeSourcePath(child.path), createCompactMetadataFileReferenceKey(key, fileKey));
          }
          return;
        }
        visit(child, key);
      });
    }

    visit(root, null);
    return {
      records,
      pathKeyByPath,
      root
    };
  } finally {
    schemaStore = previousStore;
  }
}

function isMetadataXmlSourceMetadataType(metadataTypeId = "") {
  const metadataType = getAvailableMetadataType(metadataTypeId) || {};
  return metadataType.kind === "metadata"
    || METADATA_XML_SOURCE_METADATA_TYPE_IDS.has(metadataTypeId)
    || METADATA_XML_SOURCE_METADATA_TYPE_IDS.has(metadataType.metadataApiType)
    || METADATA_XML_SOURCE_METADATA_TYPE_IDS.has(getSourceFolderForMetadataDefinition(metadataType));
}

async function saveCompactMetadataIndexRecords(host, records = [], meta = {}) {
  if (!COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED) {
    return false;
  }

  const db = await openCompactMetadataIndexDb(host);
  try {
    logRuntimeTraceTransaction({
      direction: "user -> indexedDB",
      target: "compact-metadata-index",
      action: "put",
      host,
      recordCount: records.length,
      meta
    });
    const transaction = db.transaction(
      [COMPACT_METADATA_INDEX_RECORD_STORE, COMPACT_METADATA_INDEX_META_STORE],
      "readwrite"
    );
    const recordStore = transaction.objectStore(COMPACT_METADATA_INDEX_RECORD_STORE);
    const metaStore = transaction.objectStore(COMPACT_METADATA_INDEX_META_STORE);
    recordStore.clear();
    records.forEach((record) => recordStore.put(record));
    metaStore.put({
      id: "latest",
      host,
      generatedAt: new Date().toISOString(),
      count: records.length,
      formatVersion: COMPACT_METADATA_INDEX_FORMAT_VERSION,
      fields: "K,N,P,T,L,M,F",
      fileEntryFields: "F[fileKey]=[N,T,L,S,M]",
      folderKeyLength: getCompactMetadataFolderKeyLength(),
      fileKeyLength: getCompactMetadataFileKeyLength(),
      fileReferenceKeyLength: getCompactMetadataFolderKeyLength() + getCompactMetadataFileKeyLength(),
      keyAlphabet: getCompactMetadataIndexKeyAlphabet(),
      ...meta
    });
    await waitForIndexedDbTransaction(transaction);
  } finally {
    db.close();
  }
}

async function loadSchemaObjectStoreWithDevLogging(host = "") {
  logRuntimeTraceTransaction({
    direction: "memory -> user",
    target: "runtime-schema-store",
    action: "get",
    host
  });
  const store = await loadSchemaObjectStore(host);
  logRuntimeTraceTransaction({
    direction: "memory -> user",
    target: "runtime-schema-store",
    action: "loaded",
    host,
    store: createRuntimeTraceSchemaStoreSummary(store)
  });
  return store;
}

async function saveSchemaObjectStoreWithDevLogging(host = "", store = {}) {
  logRuntimeTraceTransaction({
    direction: "user -> memory",
    target: "runtime-schema-store",
    action: "put",
    host,
    store: createRuntimeTraceSchemaStoreSummary(store)
  });
  const savedStore = await saveSchemaObjectStore(host, store);
  logRuntimeTraceTransaction({
    direction: "user -> memory",
    target: "runtime-schema-store",
    action: "saved",
    host,
    store: createRuntimeTraceSchemaStoreSummary(savedStore)
  });
  return savedStore;
}

function getCompactMetadataFolderPath(record = {}, recordByKey = new Map(), pathCache = new Map()) {
  const key = record.K || "";
  if (pathCache.has(key)) {
    return pathCache.get(key);
  }

  if (!record.P) {
    pathCache.set(key, "");
    return "";
  }

  const parentRecord = recordByKey.get(record.P);
  const parentPath = parentRecord
    ? getCompactMetadataFolderPath(parentRecord, recordByKey, pathCache)
    : "";
  const folderName = String(record.N || "").trim();
  const folderPathSegment = getCompactMetadataFolderPathSegment(parentPath, folderName);
  const path = parentPath
    ? `${parentPath}/${folderPathSegment}`
    : folderPathSegment;
  pathCache.set(key, path);
  return path;
}

function isCompactMetadataIndexMetaFresh(meta = {}) {
  if (meta?.formatVersion !== COMPACT_METADATA_INDEX_FORMAT_VERSION) {
    return false;
  }

  const timestamp = Date.parse(meta?.generatedAt || "");
  if (!timestamp || Number.isNaN(timestamp)) {
    return false;
  }

  const activeMinutes = getCacheActiveMinutes();
  if (activeMinutes <= 0) {
    return false;
  }

  return Date.now() - timestamp <= activeMinutes * 60 * 1000;
}

function isObjectsSourceFolderPath(path = "") {
  return getSourceBaseName(path) === OBJECT_SOURCE_FOLDER_NAME;
}

function getObjectSourceBucketNameSet() {
  return new Set([
    OBJECT_STANDARD_GROUP_NAME,
    OBJECT_CUSTOM_GROUP_NAME
  ]);
}

function getObjectSourceBucketPathSegmentSet() {
  return new Set([...getObjectSourceBucketNameSet()].flatMap((groupName) => [
    groupName,
    toSourceFileSegment(groupName, "group")
  ]));
}

function getCompactMetadataFolderPathSegment(parentPath = "", folderName = "") {
  if (isObjectsSourceFolderPath(parentPath) && getObjectSourceBucketNameSet().has(folderName)) {
    return toSourceFileSegment(folderName, "group");
  }
  return folderName;
}

function isObjectSourceBucketFolderPath(path = "") {
  return isObjectsSourceFolderPath(getParentSourcePath(path))
    && getObjectSourceBucketPathSegmentSet().has(getSourceBaseName(path));
}

function isObjectSourceLeafFolderPath(path = "") {
  return isObjectSourceBucketFolderPath(getParentSourcePath(path));
}

function isObjectChildSourceFolderPath(path = "") {
  return isObjectSourceLeafFolderPath(getParentSourcePath(path));
}

function getCompactMetadataFolderSortRank(path = "") {
  if (path === SOURCE_DEFAULT_ROOT) {
    return SOURCE_DEFAULT_ROOT_SORT_RANK;
  }
  if (getParentSourcePath(path) === "force-app/main") {
    return SOURCE_NAMESPACE_ROOT_SORT_RANK;
  }
  if (isObjectSourceBucketFolderPath(path)) {
    const bucketSegment = getSourceBaseName(path);
    if (bucketSegment === toSourceFileSegment(OBJECT_STANDARD_GROUP_NAME, "group")) {
      return 0;
    }
    if (bucketSegment === toSourceFileSegment(OBJECT_CUSTOM_GROUP_NAME, "group")) {
      return 1;
    }
  }
  return null;
}

function getCompactMetadataFolderSearchValues(path = "", name = "", label = "") {
  if (isObjectSourceLeafFolderPath(path)) {
    return [name, name, label].filter(Boolean);
  }
  return [path, name, label].filter(Boolean);
}

function createSourceTreeFromCompactMetadataRecords(records = []) {
  const recordByKey = new Map();
  records
    .filter((record) => record?.K)
    .forEach((record) => recordByKey.set(record.K, record));

  const rootRecord = records.find((record) => record?.K && !record.P) || null;
  const root = createSourceTreeNode(rootRecord?.N || "workspace", "", "root", {
    alwaysOpen: true,
    sourceOrigin: "indexedDB"
  });
  const nodeByKey = new Map();
  if (rootRecord?.K) {
    nodeByKey.set(rootRecord.K, root);
  }
  const pathCache = new Map();

  function buildFolderNode(record = {}) {
    if (!record?.K) {
      return root;
    }
    if (nodeByKey.has(record.K)) {
      return nodeByKey.get(record.K);
    }

    const parentRecord = record.P ? recordByKey.get(record.P) : null;
    const parentNode = parentRecord ? buildFolderNode(parentRecord) : root;
    const path = getCompactMetadataFolderPath(record, recordByKey, pathCache);
    const name = record.N || getSourceBaseName(path) || "folder";
    const label = record.L || "";
    const isObjectLeafFolder = isObjectSourceLeafFolderPath(path);
    const folder = createSourceTreeNode(name, path, "folder", {
      label: isObjectLeafFolder && !isGenericObjectSourceLabel({ name, path }, label) ? label : "",
      secondary: isObjectLeafFolder ? "Object" : label,
      defaultOpen: isLegacySourceRootPath(path),
      // Same three wrappers as createSourceRootContainers, rebuilt from cache.
      transparent: isLegacySourceRootPath(path),
      keepEmpty: isObjectSourceBucketFolderPath(path) || isObjectSourceLeafFolderPath(path) || isObjectChildSourceFolderPath(path),
      contentKind: isObjectSourceBucketFolderPath(path) ? "objectBucket" : "",
      sourceOrigin: "indexedDB",
      sortRank: getCompactMetadataFolderSortRank(path),
      searchValues: getCompactMetadataFolderSearchValues(path, name, label),
      ...expandCompactMetadataModifiedInfo(record.M)
    });
    parentNode.children.push(folder);
    nodeByKey.set(record.K, folder);

    const fileEntries = record.F && typeof record.F === "object"
      ? Object.entries(record.F).sort(([left], [right]) => left.localeCompare(right))
      : [];
    fileEntries.forEach(([, fileEntry]) => {
      const [fileName = "file", metaText = "", secondary = "", compactSelection = null, compactModifiedInfo = null] = Array.isArray(fileEntry)
        ? fileEntry
        : [String(fileEntry || "file"), "", "", null, null];
      const sourcePath = path ? `${path}/${fileName}` : fileName;
      addSourceFile(folder, fileName, expandCompactMetadataFileSelection(compactSelection, sourcePath), {
        path: sourcePath,
        metaText: metaText || "",
        secondary: secondary || "",
        sourceOrigin: "indexedDB",
        searchValues: [sourcePath, fileName, metaText, secondary].filter(Boolean),
        ...expandCompactMetadataModifiedInfo(compactModifiedInfo)
      });
    });
    return folder;
  }

  records.forEach((record) => {
    if (record?.K && record !== rootRecord) {
      buildFolderNode(record);
    }
  });

  sortSourceChildren(root);
  return root;
}

function cloneSourceTreeNode(node = {}) {
  return {
    ...node,
    children: (node.children || []).map((child) => cloneSourceTreeNode(child))
  };
}

function clearCompactMetadataSourceTreeCache() {
  compactMetadataSourceRoot = null;
  compactMetadataIndexMeta = null;
  invalidateExplorerSourceTreeCache();
}

function hasFreshCompactMetadataSourceTree() {
  return Boolean(compactMetadataSourceRoot && isCompactMetadataIndexMetaFresh(compactMetadataIndexMeta));
}

function getCompactMetadataSourceTree() {
  if (!hasFreshCompactMetadataSourceTree()) {
    return null;
  }
  const root = cloneSourceTreeNode(compactMetadataSourceRoot);
  applyLocalSourceOverlay(root);
  sortSourceChildren(root);
  return root;
}

async function loadCompactMetadataSourceTreeFromIndexedDb(host = "") {
  if (!COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED) {
    clearCompactMetadataSourceTreeCache();
    return false;
  }

  try {
    const stores = await getCompactMetadataStoreRecords(host, [
      COMPACT_METADATA_INDEX_RECORD_STORE,
      COMPACT_METADATA_INDEX_META_STORE
    ]);
    const records = stores[COMPACT_METADATA_INDEX_RECORD_STORE] || [];
    const metaRecords = stores[COMPACT_METADATA_INDEX_META_STORE] || [];
    const latestMeta = metaRecords.find((record) => record?.id === "latest") || null;
    if (!records.length || !isCompactMetadataIndexMetaFresh(latestMeta)) {
      clearCompactMetadataSourceTreeCache();
      return false;
    }
    compactMetadataSourceRoot = createSourceTreeFromCompactMetadataRecords(records);
    compactMetadataIndexMeta = latestMeta;
    invalidateExplorerSourceTreeCache();
    return true;
  } catch (error) {
    console.warn("Could not load saved folder records.", error);
    clearCompactMetadataSourceTreeCache();
    return false;
  }
}

function markCompactMetadataIndexNamespaceScopes(meta = compactMetadataIndexMeta) {
  const namespaceScopeKey = meta?.namespaceScope || getNamespaceScopeKey(getSelectedRetrieveNamespaceOptions());
  const folderNames = Array.isArray(meta?.startupFolders) && meta.startupFolders.length
    ? meta.startupFolders
    : [...getStartupMetadataIndexFolderSet()];
  folderNames.forEach((folderName) => {
    folderNamespaceScopeByPath.set(`${SOURCE_DEFAULT_PREFIX}${folderName}`, namespaceScopeKey);
  });
}

function openSourceFolderPathInDetail(sourcePath = "") {
  const folderPath = normalizeMyOrgResultPath(sourcePath);
  if (!folderPath) {
    return;
  }

  const folderNode = getSourceFolderNode(folderPath);
  if (!folderNode) {
    setStatus(t("schemaStatus.folderNotFound", { folderPath: folderPath }), true);
    return;
  }

  clearExplorerFileFilterIfPathIsHidden(folderPath);
  openSourcePathAncestors(folderPath);
  setSourceTreeFolderOpen(folderNode, true);
  setSelectedNode({
    type: "sourceFolder",
    sourcePath: folderPath
  });
  activeSourceFolderPath = folderPath;
  void ensureFilesTabWorkspaceFoldersLoaded();
}

function createStoreWithoutMetadataTypes(store = {}, metadataTypes = []) {
  const typeSet = new Set(metadataTypes);
  if (!typeSet.size) {
    return store;
  }

  const metadata = { ...(store.metadata || {}) };
  typeSet.forEach((metadataType) => {
    delete metadata[metadataType];
  });

  const nextStore = {
    ...store,
    metadata,
    metadataTypes: (store.metadataTypes || []).filter((metadataType) => !typeSet.has(metadataType)),
    errors: (store.errors || []).filter((error) => !metadataErrorMatchesTypes(error, metadataTypes))
  };

  if (typeSet.has("objects")) {
    nextStore.map = {};
    nextStore.objectCount = 0;
    nextStore.fieldCount = 0;
  }

  nextStore.metadataItemCount = getStoreMetadataItemCount(nextStore);
  return nextStore;
}

function clearSourceFolderItems(options = {}) {
  const targetPath = options.sourcePath || activeSourceFolderPath;
  if (!targetPath && options.force !== true) {
    return;
  }

  const shouldCancelActiveRequest = options.force === true || !targetPath || activeSourceFolderPath === targetPath;
  if (shouldCancelActiveRequest) {
    activeSourceFolderPath = "";
  }

  const previousPath = targetPath;
  metadataActionInProgress = false;
  if (previousPath) {
    folderRetrieveInProgress.delete(previousPath);
    folderNamespaceScopeByPath.delete(previousPath);
    const metadataTypes = getMetadataTypesForSourcePath(previousPath);
    if (metadataTypes.length) {
      schemaStore = createStoreWithoutMetadataTypes(schemaStore, metadataTypes);
      globalThis.salesforceSchemaObjectStore = schemaStore;
      globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
      clearCachesForMetadataTypes(metadataTypes, { clearSearchDetails: true });
    }
  }
  if (selectedNode?.sourcePath?.startsWith(`${previousPath}/`) || selectedNode?.sourcePath === previousPath) {
    selectedNode = null;
    clearSourceNavigationHistory();
  }
  if (options.render !== false) {
    renderWorkspaceSettingsSelectors();
    updateMetadataSelectionState({ renderManifest: false });
    renderMetadataSelectionIfVisible({ renderManifest: false });
    renderSchema({ renderDetail: false });
  } else {
    renderWorkspaceSettingsSelectors();
  }
}

function getExplorerHighlightTerms() {
  if (searchHighlightTermOverride) {
    return getSearchTerms(searchHighlightTermOverride);
  }

  return [...new Set([
    ...getSearchTerms(activeSearchTerm),
    ...(activeSidebarTab === "explorer" ? getSearchTerms(schemaFileFilterTerm) : []),
    ...(activeSidebarTab === "search" ? getSearchTerms(schemaFolderSearchTerm) : [])
  ])];
}

function withSearchHighlightTerm(term, callback) {
  const previousTerm = searchHighlightTermOverride;
  searchHighlightTermOverride = String(term || "");
  try {
    return callback();
  } finally {
    searchHighlightTermOverride = previousTerm;
  }
}

function appendHighlightedExplorerText(target, value, options = {}) {
  const text = String(value || "");
  const terms = getExplorerHighlightTerms()
    .map((term) => ({
      raw: term,
      lower: term.toLocaleLowerCase()
    }))
    .filter((term) => term.lower);

  if (!text || !terms.length) {
    target.textContent = text;
    return;
  }

  const lowerText = text.toLocaleLowerCase();
  let index = 0;
  let renderedMatchCount = 0;
  const maxMatches = Number.isFinite(Number(options.maxMatches)) ? Math.max(0, Number(options.maxMatches)) : Infinity;

  while (index < text.length) {
    if (renderedMatchCount >= maxMatches) {
      target.appendChild(document.createTextNode(text.slice(index)));
      return;
    }

    let matchIndex = -1;
    let matchLength = 0;

    terms.forEach((term) => {
      const foundIndex = lowerText.indexOf(term.lower, index);
      if (foundIndex === -1) {
        return;
      }

      if (
        matchIndex === -1
        || foundIndex < matchIndex
        || (foundIndex === matchIndex && term.raw.length > matchLength)
      ) {
        matchIndex = foundIndex;
        matchLength = term.raw.length;
      }
    });

    if (matchIndex === -1) {
      target.appendChild(document.createTextNode(text.slice(index)));
      return;
    }

    if (matchIndex > index) {
      target.appendChild(document.createTextNode(text.slice(index, matchIndex)));
    }

    const match = document.createElement("span");
    match.className = "schema-tree-match";
    match.textContent = text.slice(matchIndex, matchIndex + matchLength);
    target.appendChild(match);
    index = matchIndex + matchLength;
    renderedMatchCount += 1;
  }
}

function appendSearchHighlightedText(target, value, matchClassName = "schema-detail-match") {
  const text = String(value || "");
  const terms = getExplorerHighlightTerms()
    .map((term) => ({
      raw: term,
      lower: term.toLocaleLowerCase()
    }))
    .filter((term) => term.lower);

  if (!text || !terms.length) {
    target.appendChild(document.createTextNode(text));
    return;
  }

  const lowerText = text.toLocaleLowerCase();
  let index = 0;

  while (index < text.length) {
    let matchIndex = -1;
    let matchLength = 0;

    terms.forEach((term) => {
      const foundIndex = lowerText.indexOf(term.lower, index);
      if (foundIndex === -1) {
        return;
      }

      if (
        matchIndex === -1
        || foundIndex < matchIndex
        || (foundIndex === matchIndex && term.raw.length > matchLength)
      ) {
        matchIndex = foundIndex;
        matchLength = term.raw.length;
      }
    });

    if (matchIndex === -1) {
      target.appendChild(document.createTextNode(text.slice(index)));
      return;
    }

    if (matchIndex > index) {
      target.appendChild(document.createTextNode(text.slice(index, matchIndex)));
    }

    const match = document.createElement("span");
    match.className = matchClassName;
    match.textContent = text.slice(matchIndex, matchIndex + matchLength);
    target.appendChild(match);
    index = matchIndex + matchLength;
  }
}

function setSearchHighlightedText(target, value, matchClassName = "schema-detail-match") {
  target.textContent = "";
  appendSearchHighlightedText(target, value, matchClassName);
}

function createExplorerName(apiName, label) {
  const name = document.createElement("span");
  name.className = "schema-tree-name";

  const api = document.createElement("span");
  api.className = "schema-tree-primary";
  appendHighlightedExplorerText(api, apiName);
  name.appendChild(api);

  if (label && label !== apiName) {
    const labelEl = document.createElement("span");
    labelEl.className = "schema-tree-secondary";
    appendHighlightedExplorerText(labelEl, label);
    name.appendChild(labelEl);
  }

  return name;
}

function createDetailButton(label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function isSourceNavigationSelection(selection = selectedNode) {
  return Boolean(selection?.sourcePath && !["manifestFile", "packageCreate"].includes(selection.type));
}

function getSourceNavigationPath(selection = selectedNode) {
  return isSourceNavigationSelection(selection) ? normalizeMyOrgResultPath(selection.sourcePath || "") : "";
}

function trimSourceNavigationStack(stack) {
  const maxEntries = 100;
  if (stack.length > maxEntries) {
    stack.splice(0, stack.length - maxEntries);
  }
}

function pushSourceNavigationPath(stack, sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return;
  }
  if (stack[stack.length - 1] === path) {
    return;
  }
  stack.push(path);
  trimSourceNavigationStack(stack);
}

function clearSourceNavigationHistory() {
  sourceNavigationBackStack.length = 0;
  sourceNavigationForwardStack.length = 0;
  sourceNavigationSuppressRecord = false;
  updateSourceNavigationControls();
}

function recordSourceNavigationSelection(nextSelection = {}) {
  if (sourceNavigationSuppressRecord || !isSourceNavigationSelection(nextSelection)) {
    return;
  }
  const previousPath = getSourceNavigationPath(selectedNode);
  const nextPath = getSourceNavigationPath(nextSelection);
  if (!previousPath || !nextPath || previousPath === nextPath) {
    return;
  }
  pushSourceNavigationPath(sourceNavigationBackStack, previousPath);
  sourceNavigationForwardStack.length = 0;
  updateSourceNavigationControls();
}

function openSourceNavigationPath(sourcePath = "") {
  const normalizedSourcePath = normalizeMyOrgResultPath(sourcePath);
  if (!normalizedSourcePath) {
    return false;
  }

  openSourcePathAncestors(normalizedSourcePath);
  clearExplorerFileFilterIfPathIsHidden(normalizedSourcePath);

  const folderNode = getSourceFolderNode(normalizedSourcePath);
  if (folderNode?.kind === "folder" || Array.isArray(folderNode?.children)) {
    setSelectedNode({
      ...(folderNode.selection || {
        type: "sourceFolder"
      }),
      sourcePath: normalizedSourcePath
    });
    revealSourcePathInExplorer(normalizedSourcePath, {
      switchTab: true,
      renderDetail: false
    });
    return true;
  }

  return setSelectedSourceNodeFromPath(null, normalizedSourcePath, {
    revealInExplorer: true,
    fromHistory: true
  });
}

function navigateSourceHistory(direction = "back") {
  const isBack = direction === "back";
  const sourceStack = isBack ? sourceNavigationBackStack : sourceNavigationForwardStack;
  const targetPath = sourceStack.pop();
  if (!targetPath) {
    updateSourceNavigationControls();
    return;
  }

  const currentPath = getSourceNavigationPath(selectedNode);
  sourceNavigationSuppressRecord = true;
  let opened = false;
  try {
    opened = openSourceNavigationPath(targetPath);
  } finally {
    sourceNavigationSuppressRecord = false;
  }

  if (!opened) {
    pushSourceNavigationPath(sourceStack, targetPath);
    updateSourceNavigationControls();
    return;
  }

  if (currentPath) {
    pushSourceNavigationPath(isBack ? sourceNavigationForwardStack : sourceNavigationBackStack, currentPath);
  }
  updateSourceNavigationControls();
}

function updateSourceNavigationControls() {
  if (filesNavBackButton) {
    filesNavBackButton.disabled = sourceNavigationBackStack.length === 0;
  }
  if (filesNavForwardButton) {
    filesNavForwardButton.disabled = sourceNavigationForwardStack.length === 0;
  }
}

function createIconSvg(iconName = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const paths = {
    copy: [
      "M8 8h10v12H8z",
      "M6 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"
    ],
    external: [
      "M15 3h6v6",
      "M10 14 21 3",
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
    ],
    refresh: [
      "M21 12a9 9 0 0 1-15.5 6.2",
      "M3 12A9 9 0 0 1 18.5 5.8",
      "M18 2v4h4",
      "M6 22v-4H2"
    ],
    back: [
      "M19 12H5",
      "m12 19-7-7 7-7"
    ],
    forward: [
      "M5 12h14",
      "m12 5 7 7-7 7"
    ],
    json: [
      "M8 4H7a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3h1",
      "M16 4h1a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3h-1"
    ]
  };

  (paths[iconName] || []).forEach((pathText) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathText);
    svg.appendChild(path);
  });

  return svg;
}

function createIconButton(iconName, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["icon-button", className].filter(Boolean).join(" ");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(createIconSvg(iconName));
  return button;
}

function createTreeIcon(iconType = "file") {
  const icon = document.createElement("span");
  icon.className = `schema-tree-icon ${iconType}`;
  return icon;
}

function createDetailTitle(apiName, label, badgeText, iconType, options = {}) {
  const header = document.createElement("div");
  header.className = "schema-detail-head";

  header.appendChild(createTreeIcon(iconType));

  const text = document.createElement("div");
  text.className = "schema-detail-title";

  const title = document.createElement("h2");
  setSearchHighlightedText(title, apiName);
  text.appendChild(title);

  if (label && label !== apiName) {
    const subtitle = document.createElement("p");
    setSearchHighlightedText(subtitle, label);
    text.appendChild(subtitle);
  }

  header.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "schema-detail-actions";

  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "schema-count";
    badge.textContent = badgeText;
    actions.appendChild(badge);
  }

  header.appendChild(actions);

  return header;
}

function ensureDetailEditActions(header) {
  header?.querySelectorAll?.(".schema-detail-edit-button, .schema-detail-cancel-button, .schema-detail-save-button")
    .forEach((button) => button.remove());
}

function getObjectApiName(objectKey) {
  return splitSchemaKey(objectKey).apiName;
}

function getObjectFieldCount(objectKey) {
  return getFieldKeys(schemaStore?.map?.[objectKey]).length;
}

function getMetadataGroups() {
  const metadata = schemaStore?.metadata && typeof schemaStore.metadata === "object"
    ? schemaStore.metadata
    : {};
  const orderedMetadataTypeIds = [
    ...availableMetadataTypes.map((metadataType) => metadataType.id),
    ...Object.keys(metadata).filter((metadataTypeId) => !getAvailableMetadataType(metadataTypeId))
  ];
  const groups = orderedMetadataTypeIds
    .map((metadataTypeId) => metadata[metadataTypeId])
    .filter((group) => group && !EXCLUDED_METADATA_FOLDER_IDS.has(group.id) && !EXCLUDED_METADATA_FOLDER_IDS.has(group.metadataObject));

  if (groups.length) {
    return groups;
  }

  if (schemaStore?.map && Object.keys(schemaStore.map).length) {
    return [{
      id: "objects",
      label: "Objects",
      itemLabel: "Object",
      kind: "objects",
      count: Object.keys(schemaStore.map).length,
      childCount: Object.values(schemaStore.map).reduce((total, fieldMap) => total + getFieldKeys(fieldMap).length, 0),
      items: schemaStore.map
    }];
  }

  return [];
}

function isObjectsGroup(group = {}) {
  return group.id === "objects" || group.kind === "objects";
}

function getGroupItems(group = {}) {
  return Array.isArray(group.items) ? group.items : [];
}

function getGroupItemCount(group = {}) {
  if (isObjectsGroup(group)) {
    const objects = group.items && typeof group.items === "object" ? group.items : {};
    return Object.keys(objects).length + Object.values(objects).reduce(
      (total, fieldMap) => total + getFieldKeys(fieldMap).length,
      0
    );
  }

  return getGroupItems(group).length;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function toXmlTagName(value) {
  const text = String(value || "item").replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(text) ? text : `_${text}`;
}

function valueToXml(value, tagName, depth = 0) {
  const tag = toXmlTagName(tagName);
  const indent = "    ".repeat(depth);

  if (value === null || typeof value === "undefined") {
    return `${indent}<${tag}/>\n`;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return `${indent}<${tag}/>\n`;
    }

    return value.map((item) => valueToXml(item, tag, depth)).join("");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => typeof item !== "undefined");
    if (!entries.length) {
      return `${indent}<${tag}/>\n`;
    }

    const body = entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => valueToXml(item, key, depth + 1))
      .join("");
    return `${indent}<${tag}>\n${body}${indent}</${tag}>\n`;
  }

  return `${indent}<${tag}>${escapeXml(value)}</${tag}>\n`;
}

function createXmlDocument(rootName, detail) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${valueToXml(detail, rootName).trimEnd()}`;
}

function appendXmlSpan(parent, className, text) {
  if (!text) {
    return;
  }

  const span = document.createElement("span");
  span.className = className;
  appendSearchHighlightedText(span, text);
  parent.appendChild(span);
}

function getXmlTextClass(text) {
  const value = text.trim();
  if (/^(true|false)$/i.test(value)) {
    return "schema-xml-text schema-xml-boolean";
  }

  if (/^(null|undefined)$/i.test(value)) {
    return "schema-xml-text schema-xml-null";
  }

  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    return "schema-xml-text schema-xml-number";
  }

  if (/^(?:https?:\/\/|\/services\/|\/lightning\/)/i.test(value)) {
    return "schema-xml-text schema-xml-uri";
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return "schema-xml-text schema-xml-date";
  }

  return "schema-xml-text schema-xml-string";
}

function appendXmlTextSegment(parent, text) {
  if (!text) {
    return;
  }

  const parts = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!parts || !parts[2]) {
    appendXmlSpan(parent, "schema-xml-space", text);
    return;
  }

  appendXmlSpan(parent, "schema-xml-space", parts[1]);
  appendXmlSpan(parent, getXmlTextClass(parts[2]), parts[2]);
  appendXmlSpan(parent, "schema-xml-space", parts[3]);
}

function appendHighlightedXmlText(parent, text) {
  const entityPattern = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g;
  let lastIndex = 0;

  text.replace(entityPattern, (match, offset) => {
    appendXmlTextSegment(parent, text.slice(lastIndex, offset));
    appendXmlSpan(parent, "schema-xml-entity", match);
    lastIndex = offset + match.length;
    return match;
  });

  appendXmlTextSegment(parent, text.slice(lastIndex));
}

function appendHighlightedXmlAttributes(parent, text) {
  const attributePattern = /(\s+)([^\s=]+)(=)("[^"]*"|'[^']*')/g;
  let lastIndex = 0;

  text.replace(attributePattern, (match, whitespace, name, operator, value, offset) => {
    appendXmlSpan(parent, "schema-xml-attr", text.slice(lastIndex, offset));
    appendXmlSpan(parent, "schema-xml-space", whitespace);
    appendXmlSpan(parent, "schema-xml-attr-name", name);
    appendXmlSpan(parent, "schema-xml-punctuation", operator);
    appendXmlSpan(parent, "schema-xml-attr-value", value);
    lastIndex = offset + match.length;
    return match;
  });

  appendXmlSpan(parent, "schema-xml-attr", text.slice(lastIndex));
}

function appendHighlightedXmlTag(parent, token) {
  if (token.startsWith("<!--")) {
    appendXmlSpan(parent, "schema-xml-comment", token);
    return;
  }

  const instruction = token.match(/^<\?([^\s?]+)([\s\S]*?)\?>$/);
  if (instruction) {
    appendXmlSpan(parent, "schema-xml-punctuation schema-xml-declaration", "<?");
    appendXmlSpan(parent, "schema-xml-tag schema-xml-tag-declaration", instruction[1]);
    appendHighlightedXmlAttributes(parent, instruction[2]);
    appendXmlSpan(parent, "schema-xml-punctuation schema-xml-declaration", "?>");
    return;
  }

  const tag = token.match(/^<([/]?)([^\s>/]+)([\s\S]*?)([/]?)>$/);
  if (!tag) {
    appendXmlSpan(parent, "schema-xml-tag", token);
    return;
  }

  const tagClass = tag[1]
    ? "schema-xml-tag schema-xml-tag-close"
    : tag[4]
      ? "schema-xml-tag schema-xml-tag-self"
      : "schema-xml-tag schema-xml-tag-open";

  appendXmlSpan(parent, "schema-xml-punctuation", "<");
  appendXmlSpan(parent, "schema-xml-punctuation schema-xml-close-mark", tag[1]);
  appendXmlSpan(parent, tagClass, tag[2]);
  appendHighlightedXmlAttributes(parent, tag[3]);
  appendXmlSpan(parent, "schema-xml-punctuation schema-xml-self-mark", tag[4]);
  appendXmlSpan(parent, "schema-xml-punctuation", ">");
}

function appendHighlightedXml(parent, xml) {
  const tagPattern = /(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[^>]+?>)/g;
  let lastIndex = 0;

  xml.replace(tagPattern, (match, _token, offset) => {
    appendHighlightedXmlText(parent, xml.slice(lastIndex, offset));
    appendHighlightedXmlTag(parent, match);
    lastIndex = offset + match.length;
    return match;
  });

  appendHighlightedXmlText(parent, xml.slice(lastIndex));
}

function appendSourceSpan(parent, className, text) {
  if (!text) {
    return;
  }

  const span = document.createElement("span");
  if (className) {
    span.className = className;
  }
  appendSearchHighlightedText(span, text);
  parent.appendChild(span);
}

function getSourceLanguage(path = "", content = "") {
  const normalizedPath = String(path || "").toLowerCase();
  if (/\.(html|htm|page|component|cmp|app|evt|design|auradoc|tokens|xml)$/.test(normalizedPath)) {
    return "markup";
  }
  if (/\.(js|mjs|cjs|ts)$/.test(normalizedPath)) {
    return "js";
  }
  if (/\.(cls|trigger)$/.test(normalizedPath)) {
    return "apex";
  }
  if (/^\s*</.test(content)) {
    return "markup";
  }
  return "text";
}

function appendHighlightedSourceCode(parent, code = "", language = "text") {
  const keywordPattern = language === "apex"
    ? /\b(?:abstract|and|as|break|catch|class|continue|delete|do|else|enum|extends|false|final|finally|for|get|global|if|implements|in|insert|instanceof|interface|new|null|or|override|private|protected|public|return|set|sharing|static|super|switch|testMethod|this|throw|transient|trigger|true|try|undelete|update|upsert|virtual|void|webservice|when|while|with|without)\b/g
    : /\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield)\b/g;
  const tokenPattern = /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|@[A-Za-z_][\w.]*|\b[A-Za-z_$][\w$]*(?=\s*\()|\.[A-Za-z_$][\w$]*|\b\d+(?:\.\d+)?\b|[{}()[\].,;:+\-*/%<>=!?&|]+/g;
  let lastIndex = 0;

  function appendKeywords(text) {
    let keywordLastIndex = 0;
    text.replace(keywordPattern, (match, offset) => {
      appendSourceSpan(parent, "", text.slice(keywordLastIndex, offset));
      appendSourceSpan(parent, "schema-code-keyword", match);
      keywordLastIndex = offset + match.length;
      return match;
    });
    const remainder = text.slice(keywordLastIndex);
    let identifierLastIndex = 0;
    remainder.replace(/\b[A-Z][A-Za-z0-9_]*(?:__[a-zA-Z0-9_]+)?\b/g, (match, offset) => {
      appendSourceSpan(parent, "", remainder.slice(identifierLastIndex, offset));
      appendSourceSpan(parent, "schema-code-type", match);
      identifierLastIndex = offset + match.length;
      return match;
    });
    appendSourceSpan(parent, "", remainder.slice(identifierLastIndex));
  }

  code.replace(tokenPattern, (match, offset) => {
    appendKeywords(code.slice(lastIndex, offset));
    if (match.startsWith("//") || match.startsWith("/*")) {
      appendSourceSpan(parent, "schema-code-comment", match);
    } else if (match.startsWith("@")) {
      appendSourceSpan(parent, "schema-code-annotation", match);
    } else if (/^\d/.test(match)) {
      appendSourceSpan(parent, "schema-code-number", match);
    } else if (match.startsWith(".")) {
      appendSourceSpan(parent, "schema-code-property", match);
    } else if (/^[A-Za-z_$]/.test(match)) {
      appendSourceSpan(parent, "schema-code-function", match);
    } else if (/^[{}()[\].,;:+\-*/%<>=!?&|]+$/.test(match)) {
      appendSourceSpan(parent, "schema-code-operator", match);
    } else {
      appendSourceSpan(parent, "schema-code-string", match);
    }
    lastIndex = offset + match.length;
    return match;
  });

  appendKeywords(code.slice(lastIndex));
}

function appendHighlightedMarkup(parent, code = "") {
  const tokenPattern = /(<!--[\s\S]*?-->|<\/?[^>]+?>|\{![\s\S]*?\})/g;
  let lastIndex = 0;

  code.replace(tokenPattern, (match, offset) => {
    appendHighlightedSourceCode(parent, code.slice(lastIndex, offset), "js");
    if (match.startsWith("<!--")) {
      appendSourceSpan(parent, "schema-code-comment", match);
    } else if (match.startsWith("{!")) {
      appendSourceSpan(parent, "schema-code-expression", match);
    } else {
      appendHighlightedXmlTag(parent, match);
    }
    lastIndex = offset + match.length;
    return match;
  });

  appendHighlightedSourceCode(parent, code.slice(lastIndex), "js");
}

function getCurrentDetailScopeKey() {
  if (!selectedNode) {
    return "none";
  }

  return [
    selectedNode.type || "",
    selectedNode.metadataType || "",
    selectedNode.objectKey || "",
    selectedNode.fieldKey || "",
    selectedNode.itemKey || "",
    selectedNode.sourcePath || "",
    detailFormat
  ].join("|");
}

function getDetailFileEditKey(path = "") {
  return `${getCurrentDetailScopeKey()}::${path}`;
}

function clearChangedFileRecordsForSourcePath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return;
  }
  [...changedDetailFiles.entries()].forEach(([key, record]) => {
    if (normalizeMyOrgResultPath(record?.sourcePath || "") !== path) {
      return;
    }
    changedDetailFiles.delete(key);
    editedDetailFileContents.delete(key);
    detailFileBaselineContents.delete(key);
    selectedChangedFileKeys.delete(key);
    if (selectedChangedFileKey === key) {
      selectedChangedFileKey = "";
    }
  });
  renderChangedFilesList();
}

function renderHighlightedCodeLine(parent, line = "", format = "text", rootName = "", path = "") {
  const text = line || "\u200B";

  if (format === "xml" || format === "xmlText") {
    appendHighlightedXml(parent, text);
    return;
  }
  if (format === "json") {
    appendHighlightedSourceCode(parent, text, "js");
    return;
  }

  const language = getSourceLanguage(path || rootName, text);
  if (language === "markup") {
    appendHighlightedMarkup(parent, text);
  } else if (language === "js" || language === "apex") {
    appendHighlightedSourceCode(parent, text, language);
  } else {
    appendSearchHighlightedText(parent, text);
  }
}

function renderLineNumberedCodeView(target, content = "", format = "text", rootName = "", path = "") {
  const container = document.createElement("div");
  container.className = format === "xml" || format === "xmlText"
    ? "schema-code-line-view schema-xml-view"
    : `schema-code-line-view schema-source-code language-${getSourceLanguage(path, content)}`;
  container.dataset.sourcePath = path || "";

  String(content || "").split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const row = document.createElement("div");
    row.className = "schema-code-line-row";
    row.dataset.lineNumber = String(lineNumber);
    row.dataset.sourcePath = path || "";

    const gutter = document.createElement("span");
    gutter.className = "schema-code-line-number";
    gutter.textContent = String(lineNumber);

    const code = document.createElement("span");
    code.className = "schema-code-line-content";
    renderHighlightedCodeLine(code, line, format, rootName, path);

    row.append(gutter, code);
    container.appendChild(row);
  });

  target.appendChild(container);
}

function renderCodeView(target, content = "", format = "text", rootName = "", path = "") {
  target.innerHTML = "";
  renderLineNumberedCodeView(target, content, format, rootName, path);
}

function splitEditableDiffLines(text = "") {
  return String(text || "").split("\n");
}

function getEditableLineDiff(originalText = "", currentText = "") {
  const originalLines = splitEditableDiffLines(originalText);
  const currentLines = splitEditableDiffLines(currentText);
  const states = currentLines.map(() => "normal");
  const originalIndexes = currentLines.map((_line, index) => index);
  let prefixLength = 0;

  while (
    prefixLength < originalLines.length
    && prefixLength < currentLines.length
    && originalLines[prefixLength] === currentLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let originalEnd = originalLines.length - 1;
  let currentEnd = currentLines.length - 1;
  while (
    originalEnd >= prefixLength
    && currentEnd >= prefixLength
    && originalLines[originalEnd] === currentLines[currentEnd]
  ) {
    originalEnd -= 1;
    currentEnd -= 1;
  }

  const changedOriginalCount = Math.max(0, originalEnd - prefixLength + 1);
  for (let index = prefixLength; index <= currentEnd; index += 1) {
    const offset = index - prefixLength;
    if (offset < changedOriginalCount) {
      states[index] = "changed";
      originalIndexes[index] = prefixLength + offset;
    } else {
      states[index] = "added";
      originalIndexes[index] = -1;
    }
  }

  return {
    originalLines,
    currentLines,
    states,
    originalIndexes
  };
}

function appendDiffText(parent, text, className = "") {
  if (!text) {
    return;
  }

  const span = document.createElement("span");
  if (className) {
    span.className = className;
  }
  span.textContent = text;
  parent.appendChild(span);
}

function appendChangedLineDiff(parent, originalLine = "", currentLine = "") {
  let prefixLength = 0;
  while (
    prefixLength < originalLine.length
    && prefixLength < currentLine.length
    && originalLine[prefixLength] === currentLine[prefixLength]
  ) {
    prefixLength += 1;
  }

  let originalEnd = originalLine.length - 1;
  let currentEnd = currentLine.length - 1;
  while (
    originalEnd >= prefixLength
    && currentEnd >= prefixLength
    && originalLine[originalEnd] === currentLine[currentEnd]
  ) {
    originalEnd -= 1;
    currentEnd -= 1;
  }

  appendDiffText(parent, currentLine.slice(0, prefixLength));
  appendDiffText(parent, currentLine.slice(prefixLength, currentEnd + 1) || "\u200B", "schema-edit-diff-token-changed");
  appendDiffText(parent, currentLine.slice(currentEnd + 1));
}

function appendHighlightedCodeLine(parent, line = "", file = null) {
  const text = line || "\u200B";
  const format = file?.dataset?.format || "text";
  const rootName = file?.dataset?.rootName || "";
  const fileName = file?.dataset?.fileName || "";

  if (format === "xml" || format === "xmlText") {
    appendHighlightedXml(parent, text);
    return;
  }

  if (format === "json") {
    appendHighlightedSourceCode(parent, text, "js");
    return;
  }

  const language = getSourceLanguage(fileName || rootName, text);
  if (language === "markup") {
    appendHighlightedMarkup(parent, text);
  } else if (language === "js" || language === "apex") {
    appendHighlightedSourceCode(parent, text, language);
  } else {
    appendSourceSpan(parent, "", text);
  }
}

function syncEditableDiffScroll(file) {
  const editor = file?.querySelector?.(".schema-editable-code-editor");
  const highlight = file?.querySelector?.(".schema-editable-code-highlight");
  const lineNumbers = file?.querySelector?.(".schema-editable-code-line-numbers-inner");
  if (!editor) {
    return;
  }

  if (highlight) {
    highlight.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  }
  if (lineNumbers) {
    lineNumbers.style.transform = `translateY(${-editor.scrollTop}px)`;
  }
}

function renderEditableLineNumbers(file) {
  const editor = file?.querySelector?.(".schema-editable-code-editor");
  const lineNumbers = file?.querySelector?.(".schema-editable-code-line-numbers-inner");
  if (!editor || !lineNumbers) {
    return;
  }

  const lineCount = Math.max(String(editor.value || "").split("\n").length, 1);
  lineNumbers.innerHTML = "";
  Array.from({ length: lineCount }, (_line, index) => {
    const line = document.createElement("span");
    line.className = "schema-editable-code-line-number-line";
    line.dataset.lineNumber = String(index + 1);
    line.textContent = String(index + 1);
    lineNumbers.appendChild(line);
    return line;
  });
  syncEditableDiffScroll(file);
}

function renderEditableDiffHighlight(file) {
  const editor = file?.querySelector?.(".schema-editable-code-editor");
  const highlight = file?.querySelector?.(".schema-editable-code-highlight");
  if (!editor || !highlight) {
    return;
  }

  renderEditableLineNumbers(file);
  highlight.innerHTML = "";
  const diff = getEditableLineDiff(file.currentContent || "", editor.value || "");
  diff.currentLines.forEach((line, index) => {
    const state = diff.states[index];
    const lineEl = document.createElement("span");
    lineEl.className = `schema-edit-diff-line${state !== "normal" ? ` ${state}` : ""}`;
    lineEl.dataset.lineNumber = String(index + 1);

    appendHighlightedCodeLine(lineEl, line, file);

    highlight.appendChild(lineEl);
  });

  syncEditableDiffScroll(file);
}

function createEditableFile(fileName, content = "", options = {}) {
  const editKey = getDetailFileEditKey(fileName);
  const format = options.format || "text";
  const formattedContent = formatDetailFileContent(fileName, content, format);
  const hasEditedContent = editedDetailFileContents.has(editKey);
  const cachedOriginalContent = detailFileBaselineContents.has(editKey)
    ? detailFileBaselineContents.get(editKey)
    : formattedContent;
  const cachedCurrentContent = hasEditedContent
    ? editedDetailFileContents.get(editKey)
    : formattedContent;
  const originalContent = detailFileBaselineContents.has(editKey)
    ? formatDetailFileContent(fileName, cachedOriginalContent, format)
    : formattedContent;
  const currentContent = hasEditedContent
    ? cachedCurrentContent
    : formatDetailFileContent(fileName, cachedCurrentContent, format);
  const file = document.createElement("section");
  file.className = `${options.className || "schema-source-file"} schema-editable-file`;
  const readOnly = isMetadataFolderReadOnly || options.readOnly === true;
  if (!readOnly) {
    file.classList.add("editing");
  }
  file.dataset.format = format;
  file.dataset.rootName = options.rootName || "";
  file.dataset.editKey = editKey;
  file.dataset.fileName = fileName;
  file.originalContent = originalContent;
  file.currentContent = currentContent;
  file.deployInfo = options.deployInfo || null;

  const name = document.createElement("div");
  name.className = options.nameClassName || "schema-source-file-name";
  const nameText = document.createElement("span");
  nameText.textContent = fileName;
  const changedMarker = document.createElement("span");
  changedMarker.className = "schema-editable-changed-marker";
  changedMarker.textContent = "Changed";
  changedMarker.hidden = true;
  name.append(nameText, changedMarker);

  const view = document.createElement("div");
  view.className = "schema-editable-code-view";
  renderCodeView(view, currentContent, file.dataset.format, file.dataset.rootName, fileName);

  const editorWrap = document.createElement("div");
  editorWrap.className = "schema-editable-code-editor-wrap";

  const lineNumbers = document.createElement("div");
  lineNumbers.className = "schema-editable-code-line-numbers";
  lineNumbers.setAttribute("aria-hidden", "true");
  const lineNumbersInner = document.createElement("div");
  lineNumbersInner.className = "schema-editable-code-line-numbers-inner";
  lineNumbers.appendChild(lineNumbersInner);

  const highlight = document.createElement("pre");
  highlight.className = "schema-editable-code-highlight";
  highlight.setAttribute("aria-hidden", "true");

  const editor = document.createElement("textarea");
  editor.className = "schema-editable-code-editor";
  editor.value = currentContent;
  editor.wrap = options.wrapLines ? "soft" : "off";
  editor.spellcheck = false;
  editor.readOnly = readOnly;
  editor.setAttribute("aria-label", `${editor.readOnly ? "View" : "Edit"} ${fileName}`);
  if (!editor.readOnly) {
    editor.addEventListener("input", updateDetailDirtyState);
  }
  editor.addEventListener("scroll", () => syncEditableDiffScroll(file));

  editorWrap.append(lineNumbers, highlight, editor);
  file.append(name, view, editorWrap);
  renderEditableDiffHighlight(file);
  return file;
}

function getEditableDetailFiles() {
  return Array.from(schemaDetailEl.querySelectorAll(".schema-editable-file"));
}

function getChangedFileRecordFromEditable(file, editor) {
  const fileName = file.dataset.fileName || "detail";
  const editKey = file.dataset.editKey || getDetailFileEditKey(fileName);
  const changedContent = typeof editor?.value === "string"
    ? editor.value
    : file.currentContent || "";
  const sourcePath = selectedNode?.sourcePath || fileName;
  const deploySelection = selectedNode?.type === "metadataItem"
    ? selectedNode
    : findSourceSelectionByPath(sourcePath) || selectedNode;
  const item = deploySelection?.type === "metadataItem"
    ? findMetadataItem(deploySelection.metadataType, deploySelection.itemKey)
    : null;
  const group = deploySelection?.type === "metadataItem"
    ? findMetadataGroup(deploySelection.metadataType)
    : null;
  return {
    key: editKey,
    fileName,
    rootName: file.dataset.rootName || "",
    format: file.dataset.format || "text",
    sourceContent: file.originalContent || "",
    changedContent,
    sourcePath,
    label: deploySelection?.label || deploySelection?.apiName || deploySelection?.key || "",
    deployInfo: file.deployInfo || null,
    metadataType: deploySelection?.metadataType || "",
    itemKey: deploySelection?.itemKey || "",
    itemId: item?.id || item?.apiName || item?.key || "",
    itemRecord: item?.record || null,
    groupKind: group?.kind || ""
  };
}

function syncChangedFileRecord(file) {
  if (isMetadataFolderReadOnly) {
    return;
  }
  const editKey = file.dataset.editKey || "";
  if (!editKey) {
    return;
  }

  const editor = file.querySelector(".schema-editable-code-editor");
  const changedContent = typeof editor?.value === "string"
    ? editor.value
    : file.currentContent || "";
  const hasSourceChange = changedContent !== (file.originalContent || "");
  if (!hasSourceChange) {
    editedDetailFileContents.delete(editKey);
    changedDetailFiles.delete(editKey);
    selectedChangedFileKeys.delete(editKey);
    if (selectedChangedFileKey === editKey) {
      selectedChangedFileKey = "";
    }
    return;
  }

  const wasTracked = changedDetailFiles.has(editKey);
  editedDetailFileContents.set(editKey, changedContent);
  changedDetailFiles.set(editKey, getChangedFileRecordFromEditable(file, editor));
  if (!wasTracked) {
    selectedChangedFileKeys.add(editKey);
  }
}

function updateEditableFileChangedState(file) {
  const editor = file.querySelector(".schema-editable-code-editor");
  const marker = file.querySelector(".schema-editable-changed-marker");
  const hasUnsavedChanges = Boolean(editor && editor.value !== (file.currentContent || ""));
  const changedContent = typeof editor?.value === "string"
    ? editor.value
    : file.currentContent || "";
  const hasSourceChange = changedContent !== (file.originalContent || "");
  file.classList.toggle("changed", hasSourceChange);
  renderEditableDiffHighlight(file);
  if (marker) {
    marker.hidden = !hasSourceChange;
  }
  syncChangedFileRecord(file);
  return hasUnsavedChanges;
}

function updateDetailDirtyState() {
  if (isMetadataFolderReadOnly) {
    return;
  }
  const files = getEditableDetailFiles();
  const hasChanges = files.map((file) => updateEditableFileChangedState(file)).some(Boolean);
  const manifestFile = files.find((file) => file.classList.contains("schema-package-manifest-file"));
  if (manifestFile) {
    updatePackageManifestEditState(manifestFile);
  }
  const saveButton = schemaDetailEl.querySelector(".schema-detail-save-button");
  if (saveButton) {
    saveButton.disabled = !hasChanges;
  }
  renderChangedFilesList();
}

function setDetailEditing(_isEditing = true) {
  if (isMetadataFolderReadOnly) {
    return;
  }
  const files = getEditableDetailFiles();
  if (!files.length) {
    return;
  }

  files.forEach((file) => {
    file.classList.add("editing");
  });
  updateDetailDirtyState();
}

function validateEditedContent(content = "", format = "text") {
  if (format === "json") {
    JSON.parse(content || "{}");
  }

  if (format === "xml") {
    const document = new DOMParser().parseFromString(content, "application/xml");
    const parseError = document.getElementsByTagName("parsererror")[0];
    if (parseError) {
      throw new Error(parseError.textContent || "Invalid XML.");
    }
  }
}

function createChangedDiffColumn(title, rows = [], record, side = "changed") {
  const column = document.createElement("div");
  column.className = "schema-changed-diff-column";

  const head = document.createElement("div");
  head.className = "schema-changed-diff-head";
  head.textContent = title;

  const body = document.createElement("div");
  body.className = "schema-changed-diff-body";
  rows.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `schema-changed-diff-line ${entry.state || "normal"}`;

    const gutter = document.createElement("span");
    gutter.className = "schema-code-line-number";
    gutter.textContent = entry.lineNumber ? String(entry.lineNumber) : "";

    const code = document.createElement("span");
    code.className = "schema-code-line-content";
    if (entry.state === "placeholder") {
      code.textContent = "";
    } else if (entry.state === "omitted") {
      code.textContent = "⋯";
    } else if (entry.state === "changed" && side === "changed") {
      appendChangedLineDiff(code, entry.compareLine || "", entry.line || "");
    } else {
      appendHighlightedCodeLine(code, entry.line, {
        dataset: {
          format: record?.format || "text",
          rootName: record?.rootName || "",
          fileName: record?.fileName || ""
        }
      });
    }

    row.append(gutter, code);
    body.appendChild(row);
  });

  column.append(head, body);
  return column;
}

function createChangedFileDiff(record) {
  const fileName = record?.fileName || "detail";
  const { sourceRows, changedRows } = getChangedFileSideBySideRows(
    record?.sourceContent || "",
    record?.changedContent || ""
  );
  const item = document.createElement("details");
  item.className = "schema-changed-file";
  item.open = true;

  const summary = document.createElement("summary");
  summary.className = "schema-changed-file-summary";
  summary.textContent = fileName;

  const diff = document.createElement("div");
  diff.className = "schema-changed-diff";
  diff.append(
    createChangedDiffColumn("Source", sourceRows, record, "source"),
    createChangedDiffColumn("Changed", changedRows, record, "changed")
  );
  syncChangedDiffScroll(diff);

  item.append(summary, diff);
  return item;
}

function syncChangedDiffScroll(diff) {
  const scrollBodies = Array.from(diff.querySelectorAll(".schema-changed-diff-body"));
  let isSyncing = false;

  scrollBodies.forEach((body) => {
    body.addEventListener("scroll", () => {
      if (isSyncing) {
        return;
      }

      isSyncing = true;
      scrollBodies.forEach((otherBody) => {
        if (otherBody === body) {
          return;
        }

        otherBody.scrollTop = body.scrollTop;
        otherBody.scrollLeft = body.scrollLeft;
      });
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    }, { passive: true });
  });
}

function pruneSelectedChangedFileKeys() {
  for (const key of [...selectedChangedFileKeys]) {
    if (!changedDetailFiles.has(key)) {
      selectedChangedFileKeys.delete(key);
    }
  }
  if (selectedChangedFileKey && !changedDetailFiles.has(selectedChangedFileKey)) {
    selectedChangedFileKey = "";
  }
}

function getSelectedChangedFileRecords(options = {}) {
  pruneSelectedChangedFileKeys();
  const records = [...selectedChangedFileKeys]
    .map((key) => changedDetailFiles.get(key))
    .filter(Boolean);
  return options.deployableOnly
    ? records.filter((record) => canDeployChangedFileRecord(record))
    : records;
}

function updateChangedFilesCheckAllState() {
  if (!changedCheckAllInput) {
    return;
  }

  pruneSelectedChangedFileKeys();
  const totalCount = changedDetailFiles.size;
  const selectedCount = selectedChangedFileKeys.size;
  changedCheckAllInput.disabled = changedDeployInProgress || totalCount === 0;
  changedCheckAllInput.checked = totalCount > 0 && selectedCount === totalCount;
  changedCheckAllInput.indeterminate = selectedCount > 0 && selectedCount < totalCount;
  changedCheckAllInput.setAttribute("aria-label", totalCount
    ? `Select all changed files (${selectedCount} of ${totalCount} selected)`
    : "Select all changed files");
}

function updateChangedFilesBadge() {
  if (!changedFilesCountEl) {
    return;
  }

  pruneSelectedChangedFileKeys();
  const count = changedDetailFiles.size;
  const selectedCount = selectedChangedFileKeys.size;
  const deployableCount = getSelectedChangedFileRecords({ deployableOnly: true }).length;
  changedFilesCountEl.hidden = count === 0;
  changedFilesCountEl.textContent = count > 99 ? "99+" : String(count);
  changedTabButton?.setAttribute("aria-label", count ? `Changed Files (${count})` : "Changed Files");
  changedTabButton?.setAttribute("title", count ? `Changed Files (${count})` : "Changed Files");
  updateChangedFilesCheckAllState();
  if (deploySelectedChangedButton) {
    deploySelectedChangedButton.textContent = `Deploy Selected ${selectedCount}`;
    deploySelectedChangedButton.disabled = changedDeployInProgress || !session?.sid || selectedCount === 0;
    deploySelectedChangedButton.title = deployableCount < selectedCount
      ? `${selectedCount - deployableCount} selected ${selectedCount - deployableCount === 1 ? "file is" : "files are"} not deployable.`
      : "";
  }
  if (validateSelectedChangedButton) {
    validateSelectedChangedButton.textContent = `Validate Selected ${selectedCount}`;
    validateSelectedChangedButton.disabled = changedDeployInProgress || !session?.sid || selectedCount === 0;
  }
  if (discardSelectedChangedButton) {
    discardSelectedChangedButton.textContent = `Discard Change Selected ${selectedCount}`;
    discardSelectedChangedButton.disabled = changedDeployInProgress || selectedCount === 0;
  }
}

function renderChangedFilesList() {
  updateChangedFilesBadge();
  if (!changedFilesListEl) {
    return;
  }

  changedFilesListEl.innerHTML = "";
  const changedFiles = Array.from(changedDetailFiles.values());
  if (!changedFiles.length) {
    const empty = document.createElement("div");
    empty.className = "schema-empty";
    empty.textContent = t("schemaUi.noChangedFiles");
    changedFilesListEl.appendChild(empty);
    return;
  }

  const group = document.createElement("div");
  group.className = "schema-changed-group-head";
  group.textContent = `${changedFiles.length} ${changedFiles.length === 1 ? "change" : "changes"}`;
  changedFilesListEl.appendChild(group);

  changedFiles
    .sort((left, right) => (left.fileName || "").localeCompare(right.fileName || ""))
    .forEach((record) => {
      const row = document.createElement("div");
      row.className = "schema-tree-row schema-tree-file-row schema-changed-file-row";
      row.classList.toggle("selected", selectedChangedFileKey === record.key);
      row.classList.toggle("checked", selectedChangedFileKeys.has(record.key));

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "schema-changed-file-checkbox";
      checkbox.checked = selectedChangedFileKeys.has(record.key);
      checkbox.disabled = changedDeployInProgress;
      checkbox.setAttribute("aria-label", `Select ${record.fileName || "changed file"} for deploy`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedChangedFileKeys.add(record.key);
        } else {
          selectedChangedFileKeys.delete(record.key);
        }
        row.classList.toggle("checked", checkbox.checked);
        updateChangedFilesBadge();
      });

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "schema-changed-file-open";
      const text = document.createElement("span");
      text.className = "schema-tree-name schema-changed-file-name";
      const name = document.createElement("span");
      name.className = "schema-tree-primary";
      name.textContent = record.fileName || "detail";
      const path = document.createElement("span");
      path.className = "schema-tree-secondary";
      path.textContent = record.sourcePath || record.label || "";
      text.append(name, path);
      const status = document.createElement("span");
      status.className = "schema-changed-status";
      status.textContent = record.operation === "delete" ? "D" : "M";
      openButton.append(createTreeIcon("file"), text, status);
      openButton.addEventListener("click", () => {
        selectedChangedFileKey = record.key;
        renderChangedFilesList();
        renderChangedFileDetail(record.key);
      });
      row.append(checkbox, openButton);
      changedFilesListEl.appendChild(row);
    });
}

function toggleAllChangedFiles(checked) {
  if (changedDeployInProgress) {
    updateChangedFilesBadge();
    return;
  }

  selectedChangedFileKeys.clear();
  if (checked) {
    changedDetailFiles.forEach((_record, key) => selectedChangedFileKeys.add(key));
  }
  updateChangedFilesBadge();
  renderChangedFilesList();
}

function renderChangedFileDetail(recordKey) {
  if (isMetadataFolderReadOnly) {
    renderEmptyDetail(t("schemaStatus.readOnly"));
    return;
  }
  const record = changedDetailFiles.get(recordKey);
  if (!record) {
    renderEmptyDetail("Changed file not found.");
    renderChangedFilesList();
    return;
  }

  schemaDetailEl.innerHTML = "";
  const header = createDetailTitle(record.fileName, record.label || record.sourcePath || "", "Changed", "file");
  const actions = header.querySelector(".schema-detail-actions");
  const canDeploy = canDeployChangedFileRecord(record);
  const deployButton = createDetailButton("Deploy", canDeploy ? "schema-detail-deploy-button" : "schema-detail-deploy-button secondary");
  deployButton.disabled = changedDeployInProgress || !session?.sid || !canDeploy;
  if (!session?.sid) {
    deployButton.title = t("schemaUi.signInToDeploy");
  } else if (!canDeploy) {
    deployButton.title = t("schemaUi.cannotDeployYet");
  } else {
    deployButton.title = "";
  }
  if (canDeploy) {
    deployButton.addEventListener("click", () => void deployChangedFile(record.key));
  }
  actions?.appendChild(deployButton);
  const discardButton = createDetailButton("Discard Change", "secondary schema-detail-discard-button");
  discardButton.disabled = changedDeployInProgress;
  discardButton.addEventListener("click", () => void discardChangedFile(record.key));
  actions?.appendChild(discardButton);
  schemaDetailEl.appendChild(header);
  const panel = document.createElement("section");
  panel.className = "schema-changed-panel schema-changed-detail-panel";
  const body = document.createElement("div");
  body.className = "schema-changed-panel-body";
  body.appendChild(createChangedFileDiff(record));
  panel.appendChild(body);
  schemaDetailEl.appendChild(panel);
  setStatus(t("schemaStatus.showingChangedDiff", { fileName: record.fileName }));
}

function getBundleMetadataDeployTarget(record = {}) {
  const relativePath = getRelativeMetadataFileName(record.sourcePath || record.fileName || "");
  const auraMatch = relativePath.match(/^aura\/([^/]+)\//i);
  if (auraMatch) {
    return {
      metadataApiType: "AuraDefinitionBundle",
      fullName: auraMatch[1],
      fileName: relativePath
    };
  }

  const lwcMatch = relativePath.match(/^lwc\/([^/]+)\//i);
  if (lwcMatch) {
    return {
      metadataApiType: "LightningComponentBundle",
      fullName: lwcMatch[1],
      fileName: relativePath
    };
  }

  return null;
}

function getLocalBundleMetadataDeployFiles(record = {}, target = getBundleMetadataDeployTarget(record)) {
  const sourcePath = getRelativeMetadataFileName(record.sourcePath || record.fileName || "");
  const match = sourcePath.match(/^(aura|lwc)\/([^/]+)\//i);
  if (!match || !target || !String(target.fullName || "").trim()) {
    return [];
  }

  const baseFolder = `${SOURCE_DEFAULT_PREFIX}${match[0]}`;
  const relativeBaseFolder = match[0];
  const changedRelativePath = getRelativeMetadataFileName(record.sourcePath || record.fileName || "");
  const changedRecordPath = changedRelativePath || getRelativeMetadataFileName(target.fileName || "");
  const filesByRelativePath = new Map();

  [...localSourceEntries.entries()].forEach(([path, entry]) => {
    if (entry?.kind !== "file") {
      return;
    }
    const normalizedPath = String(path || "");
    if (!normalizedPath.startsWith(baseFolder) && !normalizedPath.startsWith(relativeBaseFolder)) {
      return;
    }
    const name = getRelativeMetadataFileName(path || "");
    filesByRelativePath.set(name, createSourceFile(path, entry.content || ""));
  });

  const changedContent = typeof record.changedContent === "string" ? record.changedContent : "";
  if (changedRecordPath) {
    const name = changedRecordPath;
    filesByRelativePath.set(name, createSourceFile(
      pathForMetadataSourceDeployFiles(record.sourcePath || record.fileName || ""),
      changedContent,
      { deployInfo: record.deployInfo || null }
    ));
  }

  return Array.from(filesByRelativePath.values());
}

function pathForMetadataSourceDeployFiles(path = "") {
  const sourcePath = String(path || "").trim();
  if (!sourcePath) {
    return "";
  }
  return toDefaultSourcePath(sourcePath);
}

const VISUALFORCE_METADATA_SOURCE_TARGETS = {
  apexPages: {
    metadataApiType: "ApexPage",
    rootName: "ApexPage",
    folder: "pages",
    extension: "page"
  },
  apexComponents: {
    metadataApiType: "ApexComponent",
    rootName: "ApexComponent",
    folder: "components",
    extension: "component"
  }
};

function getVisualforceMetadataSourceDeployTarget(record = {}) {
  const sourcePath = record.sourcePath || record.fileName || "";
  const relativePath = getRelativeMetadataFileName(sourcePath);
  if (!relativePath || /-meta\.xml$/i.test(relativePath)) {
    return null;
  }

  const targetEntry = Object.entries(VISUALFORCE_METADATA_SOURCE_TARGETS).find(([, config]) => (
    new RegExp(`^${config.folder}/([^/]+)\\.${config.extension}$`, "i").test(relativePath)
  ));
  if (!targetEntry) {
    return null;
  }

  const [metadataType, config] = targetEntry;
  if (record.metadataType && ![metadataType, config.metadataApiType].includes(record.metadataType)) {
    return null;
  }

  const match = relativePath.match(new RegExp(`^${config.folder}/([^/]+)\\.${config.extension}$`, "i"));
  const fullName = match?.[1] || "";
  if (!fullName) {
    return null;
  }

  return {
    ...config,
    metadataType,
    fullName,
    sourcePath: relativePath,
    metaPath: `${relativePath}-meta.xml`
  };
}

function getVisualforceMetadataDeployApiVersion() {
  return formatMetadataApiVersion(SALESFORCE_API_VERSION || PACKAGE_XML_API_VERSION || schemaStore?.apiVersion);
}

function createVisualforceMetadataXml(target = {}, record = {}) {
  return createMetadataXmlDocument(target.rootName, {
    apiVersion: getVisualforceMetadataDeployApiVersion(),
    label: firstValue(record.itemRecord?.MasterLabel, record.itemRecord?.Name, record.label, target.fullName),
    description: firstValue(record.itemRecord?.Description)
  });
}

function normalizeVisualforceMetadataXmlForDeploy(xml = "", target = {}, record = {}) {
  const content = String(xml || "").trim() || createVisualforceMetadataXml(target, record);
  const apiVersion = getVisualforceMetadataDeployApiVersion();
  if (!apiVersion) {
    return content;
  }
  if (/<apiVersion>[\s\S]*?<\/apiVersion>/i.test(content)) {
    return content.replace(/<apiVersion>[\s\S]*?<\/apiVersion>/i, `<apiVersion>${apiVersion}</apiVersion>`);
  }
  return content.replace(/(<[A-Za-z][^>\s/]*(?:\s[^>]*)?>)/, `$1\n    <apiVersion>${apiVersion}</apiVersion>`);
}

function getVisualforceMetadataSourceDeployFiles(record = {}, target = getVisualforceMetadataSourceDeployTarget(record)) {
  if (!target) {
    return [];
  }

  const sourceName = target.sourcePath;
  const metaName = target.metaPath;
  const metaPath = toDefaultSourcePath(metaName);
  const metaContent = localSourceEntries.get(metaPath)?.content
    || localSourceEntries.get(metaName)?.content
    || "";

  return [
    {
      name: sourceName,
      content: record.changedContent || ""
    },
    {
      name: metaName,
      content: normalizeVisualforceMetadataXmlForDeploy(metaContent, target, record)
    }
  ];
}

async function getBundleMetadataDeployFiles(record = {}, target = getBundleMetadataDeployTarget(record)) {
  const changedFile = {
    name: target?.fileName || getRelativeMetadataFileName(record.sourcePath || record.fileName || ""),
    content: record.changedContent || ""
  };
  if (!target || !record.metadataType || !record.itemKey || !["auraBundles", "lwcBundles"].includes(record.metadataType)) {
    const localBundleFiles = getLocalBundleMetadataDeployFiles(record, target);
    if (localBundleFiles.length) {
      return localBundleFiles;
    }
    return [changedFile];
  }

  const item = findMetadataItem(record.metadataType, record.itemKey);
  if (!item) {
    return [changedFile];
  }

  try {
    const detail = await loadMetadataItemDetail({
      type: "metadataItem",
      metadataType: record.metadataType,
      itemKey: record.itemKey
    });
    const files = createMetadataSourceFiles(record.metadataType, detail, item)
      .map((file) => ({
        name: getRelativeMetadataFileName(file.path || ""),
        content: file.content || ""
      }))
      .filter((file) => file.name);
    const changedIndex = files.findIndex((file) => file.name === changedFile.name);
    if (changedIndex >= 0) {
      files[changedIndex] = changedFile;
      return files;
    }
    return [...files, changedFile];
  } catch (_error) {
    const localBundleFiles = getLocalBundleMetadataDeployFiles(record, target);
    if (localBundleFiles.length) {
      return localBundleFiles;
    }
    return [changedFile];
  }
}

function hasDeployableChangedFileMetadata(record = {}) {
  const sourcePath = getRelativeMetadataFileName(record.sourcePath || record.fileName || "");
  const bundleMetadataTarget = getBundleMetadataDeployTarget(record);
  const visualforceMetadataTarget = getVisualforceMetadataSourceDeployTarget(record);
  const hasSourcePath = isForceAppSourcePath(record.sourcePath || "")
    || isForceAppSourcePath(`${SOURCE_DEFAULT_PREFIX}${sourcePath}`)
    || Boolean(bundleMetadataTarget)
    || Boolean(visualforceMetadataTarget);
  return Boolean(
    hasSourcePath
    && (
      record.operation === "delete"
      || bundleMetadataTarget
      || visualforceMetadataTarget
      || record.deployInfo
      || (record.groupKind === "metadata" && ["xml", "xmlText"].includes(record.format || "") && record.metadataType && record.itemId)
    )
  );
}

function enrichChangedFileRecordForDeploy(record = {}) {
  if (!record || hasDeployableChangedFileMetadata(record)) {
    return record;
  }

  const sourcePath = record.sourcePath || record.fileName || "";
  const localEntry = sourcePath ? localSourceEntries.get(sourcePath) : null;
  const deployInfo = record.deployInfo || localEntry?.deployInfo || createMyOrgSearchDeployInfo(localEntry?.metadataType || record.metadataType || "", localEntry?.recordId || record.itemId || "");
  if (deployInfo) {
    return {
      ...record,
      deployInfo,
      metadataType: localEntry?.metadataType || record.metadataType || "",
      itemId: localEntry?.recordId || record.itemId || "",
      groupKind: record.groupKind || "tooling"
    };
  }

  const selection = findSourceSelectionByPath(sourcePath);
  if (selection?.type !== "metadataItem") {
    return record;
  }

  const item = findMetadataItem(selection.metadataType, selection.itemKey);
  const group = findMetadataGroup(selection.metadataType);
  return {
    ...record,
    sourcePath: selection.sourcePath || sourcePath,
    metadataType: selection.metadataType || record.metadataType || "",
    itemKey: selection.itemKey || record.itemKey || "",
    itemId: item?.id || item?.apiName || item?.key || record.itemId || "",
    itemRecord: item?.record || record.itemRecord || null,
    groupKind: group?.kind || record.groupKind || ""
  };
}

function canDeployChangedFileRecord(record = {}) {
  return hasDeployableChangedFileMetadata(enrichChangedFileRecordForDeploy(record));
}

async function assertChangedFileNotStale(record = {}) {
  const enriched = enrichChangedFileRecordForDeploy(record);
  const deployInfo = enriched?.deployInfo;
  if (!deployInfo?.sobject || !deployInfo?.id || !deployInfo?.field || enriched.sourceContent == null) {
    return { checked: false, reason: "No direct Tooling source target." };
  }
  const current = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/${encodeURIComponent(deployInfo.sobject)}/${encodeURIComponent(deployInfo.id)}`
  );
  const normalizeContent = (value) => String(value ?? "").replace(/\r\n/g, "\n");
  const orgContent = normalizeContent(current?.[deployInfo.field]);
  if (orgContent !== normalizeContent(enriched.sourceContent)) {
    throw new Error(`${enriched.fileName || "Changed file"} changed in Salesforce after it was opened. Reload it before deploying to avoid overwriting newer org content.`);
  }
  return { checked: true };
}

function updateOpenEditableFileBaseline(record) {
  const file = getEditableDetailFiles().find((candidate) => candidate.dataset.editKey === record.key);
  if (!file) {
    return;
  }

  const view = file.querySelector(".schema-editable-code-view");
  const editor = file.querySelector(".schema-editable-code-editor");
  file.originalContent = record.changedContent || "";
  file.currentContent = record.changedContent || "";
  if (editor) {
    editor.value = record.changedContent || "";
  }
  renderCodeView(view, record.changedContent || "", record.format || "text", record.rootName || "", record.fileName || "");
  updateEditableFileChangedState(file);
}

function markChangedFileSaved(record) {
  editedDetailFileContents.set(record.key, record.changedContent || "");
  detailFileBaselineContents.set(record.key, record.changedContent || "");
  updateOpenEditableFileBaseline(record);
  changedDetailFiles.delete(record.key);
  selectedChangedFileKeys.delete(record.key);
  if (selectedChangedFileKey === record.key) {
    selectedChangedFileKey = "";
  }
}

function restoreOpenEditableFileToSource(record) {
  const sourceContent = record?.sourceContent || "";
  editedDetailFileContents.delete(record.key);
  detailFileBaselineContents.set(record.key, sourceContent);

  const file = getEditableDetailFiles().find((candidate) => candidate.dataset.editKey === record.key);
  if (!file) {
    return;
  }

  const view = file.querySelector(".schema-editable-code-view");
  const editor = file.querySelector(".schema-editable-code-editor");
  file.originalContent = sourceContent;
  file.currentContent = sourceContent;
  if (editor) {
    editor.value = sourceContent;
  }
  renderCodeView(view, sourceContent, record.format || "text", record.rootName || "", record.fileName || "");
  updateEditableFileChangedState(file);
  setDetailEditing(false);
}

function removeDiscardedDeletePath(record = {}) {
  if (record.operation !== "delete" || !record.sourcePath) {
    return;
  }

  deletedSourcePaths.delete(record.sourcePath);
  for (const deletedPath of [...deletedSourcePaths]) {
    if (record.sourcePath.startsWith(`${deletedPath}/`)) {
      deletedSourcePaths.delete(deletedPath);
    }
  }
}

async function clearSearchEntriesForDiscardedChanges(records = []) {
  if (!records.length) {
    return {
      updated: false,
      fileCount: 0
    };
  }

  const paths = records
    .map((record) => normalizeSourcePath(record.sourcePath || record.fileName || ""))
    .filter(Boolean);
  paths.forEach((path) => searchDetailEntryCache.delete(path));
  return {
    updated: false,
    fileCount: paths.length
  };
}

async function clearSearchEntriesForSavedChangedFile(record = {}) {
  const sourcePath = normalizeSourcePath(record.sourcePath || record.fileName || "");
  if (!sourcePath) {
    return {
      updated: false,
      fileCount: 0
    };
  }

  searchDetailEntryCache.delete(sourcePath);
  return {
    updated: false,
    fileCount: 1
  };
}

function discardChangedFileRecord(record) {
  if (isMetadataFolderReadOnly) {
    throw new Error(t("schemaStatus.readOnly"));
  }
  if (!record) {
    throw new Error("Changed file not found.");
  }

  changedDetailFiles.delete(record.key);
  selectedChangedFileKeys.delete(record.key);
  if (selectedChangedFileKey === record.key) {
    selectedChangedFileKey = "";
  }
  restoreOpenEditableFileToSource(record);
  removeDiscardedDeletePath(record);
}

async function discardChangedFile(recordKey) {
  const record = changedDetailFiles.get(recordKey);
  try {
    discardChangedFileRecord(record);
    await clearSearchEntriesForDiscardedChanges(record ? [record] : []);
    renderChangedFilesList();
    renderSchema();
    renderEmptyDetail("Changed file discarded.");
    setStatus(t("schemaStatus.discardedChangeFile", { fileName: record?.fileName || t("schemaStatus.changedFileFallback") }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
  }
}

async function deployChangedFileRecord(record, options = {}) {
  if (isMetadataFolderReadOnly) {
    throw new Error(t("schemaStatus.readOnly"));
  }
  record = enrichChangedFileRecordForDeploy(record);
  if (!record) {
    throw new Error("Changed file not found.");
  }
  if (!session?.host || !session?.sid) {
    throw new Error(t("schemaStatus.missingSession"));
  }

  validateEditedContent(record.changedContent || "", record.format || "text");

  if (record.operation === "delete") {
    window.alert(`${record.fileName || record.sourcePath || "This file"} will be removed from the Salesforce org.`);
    markChangedFileSaved(record);
    return;
  }

  const bundleMetadataTarget = getBundleMetadataDeployTarget(record);
  if (bundleMetadataTarget) {
    const bundleFiles = await getBundleMetadataDeployFiles(record, bundleMetadataTarget);
    await deployMetadataSourceFiles(
      session.host,
      session.sid,
      bundleMetadataTarget.metadataApiType,
      bundleMetadataTarget.fullName,
      bundleFiles,
      {
        apiVersion: schemaStore?.apiVersion,
        checkOnly: options.checkOnly === true
      }
    );
  } else {
    const visualforceMetadataTarget = getVisualforceMetadataSourceDeployTarget(record);
    if (visualforceMetadataTarget) {
      await deployMetadataSourceFiles(
        session.host,
        session.sid,
        visualforceMetadataTarget.metadataApiType,
        visualforceMetadataTarget.fullName,
        getVisualforceMetadataSourceDeployFiles(record, visualforceMetadataTarget),
        {
          apiVersion: SALESFORCE_API_VERSION,
          checkOnly: options.checkOnly === true
        }
      );
    } else if (record.deployInfo) {
      if (options.checkOnly) throw new Error("Validate Only is unavailable for Tooling API source deploys.");
      await deploySourceFileContent(session.host, session.sid, record.deployInfo, record.changedContent || "", {
        apiVersion: schemaStore?.apiVersion
      });
    } else if (canDeployChangedFileRecord(record)) {
      await deployMetadataXml(session.host, session.sid, record.metadataType, record.itemId, record.changedContent || "", {
        apiVersion: schemaStore?.apiVersion,
        record: record.itemRecord || {},
        checkOnly: options.checkOnly === true
      });
    } else {
      throw new Error(`Deploy is not supported for ${record.fileName || "this file"}.`);
    }
  }

  if (options.checkOnly) return;
  markChangedFileSaved(record);
  await clearSearchEntriesForSavedChangedFile(record);
  const cacheKey = record.metadataType && record.itemId
    ? getMetadataDetailCacheKey({ type: "metadataItem", metadataType: record.metadataType, itemKey: record.itemKey || record.itemId })
    : "";
  if (cacheKey) {
    metadataDetailCache.delete(cacheKey);
    toolingSourceDetailCache.delete(cacheKey);
  }
}

async function deployChangedFile(recordKey) {
  const record = changedDetailFiles.get(recordKey);
  try {
    await assertChangedFileNotStale(record);
    await confirmOrgMutation({
      host: session?.host,
      operation: "Deploy metadata change",
      target: record?.sourcePath || record?.fileName || "changed file",
      count: 1,
      risk: ORG_RISK.METADATA_MUTATION
    });
    changedDeployInProgress = true;
    updateChangedFilesBadge();
    setStatus(t("schemaStatus.deployingFile", { fileName: record?.fileName || t("schemaStatus.changedFileFallback") }));
    await deployChangedFileRecord(record);
    await recordOperation({
      kind: "metadata-deploy",
      status: "success",
      host: session.host,
      target: record?.sourcePath || record?.fileName,
      count: 1,
      verificationChecklist: ["Reload the metadata item", "Confirm the expected setup behavior", "Review deployment errors and dependent components"],
      setupUrl: `https://${session.host}/lightning/setup/SetupOneHome/home`
    });
    renderChangedFilesList();
    renderEmptyDetail("Changed file deployed.");
    setStatus(t("schemaStatus.deployedFile", { fileName: record?.fileName || t("schemaStatus.changedFileFallback") }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
  } finally {
    changedDeployInProgress = false;
    updateChangedFilesBadge();
  }
}

async function deploySelectedChangedFiles() {
  const selectedRecords = getSelectedChangedFileRecords();
  const records = selectedRecords.filter((record) => canDeployChangedFileRecord(record));
  let deployedCount = 0;
  try {
    if (!selectedRecords.length) {
      throw new Error("No selected changed files.");
    }
    if (!records.length) {
      throw new Error("No deployable selected changed files.");
    }

    for (const record of records) await assertChangedFileNotStale(record);

    await confirmOrgMutation({
      host: session?.host,
      operation: "Deploy selected metadata changes",
      target: records.map((record) => record.fileName || record.sourcePath).filter(Boolean).slice(0, 3).join(", "),
      count: records.length,
      risk: ORG_RISK.METADATA_MUTATION
    });

    changedDeployInProgress = true;
    updateChangedFilesBadge();
    setStatus(t("schemaStatus.deployingSelected", { count: records.length, files: t(records.length === 1 ? "schemaStatus.fileOne" : "schemaStatus.fileMany") }));
    const failures = [];
    for (const record of records) {
      try {
        setStatus(t("schemaStatus.deployingFile", { fileName: record.fileName || t("schemaStatus.changedFileFallback") }));
        await deployChangedFileRecord(record);
        deployedCount += 1;
      } catch (error) {
        failures.push({
          record,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (failures.length) {
      const firstFailure = failures[0];
      const failureName = firstFailure.record?.fileName || "changed file";
      throw new Error(`${failures.length} selected ${failures.length === 1 ? "file" : "files"} failed to deploy. ${failureName}: ${firstFailure.message}`);
    }

    renderEmptyDetail("Selected changed files deployed.");
    const skippedCount = selectedRecords.length - records.length;
    const skippedText = skippedCount ? ` ${skippedCount} selected ${skippedCount === 1 ? "file was" : "files were"} not deployable.` : "";
    setStatus(t("schemaStatus.deployedSelected", { count: deployedCount, files: t(deployedCount === 1 ? "schemaStatus.fileOne" : "schemaStatus.fileMany"), skipped: skippedText }), skippedCount > 0);
    await recordOperation({
      kind: "metadata-deploy",
      status: skippedCount ? "partial" : "success",
      host: session.host,
      targets: records.map((record) => record.sourcePath || record.fileName),
      count: deployedCount,
      skippedCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const deployedText = deployedCount ? t("schemaStatus.deployedBeforeError", { count: deployedCount, files: t(deployedCount === 1 ? "schemaStatus.fileWasOne" : "schemaStatus.fileWereMany") }) : "";
    setStatus(`${message}${deployedText}`, true);
  } finally {
    changedDeployInProgress = false;
    renderChangedFilesList();
    updateChangedFilesBadge();
  }
}

async function validateSelectedChangedFiles() {
  const selectedRecords = getSelectedChangedFileRecords();
  const records = selectedRecords.filter((record) => canDeployChangedFileRecord(record));
  let validatedCount = 0;
  const failures = [];
  try {
    if (!records.length) throw new Error("No deployable selected changed files.");
    changedDeployInProgress = true;
    updateChangedFilesBadge();
    for (const record of records) {
      try {
        setStatus(t("schemaStatus.validatingFile", { fileName: record.fileName || t("schemaStatus.changedFileFallback") }));
        await deployChangedFileRecord(record, { checkOnly: true });
        validatedCount += 1;
      } catch (error) {
        failures.push({
          fileName: record.fileName || record.sourcePath || "changed file",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    const receipt = await recordOperation({
      kind: "metadata-validation",
      status: failures.length ? "partial" : "success",
      host: session.host,
      targets: records.map((record) => record.sourcePath || record.fileName),
      count: validatedCount,
      failures
    });
    if (failures.length) throw new Error(`${failures.length} validation ${failures.length === 1 ? "check" : "checks"} failed. ${failures[0].fileName}: ${failures[0].message}`);
    setStatus(t("schemaStatus.validatedSelected", { count: validatedCount, files: t(validatedCount === 1 ? "schemaStatus.fileOne" : "schemaStatus.fileMany"), receipt: receipt.id }));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    changedDeployInProgress = false;
    updateChangedFilesBadge();
  }
}

async function discardSelectedChangedFiles() {
  const records = getSelectedChangedFileRecords();
  try {
    if (!records.length) {
      throw new Error("No selected changed files.");
    }

    records.forEach((record) => discardChangedFileRecord(record));
    await clearSearchEntriesForDiscardedChanges(records);
    renderChangedFilesList();
    renderSchema();
    renderEmptyDetail("Selected changed files discarded.");
    setStatus(t("schemaStatus.discardedSelected", { count: records.length, files: t(records.length === 1 ? "schemaStatus.fileOne" : "schemaStatus.fileMany") }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
  }
}

function createXmlFile(fileName, xml) {
  return createEditableFile(fileName, xml, {
    className: "schema-xml-file",
    nameClassName: "schema-xml-file-name",
    format: "xml"
  });
}

function createMetadataXmlDocument(rootName, values = {}) {
  const entries = Object.entries(values)
    .filter(([, value]) => value !== null && typeof value !== "undefined" && value !== "");
  const body = entries.map(([key, value]) => valueToXml(value, key, 1)).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${toXmlTagName(rootName)} xmlns="http://soap.sforce.com/2006/04/metadata">${body ? `\n${body}` : ""}</${toXmlTagName(rootName)}>`;
}

function formatXmlStringByTags(xml = "") {
  const text = String(xml || "").trim();
  if (!text) {
    return "";
  }

  let depth = 0;
  return text
    .replace(/>\s*</g, "><")
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const isClosing = /^<\//.test(line);
      const isDeclaration = /^<\?/.test(line);
      const isComment = /^<!--/.test(line);
      const isSelfClosing = /\/>$/.test(line);
      const isOpening = /^<[^!?/][^>]*>$/.test(line) && !isSelfClosing;
      if (isClosing) {
        depth = Math.max(depth - 1, 0);
      }

      const formatted = `${"    ".repeat(depth)}${line}`;
      if (isOpening && !isDeclaration && !isComment) {
        depth += 1;
      }
      return formatted;
    })
    .join("\n");
}

function formatXmlString(xml = "") {
  const text = String(xml || "").trim();
  if (!text) {
    return "";
  }

  try {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.getElementsByTagName("parsererror").length) {
      return formatXmlStringByTags(text);
    }

    const compact = new XMLSerializer().serializeToString(document).replace(/>\s+</g, "><");
    return formatXmlStringByTags(compact);
  } catch (_error) {
    return formatXmlStringByTags(text);
  }
}

function formatDetailFileContent(fileName = "", content = "", format = "text") {
  const text = String(content || "");
  return format === "xml" || format === "xmlText" || isXmlLikeSource(fileName)
    ? formatXmlString(text)
    : text;
}

function formatMetadataApiVersion(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "";
  }

  return String(value).replace(/^v/i, "");
}

function firstValue(...values) {
  const value = values.find((item) => item !== null && typeof item !== "undefined" && item !== "");
  return typeof value === "undefined" ? "" : value;
}

function toSourceFileSegment(value, fallback = "metadata") {
  const text = String(value || fallback)
    .normalize("NFC")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^[.]+|[.]+$/g, "");
  return text || fallback;
}

function getMetadataSourceName(detail = {}, item = {}) {
  return toSourceFileSegment(firstValue(
    detail.DeveloperName,
    detail.Name,
    detail.FullName,
    detail.MasterLabel,
    item.apiName,
    item.id
  ));
}

function getMetadataSourceNamespacePrefix(detail = {}, item = {}) {
  return String(firstValue(
    detail.NamespacePrefix,
    detail.namespacePrefix,
    item.record?.NamespacePrefix,
    item.record?.namespacePrefix
  ) || "").trim();
}

function getNamespacedMetadataSourceName(detail = {}, item = {}) {
  const name = getMetadataSourceName(detail, item);
  const namespacePrefix = getMetadataSourceNamespacePrefix(detail, item);
  if (!namespacePrefix || name.startsWith(`${namespacePrefix}__`)) {
    return name;
  }

  return toSourceFileSegment(`${namespacePrefix}__${name}`);
}

function getMetadataApiVersion(detail = {}, item = {}) {
  return formatMetadataApiVersion(firstValue(detail.ApiVersion, item.record?.ApiVersion, schemaStore?.apiVersion));
}

function createSourceFile(path, content = "", options = {}) {
  return {
    path,
    content: String(content || ""),
    deployInfo: options.deployInfo || null
  };
}

function hasToolingSourceText(record = {}, fieldName = "Source") {
  return typeof record?.[fieldName] === "string";
}

function createApexLikeSourceFiles(type, detail = {}, item = {}) {
  const name = getNamespacedMetadataSourceName(detail, item);
  const apiVersion = getMetadataApiVersion(detail, item);
  const sourceMap = {
    apexClasses: {
      folder: "classes",
      extension: "cls",
      sourceField: "Body",
      rootName: "ApexClass",
      metaValues: {
        apiVersion,
        status: firstValue(detail.Status, item.record?.Status)
      }
    },
    apexPages: {
      folder: "pages",
      extension: "page",
      sourceField: "Markup",
      rootName: "ApexPage",
      metaValues: {
        apiVersion,
        label: firstValue(detail.MasterLabel, item.record?.MasterLabel, item.label),
        description: firstValue(detail.Description, item.record?.Description)
      }
    },
    apexTriggers: {
      folder: "triggers",
      extension: "trigger",
      sourceField: "Body",
      rootName: "ApexTrigger",
      metaValues: {
        apiVersion,
        status: firstValue(detail.Status, item.record?.Status)
      }
    },
    apexComponents: {
      folder: "components",
      extension: "component",
      sourceField: "Markup",
      rootName: "ApexComponent",
      metaValues: {
        apiVersion,
        label: firstValue(detail.MasterLabel, item.record?.MasterLabel, item.label),
        description: firstValue(detail.Description, item.record?.Description)
      }
    }
  };
  const config = sourceMap[type];
  if (!config) {
    return [];
  }

  const sourcePath = `${SOURCE_DEFAULT_PREFIX}${config.folder}/${name}.${config.extension}`;
  const metaPath = `${sourcePath}-meta.xml`;
  return [
    createSourceFile(sourcePath, firstValue(detail[config.sourceField], item.record?.[config.sourceField], detail.Body, detail.Markup), {
      deployInfo: detail.Id
        ? {
          kind: "toolingSource",
          sobject: config.rootName,
          id: detail.Id,
          field: config.sourceField
        }
        : null
    }),
    createSourceFile(metaPath, createMetadataXmlDocument(config.rootName, config.metaValues))
  ];
}

function createLwcSourceFiles(detail = {}, item = {}) {
  const name = getMetadataSourceName(detail, item);
  const resources = Array.isArray(detail.resources) ? detail.resources : [];
  const files = resources
    .filter((resource) => hasToolingSourceText(resource))
    .map((resource) => {
      const resourcePath = String(resource.FilePath || `lwc/${name}/${name}.${String(resource.Format || "js").toLowerCase()}`);
      const path = resourcePath.startsWith(SOURCE_DEFAULT_PREFIX)
        ? resourcePath
        : `${SOURCE_DEFAULT_PREFIX}${resourcePath.replace(/^[/]+/, "")}`;
      return createSourceFile(path, resource.Source, {
        deployInfo: resource.Id
          ? {
            kind: "toolingSource",
            sobject: "LightningComponentResource",
            id: resource.Id,
            field: "Source"
          }
          : null
      });
    });

  const hasMetaFile = files.some((file) => file.path.endsWith("-meta.xml"));
  if (!hasMetaFile) {
    files.push(createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}lwc/${name}/${name}.js-meta.xml`,
      createMetadataXmlDocument("LightningComponentBundle", {
        apiVersion: getMetadataApiVersion(detail, item),
        isExposed: firstValue(detail.IsExposed, detail.isExposed),
        masterLabel: firstValue(detail.MasterLabel, item.record?.MasterLabel, item.label),
        description: firstValue(detail.Description, item.record?.Description)
      })
    ));
  }

  return files;
}

function getAuraDefinitionSuffix(definition = {}) {
  const type = String(definition.DefType || "").toUpperCase();
  const suffixes = {
    APPLICATION: ".app",
    COMPONENT: ".cmp",
    CONTROLLER: "Controller.js",
    DESIGN: ".design",
    DOCUMENTATION: ".auradoc",
    EVENT: ".evt",
    HELPER: "Helper.js",
    INTERFACE: ".intf",
    MODEL: ".model",
    RENDERER: "Renderer.js",
    STYLE: ".css",
    SVG: ".svg",
    TOKENS: ".tokens"
  };
  return suffixes[type] || `.${type.toLowerCase() || "definition"}`;
}

function createAuraSourceFiles(detail = {}, item = {}) {
  const name = getMetadataSourceName(detail, item);
  const definitions = Array.isArray(detail.definitions) ? detail.definitions : [];
  const files = definitions
    .filter((definition) => hasToolingSourceText(definition))
    .map((definition) => createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}aura/${name}/${name}${getAuraDefinitionSuffix(definition)}`,
      definition.Source,
      {
        deployInfo: definition.Id
          ? {
            kind: "toolingSource",
            sobject: "AuraDefinition",
            id: definition.Id,
            field: "Source"
          }
          : null
      }
    ));
  const primaryDefinition = definitions.find((definition) => ["COMPONENT", "APPLICATION", "EVENT", "INTERFACE"].includes(String(definition.DefType || "").toUpperCase()))
    || definitions[0];
  const primarySuffix = primaryDefinition ? getAuraDefinitionSuffix(primaryDefinition) : ".cmp";

  files.push(createSourceFile(
    `${SOURCE_DEFAULT_PREFIX}aura/${name}/${name}${primarySuffix}-meta.xml`,
    createMetadataXmlDocument("AuraDefinitionBundle", {
      apiVersion: getMetadataApiVersion(detail, item),
      description: firstValue(detail.Description, item.record?.Description)
    })
  ));

  return files;
}

function createFlowSourceFiles(detail = {}, item = {}) {
  const name = getMetadataSourceName(detail, item);
  const flowMetadata = detail.Metadata && typeof detail.Metadata === "object"
    ? detail.Metadata
    : {
      apiVersion: getMetadataApiVersion(detail, item),
      label: firstValue(detail.MasterLabel, item.record?.MasterLabel, item.label),
      processType: firstValue(detail.ProcessType, item.record?.ProcessType),
      status: firstValue(detail.Status, item.record?.Status),
      versionNumber: firstValue(detail.VersionNumber, item.record?.VersionNumber)
    };

  return [
    createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}flows/${name}.flow-meta.xml`,
      createMetadataXmlDocument("Flow", flowMetadata)
    )
  ];
}

function createStaticResourceSourceFiles(detail = {}, item = {}) {
  const name = getMetadataSourceName(detail, item);
  const bodyUrl = firstValue(detail.Body, detail.BodyUrl);
  return [
    createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}staticresources/${name}.resource`,
      bodyUrl ? `Salesforce REST body URL: ${bodyUrl}` : ""
    ),
    createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}staticresources/${name}.resource-meta.xml`,
      createMetadataXmlDocument("StaticResource", {
        contentType: firstValue(detail.ContentType, item.record?.ContentType),
        cacheControl: firstValue(detail.CacheControl, item.record?.CacheControl)
      })
    )
  ];
}

function cacheMetadataDetailSourceFiles(selection = {}, detail = {}, item = {}, files = []) {
  if (!selection?.metadataType || !Array.isArray(files) || !files.length) {
    return;
  }

  const group = findMetadataGroup(selection.metadataType);
  const now = new Date().toISOString();
  files.forEach((file) => {
    const sourcePath = normalizeMyOrgResultPath(file.path || "");
    if (!sourcePath || isSearchLogSource(sourcePath) || sourcePath.startsWith(`${MANIFEST_FOLDER_SOURCE_PATH}/`)) {
      return;
    }
    const existingEntry = localSourceEntries.get(sourcePath);
    if (existingEntry?.sourceOrigin === MANIFEST_LOCAL_SOURCE_ORIGIN) {
      return;
    }
    const metadataApiType = firstValue(
      detail.metadataApiType,
      detail.metadataObject,
      item.record?.metadataApiType,
      inferMetadataApiTypeFromSourcePath(sourcePath, selection.metadataType)
    );
    const fullName = firstValue(
      detail.fullName,
      detail.FullName,
      item.record?.fullName,
      item.record?.FullName,
      item.apiName,
      inferMetadataFullNameFromSourcePath(sourcePath, selection.metadataType, metadataApiType)
    );
    createLocalSourceEntry(sourcePath, "file", file.content || "", {
      recordId: firstValue(detail.Id, detail.id, item.id, item.record?.Id, item.record?.id),
      metadataType: selection.metadataType,
      typeLabel: group?.itemLabel || group?.label || selection.metadataType,
      metadataApiType,
      metadataName: fullName || item.apiName || item.key || "",
      label: item.label || "",
      fullName,
      fileName: getRelativeMetadataFileName(sourcePath),
      apiVersion: firstValue(detail.ApiVersion, detail.apiVersion, item.record?.ApiVersion, item.record?.apiVersion),
      status: firstValue(detail.Status, detail.status, item.record?.Status, item.record?.status),
      namespacePrefix: firstValue(detail.NamespacePrefix, detail.namespacePrefix, item.record?.NamespacePrefix, item.record?.namespacePrefix),
      codeSize: String(file.content || "").length,
      lastModifiedDate: firstValue(detail.LastModifiedDate, detail.lastModifiedDate, item.record?.LastModifiedDate, item.record?.lastModifiedDate, selection.lastModifiedDate),
      lastModifiedByName: firstValue(getRecordLastModifiedByName(detail), getRecordLastModifiedByName(item.record || {}), selection.lastModifiedByName),
      deployInfo: file.deployInfo || null,
      contentKind: "source",
      sourceOrigin: "metadata-detail",
      autoRetrieve: false,
      createdAt: existingEntry?.createdAt || now
    });
  });
}

function getMetadataApiSourceConfig(metadataTypeOrGroup) {
  const group = typeof metadataTypeOrGroup === "string"
    ? findMetadataGroup(metadataTypeOrGroup) || getAvailableMetadataType(metadataTypeOrGroup) || { id: metadataTypeOrGroup }
    : metadataTypeOrGroup || {};
  const metadataTypeId = group.id || "";
  const staticConfig = METADATA_API_SOURCE_CONFIG[metadataTypeId];

  if (staticConfig) {
    return {
      folder: staticConfig[0],
      suffix: staticConfig[1]
    };
  }

  const metadataType = getAvailableMetadataType(metadataTypeId) || {};
  const folder = group.directoryName
    || metadataType.directoryName
    || getSourceFolderForMetadataDefinition(metadataType)
    || metadataTypeId;

  if (!folder) {
    return null;
  }

  return {
    folder,
    suffix: group.suffix || metadataType.suffix || ""
  };
}

function stripSourceFolderPrefix(fileName = "", folder = "") {
  const relativeFileName = getRelativeMetadataFileName(fileName);
  const prefix = `${folder}/`;
  return folder && relativeFileName.startsWith(prefix)
    ? relativeFileName.slice(prefix.length)
    : relativeFileName;
}

function toMetadataSourceRelativePath(metadataType, detail = {}, item = {}) {
  const config = getMetadataApiSourceConfig(metadataType);
  if (!config) {
    return "";
  }

  const { folder, suffix } = config;
  const apiFileName = firstValue(detail.fileName, item.record?.fileName);
  const metadataApiType = firstValue(detail.metadataApiType, item.record?.metadataApiType, item.metadataObject);
  const objectChildConfig = OBJECT_CHILD_SOURCE_METADATA_CONFIGS.find((childConfig) => (
    childConfig.metadataTypeIds.includes(metadataType)
    || childConfig.metadataApiType === metadataApiType
  ));
  if (!apiFileName && objectChildConfig) {
    const childFullName = firstValue(detail.fullName, item.record?.fullName, item.apiName, item.key, "");
    const childParts = splitObjectChildMetadataFullName(childFullName);
    if (childParts.objectApiName && childParts.childApiName) {
      return [
        "objects",
        toSourceFileSegment(childParts.objectApiName, "Object"),
        objectChildConfig.folder,
        `${toSourceFileSegment(childParts.childApiName, objectChildConfig.metaText)}.${objectChildConfig.suffix}`
      ].join("/");
    }
  }

  const rawRelativePath = apiFileName
    ? getRelativeMetadataFileName(apiFileName)
    : `${folder}/${String(firstValue(detail.fullName, item.record?.fullName, item.apiName, item.key, "metadata"))
      .split("/")
      .map((segment) => toSourceFileSegment(segment, "metadata"))
      .join("/")}${suffix ? `.${suffix}` : ".xml"}`;

  if (rawRelativePath.endsWith("-meta.xml")) {
    return rawRelativePath;
  }

  if (suffix && rawRelativePath.endsWith(`.${suffix}`)) {
    return `${rawRelativePath}-meta.xml`;
  }

  return `${rawRelativePath}.xml`;
}

function createMetadataApiSourceFiles(metadataType, detail = {}, item = {}) {
  if (!detail.rawXml) {
    return [];
  }

  const relativePath = toMetadataSourceRelativePath(metadataType, detail, item);
  if (!relativePath) {
    return [];
  }

  return [
    createSourceFile(
      `${SOURCE_DEFAULT_PREFIX}${relativePath}`,
      formatXmlString(detail.rawXml)
    )
  ];
}

function createMetadataSourceFiles(metadataType, detail = {}, item = {}) {
  if (["apexClasses", "apexPages", "apexTriggers", "apexComponents"].includes(metadataType)) {
    return createApexLikeSourceFiles(metadataType, detail, item);
  }

  if (metadataType === "lwcBundles") {
    return createLwcSourceFiles(detail, item);
  }

  if (metadataType === "auraBundles") {
    return createAuraSourceFiles(detail, item);
  }

  if (metadataType === "flows") {
    return createFlowSourceFiles(detail, item);
  }

  if (metadataType === "staticResources") {
    return createStaticResourceSourceFiles(detail, item);
  }

  return createMetadataApiSourceFiles(metadataType, detail, item);
}

function getMetadataExplorerDisplay(group = {}, item = {}) {
  const name = toSourceFileSegment(item.apiName || item.key || item.id, "metadata");
  const metadataApiConfig = getMetadataApiSourceConfig(group);
  if (metadataApiConfig && group.kind === "metadata") {
    const { folder, suffix } = metadataApiConfig;
    const fileName = getMetadataSourceFileNames(group, item)[0] || (suffix ? `${name}.${suffix}-meta.xml` : `${name}.xml`);
    return {
      primary: fileName.split("/").pop(),
      secondary: folder
    };
  }

  const displayMap = {
    apexClasses: [`${name}.cls`, "classes"],
    apexPages: [`${name}.page`, "pages"],
    apexTriggers: [`${name}.trigger`, "triggers"],
    apexComponents: [`${name}.component`, "components"],
    lwcBundles: [name, `lwc/${name}`],
    auraBundles: [name, `aura/${name}`],
    flows: [`${name}.flow-meta.xml`, "flows"],
    staticResources: [`${name}.resource`, "staticresources"]
  };
  const display = displayMap[group.id];

  if (display) {
    return {
      primary: display[0],
      secondary: display[1]
    };
  }

  return {
    primary: item.apiName || item.key,
    secondary: item.label || ""
  };
}

function isXmlLikeSource(path = "") {
  return /\.(xml|page|component|cmp|app|evt|intf|design|auradoc|tokens)$/i.test(path);
}

function isSearchLogSource(path = "") {
  const sourcePath = String(path || "");
  return /^myorg\/logs\/search\/.+\.md$/i.test(sourcePath);
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

function getSalesforceRecordUrl(recordId = "") {
  const id = String(recordId || "").trim();
  if (!session?.host || !id) {
    return "";
  }
  return `https://${session.host}/${encodeURIComponent(id)}`;
}

function getSelectedSalesforceUrl(selection = selectedNode || {}) {
  if (!selection) {
    return "";
  }

  if (selection.type === "localFile") {
    const entry = localSourceEntries.get(selection.sourcePath || "");
    return entry?.salesforceUrl || getSalesforceRecordUrl(entry?.recordId);
  }

  if (selection.type === "metadataItem") {
    const item = findMetadataItem(selection.metadataType, selection.itemKey);
    return getSalesforceRecordUrl(item?.id || item?.record?.Id);
  }

  if (selection.type === "object") {
    const objectApiName = getObjectApiName(selection.objectKey);
    return session?.host && objectApiName
      ? `https://${session.host}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/Details/view`
      : "";
  }

  if (selection.type === "field") {
    const objectApiName = getObjectApiName(selection.objectKey);
    const fieldApiName = splitSchemaKey(selection.fieldKey).apiName;
    return session?.host && objectApiName && fieldApiName
      ? `https://${session.host}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/FieldsAndRelationships/${encodeURIComponent(fieldApiName)}/view`
      : "";
  }

  return "";
}

function getRawDetailSourceText(files = []) {
  const sourceFiles = files.filter((file) => file && typeof file.content !== "undefined");
  if (!sourceFiles.length) {
    return "";
  }
  if (sourceFiles.length === 1) {
    return String(sourceFiles[0].content || "");
  }
  return sourceFiles.map((file) => [
    `===== ${file.path || "source"} =====`,
    String(file.content || "")
  ].join("\n")).join("\n\n");
}

function getCurrentRawDetailSourceText(fallbackFiles = []) {
  const editableFiles = getEditableDetailFiles();
  if (!editableFiles.length) {
    return getRawDetailSourceText(fallbackFiles);
  }
  if (editableFiles.length === 1) {
    const editor = editableFiles[0].querySelector(".schema-editable-code-editor");
    return String(editor?.value ?? editableFiles[0].currentContent ?? "");
  }
  return editableFiles.map((file) => {
    const editor = file.querySelector(".schema-editable-code-editor");
    return [
      `===== ${file.dataset.fileName || "source"} =====`,
      String(editor?.value ?? file.currentContent ?? "")
    ].join("\n");
  }).join("\n\n");
}

function getSingleRawDetailSourceFile(files = []) {
  const sourceFiles = files.filter((file) => (
    file
    && typeof file.content !== "undefined"
    && !isSearchLogSource(file.path || "")
  ));
  return sourceFiles.length === 1 ? sourceFiles[0] : null;
}

function parseJsonDetailSource(text = "") {
  const source = String(text || "").trim();
  if (!source) {
    return {
      ok: false,
      error: "JSON source is empty."
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(source)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function canRenderDetailJsonPreview(files = []) {
  const sourceFile = getSingleRawDetailSourceFile(files);
  if (!sourceFile) {
    return false;
  }
  return parseJsonDetailSource(sourceFile.content || "").ok;
}

function getCurrentSingleDetailSource(files = []) {
  const editableFiles = getEditableDetailFiles();
  if (editableFiles.length === 1) {
    const editableFile = editableFiles[0];
    const editor = editableFile.querySelector(".schema-editable-code-editor");
    return {
      fileName: editableFile.dataset.fileName || "source",
      content: String(editor?.value ?? editableFile.currentContent ?? "")
    };
  }

  const sourceFile = getSingleRawDetailSourceFile(files);
  if (!sourceFile) {
    return null;
  }

  return {
    fileName: sourceFile.path || "source",
    content: String(sourceFile.content || "")
  };
}

async function copyTextToClipboard(text = "") {
  const value = String(text || "");
  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function refreshSelectedDetailFile() {
  const selection = selectedNode ? { ...selectedNode } : null;
  if (!selection) {
    return;
  }

  const statusTarget = selection.sourcePath || selection.itemKey || "file";

  if (selection.type === "metadataItem") {
    const cacheKey = getMetadataDetailCacheKey(selection);
    if (cacheKey) {
      metadataDetailCache.delete(cacheKey);
      toolingSourceDetailCache.delete(cacheKey);
    }
    setStatus(t("schemaStatus.refreshingTarget", { target: statusTarget }));
    await renderDetailPanel();
    setStatus(t("schemaStatus.refreshedTarget", { target: statusTarget }));
    return;
  }

  if (selection.type === "localFile") {
    const sourcePath = normalizeMyOrgResultPath(selection.sourcePath || "");
    if (!sourcePath) {
      setStatus(t("schemaStatus.cannotRefreshEmptyPath"), true);
      return;
    }

    const entry = localSourceEntries.get(sourcePath) || {};
    const refreshSelection = { ...selection, sourcePath };
    setSelectedNode(refreshSelection);
    setStatus(t("schemaStatus.refreshingTarget", { target: statusTarget }));

    if (entry?.kind === "file" && entry.contentKind === "search-summary" && entry.searchTerm && canLoadLocalSearchEntrySource(entry)) {
      const cacheKey = getLocalSearchMetadataCacheKey(entry);
      if (cacheKey) {
        metadataDetailCache.delete(cacheKey);
        toolingSourceDetailCache.delete(cacheKey);
      }
      const refreshed = await renderLocalSearchResultSourceDetail(entry, detailRequestId, refreshSelection);
      if (!refreshed) {
        return;
      }
      setStatus(t("schemaStatus.refreshedTarget", { target: statusTarget }));
      return;
    }

    await renderLocalSourceFileDetail(detailRequestId);
    setStatus(t("schemaStatus.refreshedTarget", { target: statusTarget }));
    return;
  }

  await renderDetailPanel();
  setStatus(t("schemaStatus.refreshedTarget", { target: statusTarget }));
}

function renderJsonDetailPreviewSource(source = null, options = {}) {
  const parsed = source ? parseJsonDetailSource(source.content) : {
    ok: false,
    error: "Select a single JSON file."
  };

  if (!source || !parsed.ok) {
    setStatus(t("schemaStatus.jsonPreviewFailed", { error: parsed.error }), true);
    return;
  }

  const fileName = source.fileName || "source.json";
  const displayName = getSourceBaseName(fileName) || "JSON";
  const formattedJson = JSON.stringify(parsed.value, null, 2);
  const header = createDetailTitle(displayName, fileName, "JSON", "file");
  const actions = header.querySelector(".schema-detail-actions");

  const copyButton = createDetailButton("Copy", "secondary schema-detail-json-copy-button");
  copyButton.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(formattedJson);
      setStatus(t("schemaStatus.copiedJson"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const backButton = createDetailButton("Back to File", "secondary schema-detail-json-back-button");
  backButton.addEventListener("click", () => {
    if (typeof options.onBack === "function") {
      options.onBack();
      return;
    }
    void renderDetailPanel();
  });

  actions?.append(copyButton, backButton);

  const section = document.createElement("section");
  section.className = "schema-json-file schema-json-preview-file";
  section.dataset.fileName = fileName;

  const name = document.createElement("div");
  name.className = "schema-json-file-name";
  name.textContent = fileName;

  const tree = document.createElement("div");
  tree.className = "schema-json-tree";
  tree.appendChild(createJsonNode(displayName, parsed.value, 0, true));

  section.append(name, tree);
  schemaDetailEl.innerHTML = "";
  schemaDetailEl.append(header, section);
}

function renderJsonDetailPreview(files = []) {
  renderJsonDetailPreviewSource(getCurrentSingleDetailSource(files));
}

function ensureDetailFileActions(header, files = []) {
  const actions = header?.querySelector?.(".schema-detail-actions");
  if (!actions || actions.querySelector(".schema-detail-refresh-button")) {
    return;
  }

  const rawSource = getRawDetailSourceText(files);
  const copyButton = createIconButton("copy", "Copy raw source", "secondary schema-detail-copy-raw-button");
  copyButton.disabled = !rawSource;
  copyButton.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(getCurrentRawDetailSourceText(files));
      setStatus(t("schemaStatus.copiedRawSource"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const refreshButton = createIconButton("refresh", "Refresh file", "secondary schema-detail-refresh-button");
  refreshButton.addEventListener("click", () => void refreshSelectedDetailFile());

  const salesforceUrl = getSelectedSalesforceUrl();
  const salesforceButton = createIconButton("external", "Open in Salesforce", "secondary schema-detail-sf-link-button");
  salesforceButton.disabled = !salesforceUrl;
  salesforceButton.addEventListener("click", () => openExternalUrl(salesforceUrl));

  const buttons = [copyButton, refreshButton, salesforceButton];
  if (canRenderDetailJsonPreview(files)) {
    const jsonButton = createIconButton("json", "View JSON", "secondary schema-detail-json-button");
    jsonButton.addEventListener("click", () => renderJsonDetailPreview(files));
    buttons.unshift(jsonButton);
  }

  actions.prepend(...buttons);
}

function appendSourceFileJsonAction(fileElement, sourceFile = {}) {
  const name = fileElement?.querySelector?.(".schema-source-file-name");
  if (!name) {
    return;
  }

  const editor = fileElement.querySelector(".schema-editable-code-editor");
  const getSource = () => ({
    fileName: fileElement.dataset.fileName || sourceFile.path || "source.json",
    content: String(editor?.value ?? fileElement.currentContent ?? sourceFile.content ?? "")
  });
  const initialSource = getSource();
  if (!parseJsonDetailSource(initialSource.content).ok) {
    return;
  }

  const jsonButton = createIconButton("json", "View JSON", "secondary schema-source-file-json-button");
  jsonButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderJsonDetailPreviewSource(getSource(), {
      onBack: () => {
        void renderDetailPanel();
      }
    });
  });
  name.appendChild(jsonButton);
}

function findSourceSelectionByPath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return null;
  }

  const localEntry = localSourceEntries.get(path);
  const root = createSourceExplorerTree(createAllSourceVisibleGroups(getMetadataGroups()));
  const node = findSourceTreeNodeByPath(root, path);
  if (node?.selection) {
    return { ...node.selection, sourcePath: path };
  }
  if (localEntry) {
    return localEntry.kind === "folder"
      ? {
        type: "sourceFolder",
        sourcePath: path
      }
      : {
        type: "localFile",
        sourcePath: path
      };
  }
  return null;
}

function getSourceClickSelection(baseSelection = null, sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath || baseSelection?.sourcePath || "");
  const localEntry = path ? localSourceEntries.get(path) : null;
  if (baseSelection) {
    return {
      ...baseSelection,
      ...(path ? { sourcePath: path } : {})
    };
  }
  if (path) {
    const root = createSourceExplorerTree(createPackageVisibleGroups());
    const node = findSourceTreeNodeByPath(root, path);
    if (node?.selection) {
      return { ...node.selection, sourcePath: path };
    }
  }
  if (localEntry) {
    return localEntry.kind === "folder"
      ? {
        type: "sourceFolder",
        sourcePath: path
      }
      : {
        type: "localFile",
        sourcePath: path
      };
  }
  return findSourceSelectionByPath(path);
}

function getSourceFileClickSelection(baseSelection = null, sourcePath = "") {
  const selection = getSourceClickSelection(baseSelection, sourcePath);
  if (selection) {
    return selection;
  }

  const normalizedSourcePath = normalizeMyOrgResultPath(sourcePath || "");
  if (!normalizedSourcePath) {
    return null;
  }

  if (localSourceEntries.has(normalizedSourcePath)) {
    return {
      type: "localFile",
      sourcePath: normalizedSourcePath
    };
  }

  return {
    type: "localFile",
    sourcePath: normalizedSourcePath
  };
}

function isSourcePathVisibleInVirtualTree(target, sourcePath = "") {
  const normalizedSourcePath = normalizeMyOrgResultPath(sourcePath || "");
  if (!target || !normalizedSourcePath) {
    return false;
  }
  const state = sourceTreeVirtualRendererStates.get(target);
  return (state?.rows || []).some((row) => (
    normalizeMyOrgResultPath(row.node?.path || row.selection?.sourcePath || row.match?.sourcePath || "") === normalizedSourcePath
  ));
}

function setSelectedSourceNodeFromPath(baseSelection = null, sourcePath = "", options = {}) {
  const selection = getSourceFileClickSelection(baseSelection, sourcePath);
  if (!selection) {
    setStatus(t("schemaStatus.fileNotFound", { sourcePath: sourcePath }), true);
    return false;
  }

  const normalizedSourcePath = normalizeMyOrgResultPath(selection.sourcePath || sourcePath || "");
  const target = options.target || null;
  const sourcePathIsVisible = target
    ? isSourcePathVisibleInVirtualTree(target, normalizedSourcePath)
    : hasSourcePath(getExplorerSourceTree(), normalizedSourcePath);
  if (normalizedSourcePath && !sourcePathIsVisible) {
    openSourcePathAncestors(normalizedSourcePath);
    if (options.clearFilterIfHidden !== false) {
      clearExplorerFileFilterIfPathIsHidden(normalizedSourcePath);
    }
  }

  setSelectedNode({
    ...selection,
    ...(normalizedSourcePath ? { sourcePath: normalizedSourcePath } : {})
  });
  if (normalizedSourcePath && (options.revealInExplorer === true || target === schemaSearchResultsTreeEl)) {
    revealSourcePathInExplorer(normalizedSourcePath, {
      switchTab: true,
      renderDetail: false,
      clearFilterIfHidden: options.clearFilterIfHidden
    });
  }
  return true;
}

function openSourcePathInDetail(sourcePath = "", lineNumber = 0) {
  const selection = findSourceSelectionByPath(sourcePath);
  if (!selection) {
    setStatus(t("schemaStatus.fileNotFound", { sourcePath: sourcePath }), true);
    return;
  }

  pendingDetailLineFocus = Number(lineNumber || 0)
    ? {
      sourcePath: normalizeMyOrgResultPath(sourcePath),
      lineNumber: Number(lineNumber || 0)
    }
    : null;
  setSelectedNode(selection);
  revealSourcePathInExplorer(selection.sourcePath || sourcePath, {
    switchTab: true,
    renderDetail: false
  });
}

function getSearchLogHighlightTerm(markdown = "") {
  const searchLine = String(markdown || "").match(/^Search:\s*(.+)$/mi);
  if (searchLine?.[1]) {
    return searchLine[1].trim();
  }

  const titleTerm = String(markdown || "").match(/^#\s+Search Results.*\[([^\]\r\n]+)\]/mi);
  return titleTerm?.[1]?.trim() || "";
}

function createSearchLogBlock(tagName, text = "") {
  const element = document.createElement(tagName);
  appendSearchHighlightedText(element, text, "schema-search-log-match");
  return element;
}

function appendSearchLogListItem(list, text = "", sourcePath = "") {
  const item = document.createElement("li");
  const lineMatch = String(text || "").match(/^\[(\d+)\]\s*(.*)$/);
  if (sourcePath) {
    const lineNumber = Number(lineMatch?.[1] || 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "schema-search-log-result-link";
    button.textContent = `[${lineNumber || 0}]`;
    button.title = lineNumber ? `Open ${sourcePath}:${lineNumber}` : `Open ${sourcePath}`;
    button.addEventListener("click", () => openSourcePathInDetail(sourcePath, lineNumber));
    const snippet = document.createElement("span");
    snippet.className = "schema-search-log-result-text";
    appendSearchHighlightedText(snippet, ` ${lineMatch ? lineMatch[2] || "" : text}`, "schema-search-log-match");
    item.append(button, snippet);
  } else {
    appendSearchHighlightedText(item, text, "schema-search-log-match");
  }
  list.appendChild(item);
}

function appendSearchLogMatchRow(target, text = "", sourcePath = "") {
  const row = document.createElement("div");
  row.className = "schema-search-log-result-row";
  const lineMatch = String(text || "").match(/^\[(\d+)\]\s*(.*)$/);
  if (sourcePath && lineMatch) {
    const lineNumber = Number(lineMatch[1] || 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "schema-search-log-result-link";
    button.textContent = `[${lineNumber || 0}]`;
    button.title = lineNumber ? `Open ${sourcePath}:${lineNumber}` : `Open ${sourcePath}`;
    button.addEventListener("click", () => openSourcePathInDetail(sourcePath, lineNumber));
    const snippet = document.createElement("span");
    snippet.className = "schema-search-log-result-text";
    appendSearchHighlightedText(snippet, ` ${lineMatch[2] || ""}`, "schema-search-log-match");
    row.append(button, snippet);
  } else {
    appendSearchHighlightedText(row, text, "schema-search-log-match");
  }
  target.appendChild(row);
}

function renderSearchLogMarkdown(target, markdown = "") {
  const highlightTerm = searchHighlightTermOverride || getSearchLogHighlightTerm(markdown);
  if (highlightTerm && !searchHighlightTermOverride) {
    withSearchHighlightTerm(highlightTerm, () => renderSearchLogMarkdown(target, markdown));
    return;
  }

  let currentList = null;
  let currentPath = "";
  let pendingSourceMarkerPath = "";

  const closeList = () => {
    currentList = null;
  };

  String(markdown || "").split(/\r?\n/).forEach((line) => {
    const text = line.trimEnd();
    if (!text.trim()) {
      closeList();
      return;
    }

    const sourceMarkerMatch = text.match(/^<!--\s*source-path:\s*(.*?)\s*-->$/i);
    if (sourceMarkerMatch) {
      closeList();
      currentPath = normalizeMyOrgResultPath(sourceMarkerMatch[1] || "");
      pendingSourceMarkerPath = currentPath;
      return;
    }

    const headingMatch = text.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = Math.min(headingMatch[1].length, 3);
      const headingText = headingMatch[2];
      if (level === 2) {
        const headingPath = normalizeMyOrgResultPath(headingText);
        currentPath = pendingSourceMarkerPath || (headingPath.includes("/") ? headingPath : "");
        pendingSourceMarkerPath = "";
      }
      const heading = createSearchLogBlock(`h${level}`, headingText);
      if (level === 2 && currentPath) {
        const headingPath = currentPath;
        heading.className = "schema-search-log-file-heading";
        heading.tabIndex = 0;
        heading.setAttribute("role", "button");
        heading.title = `Open ${headingPath}`;
        heading.addEventListener("click", () => openSourcePathInDetail(headingPath, 0));
        heading.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          openSourcePathInDetail(headingPath, 0);
        });
      }
      target.appendChild(heading);
      return;
    }

    const listMatch = text.match(/^-\s+(.+)$/);
    if (listMatch) {
      if (!currentList) {
        currentList = document.createElement("ul");
        target.appendChild(currentList);
      }
      appendSearchLogListItem(currentList, listMatch[1], currentPath);
      return;
    }

    if (/^\[\d+\]\s*/.test(text)) {
      closeList();
      appendSearchLogMatchRow(target, text, currentPath);
      return;
    }

    closeList();
    if (text.startsWith(">")) {
      target.appendChild(createSearchLogBlock("blockquote", text.replace(/^>\s*/, "")));
      return;
    }
    target.appendChild(createSearchLogBlock("p", text));
  });
}

function createSearchLogFileElement(file = {}) {
  const section = document.createElement("section");
  section.className = "schema-source-file schema-search-log-file";
  section.dataset.fileName = file.path || "";

  const name = document.createElement("div");
  name.className = "schema-source-file-name";
  const nameText = document.createElement("span");
  nameText.textContent = file.path || "Search log";
  name.appendChild(nameText);

  const view = document.createElement("article");
  view.className = "schema-manual-doc schema-search-log-md";
  renderSearchLogMarkdown(view, file.content || "");

  section.append(name, view);
  return section;
}

function createSourceFileElement(file = {}) {
  const isSearchLog = isSearchLogSource(file.path);
  if (isSearchLog) {
    return createSearchLogFileElement(file);
  }
  const isJsonSource = /\.json$/i.test(String(file.path || ""));
  const fileElement = createEditableFile(file.path, file.content, {
    className: `schema-source-file${isSearchLog ? " schema-search-log-file" : ""}`,
    nameClassName: "schema-source-file-name",
    format: isJsonSource ? "json" : isXmlLikeSource(file.path) ? "xmlText" : "text",
    deployInfo: file.deployInfo || null,
    wrapLines: isSearchLog,
    readOnly: file.readOnly === true
  });
  appendSourceFileJsonAction(fileElement, file);
  return fileElement;
}

function renderSourceFilesDetail(header, files = []) {
  schemaDetailEl.innerHTML = "";
  if (files.some((file) => !isSearchLogSource(file.path))) {
    ensureDetailEditActions(header);
  }
  ensureDetailFileActions(header, files);
  const sourceFiles = document.createElement("div");
  sourceFiles.className = "schema-source-files";
  files.forEach((file) => {
    sourceFiles.appendChild(createSourceFileElement(file));
  });
  schemaDetailEl.append(header, sourceFiles);
  applyPendingDetailLineFocus();
}

function getSelectedSourceFiles(sourceFiles = [], selection = {}) {
  if (!selection?.sourcePath) {
    return sourceFiles;
  }

  const selectedFile = sourceFiles.find((file) => file.path === selection.sourcePath);
  return selectedFile ? [selectedFile] : sourceFiles;
}

function createMetadataSourceDetailTitle(item = {}, group = {}, selection = {}, sourceFiles = []) {
  if (selection?.sourcePath && sourceFiles.length === 1) {
    const file = sourceFiles[0];
    const fileName = getSourceBaseName(file.path || selection.sourcePath);
    return createDetailTitle(fileName, file.path || selection.sourcePath, group.itemLabel || "Metadata", "file");
  }

  return createDetailTitle(item.apiName || item.key, item.label || "", group.itemLabel || "Metadata", "file");
}

function getLocalSearchMetadataGroup(entry = {}) {
  const group = findMetadataGroup(entry.metadataType);
  if (group) {
    return group;
  }

  const metadataType = getAvailableMetadataType(entry.metadataType) || {};
  return {
    id: entry.metadataType || metadataType.id || "",
    label: entry.typeLabel || metadataType.label || entry.metadataType || "Metadata",
    itemLabel: metadataType.itemLabel || entry.typeLabel || "Metadata",
    kind: metadataType.kind || "",
    directoryName: metadataType.directoryName || "",
    suffix: metadataType.suffix || "",
    sourceFolder: metadataType.sourceFolder || metadataType.directoryName || ""
  };
}

function createLocalSearchMetadataItem(entry = {}) {
  const metadataApiType = entry.metadataApiType || inferMetadataApiTypeFromSourcePath(entry.path || "", entry.metadataType || "");
  const fullName = entry.fullName
    || inferMetadataFullNameFromSourcePath(entry.path || "", entry.metadataType || "", metadataApiType)
    || entry.metadataName
    || entry.name
    || "";
  const apiName = entry.metadataName || fullName || entry.name || getSourceBaseName(entry.path || "");
  const record = {
    Id: entry.recordId || "",
    id: entry.recordId || "",
    Name: apiName,
    DeveloperName: apiName,
    MasterLabel: entry.label || apiName,
    fullName,
    metadataApiType,
    fileName: entry.fileName || getRelativeMetadataFileName(entry.path || ""),
    ApiVersion: entry.apiVersion || "",
    Status: entry.status || "",
    NamespacePrefix: entry.namespacePrefix || "",
    LastModifiedDate: entry.lastModifiedDate || ""
  };

  return {
    id: entry.recordId || fullName || apiName,
    key: entry.recordId || fullName || apiName || entry.path || "",
    apiName,
    label: entry.label || entry.typeLabel || "",
    record
  };
}

function getLocalSearchMetadataCacheKey(entry = {}) {
  if (!entry?.metadataType) {
    return "";
  }

  const item = createLocalSearchMetadataItem(entry);
  return [
    "localSearch",
    entry.metadataType,
    item.id,
    item.record.metadataApiType,
    entry.path
  ].filter(Boolean).join(":");
}

function canLoadLocalSearchEntrySource(entry = {}) {
  return entry?.kind === "file"
    && (entry.contentKind === "search-summary" || hasInternalMyOrgResultSourceContent(entry))
    && Boolean(entry.searchTerm || activeSearchTerm)
    && Boolean(entry.metadataType)
    && Boolean(session?.host && session?.sid)
    && !isSearchLogSource(entry.path);
}

function getCustomFieldSearchSelection(entry = {}) {
  const identity = getMyOrgSearchEntryIdentity(entry);
  if (identity.metadataApiType !== "CustomField") {
    return null;
  }

  const fullName = normalizeMyOrgObjectChildFullName("CustomField", identity.fullName);
  const splitIndex = fullName.lastIndexOf(".");
  if (splitIndex <= 0 || splitIndex === fullName.length - 1) {
    return null;
  }

  const objectApiName = fullName.slice(0, splitIndex);
  const fieldApiName = fullName.slice(splitIndex + 1);
  const sourcePath = normalizeMyOrgResultPath(entry.path)
    || normalizeSearchResultSourcePath(entry)
    || `${SOURCE_DEFAULT_PREFIX}objects/${toSourceFileSegment(objectApiName, "Object")}/fields/${toSourceFileSegment(fieldApiName, "Field")}.field-meta.xml`;
  return {
    type: "field",
    metadataType: "objects",
    objectKey: objectApiName,
    fieldKey: fieldApiName,
    sourcePath
  };
}

function findDescribeFieldByApiName(describe = {}, fieldApiName = "") {
  const needle = String(fieldApiName || "").toLocaleLowerCase();
  if (!needle || !Array.isArray(describe?.fields)) {
    return null;
  }

  return describe.fields.find((field) => (
    String(field?.name || field?.Name || "").toLocaleLowerCase() === needle
  )) || null;
}

function updateLocalSearchEntryGeneratedSource(entry = {}, sourceFile = {}, metadataApiType = "Metadata") {
  const path = normalizeMyOrgResultPath(sourceFile.path || entry.path || "");
  const updatedEntry = {
    ...entry,
    kind: "file",
    path,
    name: getSourceBaseName(path),
    parentPath: getParentSourcePath(path),
    content: sourceFile.content || "",
    deployInfo: null,
    readOnly: true,
    typeLabel: entry.typeLabel || metadataApiType,
    metadataApiType: entry.metadataApiType || metadataApiType,
    contentKind: "generated-source"
  };
  localSourceEntries.set(path, updatedEntry);
  if (entry.path && entry.path !== path) {
    localSourceEntries.delete(entry.path);
    searchDetailEntryCache.delete(entry.path);
  }
  if (selectedNode?.type === "localFile" && selectedNode.sourcePath === entry.path && entry.path !== path) {
    selectedNode = {
      ...selectedNode,
      sourcePath: path
    };
  }
  if (myOrgSearchLocalPaths.has(entry.path || path)) {
    myOrgSearchLocalPaths.delete(entry.path || path);
    myOrgSearchLocalPaths.add(path);
  }
  return updatedEntry;
}

async function loadCustomFieldSearchFallbackSource(entry = {}) {
  const selection = getCustomFieldSearchSelection(entry);
  if (!selection) {
    return null;
  }

  const fieldParts = splitSchemaKey(selection.fieldKey);
  let sourceLabel = "search result identity";
  let field = {
    name: fieldParts.apiName,
    label: entry.label || fieldParts.label
  };
  try {
    const describe = await loadObjectDescribe(selection.objectKey);
    field = findDescribeFieldByApiName(describe, fieldParts.apiName) || field;
    sourceLabel = "object describe";
  } catch (_error) {
    // A minimal field XML is still more useful than replacing the detail pane with the source-loading error.
  }
  return {
    selection,
    sourceLabel,
    sourceFile: {
      ...createFallbackFieldSourceFile(selection, field),
      readOnly: true
    }
  };
}

async function renderLocalSearchResultSourceDetail(entry = {}, requestId = detailRequestId, selection = selectedNode || {}) {
  const group = getLocalSearchMetadataGroup(entry);
  const loadingTitle = createDetailTitle(entry.name || getSourceBaseName(entry.path || ""), entry.path || "", group.itemLabel || "Search result", "file");
  schemaDetailEl.innerHTML = "";
  schemaDetailEl.append(loadingTitle, createLoadingDetail("Loading file source..."));

  try {
    const { item, content } = await loadLocalSearchEntrySource(entry);
    if (requestId !== detailRequestId || !isSelected(selection)) {
      return true;
    }

    const updatedEntry = updateLocalSearchEntrySource(entry, item, content);
    const render = () => renderSourceFilesDetail(
      createDetailTitle(updatedEntry.name || getSourceBaseName(updatedEntry.path || ""), updatedEntry.path || "", updatedEntry.typeLabel || group.itemLabel || "Search result", "file"),
      [{
        path: updatedEntry.path,
        content: updatedEntry.content || "",
        deployInfo: updatedEntry.deployInfo || null
      }]
    );
    if (updatedEntry.searchTerm) {
      withSearchHighlightTerm(updatedEntry.searchTerm, render);
    } else {
      render();
    }
    return true;
  } catch (error) {
    try {
      const fallback = await loadCustomFieldSearchFallbackSource(entry);
      if (fallback && requestId === detailRequestId && isSelected(selection)) {
        const updatedEntry = updateLocalSearchEntryGeneratedSource(entry, fallback.sourceFile, "CustomField");
        renderSourceFilesDetail(
          createDetailTitle(updatedEntry.name || getSourceBaseName(updatedEntry.path || ""), updatedEntry.path || "", "CustomField", "file"),
          [{
            path: updatedEntry.path,
            content: updatedEntry.content || "",
            deployInfo: null,
            readOnly: true
          }]
        );
        setStatus(t("schemaStatus.loadedPathFromSalesforce", { path: updatedEntry.path }));
        return true;
      }
    } catch (_fallbackError) {
      // Keep the original source-loading error; the fallback is best-effort for fields that lack Metadata API XML.
    }

    if (requestId === detailRequestId && isSelected(selection)) {
      const message = error instanceof Error ? error.message : String(error);
      renderEmptyDetail(`Could not load source for ${entry.path || entry.name || "search result"}. ${message}`);
      setStatus(message, true);
    }
    return true;
  }
}

function getLazySourceFileMetadataTypes(sourcePath = "") {
  const folderName = getMetadataFolderNameFromPath(sourcePath);
  if (!folderName) {
    return [];
  }
  const inferredMetadataApiType = inferMetadataApiTypeFromSourcePath(sourcePath, folderName === OBJECT_SOURCE_FOLDER_NAME ? "objects" : "");
  const objectChildConfig = OBJECT_CHILD_SOURCE_METADATA_CONFIGS.find((config) => (
    config.metadataApiType === inferredMetadataApiType
  ));
  const metadataTypes = objectChildConfig?.metadataTypeIds?.length
    ? objectChildConfig.metadataTypeIds
    : getMetadataTypesForSourceFolder(folderName);
  return metadataTypes
    .filter((metadataTypeId) => isRetrievableFolderMetadataType(metadataTypeId));
}

function getNamespacePrefixFromSourcePath(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  const mainPrefix = `${SOURCE_PROJECT_ROOT}/main/`;
  if (!normalizedPath.startsWith(mainPrefix)) {
    return "";
  }
  const namespaceSegment = normalizedPath.slice(mainPrefix.length).split("/").filter(Boolean)[0] || "";
  return namespaceSegment && namespaceSegment !== "default" ? namespaceSegment : "";
}

function getLazySourceFileNamespaceOptions(sourcePath = "") {
  const namespacePrefix = getNamespacePrefixFromSourcePath(sourcePath);
  if (!namespacePrefix) {
    return getSelectedRetrieveNamespaceOptions();
  }
  return {
    includeInstalledPackages: false,
    installedPackageNamespaces: [namespacePrefix]
  };
}

function findLazySourceFileSelection(sourcePath = "") {
  const selection = findSourceSelectionByPath(sourcePath);
  if (!selection || selection.type === "localFile") {
    return findSourceSelectionFromMetadataPath(sourcePath);
  }
  return selection;
}

function getMetadataTypeIdForMetadataApiType(metadataApiType = "") {
  const objectChildConfig = OBJECT_CHILD_SOURCE_METADATA_CONFIGS.find((config) => (
    config.metadataApiType === metadataApiType
  ));
  return objectChildConfig?.metadataTypeIds?.[0] || "";
}

function findMetadataItemByFullName(metadataType = "", fullName = "") {
  const needle = String(fullName || "").toLocaleLowerCase();
  if (!metadataType || !needle) {
    return null;
  }
  const group = findMetadataGroup(metadataType);
  return getGroupItems(group).find((item) => (
    String(getObjectChildItemFullName(item) || item.apiName || item.key || "").toLocaleLowerCase() === needle
    || String(splitSchemaKey(item.key).apiName || "").toLocaleLowerCase() === needle
  )) || null;
}

function findObjectFieldSelectionFromSourcePath(sourcePath = "", fullName = "") {
  const childParts = splitObjectChildMetadataFullName(fullName);
  if (!childParts.objectApiName || !childParts.childApiName) {
    return null;
  }
  const objectGroup = findMetadataGroup("objects");
  const objectItems = objectGroup?.items && typeof objectGroup.items === "object" ? objectGroup.items : {};
  const objectEntry = Object.entries(objectItems).find(([objectKey]) => (
    getObjectApiName(objectKey) === childParts.objectApiName
  ));
  if (!objectEntry) {
    return null;
  }
  const [objectKey, fieldKeys] = objectEntry;
  const fieldKey = getFieldKeys(fieldKeys).find((candidate) => (
    splitSchemaKey(candidate).apiName === childParts.childApiName
  )) || childParts.childApiName;
  return {
    type: "field",
    metadataType: "objects",
    objectKey,
    fieldKey,
    sourcePath: normalizeMyOrgResultPath(sourcePath)
  };
}

function findSourceSelectionFromMetadataPath(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  const inferred = inferObjectMetadataFromSourcePath(normalizedPath);
  if (!inferred.metadataApiType || !inferred.fullName) {
    return null;
  }

  const metadataType = getMetadataTypeIdForMetadataApiType(inferred.metadataApiType);
  const item = findMetadataItemByFullName(metadataType, inferred.fullName);
  if (item) {
    const childParts = splitObjectChildMetadataFullName(inferred.fullName);
    return {
      type: "metadataItem",
      metadataType,
      objectKey: childParts.objectApiName || "",
      fieldKey: inferred.metadataApiType === "CustomField" ? childParts.childApiName : "",
      itemKey: item.key,
      sourcePath: normalizedPath
    };
  }

  if (inferred.metadataApiType === "CustomField") {
    return findObjectFieldSelectionFromSourcePath(normalizedPath, inferred.fullName);
  }

  return null;
}

async function resolveLazySourceFileSelection(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  const existingSelection = findLazySourceFileSelection(normalizedPath);
  if (existingSelection) {
    return existingSelection;
  }

  const metadataTypes = getLazySourceFileMetadataTypes(normalizedPath);
  if (!metadataTypes.length) {
    return null;
  }

  const namespaceOptions = getLazySourceFileNamespaceOptions(normalizedPath);
  const unloadedMetadataTypes = getFolderMetadataTypesForNamespaceScope(normalizedPath, metadataTypes, namespaceOptions);
  if (unloadedMetadataTypes.length) {
    const folderName = getMetadataFolderNameFromPath(normalizedPath);
    const packageLabel = getInstalledPackageRetrieveLabel(
      namespaceOptions.installedPackageNamespaces,
      namespaceOptions.includeInstalledPackages
    );
    const loaded = await retrieveMetadataTypes(unloadedMetadataTypes, t("schemaStatus.folderLabelSuffix", { folderName }), {
      namesOnly: true,
      persist: false,
      render: false,
      loadSearchSupport: false,
      clearSearchDetails: false,
      includeInstalledPackages: namespaceOptions.includeInstalledPackages,
      installedPackageNamespaces: namespaceOptions.installedPackageNamespaces,
      statusPrefix: t("schemaStatus.prefixFileListLoad"),
      summaryPrefix: t("schemaStatus.prefixFileListLoading"),
      completionMessage: t("schemaStatus.loadedNames", { name: folderName || t("schemaStatus.labelFile"), packageLabel })
    });
    if (!loaded) {
      return null;
    }
    folderNamespaceScopeByPath.set(normalizedPath, getNamespaceScopeKey(namespaceOptions));
  }

  return findLazySourceFileSelection(normalizedPath);
}

async function renderLazySourceFileDetail(sourcePath = "", requestId = detailRequestId) {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  if (!normalizedPath || !session?.host || !session?.sid) {
    return false;
  }

  const metadataTypes = getLazySourceFileMetadataTypes(normalizedPath);
  if (!metadataTypes.length) {
    return false;
  }

  logRuntimeTraceMethodRun("renderLazySourceFileDetail", {
    phase: "start",
    requestId,
    sourcePath: normalizedPath,
    metadataTypes
  });
  schemaDetailEl.innerHTML = "";
  schemaDetailEl.append(
    createDetailTitle(getSourceBaseName(normalizedPath) || "file", normalizedPath, "Source file", "file"),
    createLoadingDetail("Loading file metadata...")
  );

  const selection = await resolveLazySourceFileSelection(normalizedPath);
  if (requestId !== detailRequestId || selectedNode?.sourcePath !== normalizedPath) {
    logRuntimeTraceMethodRun("renderLazySourceFileDetail", {
      phase: "stale",
      requestId,
      currentRequestId: detailRequestId,
      sourcePath: normalizedPath
    });
    return true;
  }

  if (!selection) {
    logRuntimeTraceMethodRun("renderLazySourceFileDetail", {
      phase: "missing-selection",
      requestId,
      sourcePath: normalizedPath,
      metadataTypes
    });
    renderEmptyDetail(t("schemaStatus.fileMetadataNotFound", { path: normalizedPath }));
    setStatus(t("schemaStatus.fileMetadataNotFound", { path: normalizedPath }), true);
    return true;
  }

  selectedNode = {
    ...selection,
    sourcePath: normalizedPath
  };
  updateSelectedRows();
  await renderDetailPanel();
  logRuntimeTraceMethodRun("renderLazySourceFileDetail", {
    phase: "end",
    requestId,
    selection: createRuntimeTraceSelectionSummary(selectedNode)
  });
  return true;
}

function shouldResolveMetadataItemSourcePathLazily(selection = {}) {
  if (selection.type !== "metadataItem" || !selection.sourcePath) {
    return false;
  }
  if (!schemaStore?.generatedAt) {
    return true;
  }
  return !findMetadataGroup(selection.metadataType) || !findMetadataItem(selection.metadataType, selection.itemKey);
}

async function renderLocalSourceFileDetail(requestId = detailRequestId) {
  const entry = localSourceEntries.get(selectedNode?.sourcePath || "");
  if (!entry || entry.kind !== "file") {
    if (await renderLazySourceFileDetail(selectedNode?.sourcePath || "", requestId)) {
      return;
    }
    renderEmptyDetail("Local file not found.");
    return;
  }

  const selection = selectedNode ? { ...selectedNode } : {};
  if (canLoadLocalSearchEntrySource(entry) && await renderLocalSearchResultSourceDetail(entry, requestId, selection)) {
    return;
  }

  const render = () => renderSourceFilesDetail(
    createDetailTitle(entry.name || "file", entry.path || "", entry.typeLabel || "Local file", "file"),
    [{
      path: entry.path,
      content: entry.content || "",
      deployInfo: entry.deployInfo || null,
      readOnly: entry.readOnly === true
    }]
  );

  if (entry.searchTerm) {
    withSearchHighlightTerm(entry.searchTerm, render);
    return;
  }

  render();
}

function formatJsonPrimitive(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function getJsonSummary(value) {
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).length}}`;
  }

  return formatJsonPrimitive(value);
}

function createJsonKey(key) {
  const keyEl = document.createElement("span");
  keyEl.className = "schema-json-key";
  setSearchHighlightedText(keyEl, String(key));
  return keyEl;
}

function createJsonPrimitive(value) {
  const valueEl = document.createElement("span");
  valueEl.className = `schema-json-value ${value === null ? "null" : typeof value}`;
  setSearchHighlightedText(valueEl, formatJsonPrimitive(value));
  return valueEl;
}

function createJsonNode(key, value, depth = 0, open = false) {
  const isBranch = value !== null && typeof value === "object";
  const node = document.createElement("div");
  node.className = isBranch ? "schema-json-node branch" : "schema-json-node";

  if (!isBranch) {
    const row = document.createElement("div");
    row.className = "schema-json-row leaf";
    row.style.setProperty("--json-indent", `${depth}rem`);
    row.append(createJsonKey(key), createJsonPrimitive(value));
    node.appendChild(row);
    return node;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

  const row = document.createElement("button");
  row.type = "button";
  row.className = "schema-json-row branch";
  row.style.setProperty("--json-indent", `${depth}rem`);

  const toggle = document.createElement("span");
  toggle.className = "schema-json-toggle";

  const summary = document.createElement("span");
  summary.className = "schema-json-summary";
  summary.textContent = getJsonSummary(value);

  row.append(toggle, createJsonKey(key), summary);

  const children = document.createElement("div");
  children.className = "schema-json-children";
  let childrenRendered = false;

  function renderChildren() {
    if (childrenRendered) {
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach(([childKey, childValue]) => {
      fragment.appendChild(createJsonNode(childKey, childValue, depth + 1));
    });
    children.replaceChildren(fragment);
    childrenRendered = true;
  }

  function clearChildren() {
    if (!childrenRendered) {
      return;
    }

    children.replaceChildren();
    childrenRendered = false;
  }

  function setOpen(isOpen) {
    node.classList.toggle("open", isOpen);
    row.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = isOpen ? "-" : "+";
    children.hidden = !isOpen;
    if (isOpen) {
      renderChildren();
    } else {
      clearChildren();
    }
  }

  row.addEventListener("click", () => setOpen(!node.classList.contains("open")));
  setOpen(open);
  node.append(row, children);
  return node;
}

function createLoadingDetail(message) {
  const loading = document.createElement("div");
  loading.className = "schema-detail-loading";
  loading.textContent = formatUserFacingMessage(message);
  return loading;
}

function renderFormattedDetail(header, fileBaseName, rootName, detail) {
  schemaDetailEl.innerHTML = "";
  ensureDetailEditActions(header);
  schemaDetailEl.append(
    header,
    createXmlFile(`${fileBaseName}.xml`, createXmlDocument(rootName, detail))
  );
  applyPendingDetailLineFocus();
}

async function loadObjectDescribe(objectKey) {
  const objectApiName = getObjectApiName(objectKey);
  if (!objectApiName) {
    throw new Error("Missing object API name.");
  }

  if (describeCache.has(objectApiName)) {
    return describeCache.get(objectApiName);
  }

  const describe = await getSObjectDescribe(session.host, session.sid, objectApiName, {
    apiVersion: schemaStore?.apiVersion
  });
  describeCache.set(objectApiName, describe);
  return describe;
}

function cacheObjectDescribeMap(objectDescribeMap = {}) {
  if (!objectDescribeMap || typeof objectDescribeMap !== "object") {
    return 0;
  }

  let cacheCount = 0;
  Object.entries(objectDescribeMap).forEach(([objectApiName, describe]) => {
    const cacheKey = describe?.name || objectApiName;
    if (!cacheKey || !describe || typeof describe !== "object") {
      return;
    }

    describeCache.set(cacheKey, describe);
    cacheCount += 1;
  });
  return cacheCount;
}

function getObjectDescribeWarmupKeys(store = schemaStore) {
  const objectKeys = new Set();
  const addObjectKey = (objectKey) => {
    const apiName = getObjectApiName(objectKey);
    if (apiName) {
      objectKeys.add(objectKey);
    }
  };
  const objectMap = store?.map && typeof store.map === "object" ? store.map : {};
  Object.keys(objectMap).forEach(addObjectKey);
  const objectItems = store?.metadata?.objects?.items;
  if (Array.isArray(objectItems)) {
    objectItems.forEach((item) => {
      addObjectKey(typeof item === "string" ? item : item?.key || item?.name || item?.fullName || "");
    });
  } else if (objectItems && typeof objectItems === "object") {
    Object.keys(objectItems).forEach(addObjectKey);
  }

  return [...objectKeys].sort((left, right) => getObjectApiName(left).localeCompare(getObjectApiName(right)));
}

async function mapWithRuntimeConcurrency(items, limit, worker) {
  const results = [];
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(Number(limit) || 1, 1), items.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

async function warmStartupObjectDescribeCache(options = {}) {
  if (!session?.host || !session?.sid) {
    return [];
  }

  const objectKeys = getObjectDescribeWarmupKeys()
    .filter((objectKey) => {
      const objectApiName = getObjectApiName(objectKey);
      return objectApiName && !describeCache.has(objectApiName);
    });
  if (!objectKeys.length) {
    return [];
  }

  const warnings = [];
  const concurrency = Math.max(1, Math.min(4, getFileDetailSourceRequestConcurrency()));
  const basePercent = Number.isFinite(options.basePercent) ? options.basePercent : 76;
  const percentWeight = Number.isFinite(options.percentWeight) ? options.percentWeight : 18;
  const title = options.title || "Loading Object Describes";
  let completedCount = 0;

  const updateProgress = () => {
    const percent = basePercent + (percentWeight * completedCount / Math.max(objectKeys.length, 1));
    const detail = `${completedCount} of ${objectKeys.length} objects`;
    setStartupLoading(t("schemaStatus.loadingObjectDescribes", { detail: detail }), {
      title,
      percent
    });
    setSchemaSummary(t("schemaStatus.loadingObjectDescribes", { detail: detail }));
  };
  updateProgress();

  await mapWithRuntimeConcurrency(objectKeys, concurrency, async (objectKey) => {
    const objectApiName = getObjectApiName(objectKey);
    try {
      await loadObjectDescribe(objectKey);
    } catch (error) {
      warnings.push(`Object describe ${objectApiName} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      completedCount += 1;
      updateProgress();
    }
  });

  return warnings;
}

function findMetadataGroup(metadataType) {
  return getMetadataGroups().find((group) => group.id === metadataType);
}

function findMetadataItem(metadataType, itemKey) {
  const group = findMetadataGroup(metadataType);
  return getGroupItems(group).find((item) => item.key === itemKey);
}

function getMetadataItemCacheKey(metadataType, item = {}) {
  return item ? `${metadataType}:${item.id || item.key}` : "";
}

function getToolingSourceDetailCacheKey(metadataType = "", recordId = "") {
  return metadataType && recordId ? `${metadataType}:${recordId}` : "";
}

function getCachedToolingSourceDetail(selection = {}, item = {}) {
  const sourceField = SOURCE_BODY_SEARCH_FIELD_BY_TYPE[selection.metadataType];
  const recordId = item.id || item.record?.Id || item.record?.id || "";
  if (!sourceField || !recordId) {
    return null;
  }

  const cacheKey = getToolingSourceDetailCacheKey(selection.metadataType, recordId);
  const cachedDetail = toolingSourceDetailCache.get(cacheKey);
  if (cachedDetail) {
    return cachedDetail;
  }

  const sourceFiles = createMetadataSourceFiles(selection.metadataType, item.record || item, item);
  const sourcePath = selection.sourcePath && !selection.sourcePath.endsWith("-meta.xml")
    ? selection.sourcePath
    : sourceFiles.find((file) => !file.path.endsWith("-meta.xml"))?.path || "";
  const localEntry = sourcePath ? localSourceEntries.get(sourcePath) : null;
  if (!localEntry || localEntry.kind !== "file" || localEntry.recordId !== recordId) {
    return null;
  }

  const detail = {
    ...(item.record || {}),
    Id: recordId,
    id: recordId,
    Name: item.apiName || item.record?.Name || getSourceBaseName(sourcePath).replace(/\.[^.]+$/, ""),
    NamespacePrefix: item.record?.NamespacePrefix || item.record?.namespacePrefix || localEntry.namespacePrefix || "",
    namespacePrefix: item.record?.namespacePrefix || item.record?.NamespacePrefix || localEntry.namespacePrefix || "",
    [sourceField]: localEntry.content || ""
  };
  toolingSourceDetailCache.set(cacheKey, detail);
  return detail;
}

function shouldFetchMetadataItemSourceDetail(selection = {}, detail = {}) {
  const sourceField = SOURCE_BODY_SEARCH_FIELD_BY_TYPE[selection.metadataType];
  return Boolean(sourceField) && !hasToolingSourceText(detail, sourceField);
}

async function loadMetadataItemDetail(selection = {}) {
  const item = findMetadataItem(selection.metadataType, selection.itemKey);
  if (!item) {
    throw new Error("Metadata item not found.");
  }

  const cacheKey = getMetadataItemCacheKey(selection.metadataType, item);
  const cachedDetail = getBoundedCacheValue(metadataDetailCache, cacheKey);
  if (cachedDetail && !shouldFetchMetadataItemSourceDetail(selection, cachedDetail)) {
    return cachedDetail;
  }

  const cachedToolingSourceDetail = getCachedToolingSourceDetail(selection, item);
  const usableCachedToolingSourceDetail = cachedToolingSourceDetail && !shouldFetchMetadataItemSourceDetail(selection, cachedToolingSourceDetail)
    ? cachedToolingSourceDetail
    : null;
  const shouldFetchDetail = Boolean(item.id) || shouldFetchMetadataItemSourceDetail(selection, item.record || item);
  const detail = usableCachedToolingSourceDetail || (shouldFetchDetail
    ? await getMetadataItemDetail(session.host, session.sid, selection.metadataType, item.id || "", {
      apiVersion: schemaStore?.apiVersion,
      record: item.record
    })
    : item.record || item);
  const mergedDetail = item.record && typeof item.record === "object"
    ? { ...item.record, ...detail }
    : detail;
  setBoundedCacheValue(metadataDetailCache, cacheKey, mergedDetail, getMetadataDetailCacheLimit());
  return mergedDetail;
}

function isSelected(selection) {
  if (!selection || !selectedNode) {
    return false;
  }

  const sameSourcePath = selection.sourcePath
    && selectedNode.sourcePath
    && selection.sourcePath === selectedNode.sourcePath;
  if (sameSourcePath
    && ["localFile", "metadataItem", "packageCreate"].includes(selection.type)
    && ["localFile", "metadataItem", "packageCreate"].includes(selectedNode.type)) {
    return true;
  }

  if (selection.type !== selectedNode.type) {
    return false;
  }

  if (selection.type === "metadataType") {
    return selection.metadataType === selectedNode.metadataType;
  }

  if (selection.type === "metadataItem") {
    const baseMatch = selection.metadataType === selectedNode.metadataType && selection.itemKey === selectedNode.itemKey;
    if (!baseMatch) {
      return false;
    }

    return selectedNode.sourcePath ? selection.sourcePath === selectedNode.sourcePath : true;
  }

  if (selection.type === "manifestFile") {
    return false;
  }

  if (selection.type === "packageCreate") {
    return !selectedNode.sourcePath
      || !selection.sourcePath
      || selection.sourcePath === selectedNode.sourcePath;
  }

  if (selection.type === "localFile") {
    return selection.sourcePath === selectedNode.sourcePath;
  }

  if (selection.type === "sourceFolder") {
    return selection.sourcePath === selectedNode.sourcePath;
  }

  if (selection.type === "object") {
    return selection.objectKey === selectedNode.objectKey;
  }

  return selection.objectKey === selectedNode.objectKey && selection.fieldKey === selectedNode.fieldKey;
}

function updateSelectedRows() {
  [schemaTreeEl, schemaSearchResultsTreeEl, schemaPackageTreeEl].filter(Boolean).forEach((tree) => {
    tree.querySelectorAll(".schema-tree-row.selected").forEach((row) => {
      row.classList.remove("selected");
    });

    tree.querySelectorAll(".schema-tree-row").forEach((row) => {
      const selection = {
        type: row.dataset.type,
        metadataType: row.dataset.metadataType,
        objectKey: row.dataset.objectKey,
        fieldKey: row.dataset.fieldKey,
        itemKey: row.dataset.itemKey,
        sourcePath: row.dataset.sourcePath
      };

      if (isSelected(selection)) {
        row.classList.add("selected");
      }
    });
  });
}

function setSelectedNode(selection) {
  logRuntimeTraceFolderMethodRun("setSelectedNode", {
    selection: createRuntimeTraceSelectionSummary(selection)
  });
  if (!selection?.type) {
    setStatus(t("schemaStatus.cannotOpenNoSelection"), true);
    return;
  }
  if (selection.type === "localFile" && isManifestLocalXmlBuilderPath(selection.sourcePath || "")) {
    selection = {
      ...selection,
      type: "packageCreate",
      sourcePath: normalizeMyOrgResultPath(selection.sourcePath || ""),
      localManifest: true
    };
  }
  if (selection.type === "packageCreate") {
    if (!session?.host) {
      setStatus(t("schemaStatus.missingSession"), true);
      return;
    }
    preparePackageXmlCreateDetail({
      sourcePath: selection.sourcePath || PACKAGE_XML_SOURCE_PATH,
      previewXml: selection.previewXml === true || selection.sourcePath === PACKAGE_XML_SOURCE_PATH
    });
    selection = {
      ...selection,
      sourcePath: selection.sourcePath || PACKAGE_XML_SOURCE_PATH
    };
  }
  recordSourceNavigationSelection(selection);
  selectedNode = selection;
  if (selection.type === "sourceFolder" && selection.sourcePath) {
    activeSourceFolderPath = selection.sourcePath;
  }
  if (selection.type === "sourceFolder") {
    scheduleDetailRenderAfterTree();
  } else {
    void renderDetailPanel();
  }
  updateSelectedRows();
}

function focusDetailLine(sourcePath = "", lineNumber = 0) {
  if (!sourcePath || !lineNumber) {
    return;
  }

  schemaDetailEl.querySelectorAll(".schema-code-line-row.focused, .schema-edit-diff-line.focused, .schema-editable-code-line-number-line.focused").forEach((line) => {
    line.classList.remove("focused");
  });

  if (focusEditableDetailLine(sourcePath, lineNumber)) {
    return;
  }

  const rows = Array.from(schemaDetailEl.querySelectorAll(`.schema-code-line-row[data-line-number="${lineNumber}"]`));
  const row = rows.find((line) => line.dataset.sourcePath === sourcePath) || rows[0];
  if (!row) {
    return;
  }

  row.classList.add("focused");
  row.scrollIntoView({
    block: "center",
    inline: "nearest"
  });
}

function getEditableFileForSourcePath(sourcePath = "") {
  const normalizedPath = normalizeMyOrgResultPath(sourcePath);
  const files = getEditableDetailFiles();
  return files.find((file) => normalizeMyOrgResultPath(file.dataset.fileName || "") === normalizedPath)
    || files.find((file) => getSourceBaseName(file.dataset.fileName || "") === getSourceBaseName(normalizedPath))
    || files[0]
    || null;
}

function getEditorLineHeight(editor) {
  const computed = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(computed.lineHeight || "");
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }

  const fontSize = Number.parseFloat(computed.fontSize || "");
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.55 : 18;
}

function focusEditableDetailLine(sourcePath = "", lineNumber = 0) {
  const file = getEditableFileForSourcePath(sourcePath);
  const editor = file?.querySelector?.(".schema-editable-code-editor");
  if (!file || !editor) {
    return false;
  }

  const line = Math.max(1, Number(lineNumber || 0));
  const lineHeight = getEditorLineHeight(editor);
  const targetTop = Math.max(0, (line - 1) * lineHeight - (editor.clientHeight * 0.35));
  editor.scrollTop = targetTop;
  syncEditableDiffScroll(file);

  const number = file.querySelector(`.schema-editable-code-line-number-line[data-line-number="${line}"]`);
  const highlightLine = file.querySelector(`.schema-edit-diff-line[data-line-number="${line}"]`);
  number?.classList.add("focused");
  highlightLine?.classList.add("focused");

  requestAnimationFrame(() => {
    number?.classList.add("focused");
    highlightLine?.classList.add("focused");
  });
  return true;
}

function applyPendingDetailLineFocus() {
  if (!pendingDetailLineFocus) {
    return;
  }

  const { sourcePath, lineNumber } = pendingDetailLineFocus;
  pendingDetailLineFocus = null;
  requestAnimationFrame(() => focusDetailLine(sourcePath, lineNumber));
}

function renderEmptyDetail(message) {
  schemaDetailEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "schema-detail-empty";
  empty.textContent = formatUserFacingMessage(message);
  schemaDetailEl.appendChild(empty);
}

function getCurrentSourceRoot() {
  return getExplorerSourceTree();
}

function getSourceFolderNode(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return null;
  }

  return findSourceTreeNodeByPath(getCurrentSourceRoot(), path);
}

function appendFolderTableHighlightedText(target, value = "", searchTerm = "") {
  const text = String(value ?? "");
  const needle = String(searchTerm || "").trim();
  if (!text || !needle) {
    target.appendChild(document.createTextNode(text));
    return;
  }

  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  let index = 0;
  while (index < text.length) {
    const matchIndex = lowerText.indexOf(lowerNeedle, index);
    if (matchIndex === -1) {
      target.appendChild(document.createTextNode(text.slice(index)));
      return;
    }
    if (matchIndex > index) {
      target.appendChild(document.createTextNode(text.slice(index, matchIndex)));
    }
    const match = document.createElement("span");
    match.className = "schema-detail-match";
    match.textContent = text.slice(matchIndex, matchIndex + lowerNeedle.length);
    target.appendChild(match);
    index = matchIndex + lowerNeedle.length;
  }
}

function getFirstNonEmptyString(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function getCodeSizeValue(child = {}, localEntry = null, record = {}) {
  return getFirstNonEmptyString(
    localEntry?.codeSize,
    record.LengthWithoutComments,
    record.lengthWithoutComments,
    localEntry?.content ? String(localEntry.content).length : "",
    getFolderChildContent(child) ? String(getFolderChildContent(child)).length : ""
  );
}

function getCompanionMetadataFilePath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return "";
  }
  if (path.endsWith("-meta.xml")) {
    return path;
  }
  return `${path}-meta.xml`;
}

function getFolderChildContent(child = {}) {
  const path = normalizeMyOrgResultPath(child.path || "");
  if (!path) {
    return "";
  }
  return localSourceEntries.get(path)?.content || "";
}

function getFolderChildMetaXmlContent(child = {}, siblings = []) {
  const metaPath = getCompanionMetadataFilePath(child.path || "");
  if (!metaPath) {
    return "";
  }
  const localContent = localSourceEntries.get(metaPath)?.content || "";
  if (localContent) {
    return localContent;
  }
  const sibling = siblings.find((entry) => normalizeMyOrgResultPath(entry.path || "") === metaPath);
  return getFolderChildContent(sibling);
}

function getMetadataXmlFlatFields(xml = "") {
  const text = String(xml || "").trim();
  if (!text) {
    return {};
  }

  try {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.getElementsByTagName("parsererror").length) {
      return {};
    }

    const root = document.documentElement;
    if (!root) {
      return {};
    }

    const fields = {};
    Array.from(root.children || []).forEach((child) => {
      if ((child.children || []).length) {
        return;
      }
      const key = child.localName || child.nodeName || "";
      const value = String(child.textContent || "").trim();
      if (key && value && typeof fields[key] === "undefined") {
        fields[key] = value;
      }
    });
    return fields;
  } catch (_error) {
    return {};
  }
}

function getFolderChildMetaFields(child = {}, siblings = []) {
  return getMetadataXmlFlatFields(getFolderChildMetaXmlContent(child, siblings));
}

function normalizeFieldObjectApiName(value = "") {
  return String(value || "").trim().replace(/\.object$/i, "");
}

function getFolderChildObjectApiName(child = {}, selection = {}, record = {}, metadataItem = null, searchValues = []) {
  const childFullName = getFirstNonEmptyString(
    metadataItem?.fullName,
    metadataItem?.apiName,
    record.fullName,
    record.FullName
  );
  const childParts = splitObjectChildMetadataFullName(childFullName);
  const relativePath = getCanonicalMetadataRelativePath(child.path || selection.sourcePath || "");
  const pathObjectMatch = relativePath.match(/^objects\/([^/]+)\//i);
  return normalizeFieldObjectApiName(getFirstNonEmptyString(
    splitSchemaKey(selection.objectKey).apiName,
    childParts.objectApiName,
    record.EntityDefinition?.QualifiedApiName,
    record.SobjectType,
    /^[a-zA-Z][\w]*(__\w+)?$/.test(String(record.TableEnumOrId || "")) ? record.TableEnumOrId : "",
    pathObjectMatch?.[1],
    searchValues.find((value) => String(value || "").includes(": "))
      ? splitSchemaKey(searchValues.find((value) => String(value || "").includes(": "))).apiName
      : ""
  ));
}

function getFolderChildFieldApiName(child = {}, selection = {}, record = {}, metadataItem = null, searchValues = []) {
  const childFullName = getFirstNonEmptyString(
    metadataItem?.fullName,
    metadataItem?.apiName,
    record.fullName,
    record.FullName
  );
  const childParts = splitObjectChildMetadataFullName(childFullName);
  const fileName = getSourceBaseName(child.path || selection.sourcePath || child.name || "")
    .replace(/\.field-meta\.xml$/i, "");
  return getFirstNonEmptyString(
    splitSchemaKey(selection.fieldKey).apiName,
    childParts.childApiName,
    record.QualifiedApiName,
    record.DeveloperName,
    record.Name,
    searchValues.find((value) => String(value || "").endsWith("__c") || String(value || "").endsWith("__pc")),
    fileName
  );
}

function getDescribeField(objectApiName = "", fieldApiName = "") {
  const cleanObjectApiName = normalizeFieldObjectApiName(objectApiName);
  const cleanFieldApiName = String(fieldApiName || "").trim();
  if (!cleanObjectApiName || !cleanFieldApiName) {
    return null;
  }

  const describe = describeCache.get(cleanObjectApiName);
  const fields = Array.isArray(describe?.fields) ? describe.fields : [];
  return fields.find((field) => String(field?.name || "").toLocaleLowerCase() === cleanFieldApiName.toLocaleLowerCase()) || null;
}

function getObjectMetadataField(objectApiName = "", fieldApiName = "") {
  const cleanObjectApiName = normalizeFieldObjectApiName(objectApiName);
  const cleanFieldApiName = String(fieldApiName || "").trim();
  const detail = objectMetadataDetailCache.get(cleanObjectApiName);
  const fields = normalizeObjectMetadataChildEntries(detail?.metadata?.fields);
  return fields.find((field) => {
    const fullName = getFirstNonEmptyString(field.fullName, field.FullName, field.name, field.Name);
    const childApiName = fullName.startsWith(`${cleanObjectApiName}.`)
      ? fullName.slice(cleanObjectApiName.length + 1)
      : fullName;
    return childApiName.toLocaleLowerCase() === cleanFieldApiName.toLocaleLowerCase();
  }) || null;
}

function formatPicklistValueEntries(values = [], maxValues = 30) {
  const entries = (Array.isArray(values) ? values : [])
    .filter((entry) => entry && entry.active !== false)
    .map((entry) => {
      const value = getFirstNonEmptyString(entry.value, entry.fullName, entry.label);
      const label = getFirstNonEmptyString(entry.label, entry.value, entry.fullName);
      return label && value && label !== value ? `${label} (${value})` : label || value;
    })
    .filter(Boolean);
  if (entries.length <= maxValues) {
    return entries.join(", ");
  }
  return `${entries.slice(0, maxValues).join(", ")} +${entries.length - maxValues} more`;
}

function formatMetadataValueSet(valueSet) {
  if (!valueSet) {
    return "";
  }
  if (typeof valueSet === "string") {
    return valueSet;
  }
  const globalValueSetName = getFirstNonEmptyString(valueSet.valueSetName, valueSet.valueSetNameField);
  if (globalValueSetName) {
    return `Global Value Set: ${globalValueSetName}`;
  }
  const definition = valueSet.valueSetDefinition || valueSet.ValueSetDefinition || valueSet;
  const values = normalizeObjectMetadataChildEntries(definition.value || definition.values || definition.customValue);
  return formatPicklistValueEntries(values.map((entry) => ({
    value: getFirstNonEmptyString(entry.fullName, entry.value, entry.name),
    label: getFirstNonEmptyString(entry.label, entry.fullName, entry.value, entry.name),
    active: String(entry.isActive ?? entry.active ?? "true").toLocaleLowerCase() !== "false"
  })));
}

function formatReferenceTargets(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return String(value || "").trim();
}

function getFieldValueColumn(field = {}, metadataField = {}, metaFields = {}, record = {}) {
  const fieldType = getFirstNonEmptyString(metaFields.type, metadataField.type, field.type, record.Type);
  const formula = getFirstNonEmptyString(
    metaFields.formula,
    metaFields.calculatedFormula,
    metadataField.formula,
    metadataField.calculatedFormula,
    field.calculatedFormula,
    record.Formula,
    record.CalculatedFormula
  );
  if (formula) {
    return formula;
  }

  const metadataValueSet = formatMetadataValueSet(metadataField.valueSet || metadataField.ValueSet || record.valueSet || record.ValueSet);
  const describePicklistValues = /picklist/i.test(fieldType)
    ? formatPicklistValueEntries(field.picklistValues)
    : "";
  if (metadataValueSet || describePicklistValues) {
    return metadataValueSet || describePicklistValues;
  }

  const referenceTo = formatReferenceTargets(
    metadataField.referenceTo
      || metadataField.ReferenceTo
      || field.referenceTo
      || record.ReferenceTo
  );
  if (referenceTo) {
    return referenceTo;
  }

  return getFirstNonEmptyString(metaFields.defaultValue, metadataField.defaultValue, field.defaultValue, record.DefaultValue);
}

function isFolderFieldRecord(child = {}, selection = {}, metadataType = "", metadataApiType = "") {
  const relativePath = getCanonicalMetadataRelativePath(child.path || selection.sourcePath || "");
  return selection.type === "field"
    || metadataType === "customFields"
    || metadataApiType === "CustomField"
    || /^objects\/[^/]+\/fields\/[^/]+\.field-meta\.xml$/i.test(relativePath)
    || String(child.metaText || "").toLocaleLowerCase() === "field"
    || String(child.metaText || "").toLocaleLowerCase() === "custom field";
}

function getFieldFolderRecordValues(child = {}, selection = {}, metaFields = {}, metadataItem = null, record = {}, searchValues = []) {
  const metadataType = selection.metadataType || "";
  const metadataApiType = getFirstNonEmptyString(child.metaText, metadataItem?.metadataApiType, record.metadataApiType, record.type);
  if (!isFolderFieldRecord(child, selection, metadataType, metadataApiType)) {
    return {};
  }

  const objectApiName = getFolderChildObjectApiName(child, selection, record, metadataItem, searchValues);
  const fieldApiName = getFolderChildFieldApiName(child, selection, record, metadataItem, searchValues);
  const field = getDescribeField(objectApiName, fieldApiName) || {};
  const metadataField = getObjectMetadataField(objectApiName, fieldApiName) || {};

  return {
    isFieldRecord: true,
    apiName: fieldApiName,
    fullName: objectApiName && fieldApiName ? `${objectApiName}.${fieldApiName}` : fieldApiName,
    label: getFirstNonEmptyString(field.label, metaFields.label, metadataField.label, record.Label, splitSchemaKey(selection.fieldKey).label, fieldApiName),
    fieldType: getFirstNonEmptyString(metaFields.type, metadataField.type, field.type, record.Type),
    fieldValue: getFieldValueColumn(field, metadataField, metaFields, record)
  };
}

function getRecordLastModifiedByName(record = {}) {
  return getFirstNonEmptyString(
    record.LastModifiedBy?.Name,
    record.LastModifiedByName,
    record.lastModifiedByName,
    record.lastModifiedBy?.Name,
    record.lastModifiedBy,
    record.lastModifiedById
  );
}

function getFolderChildRecord(child = {}, siblings = []) {
  const selection = child.selection || {};
  const selectionRecord = selection.record && typeof selection.record === "object" ? selection.record : {};
  const localEntry = child.path ? localSourceEntries.get(child.path) : null;
  const metaFields = getFolderChildMetaFields(child, siblings);
  const metadataType = selection.metadataType || localEntry?.metadataType || "";
  const metadataItem = selection.type === "metadataItem"
    ? findMetadataItem(selection.metadataType, selection.itemKey)
    : null;
  const record = metadataItem?.record || {};
  const objectParts = selection.objectKey ? splitSchemaKey(selection.objectKey) : {};
  const fieldParts = selection.fieldKey ? splitSchemaKey(selection.fieldKey) : {};
  const searchValues = Array.isArray(child.searchValues) ? child.searchValues : [];
  const name = child.name || getSourceBaseName(child.path || "") || "";
  const apiName = getFirstNonEmptyString(
    fieldParts.apiName,
    objectParts.apiName,
    metadataItem?.apiName,
    localEntry?.metadataName,
    localEntry?.fullName,
    searchValues[1],
    name.replace(/(?:\.[^.]+)?(?:-meta)?\.xml$/i, "")
  );
  const fullName = getFirstNonEmptyString(
    metadataItem?.fullName,
    metadataItem?.apiName,
    localEntry?.fullName,
    record.fullName,
    record.FullName,
    apiName
  );
  const label = getFirstNonEmptyString(
    metaFields.label,
    fieldParts.label,
    objectParts.label,
    getSourceNodeRecordLabel(child),
    metadataItem?.label,
    localEntry?.label,
    searchValues[2]
  );
  const fieldValues = getFieldFolderRecordValues(child, selection, metaFields, metadataItem, record, searchValues);

  return {
    child,
    apiName,
    fullName,
    label,
    developerName: getFirstNonEmptyString(record.DeveloperName, record.developerName, metadataItem?.developerName),
    masterLabel: getFirstNonEmptyString(metaFields.masterLabel, record.MasterLabel, record.masterLabel, metadataItem?.masterLabel),
    metadataType,
    metadataApiType: getFirstNonEmptyString(child.metaText, localEntry?.metadataApiType, metadataItem?.metadataApiType),
    apiVersion: getFirstNonEmptyString(metaFields.apiVersion, record.ApiVersion, record.apiVersion, localEntry?.apiVersion),
    namespace: getFirstNonEmptyString(metadataItem?.namespacePrefix, localEntry?.namespacePrefix),
    status: getFirstNonEmptyString(metaFields.status, metadataItem?.status, localEntry?.status),
    description: getFirstNonEmptyString(metaFields.description, record.Description, record.description),
    manageableState: getFirstNonEmptyString(record.ManageableState, record.manageableState),
    codeSize: getCodeSizeValue(child, localEntry, record),
    lastModifiedDate: getFirstNonEmptyString(
      child.lastModifiedDate,
      selection.lastModifiedDate,
      selectionRecord.LastModifiedDate,
      selectionRecord.lastModifiedDate,
      record.LastModifiedDate,
      record.lastModifiedDate,
      localEntry?.lastModifiedDate
    ),
    lastModifiedByName: getFirstNonEmptyString(
      child.lastModifiedByName,
      selection.lastModifiedByName,
      getRecordLastModifiedByName(selectionRecord),
      getRecordLastModifiedByName(record),
      localEntry?.lastModifiedByName
    ),
    fileName: getFirstNonEmptyString(localEntry?.fileName, name),
    searchText: [
      name,
      child.kind || "",
      child.metaText || "",
      localEntry?.typeLabel || "",
      child.path || "",
      ...searchValues
    ].filter(Boolean).join(" "),
    ...fieldValues
  };
}

function getFolderTableColumns(records = []) {
  const fieldRecordCount = records.filter((record) => record.isFieldRecord).length;
  if (fieldRecordCount && fieldRecordCount === records.length) {
    const fieldColumns = [
      { key: "apiName", label: t("schemaUi.col.apiName"), always: true },
      { key: "label", label: t("schemaUi.col.label"), always: true },
      { key: "fieldType", label: t("schemaUi.col.fieldType"), always: true },
      { key: "fieldValue", label: t("schemaUi.col.fieldValue"), always: true },
      { key: "lastModifiedDate", label: t("schemaUi.col.lastModifiedDate"), type: "date" }
    ];
    return fieldColumns.filter((column) => column.always || records.some((record) => record[column.key]));
  }

  const columns = [
    { key: "apiName", label: t("schemaUi.col.apiName") },
    { key: "fullName", label: t("schemaUi.col.fullName") },
    { key: "developerName", label: t("schemaUi.col.developerName") },
    { key: "label", label: t("schemaUi.col.label") },
    { key: "masterLabel", label: t("schemaUi.col.masterLabel") },
    { key: "apiVersion", label: t("schemaUi.col.apiVersion") },
    { key: "namespace", label: t("schemaUi.col.namespace") },
    { key: "status", label: t("schemaUi.col.status") },
    { key: "description", label: t("schemaUi.col.description") },
    { key: "manageableState", label: t("schemaUi.col.manageableState") },
    { key: "codeSize", label: t("schemaUi.col.codeSize"), type: "number" },
    { key: "lastModifiedDate", label: t("schemaUi.col.lastModifiedDate"), type: "date" },
    { key: "lastModifiedByName", label: t("schemaUi.col.lastModifiedByName") }
  ];
  return columns.filter((column) => column.key === "apiName" || records.some((record) => record[column.key]));
}

function recordMatchesFolderTableSearch(record = {}, searchTerm = "") {
  if (!searchTerm) {
    return true;
  }
  return Object.entries(record)
    .filter(([key, value]) => key !== "child" && typeof value === "string")
    .some(([, value]) => matchesFixedSearchText(value, searchTerm));
}

function revealFolderTableRecordInTree(record = {}) {
  const sourcePath = normalizeDetailSourcePath(record.child?.path || record.child?.selection?.sourcePath || "");
  if (!sourcePath) {
    return;
  }

  clearExplorerFileFilterIfPathIsHidden(sourcePath);
  openSourcePathAncestors(sourcePath);
  if (activeSidebarTab === "explorer") {
    renderSchema({
      renderDetail: false,
      scrollSelectedIntoView: true
    });
  } else {
    updateSelectedRows();
  }
}

function openFolderTableRecord(record = {}) {
  const child = record.child || {};
  if (child.kind === "folder") {
    openSourceFolderPathInDetail(child.path);
    revealFolderTableRecordInTree(record);
    return;
  }
  setSelectedSourceNodeFromPath(child.selection, child.path);
  revealFolderTableRecordInTree(record);
}

function getFolderTableColumnValue(record = {}, column = {}) {
  return record[column.key] ?? "";
}

function getFolderTableSortValue(record = {}, column = {}) {
  const rawValue = getFolderTableColumnValue(record, column);
  const textValue = String(rawValue ?? "").trim();
  if (!textValue) {
    return { empty: true, value: "" };
  }

  if (column.type === "date") {
    const timestamp = Date.parse(textValue);
    return Number.isNaN(timestamp)
      ? { empty: false, value: textValue.toLocaleLowerCase() }
      : { empty: false, value: timestamp };
  }

  if (column.type === "number") {
    const number = Number(textValue.replace(/,/g, ""));
    return Number.isFinite(number)
      ? { empty: false, value: number }
      : { empty: false, value: textValue.toLocaleLowerCase() };
  }

  return { empty: false, value: textValue.toLocaleLowerCase() };
}

function compareFolderTableSortValues(leftRecord = {}, rightRecord = {}, column = {}, direction = "asc") {
  const left = getFolderTableSortValue(leftRecord, column);
  const right = getFolderTableSortValue(rightRecord, column);
  if (left.empty || right.empty) {
    if (left.empty && right.empty) {
      return 0;
    }
    return left.empty ? 1 : -1;
  }

  const result = typeof left.value === "number" && typeof right.value === "number"
    ? left.value - right.value
    : String(left.value).localeCompare(String(right.value), undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -result : result;
}

function sortFolderTableRecords(records = [], columns = [], sortState = {}) {
  const sortColumn = columns.find((column) => column.key === sortState.columnKey);
  if (!sortColumn) {
    return records;
  }

  const direction = sortState.direction === "desc" ? "desc" : "asc";
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => (
      compareFolderTableSortValues(left.record, right.record, sortColumn, direction)
      || left.index - right.index
    ))
    .map((entry) => entry.record);
}

function createFolderTableHeaderRow(columns = [], sortState = {}, onSortChange = () => {}) {
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.columnKey = column.key;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "schema-folder-table-sort-button";
    button.dataset.columnKey = column.key;
    button.addEventListener("click", () => onSortChange(column));

    const label = document.createElement("span");
    label.textContent = column.label;

    const icon = document.createElement("span");
    icon.className = "schema-folder-table-sort-icon";
    icon.setAttribute("aria-hidden", "true");

    button.append(label, icon);
    th.appendChild(button);
    headerRow.appendChild(th);
  });
  updateFolderTableHeaderSortState(headerRow, columns, sortState);
  return headerRow;
}

function updateFolderTableHeaderSortState(headerRow, columns = [], sortState = {}) {
  columns.forEach((column) => {
    const th = Array.from(headerRow?.children || []).find((cell) => cell.dataset?.columnKey === column.key);
    const button = th?.querySelector(".schema-folder-table-sort-button");
    if (!th || !button) {
      return;
    }

    const isSorted = sortState.columnKey === column.key;
    const direction = sortState.direction === "desc" ? "desc" : "asc";
    th.setAttribute("aria-sort", isSorted ? (direction === "asc" ? "ascending" : "descending") : "none");
    button.classList.toggle("sorted", isSorted);
    button.classList.toggle("ascending", isSorted && direction === "asc");
    button.classList.toggle("descending", isSorted && direction === "desc");
    button.setAttribute("aria-label", isSorted
      ? `Sort by ${column.label}, currently ${direction === "asc" ? "ascending" : "descending"}`
      : `Sort by ${column.label}`);
    button.title = isSorted
      ? `${column.label}: ${direction === "asc" ? "ascending" : "descending"}`
      : `Sort by ${column.label}`;
  });
}

function createFolderTableRow(record = {}, columns = [], searchTerm = "") {
  const row = document.createElement("tr");
  row.tabIndex = 0;
  row.className = "schema-folder-table-row";
  row.title = record.child?.path || record.fileName || record.apiName || "";
  row.addEventListener("click", () => openFolderTableRecord(record));
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openFolderTableRecord(record);
  });
  columns.forEach((column) => {
    const cell = document.createElement("td");
    appendFolderTableHighlightedText(cell, getFolderTableColumnValue(record, column), searchTerm);
    row.appendChild(cell);
  });
  return row;
}

function renderFolderTableRows(tbody, empty, records = [], columns = [], searchTerm = "", options = {}) {
  tbody.innerHTML = "";
  const visibleRecords = sortFolderTableRecords(
    records.filter((record) => recordMatchesFolderTableSearch(record, searchTerm)),
    columns,
    options.sortState || {}
  );
  empty.hidden = visibleRecords.length > 0;
  const renderToken = options.renderToken || 0;
  const isCurrent = typeof options.isCurrent === "function"
    ? options.isCurrent
    : () => true;

  function appendBatch(startIndex = 0) {
    if (!isCurrent(renderToken)) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(startIndex + FOLDER_DETAIL_TABLE_RENDER_BATCH_SIZE, visibleRecords.length);
    for (let index = startIndex; index < endIndex; index += 1) {
      fragment.appendChild(createFolderTableRow(visibleRecords[index], columns, searchTerm));
    }
    tbody.appendChild(fragment);

    if (endIndex < visibleRecords.length) {
      window.requestAnimationFrame(() => appendBatch(endIndex));
    }
  }

  appendBatch(0);
}

function createFolderContentsTable(folderNode = {}) {
  logRuntimeTraceMethodRun("createFolderContentsTable", {
    folder: createRuntimeTraceSourceNodeSummary(folderNode)
  });
  const children = folderNode.children || [];
  const records = children.map((child) => getFolderChildRecord(child, children));
  const columns = getFolderTableColumns(records);
  const frame = document.createElement("div");
  frame.className = "schema-folder-table-frame";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-folder-table-search";
  input.placeholder = t("schemaUi.searchFolderRows");
  input.setAttribute("aria-label", t("schemaUi.searchFolderRows"));

  const wrap = document.createElement("div");
  wrap.className = "schema-folder-table-wrap";
  const table = document.createElement("table");
  table.className = "schema-folder-table";
  const thead = document.createElement("thead");
  const sortState = { columnKey: "", direction: "asc" };
  const headerRow = createFolderTableHeaderRow(columns, sortState, (column) => {
    sortState.direction = sortState.columnKey === column.key && sortState.direction === "asc" ? "desc" : "asc";
    sortState.columnKey = column.key;
    updateFolderTableHeaderSortState(headerRow, columns, sortState);
    renderRows();
  });
  thead.appendChild(headerRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  wrap.appendChild(table);

  const empty = document.createElement("div");
  empty.className = "schema-detail-empty schema-folder-table-empty";
  empty.textContent = records.length ? "No matching rows." : "No child files or folders.";

  let renderToken = 0;
  const renderRows = () => {
    renderToken += 1;
    renderFolderTableRows(tbody, empty, records, columns, input.value.trim(), {
      renderToken,
      sortState,
      isCurrent: (token) => token === renderToken
    });
  };

  input.addEventListener("input", renderRows);
  input.addEventListener("search", renderRows);

  renderRows();
  frame.append(input, wrap, empty);
  return frame;
}

function getObjectBucketChildRecord(child = {}) {
  const selection = child.selection || {};
  const selectionRecord = selection.record && typeof selection.record === "object" ? selection.record : {};
  const localEntry = child.path ? localSourceEntries.get(child.path) : null;
  const searchValues = Array.isArray(child.searchValues) ? child.searchValues : [];
  const objectKeyCandidate = selection.objectKey || searchValues.find((value) => (
    !String(value || "").includes("/") && splitSchemaKey(value).label
  )) || "";
  const objectParts = splitSchemaKey(objectKeyCandidate);
  const fileApiName = String(child.name || "").replace(/\.object$/i, "");
  const apiName = getFirstNonEmptyString(
    objectParts.apiName,
    searchValues[1] && !String(searchValues[1]).includes("/") ? String(searchValues[1]).replace(/\.object$/i, "") : "",
    fileApiName
  );
  const label = getFirstNonEmptyString(
    getSourceNodeRecordLabel(child),
    objectParts.label,
    !isGenericObjectSourceLabel(child, searchValues[2]) ? searchValues[2] : ""
  );
  return {
    child,
    apiName,
    label,
    lastModifiedDate: getFirstNonEmptyString(
      child.lastModifiedDate,
      selection.lastModifiedDate,
      selectionRecord.LastModifiedDate,
      selectionRecord.lastModifiedDate,
      localEntry?.lastModifiedDate
    ),
    lastModifiedByName: getFirstNonEmptyString(
      child.lastModifiedByName,
      selection.lastModifiedByName,
      getRecordLastModifiedByName(selectionRecord),
      localEntry?.lastModifiedByName
    ),
    fileName: child.name || apiName,
    searchText: [
      apiName,
      label,
      child.lastModifiedDate || "",
      child.lastModifiedByName || "",
      child.name || "",
      child.path || "",
      ...searchValues
    ].filter(Boolean).join(" ")
  };
}

function createObjectBucketContentsTable(folderNode = {}) {
  logRuntimeTraceMethodRun("createObjectBucketContentsTable", {
    folder: createRuntimeTraceSourceNodeSummary(folderNode)
  });
  const records = (folderNode.children || []).map(getObjectBucketChildRecord);
  const columns = [
    { key: "apiName", label: "Object API Name" },
    { key: "label", label: t("schemaUi.col.label") },
    { key: "lastModifiedDate", label: t("schemaUi.col.lastModifiedDate"), type: "date" },
    { key: "lastModifiedByName", label: t("schemaUi.col.lastModifiedByName") }
  ].filter((column) => column.key === "apiName" || records.some((record) => record[column.key]));
  const frame = document.createElement("div");
  frame.className = "schema-folder-table-frame";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "schema-folder-table-search";
  input.placeholder = t("schemaUi.searchObjects");
  input.setAttribute("aria-label", t("schemaUi.searchObjects"));

  const wrap = document.createElement("div");
  wrap.className = "schema-folder-table-wrap";
  const table = document.createElement("table");
  table.className = "schema-folder-table";
  const thead = document.createElement("thead");
  const sortState = { columnKey: "", direction: "asc" };
  const headerRow = createFolderTableHeaderRow(columns, sortState, (column) => {
    sortState.direction = sortState.columnKey === column.key && sortState.direction === "asc" ? "desc" : "asc";
    sortState.columnKey = column.key;
    updateFolderTableHeaderSortState(headerRow, columns, sortState);
    renderRows();
  });
  thead.appendChild(headerRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  wrap.appendChild(table);

  const empty = document.createElement("div");
  empty.className = "schema-detail-empty schema-folder-table-empty";
  empty.textContent = records.length ? "No matching objects." : "No objects.";

  let renderToken = 0;
  const renderRows = () => {
    renderToken += 1;
    renderFolderTableRows(tbody, empty, records, columns, input.value.trim(), {
      renderToken,
      sortState,
      isCurrent: (token) => token === renderToken
    });
  };

  input.addEventListener("input", renderRows);
  input.addEventListener("search", renderRows);

  renderRows();
  frame.append(input, wrap, empty);
  return frame;
}

async function renderSourceFolderDetail(selection = {}, requestId = detailRequestId) {
  logRuntimeTraceMethodRun("renderSourceFolderDetail", {
    phase: "start",
    requestId,
    selection: createRuntimeTraceSelectionSummary(selection)
  });
  let folderNode = getSourceFolderNode(selection.sourcePath);
  if (!folderNode) {
    logRuntimeTraceMethodRun("renderSourceFolderDetail", {
      phase: "missing-folder",
      requestId,
      selection: createRuntimeTraceSelectionSummary(selection)
    });
    renderEmptyDetail("Folder not found.");
    return;
  }
  const objectBucket = isObjectBucketSourceFolder(folderNode);
  if (!objectBucket) {
    ensureSourceTreeLazyChildren(folderNode);
    try {
      if (await ensureObjectChildSourceFolderLoaded(folderNode, selection.sourcePath)) {
        if (requestId !== detailRequestId || !isSelected(selection)) {
          logRuntimeTraceMethodRun("renderSourceFolderDetail", {
            phase: "stale-after-object-child-load",
            requestId,
            currentRequestId: detailRequestId,
            selection: createRuntimeTraceSelectionSummary(selection)
          });
          return;
        }
        renderSchema({ renderDetail: false, preserveScroll: true, treeOnly: true });
        folderNode = getSourceFolderNode(selection.sourcePath) || folderNode;
        ensureSourceTreeLazyChildren(folderNode);
      }
    } catch (error) {
      if (requestId === detailRequestId && isSelected(selection)) {
        const message = error instanceof Error ? error.message : String(error);
        logRuntimeTraceMethodRun("renderSourceFolderDetail", {
          phase: "object-child-load-error",
          requestId,
          selection: createRuntimeTraceSelectionSummary(selection),
          message
        });
        setStatus(t("schemaStatus.folderItemsLoadFailed", { message: message }), true);
      }
    }
  }

  const header = createDetailTitle(
    folderNode.name || getSourceBaseName(folderNode.path || ""),
    folderNode.path || "",
    t("schemaUi.rowCount", { count: (folderNode.children || []).length }),
    "folder"
  );
  if (requestId !== detailRequestId || !isSelected(selection)) {
    logRuntimeTraceMethodRun("renderSourceFolderDetail", {
      phase: "stale",
      requestId,
      currentRequestId: detailRequestId,
      selection: createRuntimeTraceSelectionSummary(selection)
    });
    return;
  }
  schemaDetailEl.innerHTML = "";
  schemaDetailEl.append(
    header,
    objectBucket ? createObjectBucketContentsTable(folderNode) : createFolderContentsTable(folderNode)
  );
  logRuntimeTraceMethodRun("renderSourceFolderDetail", {
    phase: "end",
    requestId,
    folder: createRuntimeTraceSourceNodeSummary(folderNode)
  });
}

function scheduleDetailRenderAfterTree() {
  logRuntimeTraceFolderMethodRun("scheduleDetailRenderAfterTree", {
    delayMs: 0
  });
  scheduledDetailRenderToken += 1;
  const token = scheduledDetailRenderToken;
  if (scheduledDetailRenderTimer) {
    window.clearTimeout(scheduledDetailRenderTimer);
    scheduledDetailRenderTimer = 0;
  }
  if (scheduledDetailRenderFrame) {
    window.cancelAnimationFrame(scheduledDetailRenderFrame);
    scheduledDetailRenderFrame = 0;
  }
  if (scheduledDetailRenderIdle) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(scheduledDetailRenderIdle);
    } else {
      window.clearTimeout(scheduledDetailRenderIdle);
    }
    scheduledDetailRenderIdle = 0;
  }

  const runDetail = () => {
    scheduledDetailRenderIdle = 0;
    if (token !== scheduledDetailRenderToken) {
      logRuntimeTraceMethodRun("scheduleDetailRenderAfterTree.timer", {
        phase: "stale",
        token,
        scheduledDetailRenderToken
      });
      return;
    }
    logRuntimeTraceMethodRun("scheduleDetailRenderAfterTree.timer", {
      phase: "fire",
      token
    });
    void renderDetailPanel();
  };

  scheduledDetailRenderFrame = window.requestAnimationFrame(() => {
    scheduledDetailRenderFrame = 0;
    if (typeof window.requestIdleCallback === "function") {
      scheduledDetailRenderIdle = window.requestIdleCallback(runDetail, { timeout: 120 });
      return;
    }
    scheduledDetailRenderIdle = window.setTimeout(runDetail, 0);
  });
}

async function renderDetailPanel() {
  if (selectedNode?.type === "sourceFolder") {
    logRuntimeTraceMethodRun("renderDetailPanel", {
      phase: "start",
      selectedNode: createRuntimeTraceSelectionSummary(selectedNode || {})
    });
  }
  scheduledDetailRenderToken += 1;
  if (scheduledDetailRenderTimer) {
    window.clearTimeout(scheduledDetailRenderTimer);
    scheduledDetailRenderTimer = 0;
  }
  if (scheduledDetailRenderFrame) {
    window.cancelAnimationFrame(scheduledDetailRenderFrame);
    scheduledDetailRenderFrame = 0;
  }
  if (scheduledDetailRenderIdle) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(scheduledDetailRenderIdle);
    } else {
      window.clearTimeout(scheduledDetailRenderIdle);
    }
    scheduledDetailRenderIdle = 0;
  }

  const requestId = detailRequestId + 1;
  detailRequestId = requestId;
  renderSchemaBreadcrumb(selectedNode?.sourcePath || "");
  schemaDetailEl.innerHTML = "";

  if (selectedNode?.type === "packageCreate") {
    renderPackageXmlCreateDetail();
    return;
  }

  if (selectedNode?.type === "localFile") {
    await renderLocalSourceFileDetail(requestId);
    return;
  }

  if (selectedNode?.type === "sourceFolder") {
    await renderSourceFolderDetail({ ...selectedNode }, requestId);
    return;
  }

  if (shouldResolveMetadataItemSourcePathLazily(selectedNode)) {
    if (await renderLazySourceFileDetail(selectedNode.sourcePath, requestId)) {
      return;
    }
  }

  if (!schemaStore?.generatedAt) {
    renderEmptyDetail("Build the schema map to view details.");
    return;
  }

  if (!selectedNode) {
    renderEmptyDetail("Select a metadata type or item.");
    return;
  }

  if (selectedNode.type === "metadataType") {
    const group = findMetadataGroup(selectedNode.metadataType);
    if (!group) {
      renderEmptyDetail("Metadata type not found.");
      return;
    }

    const groupDetail = {
      id: group.id,
      label: group.label,
      itemLabel: group.itemLabel,
      kind: group.kind,
      count: group.count || 0,
      childCount: group.childCount || 0
    };
    renderFormattedDetail(
      createDetailTitle(group.label, group.itemLabel || "", `${getGroupItemCount(group)} items`, "folder"),
      `${group.id}.metadataType`,
      "metadataType",
      groupDetail
    );
    return;
  }

  if (selectedNode.type === "metadataItem") {
    const selection = { ...selectedNode };
    const item = findMetadataItem(selection.metadataType, selection.itemKey);
    const group = findMetadataGroup(selection.metadataType);
    if (!item || !group) {
      renderEmptyDetail("Metadata item not found.");
      return;
    }

    schemaDetailEl.append(
      createDetailTitle(item.apiName || item.key, item.label || "", group.itemLabel || "Metadata", "file"),
      createLoadingDetail("Loading metadata detail...")
    );

    try {
      const detail = await loadMetadataItemDetail(selection);
      if (requestId !== detailRequestId || !isSelected(selection)) {
        return;
      }

      const sourceFiles = createMetadataSourceFiles(selection.metadataType, detail, item);
      if (sourceFiles.length) {
        cacheMetadataDetailSourceFiles(selection, detail, item, sourceFiles);
        const selectedSourceFiles = getSelectedSourceFiles(sourceFiles, selection);
        renderSourceFilesDetail(
          createMetadataSourceDetailTitle(item, group, selection, selectedSourceFiles),
          selectedSourceFiles
        );
        return;
      }

      renderFormattedDetail(
        createDetailTitle(item.apiName || item.key, item.label || "", group.itemLabel || "Metadata", "file"),
        `${selection.metadataType}.${item.apiName || item.id || "item"}`,
        "metadataItem",
        {
          metadataType: group.id,
          metadataLabel: group.label,
          ...detail
        }
      );
    } catch (error) {
      if (requestId !== detailRequestId) {
        return;
      }

      renderEmptyDetail(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (selectedNode.type === "object") {
    const selection = { ...selectedNode };
    if (selection.sourcePath && getSourceFolderNode(selection.sourcePath)) {
      await renderSourceFolderDetail(selection, requestId);
      return;
    }

    const objectParts = splitSchemaKey(selectedNode.objectKey);
    const fieldCount = getObjectFieldCount(selectedNode.objectKey);
    schemaDetailEl.append(
      createDetailTitle(objectParts.apiName, objectParts.label, `${fieldCount} fields`, "folder"),
      createLoadingDetail("Loading object detail...")
    );

    try {
      const describe = await loadObjectDescribe(selection.objectKey);
      if (requestId !== detailRequestId || !isSelected(selection)) {
        return;
      }

      renderFormattedDetail(
        createDetailTitle(objectParts.apiName, objectParts.label, `${fieldCount} fields`, "folder"),
        `${objectParts.apiName}.object`,
        "object",
        describe
      );
    } catch (error) {
      if (requestId !== detailRequestId) {
        return;
      }

      renderEmptyDetail(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const selection = { ...selectedNode };
  const fieldParts = splitSchemaKey(selectedNode.fieldKey);
  const parentParts = splitSchemaKey(selectedNode.objectKey);
  schemaDetailEl.append(
    createDetailTitle(fieldParts.apiName, fieldParts.label, "field", "file"),
    createLoadingDetail("Loading field detail...")
  );

  try {
    const describe = await loadObjectDescribe(selection.objectKey);
    if (requestId !== detailRequestId || !isSelected(selection)) {
      return;
    }

    const field = Array.isArray(describe?.fields)
      ? describe.fields.find((item) => item?.name === fieldParts.apiName)
      : null;
    const fieldDetail = {
      objectApiName: parentParts.apiName,
      objectLabel: parentParts.label,
      ...(field || {
        name: fieldParts.apiName,
        label: fieldParts.label
      })
    };

    renderFormattedDetail(
      createDetailTitle(fieldParts.apiName, fieldParts.label, field?.type || "field", "file"),
      `${parentParts.apiName}.${fieldParts.apiName}.field`,
      "field",
      fieldDetail
    );
  } catch (error) {
    if (requestId !== detailRequestId) {
      return;
    }

    renderEmptyDetail(error instanceof Error ? error.message : String(error));
  }
}

function setTreeIndent(row, level = 0) {
  row.style.setProperty("--tree-indent", `${Math.max(0, level) * SOURCE_TREE_INDENT_REM}rem`);
}

function createSourceTreeNode(name, path, kind = "folder", options = {}) {
  return {
    name,
    path,
    kind,
    children: [],
    lazyChildrenFactory: typeof options.lazyChildrenFactory === "function" ? options.lazyChildrenFactory : null,
    lazyChildrenLoaded: false,
    lazyChildCount: Number.isFinite(options.lazyChildCount) ? options.lazyChildCount : null,
    sourceFileCount: Number.isFinite(options.sourceFileCount) ? options.sourceFileCount : null,
    selection: options.selection || null,
    label: options.label || "",
    metaText: options.metaText || "",
    secondary: options.secondary || "",
    alwaysOpen: options.alwaysOpen === true,
    defaultOpen: options.defaultOpen === true,
    autoRetrieve: options.autoRetrieve !== false,
    contentKind: options.contentKind || "",
    sourceOrigin: options.sourceOrigin || "",
    localUid: options.localUid || "",
    keepEmpty: options.keepEmpty === true,
    sortRank: Number.isFinite(options.sortRank) ? options.sortRank : null,
    lastModifiedDate: options.lastModifiedDate || "",
    lastModifiedByName: options.lastModifiedByName || "",
    // Transparent folders keep their node and path (so sourcePath, package.xml
    // and the IndexedDB cache are unchanged) but render no row of their own —
    // their children are flattened up to the transparent folder's own level.
    transparent: options.transparent === true,
    searchValues: options.searchValues || []
  };
}

function addSourceFolder(parent, name, options = {}) {
  const path = options.path || `${parent.path}/${name}`;
  let folder = parent.children.find((child) => child.kind === "folder" && child.path === path);
  if (!folder) {
    folder = createSourceTreeNode(name, path, "folder", options);
    parent.children.push(folder);
  } else {
    folder.searchValues.push(...(options.searchValues || []));
    folder.selection = folder.selection || options.selection || null;
    folder.label = folder.label || options.label || "";
    folder.secondary = folder.secondary || options.secondary || "";
    folder.alwaysOpen = folder.alwaysOpen || options.alwaysOpen === true;
    folder.defaultOpen = folder.defaultOpen || options.defaultOpen === true;
    if (options.autoRetrieve === false) {
      folder.autoRetrieve = false;
    }
    folder.contentKind = folder.contentKind || options.contentKind || "";
    folder.sourceOrigin = folder.sourceOrigin || options.sourceOrigin || "";
    folder.localUid = folder.localUid || options.localUid || "";
    folder.keepEmpty = folder.keepEmpty || options.keepEmpty === true;
    folder.transparent = folder.transparent || options.transparent === true;
    folder.sortRank = Number.isFinite(folder.sortRank) ? folder.sortRank : (Number.isFinite(options.sortRank) ? options.sortRank : null);
    folder.lastModifiedDate = folder.lastModifiedDate || options.lastModifiedDate || "";
    folder.lastModifiedByName = folder.lastModifiedByName || options.lastModifiedByName || "";
    folder.lazyChildrenFactory = folder.lazyChildrenFactory || (typeof options.lazyChildrenFactory === "function" ? options.lazyChildrenFactory : null);
    folder.lazyChildCount = Number.isFinite(folder.lazyChildCount) ? folder.lazyChildCount : (Number.isFinite(options.lazyChildCount) ? options.lazyChildCount : null);
    folder.sourceFileCount = Number.isFinite(folder.sourceFileCount) ? folder.sourceFileCount : (Number.isFinite(options.sourceFileCount) ? options.sourceFileCount : null);
  }

  return folder;
}

function ensureSourceTreeLazyChildren(node = {}) {
  logRuntimeTraceFolderMethodRun("ensureSourceTreeLazyChildren", {
    phase: "call",
    node: createRuntimeTraceSourceNodeSummary(node)
  });
  if (node.kind !== "folder" || !node.lazyChildrenFactory || node.lazyChildrenLoaded) {
    logRuntimeTraceFolderMethodRun("ensureSourceTreeLazyChildren", {
      phase: "skip",
      node: createRuntimeTraceSourceNodeSummary(node)
    });
    return false;
  }

  node.lazyChildrenLoaded = true;
  node.lazyChildrenFactory(node);
  logRuntimeTraceFolderMethodRun("ensureSourceTreeLazyChildren", {
    phase: "loaded",
    node: createRuntimeTraceSourceNodeSummary(node)
  });
  return true;
}

function getSourceNodeLastModifiedTimestamp(node = {}) {
  const timestamp = Date.parse(node.lastModifiedDate || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function applySourceFolderLastModifiedFromChildren(node = {}) {
  if (!node || node.kind !== "folder") {
    return node;
  }

  let latestNode = node.lastModifiedDate ? node : null;
  let latestTimestamp = getSourceNodeLastModifiedTimestamp(node);
  (node.children || []).forEach((child) => {
    const childTimestamp = getSourceNodeLastModifiedTimestamp(child);
    if (childTimestamp > latestTimestamp) {
      latestTimestamp = childTimestamp;
      latestNode = child;
    }
  });

  if (latestNode) {
    node.lastModifiedDate = latestNode.lastModifiedDate || "";
    node.lastModifiedByName = latestNode.lastModifiedByName || "";
  }
  return node;
}

function sortSourceChildren(node = {}) {
  node.children = (node.children || [])
    .map((child) => {
      if (child.kind === "folder") {
        sortSourceChildren(child);
      }
      return child;
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }
      if (Number.isFinite(left.sortRank) && Number.isFinite(right.sortRank) && left.sortRank !== right.sortRank) {
        return left.sortRank - right.sortRank;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    });
  return applySourceFolderLastModifiedFromChildren(node);
}

function addSourceFile(parent, name, selection, options = {}) {
  const path = options.path || `${parent.path}/${name}`;
  const file = createSourceTreeNode(name, path, "file", {
    selection,
    label: options.label || "",
    metaText: options.metaText || "",
    secondary: options.secondary || "",
    autoRetrieve: options.autoRetrieve !== false,
    contentKind: options.contentKind || "",
    sourceOrigin: options.sourceOrigin || "",
    localUid: options.localUid || "",
    lastModifiedDate: options.lastModifiedDate || "",
    lastModifiedByName: options.lastModifiedByName || "",
    searchValues: options.searchValues || []
  });
  parent.children.push(file);
  return file;
}

function addPackageManifestExplorerNode(root) {
  if (!root) {
    return null;
  }

  let manifestFolder = findSourceTreeNodeByPath(root, MANIFEST_FOLDER_SOURCE_PATH);
  if (!manifestFolder) {
    manifestFolder = addSourceFolder(root, "manifest", {
      path: MANIFEST_FOLDER_SOURCE_PATH,
      alwaysOpen: true,
      keepEmpty: true,
      searchValues: ["manifest", "package.xml", "Package XML"]
    });
  } else {
    manifestFolder.alwaysOpen = true;
    manifestFolder.keepEmpty = true;
    manifestFolder.searchValues.push("manifest", "package.xml", "Package XML");
  }

  const existingPackageXml = findSourceTreeNodeByPath(root, PACKAGE_XML_SOURCE_PATH);
  const packageXmlSelection = {
    type: "packageCreate",
    sourcePath: PACKAGE_XML_SOURCE_PATH,
    previewXml: true
  };
  if (existingPackageXml) {
    existingPackageXml.selection = packageXmlSelection;
    existingPackageXml.metaText = "manifest";
    existingPackageXml.secondary = "Package XML";
    existingPackageXml.contentKind = "xml";
    existingPackageXml.sourceOrigin = "virtual";
    existingPackageXml.searchValues.push("manifest", "package.xml", "Package XML");
    return existingPackageXml;
  }

  return addSourceFile(manifestFolder, "package.xml", packageXmlSelection, {
    path: PACKAGE_XML_SOURCE_PATH,
    metaText: "manifest",
    secondary: "Package XML",
    autoRetrieve: false,
    contentKind: "xml",
    sourceOrigin: "virtual",
    searchValues: ["manifest", "package.xml", "Package XML"]
  });
}

function isManifestFolderPath(sourcePath = "") {
  return normalizeMyOrgResultPath(sourcePath) === MANIFEST_FOLDER_SOURCE_PATH;
}

function isManifestSourcePath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  return path === MANIFEST_FOLDER_SOURCE_PATH || path.startsWith(`${MANIFEST_FOLDER_SOURCE_PATH}/`);
}

function isManifestLocalFilePath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  const entry = localSourceEntries.get(path);
  return Boolean(
    path.startsWith(`${MANIFEST_FOLDER_SOURCE_PATH}/`)
    && path !== PACKAGE_XML_SOURCE_PATH
    && entry?.kind === "file"
    && entry.sourceOrigin === MANIFEST_LOCAL_SOURCE_ORIGIN
  );
}

function getManifestLocalFileEntry(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  return isManifestLocalFilePath(path) ? localSourceEntries.get(path) : null;
}

function createManifestLocalUid() {
  if (globalThis.crypto?.randomUUID) {
    return `manifest:${globalThis.crypto.randomUUID()}`;
  }
  return `manifest:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function normalizeManifestFileName(name = "", fallback = "manifest.xml") {
  const cleanName = toSourceFileSegment(String(name || fallback).replace(/\.xml$/i, ""), "manifest");
  const fileName = `${cleanName || "manifest"}.xml`;
  return fileName.toLocaleLowerCase() === "package.xml" ? "manifest.xml" : fileName;
}

function getUniqueManifestFilePath(fileName = "manifest.xml", currentPath = "") {
  const normalizedCurrentPath = normalizeMyOrgResultPath(currentPath);
  const baseName = normalizeManifestFileName(fileName);
  const stem = baseName.replace(/\.xml$/i, "");
  let candidateName = baseName;
  let index = 1;
  while (
    candidateName.toLocaleLowerCase() === "package.xml"
    || (
      localSourceEntries.has(`${MANIFEST_FOLDER_SOURCE_PATH}/${candidateName}`)
      && `${MANIFEST_FOLDER_SOURCE_PATH}/${candidateName}` !== normalizedCurrentPath
    )
  ) {
    index += 1;
    candidateName = `${stem}-${index}.xml`;
  }
  return `${MANIFEST_FOLDER_SOURCE_PATH}/${candidateName}`;
}

function createBlankManifestContent() {
  return createPackageXmlManifest([]);
}

function createManifestFileFromContext() {
  if (isMetadataFolderReadOnly) {
    setStatus(t("schemaStatus.readOnly"), true);
    return;
  }
  const path = getUniqueManifestFilePath("manifest.xml");
  const now = new Date().toISOString();
  createLocalSourceEntry(path, "file", createBlankManifestContent(), {
    typeLabel: "Manifest",
    label: "Custom Manifest",
    fileName: getSourceBaseName(path),
    metadataType: "manifest",
    contentKind: "xml",
    sourceOrigin: MANIFEST_LOCAL_SOURCE_ORIGIN,
    localUid: createManifestLocalUid(),
    autoRetrieve: false,
    createdAt: now,
    lastModifiedDate: now
  });
  savePersistedManifestLocalFiles();
  openSourcePathAncestors(path);
  if (activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  } else {
    renderSchema({ renderDetail: false });
  }
  setSelectedSourceNodeFromPath({ type: "localFile", sourcePath: path }, path, {
    ...(activeSidebarTab === "package" ? { target: schemaPackageTreeEl } : { revealInExplorer: true })
  });
  setStatus(t("schemaStatus.createdPath", { path: path }));
  setSchemaSummary(t("schemaStatus.createdBlankManifest", { fileName: getSourceBaseName(path) }));
}

function renameManifestLocalFile(sourcePath = "", nextName = "") {
  if (isMetadataFolderReadOnly) {
    setStatus(t("schemaStatus.readOnly"), true);
    return false;
  }
  const oldPath = normalizeMyOrgResultPath(sourcePath);
  const entry = getManifestLocalFileEntry(oldPath);
  if (!entry) {
    setStatus(t("schemaStatus.renameCustomOnly"), true);
    return false;
  }

  const newPath = getUniqueManifestFilePath(nextName || entry.name || getSourceBaseName(oldPath), oldPath);
  if (!newPath || newPath === oldPath) {
    return false;
  }

  const currentFile = selectedNode?.sourcePath === oldPath
    ? getEditableFileForSourcePath(oldPath)
    : null;
  const currentEditor = currentFile?.querySelector?.(".schema-editable-code-editor");
  const content = typeof currentEditor?.value === "string" ? currentEditor.value : entry.content || "";
  localSourceEntries.delete(oldPath);
  clearChangedFileRecordsForSourcePath(oldPath);
  localSourceEntries.set(newPath, {
    ...entry,
    path: newPath,
    name: getSourceBaseName(newPath),
    parentPath: MANIFEST_FOLDER_SOURCE_PATH,
    content,
    fileName: getSourceBaseName(newPath),
    localUid: entry.localUid || createManifestLocalUid(),
    lastModifiedDate: new Date().toISOString()
  });
  searchDetailEntryCache.delete(oldPath);
  invalidateExplorerSourceTreeCache();
  savePersistedManifestLocalFiles();
  if (selectedNode?.sourcePath === oldPath) {
    selectedNode = {
      ...selectedNode,
      sourcePath: newPath
    };
  }
  openSourcePathAncestors(newPath);
  if (activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  } else {
    renderSchema({ renderDetail: false });
  }
  setSelectedSourceNodeFromPath({ type: "localFile", sourcePath: newPath }, newPath, {
    ...(activeSidebarTab === "package" ? { target: schemaPackageTreeEl } : { revealInExplorer: true })
  });
  setStatus(t("schemaStatus.renamedManifest", { fileName: getSourceBaseName(newPath) }));
  return true;
}

function deleteManifestLocalFile(sourcePath = "") {
  if (isMetadataFolderReadOnly) {
    setStatus(t("schemaStatus.readOnly"), true);
    return false;
  }
  const path = normalizeMyOrgResultPath(sourcePath);
  const entry = getManifestLocalFileEntry(path);
  if (!entry) {
    setStatus(t("schemaStatus.deleteCustomOnly"), true);
    return false;
  }
  if (!window.confirm(`Delete ${getSourceBaseName(path)}?`)) {
    return false;
  }
  localSourceEntries.delete(path);
  searchDetailEntryCache.delete(path);
  clearChangedFileRecordsForSourcePath(path);
  invalidateExplorerSourceTreeCache();
  savePersistedManifestLocalFiles();
  if (selectedNode?.sourcePath === path) {
    selectedNode = null;
    renderEmptyDetail("Manifest file deleted.");
  }
  if (activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  } else {
    renderSchema({ renderDetail: false });
  }
  setStatus(t("schemaStatus.deletedPath", { path: path }));
  return true;
}

function hasSourcePath(node = {}, sourcePath = "") {
  if (node.path === sourcePath) {
    return true;
  }

  if (node.lazyChildrenFactory && !node.lazyChildrenLoaded) {
    if (!sourcePath.startsWith(`${node.path}/`)) {
      return false;
    }
    ensureSourceTreeLazyChildren(node);
  }

  return (node.children || []).some((child) => hasSourcePath(child, sourcePath));
}

function openSourcePathAncestors(sourcePath = "") {
  const pathParts = normalizeMyOrgResultPath(sourcePath).split("/").filter(Boolean);
  if (!pathParts.length) {
    return false;
  }

  let currentPath = "";
  pathParts.forEach((part) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folderKey = `source:${currentPath}`;
    closedSourceFolderKeys.delete(folderKey);
    openObjectKeys.add(folderKey);
  });
  return true;
}

function clearExplorerFileFilterIfPathIsHidden(sourcePath = "") {
  if (!schemaFileFilterTerm) {
    return false;
  }
  if (schemaFileFilterInput && String(schemaFileFilterInput.value || "").trim() === schemaFileFilterTerm) {
    return false;
  }

  const visibleSourceRoot = getExplorerSourceTree();
  if (hasSourcePath(visibleSourceRoot || {}, sourcePath)) {
    return false;
  }

  schemaFileFilterTerm = "";
  if (schemaFileFilterInput) {
    schemaFileFilterInput.value = "";
  }
  return true;
}

function normalizeDetailSourcePath(path = "") {
  const sourcePath = normalizeMyOrgResultPath(path);
  if (!sourcePath) {
    return "";
  }

  if (isDefaultSourcePath(sourcePath) || isLegacySourceRootPath(sourcePath)) {
    return normalizeSourcePath(sourcePath);
  }

  const firstSegment = sourcePath.split("/").filter(Boolean)[0] || "";
  if (firstSegment && getSourceDefaultFolders().includes(firstSegment)) {
    return toDefaultSourcePath(sourcePath);
  }

  return normalizeSourcePath(sourcePath);
}

function getCurrentDetailSourcePath() {
  const changedRecord = selectedChangedFileKey ? changedDetailFiles.get(selectedChangedFileKey) : null;
  const changedSourcePath = normalizeDetailSourcePath(changedRecord?.sourcePath || changedRecord?.fileName || "");
  if (changedSourcePath && (activeSidebarTab === "changed" || schemaDetailEl?.querySelector(".schema-changed-detail-panel"))) {
    return changedSourcePath;
  }

  const selectedSourcePath = normalizeDetailSourcePath(selectedNode?.sourcePath || "");
  if (selectedSourcePath) {
    return selectedSourcePath;
  }

  if (changedSourcePath) {
    return changedSourcePath;
  }

  const detailSourceElement = schemaDetailEl?.querySelector(
    "[data-source-path], .schema-editable-file[data-file-name], .schema-json-file[data-file-name], .schema-source-file[data-file-name]"
  );
  return normalizeDetailSourcePath(
    detailSourceElement?.dataset.sourcePath || detailSourceElement?.dataset.fileName || ""
  );
}

function syncSelectedNodeToSourcePath(sourcePath = "") {
  const selectedSourcePath = normalizeDetailSourcePath(selectedNode?.sourcePath || "");
  if (selectedSourcePath === sourcePath) {
    return true;
  }

  const selection = findSourceSelectionByPath(sourcePath);
  if (!selection) {
    return false;
  }

  selectedNode = selection;
  return true;
}

function revealSourcePathInExplorer(sourcePath = "", options = {}) {
  const normalizedSourcePath = normalizeDetailSourcePath(sourcePath);
  if (!normalizedSourcePath) {
    return false;
  }

  if (options.clearFilterIfHidden === false) {
    preserveExplorerFileFilterOnNextReveal = true;
  } else {
    clearExplorerFileFilterIfPathIsHidden(normalizedSourcePath);
  }
  openSourcePathAncestors(normalizedSourcePath);
  syncSelectedNodeToSourcePath(normalizedSourcePath);
  if (options.switchTab === true && activeSidebarTab !== "explorer") {
    setSidebarTab("explorer");
    return true;
  }

  if (activeSidebarTab === "explorer") {
    renderSchema({
      renderDetail: options.renderDetail !== false,
      scrollSelectedIntoView: true
    });
  } else {
    updateSelectedRows();
  }
  return true;
}

function revealSelectedSourcePathInExplorer() {
  const sourcePath = getCurrentDetailSourcePath();
  if (!sourcePath) {
    return false;
  }

  const preserveFileFilter = preserveExplorerFileFilterOnNextReveal === true;
  preserveExplorerFileFilterOnNextReveal = false;
  let visibleSourceRoot = getExplorerSourceTree();
  let isVisible = hasSourcePath(visibleSourceRoot || {}, sourcePath);
  if (!preserveFileFilter) {
    clearExplorerFileFilterIfPathIsHidden(sourcePath);
  }
  if (!isVisible && !schemaFileFilterTerm) {
    visibleSourceRoot = getExplorerSourceTree();
    isVisible = hasSourcePath(visibleSourceRoot || {}, sourcePath);
  }
  if (!isVisible) {
    return false;
  }

  syncSelectedNodeToSourcePath(sourcePath);
  return openSourcePathAncestors(sourcePath);
}

function scrollSelectedExplorerRowIntoView() {
  if (!schemaTreeEl) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (activeSidebarTab !== "explorer") {
      return;
    }

    const selectedRow = schemaTreeEl.querySelector(".schema-tree-row.selected");
    if (selectedRow) {
      selectedRow.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
      return;
    }

    // Selected row is outside the rendered viewport — compute its position from the row list
    const selectedIndex = lastRenderedTreeRows.findIndex(
      (row) => row.selection && isSelected(row.selection)
    );
    if (selectedIndex >= 0) {
      const targetTop = selectedIndex * SOURCE_TREE_VIRTUAL_ROW_HEIGHT;
      const halfViewport = schemaTreeEl.clientHeight / 2;
      schemaTreeEl.scrollTop = Math.max(0, targetTop - halfViewport);
      scheduleSourceTreeVirtualRenderers();
    }
  });
}

function collectSourceNodePathMap(node = {}, pathMap = new Map()) {
  const path = normalizeSourcePath(node.path || "");
  if (path) {
    pathMap.set(path, node);
  }
  (node.children || []).forEach((child) => collectSourceNodePathMap(child, pathMap));
  return pathMap;
}

function addSourceFileByPath(parent, sourcePath, selection, options = {}) {
  if (!sourcePath.startsWith(`${parent.path}/`) || hasSourcePath(parent, sourcePath)) {
    return;
  }

  const pathParts = sourcePath.slice(parent.path.length + 1).split("/").filter(Boolean);
  if (!pathParts.length) {
    return;
  }

  let currentFolder = parent;
  pathParts.slice(0, -1).forEach((folderName) => {
    currentFolder = addSourceFolder(currentFolder, folderName, {
      path: `${currentFolder.path}/${folderName}`
    });
  });

  addSourceFile(
    currentFolder,
    pathParts[pathParts.length - 1],
    getSourceSelection(selection, sourcePath),
    {
      ...options,
      path: sourcePath,
      searchValues: [...(options.searchValues || []), sourcePath]
    }
  );
}

function getSourceFolderForMetadataType(metadataType) {
  const metadataTypeDefinition = getAvailableMetadataType(metadataType) || { id: metadataType };
  return getSourceFolderForMetadataDefinition(metadataTypeDefinition);
}

function getMetadataSourceFileNames(group = {}, item = {}) {
  const name = toSourceFileSegment(item.apiName || item.key || item.id, "metadata");
  const metadataApiConfig = getMetadataApiSourceConfig(group);
  if (metadataApiConfig && group.kind === "metadata") {
    const { folder, suffix } = metadataApiConfig;
    const fileName = String(item.record?.fileName || "");
    if (fileName) {
      const relativeFileName = stripSourceFolderPrefix(fileName, folder);
      return [suffix && relativeFileName.endsWith(`.${suffix}`) ? `${relativeFileName}-meta.xml` : relativeFileName];
    }

    const relativeName = String(item.apiName || item.key || item.id)
      .split("/")
      .map((segment) => toSourceFileSegment(segment, "metadata"))
      .join("/");
    return [suffix ? `${relativeName}.${suffix}-meta.xml` : `${relativeName}.xml`];
  }

  const sourceMap = {
    apexClasses: [`${name}.cls`, `${name}.cls-meta.xml`],
    apexPages: [`${name}.page`, `${name}.page-meta.xml`],
    apexTriggers: [`${name}.trigger`, `${name}.trigger-meta.xml`],
    apexComponents: [`${name}.component`, `${name}.component-meta.xml`],
    flows: [`${name}.flow-meta.xml`],
    staticResources: [`${name}.resource`, `${name}.resource-meta.xml`]
  };
  return sourceMap[group.id] || [getMetadataExplorerDisplay(group, item).primary];
}

function createSelectionDataset(row, selection = {}) {
  selection = selection || {};
  row.dataset.type = selection.type || "";
  row.dataset.metadataType = selection.metadataType || "";
  row.dataset.objectKey = selection.objectKey || "";
  row.dataset.fieldKey = selection.fieldKey || "";
  row.dataset.itemKey = selection.itemKey || "";
  row.dataset.sourcePath = selection.sourcePath || "";
}

function getSourceSelection(baseSelection, sourcePath) {
  return {
    ...baseSelection,
    sourcePath
  };
}

const OBJECT_CHILD_SOURCE_METADATA_CONFIGS = [
  {
    metadataTypeIds: ["customFields", "CustomField"],
    metadataApiType: "CustomField",
    folder: "fields",
    suffix: "field-meta.xml",
    metaText: "field"
  },
  {
    metadataTypeIds: ["recordTypes", "RecordType"],
    metadataApiType: "RecordType",
    folder: "recordTypes",
    suffix: "recordType-meta.xml",
    metaText: "recordType"
  },
  {
    metadataTypeIds: ["fieldSets", "FieldSet"],
    metadataApiType: "FieldSet",
    folder: "fieldSets",
    suffix: "fieldSet-meta.xml",
    metaText: "fieldSet"
  },
  {
    metadataTypeIds: ["validationRules", "ValidationRule"],
    metadataApiType: "ValidationRule",
    folder: "validationRules",
    suffix: "validationRule-meta.xml",
    metaText: "validationRule"
  },
  {
    metadataTypeIds: ["listViews", "ListView"],
    metadataApiType: "ListView",
    folder: "listViews",
    suffix: "listView-meta.xml",
    metaText: "listView"
  },
  {
    metadataTypeIds: ["compactLayouts", "CompactLayout"],
    metadataApiType: "CompactLayout",
    folder: "compactLayouts",
    suffix: "compactLayout-meta.xml",
    metaText: "compactLayout"
  },
  {
    metadataTypeIds: ["businessProcesses", "BusinessProcess"],
    metadataApiType: "BusinessProcess",
    folder: "businessProcesses",
    suffix: "businessProcess-meta.xml",
    metaText: "businessProcess"
  },
  {
    metadataTypeIds: ["webLinks", "WebLink"],
    metadataApiType: "WebLink",
    folder: "webLinks",
    suffix: "webLink-meta.xml",
    metaText: "webLink"
  }
];

function getObjectChildMetadataGroupConfig(group = {}) {
  return OBJECT_CHILD_SOURCE_METADATA_CONFIGS.find((config) => {
    const metadataTypeIds = new Set(config.metadataTypeIds || []);
    return metadataTypeIds.has(group.id)
      || group.metadataObject === config.metadataApiType
      || group.metadataApiType === config.metadataApiType;
  }) || null;
}

function isObjectChildMetadataGroup(group = {}) {
  return Boolean(getObjectChildMetadataGroupConfig(group));
}

function splitObjectChildMetadataFullName(value = "") {
  const apiName = splitSchemaKey(value).apiName || String(value || "");
  const splitIndex = apiName.lastIndexOf(".");
  if (splitIndex <= 0) {
    return {
      objectApiName: "",
      childApiName: apiName
    };
  }

  return {
    objectApiName: apiName.slice(0, splitIndex),
    childApiName: apiName.slice(splitIndex + 1)
  };
}

function getObjectChildItemFullName(item = {}) {
  return getFirstNonEmptyString(
    item.apiName,
    item.fullName,
    item.record?.fullName,
    item.record?.FullName,
    item.record?.DeveloperName,
    item.key,
    item.id
  );
}

function getObjectChildSourceIndexKey(objectApiName = "") {
  return String(objectApiName || "").trim().toLocaleLowerCase();
}

function addObjectChildSourceIndexItem(index, objectApiName = "", config = {}, group = {}, item = {}) {
  const objectKey = getObjectChildSourceIndexKey(objectApiName);
  if (!objectKey || !config.folder) {
    return;
  }

  if (!index.has(objectKey)) {
    index.set(objectKey, new Map());
  }
  const folderMap = index.get(objectKey);
  if (!folderMap.has(config.folder)) {
    folderMap.set(config.folder, {
      config,
      group,
      items: []
    });
  }
  folderMap.get(config.folder).items.push(item);
}

function createObjectChildSourceIndex(visibleGroups = []) {
  const index = new Map();
  visibleGroups.forEach((visibleGroup) => {
    const { group } = visibleGroup;
    const config = getObjectChildMetadataGroupConfig(group);
    if (!config) {
      return;
    }

    (visibleGroup.items || []).forEach((item) => {
      const childParts = splitObjectChildMetadataFullName(getObjectChildItemFullName(item));
      if (!childParts.objectApiName || !childParts.childApiName) {
        return;
      }
      addObjectChildSourceIndexItem(index, childParts.objectApiName, config, group, item);
    });
  });
  return index;
}

function getObjectChildSourceFolderEntries(objectChildIndex, objectApiName = "") {
  return objectChildIndex?.get?.(getObjectChildSourceIndexKey(objectApiName)) || new Map();
}

function getObjectSourceChildFolderLabel(config = {}) {
  return ({
    fields: "Fields",
    fieldSets: "Field Sets",
    recordTypes: "Record Types",
    validationRules: "Validation Rules",
    listViews: "List Views",
    compactLayouts: "Compact Layouts",
    businessProcesses: "Business Processes",
    webLinks: "Web Links"
  })[config.folder] || config.folder || "";
}

function getObjectChildFolderInfoFromSourcePath(sourcePath = "") {
  const relativePath = getCanonicalMetadataRelativePath(sourcePath);
  const match = relativePath.match(/^objects\/([^/]+)\/([^/]+)$/i);
  if (!match) {
    return null;
  }

  const folderName = match[2] || "";
  const config = OBJECT_CHILD_SOURCE_METADATA_CONFIGS.find((candidate) => (
    candidate.folder.toLocaleLowerCase() === folderName.toLocaleLowerCase()
  ));
  if (!config) {
    return null;
  }

  return {
    objectApiName: match[1] || "",
    folderName,
    config
  };
}

function getObjectKeyForApiName(objectApiName = "", label = "") {
  const normalizedApiName = String(objectApiName || "").trim().toLocaleLowerCase();
  if (!normalizedApiName) {
    return "";
  }

  const objectMap = schemaStore?.map && typeof schemaStore.map === "object" ? schemaStore.map : {};
  const existingMapKey = Object.keys(objectMap).find((objectKey) => (
    getObjectApiName(objectKey).toLocaleLowerCase() === normalizedApiName
  ));
  if (existingMapKey) {
    return existingMapKey;
  }

  const objectItems = schemaStore?.metadata?.objects?.items;
  const existingMetadataKey = objectItems && typeof objectItems === "object" && !Array.isArray(objectItems)
    ? Object.keys(objectItems).find((objectKey) => (
      getObjectApiName(objectKey).toLocaleLowerCase() === normalizedApiName
    ))
    : "";
  if (existingMetadataKey) {
    return existingMetadataKey;
  }

  return `${objectApiName}: ${label || objectApiName}`;
}

function createRuntimeFieldSchemaKey(field = {}) {
  const apiName = field.name || field.fullName || field.apiName || "";
  if (!apiName) {
    return "";
  }
  return `${apiName}: ${field.label || field.inlineHelpText || apiName}`;
}

function getFieldKeysFromObjectDescribe(describe = {}) {
  return (Array.isArray(describe?.fields) ? describe.fields : [])
    .map((field) => createRuntimeFieldSchemaKey(field))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function mergeObjectFieldKeysIntoSchemaStore(objectKey = "", fieldKeys = []) {
  if (!objectKey || !fieldKeys.length) {
    return false;
  }

  const existingMap = schemaStore?.map && typeof schemaStore.map === "object" ? schemaStore.map : {};
  const existingKeys = getFieldKeys(existingMap[objectKey]);
  if (existingKeys.length && setContainsAllValues(existingKeys, fieldKeys)) {
    return false;
  }

  const nextFieldKeys = [...new Set([...existingKeys, ...fieldKeys])]
    .sort((left, right) => left.localeCompare(right));
  const nextMap = {
    ...existingMap,
    [objectKey]: nextFieldKeys
  };
  const metadata = {
    ...(schemaStore?.metadata || {})
  };
  const objectGroup = metadata.objects || {
    id: "objects",
    label: "Objects",
    itemLabel: "Object",
    kind: "objects",
    items: {}
  };
  const objectItems = objectGroup.items && typeof objectGroup.items === "object" && !Array.isArray(objectGroup.items)
    ? { ...objectGroup.items }
    : {};
  objectItems[objectKey] = nextFieldKeys;
  metadata.objects = {
    ...objectGroup,
    count: Object.keys(objectItems).length,
    childCount: Object.values(objectItems).reduce((total, fieldMap) => total + getFieldKeys(fieldMap).length, 0),
    items: objectItems
  };

  const nextStore = {
    ...(schemaStore || {}),
    map: nextMap,
    metadata,
    metadataTypes: [...new Set([...(schemaStore?.metadataTypes || []), "objects"])],
    objectCount: Object.keys(nextMap).length,
    fieldCount: Object.values(nextMap).reduce((total, fieldMap) => total + getFieldKeys(fieldMap).length, 0)
  };
  nextStore.metadataItemCount = getStoreMetadataItemCount(nextStore);
  schemaStore = nextStore;
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
  clearCompactMetadataSourceTreeCache();
  return true;
}

function normalizeObjectMetadataChildEntries(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getObjectMetadataChildEntryName(entry = {}) {
  if (!entry || typeof entry !== "object") {
    return String(entry || "").trim();
  }
  return getFirstNonEmptyString(
    entry.fullName,
    entry.FullName,
    entry.name,
    entry.Name,
    entry.developerName,
    entry.DeveloperName,
    entry.label,
    entry.masterLabel,
    entry.MasterLabel
  );
}

function getObjectMetadataChildEntryLabel(entry = {}, fallbackName = "") {
  if (!entry || typeof entry !== "object") {
    return fallbackName || String(entry || "").trim();
  }
  return getFirstNonEmptyString(
    entry.label,
    entry.masterLabel,
    entry.MasterLabel,
    entry.fullName,
    entry.name,
    fallbackName
  );
}

function createObjectChildMetadataItemFromEntry(objectApiName = "", config = {}, entry = {}) {
  const rawChildApiName = String(getObjectMetadataChildEntryName(entry) || "").trim();
  const childApiName = rawChildApiName.startsWith(`${objectApiName}.`)
    ? rawChildApiName.slice(objectApiName.length + 1)
    : rawChildApiName;
  if (!objectApiName || !childApiName) {
    return null;
  }

  const fullName = rawChildApiName.includes(".") ? rawChildApiName : `${objectApiName}.${childApiName}`;
  const label = getObjectMetadataChildEntryLabel(entry, childApiName);
  const metadataType = config.metadataTypeIds?.[0] || "";
  const entryRecord = entry && typeof entry === "object" ? entry : { fullName: childApiName };
  const record = {
    ...entryRecord,
    fullName,
    FullName: fullName,
    fileName: `objects/${objectApiName}/${config.folder}/${childApiName}.${config.suffix}`,
    type: config.metadataApiType,
    metadataApiType: config.metadataApiType
  };

  return {
    key: `${fullName}: ${label}`,
    apiName: fullName,
    label,
    id: fullName,
    metadataType,
    metadataObject: config.metadataApiType,
    record
  };
}

function getRecordTypeChildEntriesFromDescribe(describe = {}) {
  return (Array.isArray(describe?.recordTypeInfos) ? describe.recordTypeInfos : [])
    .filter((recordType) => recordType && recordType.master !== true)
    .map((recordType) => ({
      fullName: recordType.developerName || recordType.name || "",
      label: recordType.name || recordType.developerName || "",
      DeveloperName: recordType.developerName || "",
      MasterLabel: recordType.name || "",
      Id: recordType.recordTypeId || ""
    }))
    .filter((recordType) => recordType.fullName);
}

function getObjectChildMetadataGroupForConfig(config = {}) {
  const metadataTypeId = config.metadataTypeIds?.[0] || "";
  const metadataType = getAvailableMetadataType(metadataTypeId) || {};
  return {
    id: metadataTypeId,
    label: metadataType.label || getObjectSourceChildFolderLabel(config),
    itemLabel: metadataType.itemLabel || config.metaText || config.metadataApiType || "Metadata",
    kind: "metadata",
    metadataObject: config.metadataApiType,
    metadataApiType: config.metadataApiType,
    directoryName: metadataType.directoryName || "objects",
    sourceFolder: metadataType.sourceFolder || "objects",
    suffix: metadataType.suffix || config.suffix || "",
    items: []
  };
}

function mergeObjectChildMetadataItemsIntoSchemaStore(config = {}, items = []) {
  const metadataTypeId = config.metadataTypeIds?.[0] || "";
  const nextItems = items.filter(Boolean);
  if (!metadataTypeId || !nextItems.length) {
    return false;
  }

  const metadata = {
    ...(schemaStore?.metadata || {})
  };
  const currentGroup = metadata[metadataTypeId] || getObjectChildMetadataGroupForConfig(config);
  const itemByKey = new Map(getGroupItems(currentGroup).map((item) => [item.key, item]));
  nextItems.forEach((item) => {
    if (item?.key && !itemByKey.has(item.key)) {
      itemByKey.set(item.key, item);
    }
  });
  if (itemByKey.size === getGroupItems(currentGroup).length) {
    return false;
  }

  const mergedItems = [...itemByKey.values()]
    .sort((left, right) => String(left.key || "").localeCompare(String(right.key || "")));
  metadata[metadataTypeId] = {
    ...currentGroup,
    count: mergedItems.length,
    items: mergedItems
  };

  const nextStore = {
    ...(schemaStore || {}),
    metadata,
    metadataTypes: [...new Set([...(schemaStore?.metadataTypes || []), metadataTypeId])]
  };
  nextStore.metadataItemCount = getStoreMetadataItemCount(nextStore);
  schemaStore = nextStore;
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
  clearCompactMetadataSourceTreeCache();
  return true;
}

async function loadObjectMetadataDetailForChildFolders(objectApiName = "") {
  if (!objectApiName || !session?.host || !session?.sid) {
    return null;
  }
  if (objectMetadataDetailCache.has(objectApiName)) {
    return objectMetadataDetailCache.get(objectApiName);
  }

  const detail = await getMetadataItemDetail(session.host, session.sid, "objects", objectApiName, {
    apiVersion: schemaStore?.apiVersion,
    record: {
      fullName: objectApiName,
      metadataApiType: "CustomObject"
    }
  });
  objectMetadataDetailCache.set(objectApiName, detail);
  return detail;
}

async function ensureObjectChildSourceFolderLoaded(folderNode = {}, sourcePath = "") {
  if (!session?.host || !session?.sid || !folderNode) {
    return false;
  }

  const folderInfo = getObjectChildFolderInfoFromSourcePath(sourcePath || folderNode.path || "");
  if (!folderInfo?.objectApiName || !folderInfo.config) {
    return false;
  }
  if ((folderNode.children || []).length && folderInfo.config.folder !== "fields") {
    return false;
  }

  if (folderInfo.config.folder === "fields") {
    const describe = await loadObjectDescribe(folderInfo.objectApiName);
    const objectKey = getObjectKeyForApiName(folderInfo.objectApiName, describe?.label || "");
    const fieldKeys = getFieldKeysFromObjectDescribe(describe);
    let metadataChanged = false;
    try {
      const detail = await loadObjectMetadataDetailForChildFolders(folderInfo.objectApiName);
      const childItems = normalizeObjectMetadataChildEntries(detail?.metadata?.fields)
        .map((entry) => createObjectChildMetadataItemFromEntry(folderInfo.objectApiName, folderInfo.config, entry))
        .filter(Boolean);
      metadataChanged = mergeObjectChildMetadataItemsIntoSchemaStore(folderInfo.config, childItems);
    } catch (_error) {
      // Field metadata details are supplemental; keep describe-backed standard fields visible.
    }
    const changed = mergeObjectFieldKeysIntoSchemaStore(objectKey, fieldKeys);
    if (!changed && !metadataChanged && fieldKeys.length) {
      clearCompactMetadataSourceTreeCache();
      return true;
    }
    return changed || metadataChanged;
  }

  let childEntries = [];
  try {
    const detail = await loadObjectMetadataDetailForChildFolders(folderInfo.objectApiName);
    childEntries = normalizeObjectMetadataChildEntries(detail?.metadata?.[folderInfo.config.folder]);
  } catch (error) {
    if (folderInfo.config.folder !== "recordTypes") {
      throw error;
    }
  }
  if (!childEntries.length && folderInfo.config.folder === "recordTypes") {
    const describe = await loadObjectDescribe(folderInfo.objectApiName);
    childEntries = getRecordTypeChildEntriesFromDescribe(describe);
  }
  const childItems = childEntries
    .map((entry) => createObjectChildMetadataItemFromEntry(folderInfo.objectApiName, folderInfo.config, entry))
    .filter(Boolean);
  const changed = mergeObjectChildMetadataItemsIntoSchemaStore(folderInfo.config, childItems);
  if (!changed && childItems.length) {
    clearCompactMetadataSourceTreeCache();
    return true;
  }
  return changed;
}

function getObjectFieldChildNameKey(value = "") {
  return String(value || "").trim().toLocaleLowerCase();
}

function getObjectFieldKeyChildApiName(fieldKey = "") {
  return splitSchemaKey(fieldKey).apiName || String(fieldKey || "");
}

function getObjectChildItemChildApiName(item = {}) {
  return splitObjectChildMetadataFullName(getObjectChildItemFullName(item)).childApiName || "";
}

function getObjectFieldSourceItemCount(fieldKeys = [], indexedFolder = {}) {
  const childNames = new Set();
  fieldKeys.forEach((fieldKey) => {
    const childName = getObjectFieldKeyChildApiName(fieldKey);
    if (childName) {
      childNames.add(getObjectFieldChildNameKey(childName));
    }
  });
  (indexedFolder?.items || []).forEach((item) => {
    const childName = getObjectChildItemChildApiName(item);
    if (childName) {
      childNames.add(getObjectFieldChildNameKey(childName));
    }
  });
  return childNames.size;
}

function addObjectFieldSourceNode(fieldsFolder, objectKey = "", fieldKey = "") {
  const fieldParts = splitSchemaKey(fieldKey);
  const fieldApiName = fieldParts.apiName || fieldKey;
  if (!fieldApiName) {
    return;
  }

  const fileName = `${toSourceFileSegment(fieldApiName, "Field")}.field-meta.xml`;
  const sourcePath = `${fieldsFolder.path}/${fileName}`;
  addSourceFile(
    fieldsFolder,
    fileName,
    {
      type: "field",
      metadataType: "objects",
      objectKey,
      fieldKey,
      sourcePath
    },
    {
      path: sourcePath,
      label: fieldParts.label || "",
      metaText: "field",
      searchValues: [objectKey, fieldKey, fieldApiName, fieldParts.label, fileName]
    }
  );
}

function addObjectChildMetadataSourceNode(childFolder, config = {}, group = {}, item = {}) {
  const childParts = splitObjectChildMetadataFullName(getObjectChildItemFullName(item));
  if (!childParts.childApiName) {
    return;
  }

  const fileName = `${toSourceFileSegment(childParts.childApiName, config.metaText || "metadata")}.${config.suffix}`;
  const sourcePath = `${childFolder.path}/${fileName}`;
  const metadataType = group.id || config.metadataTypeIds?.[0] || "";
  const modifiedOptions = getMetadataItemModifiedOptions(item);
  addSourceFile(
    childFolder,
    fileName,
    {
      type: "metadataItem",
      metadataType,
      objectKey: childParts.objectApiName || "",
      fieldKey: config.folder === "fields" ? childParts.childApiName : "",
      itemKey: item.key,
      sourcePath,
      ...modifiedOptions
    },
    {
      path: sourcePath,
      label: item.label || "",
      metaText: group.itemLabel || config.metaText || "metadata",
      ...modifiedOptions,
      searchValues: [group.label, group.id, item.key, item.apiName, item.label, fileName]
    }
  );
}

function populateObjectFieldSourceFolderChildren(fieldsFolder, objectKey = "", fieldKeys = []) {
  if (!fieldsFolder || fieldsFolder.kind !== "folder") {
    return;
  }

  fieldKeys
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .forEach((fieldKey) => addObjectFieldSourceNode(fieldsFolder, objectKey, fieldKey));
}

function populateObjectMetadataSourceFolderChildren(childFolder, config = {}, group = {}, items = []) {
  if (!childFolder || childFolder.kind !== "folder") {
    return;
  }

  items
    .slice()
    .sort((left, right) => String(left.key || left.apiName || "").localeCompare(String(right.key || right.apiName || "")))
    .forEach((item) => addObjectChildMetadataSourceNode(childFolder, config, group, item));
}

function populateObjectFieldSourceFolderChildrenFromIndexedMetadata(
  fieldsFolder,
  objectKey = "",
  fieldKeys = [],
  indexedFolder = {}
) {
  const indexedItems = Array.isArray(indexedFolder?.items) ? indexedFolder.items : [];
  if (!indexedItems.length) {
    populateObjectFieldSourceFolderChildren(fieldsFolder, objectKey, fieldKeys);
    return;
  }

  populateObjectMetadataSourceFolderChildren(
    fieldsFolder,
    indexedFolder.config || OBJECT_CHILD_SOURCE_METADATA_CONFIGS[0],
    indexedFolder.group || {},
    indexedItems
  );
  const indexedFieldNames = new Set(
    indexedItems
      .map((item) => getObjectFieldChildNameKey(getObjectChildItemChildApiName(item)))
      .filter(Boolean)
  );
  const fallbackFieldKeys = fieldKeys.filter((fieldKey) => (
    !indexedFieldNames.has(getObjectFieldChildNameKey(getObjectFieldKeyChildApiName(fieldKey)))
  ));
  populateObjectFieldSourceFolderChildren(fieldsFolder, objectKey, fallbackFieldKeys);
}

function getObjectSourceFileCount(fieldKeys = [], objectChildIndex = new Map(), objectApiName = "") {
  const indexedFolders = getObjectChildSourceFolderEntries(objectChildIndex, objectApiName);
  let count = getObjectFieldSourceItemCount(fieldKeys, indexedFolders.get("fields"));
  indexedFolders.forEach((entry, folderName) => {
    if (folderName !== "fields") {
      count += Array.isArray(entry.items) ? entry.items.length : 0;
    }
  });
  return count;
}

function populateObjectSourceNodeChildren(objectNode, objectKey = "", fieldKeys = [], objectChildIndex = new Map()) {
  if (!objectNode || objectNode.kind !== "folder") {
    return;
  }

  const objectApiName = splitSchemaKey(objectKey).apiName || objectKey;
  const indexedFolders = getObjectChildSourceFolderEntries(objectChildIndex, objectApiName);
  OBJECT_CHILD_SOURCE_METADATA_CONFIGS.forEach((config) => {
    const indexedFolder = indexedFolders.get(config.folder);
    const childItemCount = config.folder === "fields"
      ? getObjectFieldSourceItemCount(fieldKeys, indexedFolder)
      : (Array.isArray(indexedFolder?.items) ? indexedFolder.items.length : 0);
    const childFolder = addSourceFolder(objectNode, config.folder, {
      path: `${objectNode.path}/${config.folder}`,
      keepEmpty: true,
      secondary: getObjectSourceChildFolderLabel(config),
      lazyChildrenFactory: (node) => {
        if (config.folder === "fields") {
          populateObjectFieldSourceFolderChildrenFromIndexedMetadata(node, objectKey, fieldKeys, indexedFolder);
          return;
        }
        populateObjectMetadataSourceFolderChildren(
          node,
          indexedFolder?.config || config,
          indexedFolder?.group || {},
          indexedFolder?.items || []
        );
      },
      lazyChildCount: childItemCount,
      sourceFileCount: childItemCount,
      searchValues: [objectKey, objectApiName, config.folder, config.metadataApiType, getObjectSourceChildFolderLabel(config)]
    });
    childFolder.keepEmpty = true;
  });
}

function addObjectSourceNode(objectsFolder, objectKey, options = {}) {
  const objectParts = splitSchemaKey(objectKey);
  const objectApiName = objectParts.apiName || objectKey;
  const objectName = `${toSourceFileSegment(objectApiName, "Object")}.object`;
  addSourceFolder(objectsFolder, objectName, {
    path: `${options.sourceParentPath || objectsFolder.path}/${objectName}`,
    label: objectParts.label || "",
    secondary: "Object",
    keepEmpty: true,
    selection: {
      type: "object",
      metadataType: "objects",
      objectKey,
      sourcePath: `${options.sourceParentPath || objectsFolder.path}/${objectName}`
    },
    lazyChildrenFactory: (node) => populateObjectSourceNodeChildren(
      node,
      objectKey,
      options.fieldKeys || [],
      options.objectChildIndex || new Map()
    ),
    lazyChildCount: OBJECT_CHILD_SOURCE_METADATA_CONFIGS.length,
    sourceFileCount: getObjectSourceFileCount(
      Array.isArray(options.fieldKeys) ? options.fieldKeys : [],
      options.objectChildIndex || new Map(),
      objectApiName
    ),
    searchValues: [objectKey, objectApiName, objectParts.label]
  });
}

function isCustomObjectSourceKey(objectKey = "") {
  const objectApiName = splitSchemaKey(objectKey).apiName || objectKey;
  return /__(?:b|c|e|mdt|x)$/i.test(objectApiName);
}

function getObjectSourceBucketKey(objectKey = "") {
  if (isCustomObjectSourceKey(objectKey)) {
    return "custom";
  }
  return "standard";
}

function getObjectSourceBucketDefinition(bucketKey = "") {
  if (bucketKey === "standard") {
    return {
      name: OBJECT_STANDARD_GROUP_NAME,
      secondary: "Standard objects",
      sortRank: 0,
      searchValues: ["objects", "standard objects", "standard object"]
    };
  }
  return {
    name: OBJECT_CUSTOM_GROUP_NAME,
    secondary: "Custom objects",
    sortRank: bucketKey === "custom" ? 1 : 99,
    searchValues: ["objects", "custom objects"]
  };
}

function getObjectSourceBucketFolder(objectsFolder, bucketFolders, bucketKey = "", options = {}) {
  if (!bucketFolders.has(bucketKey)) {
    const bucketDefinition = getObjectSourceBucketDefinition(bucketKey);
    bucketFolders.set(bucketKey, addSourceGroupFolder(objectsFolder, bucketDefinition.name, {
      secondary: bucketDefinition.secondary,
      contentKind: "objectBucket",
      keepEmpty: options.keepEmpty === true,
      sortRank: bucketDefinition.sortRank,
      searchValues: bucketDefinition.searchValues
    }));
  }
  return bucketFolders.get(bucketKey);
}

function getObjectSourceNamespacePrefix(objectKey = "", fieldKeys = []) {
  const objectApiName = splitSchemaKey(objectKey).apiName || objectKey;
  const objectNamespace = getNamespacedApiNamePrefix(objectApiName);
  if (objectNamespace) {
    return objectNamespace;
  }

  for (const fieldKey of fieldKeys) {
    const fieldNamespace = getNamespacedApiNamePrefix(splitSchemaKey(fieldKey).apiName || fieldKey);
    if (fieldNamespace) {
      return fieldNamespace;
    }
  }
  return "";
}

function getSourceGroupPath(parentFolder = {}, groupName = "") {
  return `${parentFolder.path || ""}/${toSourceFileSegment(groupName, "group")}`;
}

function addSourceGroupFolder(parentFolder, groupName = "", options = {}) {
  return addSourceFolder(parentFolder, groupName, {
    path: getSourceGroupPath(parentFolder, groupName),
    sourceOrigin: "virtual",
    keepEmpty: options.keepEmpty === true,
    contentKind: options.contentKind || "sourceGroup",
    secondary: options.secondary || "",
    sortRank: Number.isFinite(options.sortRank) ? options.sortRank : null,
    searchValues: options.searchValues || [groupName]
  });
}

function getBundleDefaultSourceFileNames(metadataType = "", name = "") {
  if (metadataType === "lwcBundles") {
    return [
      `${name}.html`,
      `${name}.js`,
      `${name}.css`,
      `${name}.js-meta.xml`
    ];
  }

  if (metadataType === "auraBundles") {
    return [
      `${name}.cmp`,
      `${name}Controller.js`,
      `${name}Helper.js`,
      `${name}.css`,
      `${name}.cmp-meta.xml`
    ];
  }

  return [];
}

function getBundleCachedSourceFileNames(group = {}, item = {}, bundlePath = "") {
  const cacheKey = getMetadataItemCacheKey(group.id, item);
  const detail = cacheKey ? getBoundedCacheValue(metadataDetailCache, cacheKey) : null;
  if (!detail) {
    return [];
  }

  const normalizedBundlePath = normalizeSourcePath(bundlePath);
  const prefix = `${normalizedBundlePath}/`;
  return createMetadataSourceFiles(group.id, detail, item)
    .map((file) => normalizeSourcePath(file.path || ""))
    .filter((sourcePath) => sourcePath.startsWith(prefix))
    .map((sourcePath) => sourcePath.slice(prefix.length))
    .filter(Boolean);
}

function getBundleSourceFileNames(group = {}, item = {}, name = "", bundlePath = "") {
  const cachedFileNames = getBundleCachedSourceFileNames(group, item, bundlePath);
  const fileNames = cachedFileNames.length
    ? cachedFileNames
    : getBundleDefaultSourceFileNames(group.id, name);
  return [...new Set(fileNames)]
    .sort((left, right) => {
      const leftIsMeta = /-meta\.xml$/i.test(left);
      const rightIsMeta = /-meta\.xml$/i.test(right);
      if (leftIsMeta !== rightIsMeta) {
        return leftIsMeta ? 1 : -1;
      }
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    });
}

function getMetadataItemModifiedOptions(item = {}) {
  const record = item.record || {};
  return {
    lastModifiedDate: getFirstNonEmptyString(
      item.lastModifiedDate,
      record.LastModifiedDate,
      record.lastModifiedDate
    ),
    lastModifiedByName: getFirstNonEmptyString(
      item.lastModifiedByName,
      getRecordLastModifiedByName(record)
    )
  };
}

function addMetadataSourceNode(folder, group, item, options = {}) {
  const name = toSourceFileSegment(item.apiName || item.key || item.id, "metadata");
  const sourceBasePath = options.sourceBasePath || folder.path;
  const modifiedOptions = getMetadataItemModifiedOptions(item);
  const itemSelection = {
    type: "metadataItem",
    metadataType: group.id,
    itemKey: item.key,
    ...modifiedOptions
  };

  if (group.id === "lwcBundles" || group.id === "auraBundles") {
    const bundlePath = `${sourceBasePath}/${name}`;
    const bundleFolder = addSourceFolder(folder, name, {
      path: bundlePath,
      label: item.label || "",
      secondary: group.itemLabel || group.label || "",
      selection: getSourceSelection(itemSelection, bundlePath),
      ...modifiedOptions,
      searchValues: [group.label, group.id, item.key, item.apiName, item.label, name]
    });
    getBundleSourceFileNames(group, item, name, bundleFolder.path).forEach((fileName) => {
      const sourcePath = `${bundleFolder.path}/${fileName}`;
      const fileOptions = {
        label: item.label || "",
        metaText: /-meta\.xml$/i.test(fileName) ? group.itemLabel || "metadata" : getSourceBaseName(fileName).split(".").pop() || group.itemLabel || "source",
        ...modifiedOptions,
        searchValues: [group.label, group.id, item.key, item.apiName, item.label, fileName]
      };
      if (fileName.includes("/")) {
        addSourceFileByPath(bundleFolder, sourcePath, itemSelection, fileOptions);
      } else {
        addSourceFile(
          bundleFolder,
          fileName,
          getSourceSelection(itemSelection, sourcePath),
          fileOptions
        );
      }
    });
    return;
  }

  getMetadataSourceFileNames(group, item).forEach((fileName) => {
    const sourcePath = `${sourceBasePath}/${fileName}`;
    const fileOptions = {
      label: item.label || "",
      metaText: group.itemLabel || "metadata",
      ...modifiedOptions,
      searchValues: [group.label, group.id, item.key, item.apiName, item.label, fileName]
    };
    if (fileName.includes("/")) {
      addSourceFileByPath(folder, sourcePath, itemSelection, fileOptions);
    } else {
      addSourceFile(
        folder,
        fileName,
        getSourceSelection(itemSelection, sourcePath),
        fileOptions
      );
    }
  });
}

function getSourceFolderForVisibleGroup(visibleGroup = {}) {
  return isObjectsGroup(visibleGroup.group)
    ? "objects"
    : getSourceFolderForMetadataType(visibleGroup.group?.id);
}

function getVisibleSourceFolderNames(visibleGroups = []) {
  return [...new Set(
    visibleGroups
      .map((visibleGroup) => getSourceFolderForVisibleGroup(visibleGroup))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function ensureSourceExplorerFolder(root, folders, folderName, options = {}) {
  if (!folderName) {
    return null;
  }

  const sourceParentPath = normalizeMyOrgResultPath(options.sourceParentPath || "");
  const folderOptions = {
    path: sourceParentPath ? `${sourceParentPath}/${folderName}` : `${SOURCE_DEFAULT_PREFIX}${folderName}`,
    keepEmpty: options.keepEmpty === true,
    contentKind: options.contentKind || "",
    secondary: getSourceFolderLabel(folderName),
    searchValues: options.searchValues || getSourceFolderSearchValues(folderName)
  };
  if (!folders.has(folderName)) {
    folders.set(folderName, addSourceFolder(root, folderName, folderOptions));
  } else if (options.contentKind || options.keepEmpty === true || options.searchValues) {
    addSourceFolder(root, folderName, folderOptions);
  }
  return folders.get(folderName);
}

function createSourceRootContainers(root, options = {}) {
  if (options.showDefaultSourceRoot !== true) {
    return {
      folderParent: root,
      namespaceParent: root
    };
  }

  const [projectSegment = "force-app", mainSegment = "main", defaultSegment = "default"] = SOURCE_DEFAULT_ROOT.split("/");
  const projectNode = addSourceFolder(root, projectSegment, {
    path: projectSegment,
    defaultOpen: true,
    keepEmpty: true,
    transparent: true,
    searchValues: [projectSegment]
  });
  const mainNode = addSourceFolder(projectNode, mainSegment, {
    path: `${projectSegment}/${mainSegment}`,
    defaultOpen: true,
    keepEmpty: true,
    transparent: true,
    searchValues: [mainSegment, `${projectSegment}/${mainSegment}`]
  });
  const defaultNode = addSourceFolder(mainNode, defaultSegment, {
    path: SOURCE_DEFAULT_ROOT,
    defaultOpen: true,
    keepEmpty: true,
    transparent: true,
    sortRank: SOURCE_DEFAULT_ROOT_SORT_RANK,
    searchValues: [defaultSegment, SOURCE_DEFAULT_ROOT]
  });
  return {
    folderParent: defaultNode,
    namespaceParent: mainNode
  };
}

function getInstalledPackageLabelForNamespace(namespacePrefix = "") {
  const namespaceName = String(namespacePrefix || "").trim();
  if (!namespaceName) {
    return "";
  }
  const installedPackage = availableInstalledPackages.find((record) => record.namespacePrefix === namespaceName)
    || schemaStore?.installedPackages?.find?.((record) => record.namespacePrefix === namespaceName)
    || schemaStore?.subscriberPackages?.find?.((record) => record.namespacePrefix === namespaceName);
  const packageName = String(installedPackage?.name || "").trim();
  return packageName && packageName !== namespaceName ? packageName : "";
}

function getNamespaceSourceRootFolder(namespaceParent, namespaceFolders, namespacePrefix = "", options = {}) {
  const namespaceName = String(namespacePrefix || "").trim();
  if (!namespaceName) {
    return null;
  }
  if (!namespaceFolders.has(namespaceName)) {
    const namespacePathSegment = toSourceFileSegment(namespaceName, "namespace");
    const packageLabel = getInstalledPackageLabelForNamespace(namespaceName);
    namespaceFolders.set(namespaceName, addSourceFolder(namespaceParent, namespaceName, {
      path: namespaceParent.path ? `${namespaceParent.path}/${namespacePathSegment}` : namespacePathSegment,
      sourceOrigin: "virtual",
      keepEmpty: options.keepEmpty === true,
      secondary: packageLabel,
      sortRank: SOURCE_NAMESPACE_ROOT_SORT_RANK,
      searchValues: [namespaceName, packageLabel, `${namespaceName} namespace`, "installed package"].filter(Boolean)
    }));
  }
  return namespaceFolders.get(namespaceName);
}

function createSourceExplorerTree(visibleGroups = [], options = {}) {
  const root = createSourceTreeNode("workspace", "", "root", { alwaysOpen: true });
  const { folderParent, namespaceParent } = createSourceRootContainers(root, options);
  const objectChildIndex = createObjectChildSourceIndex(visibleGroups);
  const defaultFolders = new Map();
  const namespaceFolders = new Map();
  const namespaceSourceFolderMaps = new Map();
  const includeEmptyDefaultFolders = options.includeEmptyDefaultFolders === true;
  const emptyDefaultFolderNames = Array.isArray(options.emptyDefaultFolderNames)
    ? options.emptyDefaultFolderNames
    : getSourceDefaultFolders();
  const defaultFolderNames = (includeEmptyDefaultFolders
    ? emptyDefaultFolderNames
    : getVisibleSourceFolderNames(visibleGroups));

  defaultFolderNames.forEach((folderName) => {
    ensureSourceExplorerFolder(folderParent, defaultFolders, folderName, {
      keepEmpty: includeEmptyDefaultFolders
    });
  });

  visibleGroups.forEach((visibleGroup) => {
    const { group } = visibleGroup;

    if (isObjectsGroup(group)) {
      const objectsFolder = ensureSourceExplorerFolder(folderParent, defaultFolders, OBJECT_SOURCE_FOLDER_NAME, {
        keepEmpty: includeEmptyDefaultFolders
      });
      if (!objectsFolder) {
        return;
      }
      const defaultObjectBucketFolders = new Map();
      if (includeEmptyDefaultFolders) {
        ["standard", "custom"].forEach((bucketKey) => {
          getObjectSourceBucketFolder(objectsFolder, defaultObjectBucketFolders, bucketKey, {
            keepEmpty: true
          });
        });
      }
      const namespaceObjectBucketFolders = new Map();
      visibleGroup.objectEntries.forEach(([objectKey, fieldKeys]) => {
        const namespacePrefix = getObjectSourceNamespacePrefix(objectKey, fieldKeys);
        let targetObjectsFolder = objectsFolder;
        let targetBucketFolders = defaultObjectBucketFolders;
        if (namespacePrefix) {
          const namespaceRoot = getNamespaceSourceRootFolder(namespaceParent, namespaceFolders, namespacePrefix, {
            keepEmpty: includeEmptyDefaultFolders
          });
          if (!namespaceRoot) {
            return;
          }
          let namespaceSourceFolders = namespaceSourceFolderMaps.get(namespacePrefix);
          if (!namespaceSourceFolders) {
            namespaceSourceFolders = new Map();
            namespaceSourceFolderMaps.set(namespacePrefix, namespaceSourceFolders);
          }
          targetObjectsFolder = ensureSourceExplorerFolder(namespaceRoot, namespaceSourceFolders, OBJECT_SOURCE_FOLDER_NAME, {
            keepEmpty: includeEmptyDefaultFolders,
            sourceParentPath: namespaceRoot.path
          });
          if (!targetObjectsFolder) {
            return;
          }
          if (!namespaceObjectBucketFolders.has(namespacePrefix)) {
            namespaceObjectBucketFolders.set(namespacePrefix, new Map());
            if (includeEmptyDefaultFolders) {
              ["standard", "custom"].forEach((bucketKey) => {
                getObjectSourceBucketFolder(targetObjectsFolder, namespaceObjectBucketFolders.get(namespacePrefix), bucketKey, {
                  keepEmpty: true
                });
              });
            }
          }
          targetBucketFolders = namespaceObjectBucketFolders.get(namespacePrefix);
        }
        const bucketKey = getObjectSourceBucketKey(objectKey);
        const bucketFolder = getObjectSourceBucketFolder(targetObjectsFolder, targetBucketFolders, bucketKey, {
          keepEmpty: includeEmptyDefaultFolders
        });
        if (!bucketFolder) {
          return;
        }
        addObjectSourceNode(bucketFolder, objectKey, {
          sourceParentPath: bucketFolder.path,
          fieldKeys,
          objectChildIndex
        });
      });
      return;
    }

    if (isObjectChildMetadataGroup(group)) {
      return;
    }

    const folderName = getSourceFolderForMetadataType(group.id);
    const folder = ensureSourceExplorerFolder(folderParent, defaultFolders, folderName);
    if (!folder) {
      return;
    }
    visibleGroup.items.forEach((item) => {
      const namespacePrefix = getMetadataItemNamespace(item);
      let targetFolder = folder;
      if (namespacePrefix) {
        const namespaceRoot = getNamespaceSourceRootFolder(namespaceParent, namespaceFolders, namespacePrefix, {
          keepEmpty: includeEmptyDefaultFolders
        });
        if (!namespaceRoot) {
          return;
        }
        let namespaceSourceFolders = namespaceSourceFolderMaps.get(namespacePrefix);
        if (!namespaceSourceFolders) {
          namespaceSourceFolders = new Map();
          namespaceSourceFolderMaps.set(namespacePrefix, namespaceSourceFolders);
        }
        targetFolder = ensureSourceExplorerFolder(namespaceRoot, namespaceSourceFolders, folderName, {
          keepEmpty: includeEmptyDefaultFolders,
          sourceParentPath: namespaceRoot.path
        });
      }
      if (!targetFolder) {
        return;
      }
      addMetadataSourceNode(targetFolder, group, item);
    });
  });

  if (options.includeLocalOverlay !== false) {
    applyLocalSourceOverlay(root, {
      includeEntry: options.includePackageManifest === false
        ? (entry) => !isManifestSourcePath(entry?.path)
        : null
    });
  }
  if (options.includeLocalOverlay !== false && options.includePackageManifest !== false) {
    addPackageManifestExplorerNode(root);
  }
  sortSourceChildren(root);
  return root;
}

function isDeletedSourcePath(path = "") {
  return deletedSourcePaths.has(path) || [...deletedSourcePaths].some((deletedPath) => path.startsWith(`${deletedPath}/`));
}

function pruneDeletedSourcePaths(node = {}) {
  node.children = (node.children || [])
    .filter((child) => !isDeletedSourcePath(child.path || ""))
    .map((child) => {
      if (child.kind === "folder") {
        pruneDeletedSourcePaths(child);
      }
      return child;
    });
}

function findSourceTreeNodeByPath(node = {}, path = "") {
  if (node.path === path) {
    return node;
  }

  if (node.lazyChildrenFactory && !node.lazyChildrenLoaded) {
    if (!path.startsWith(`${node.path}/`)) {
      return null;
    }
    ensureSourceTreeLazyChildren(node);
  }

  for (const child of (node.children || [])) {
    const found = findSourceTreeNodeByPath(child, path);
    if (found) {
      return found;
    }
  }

  return null;
}

function getParentSourcePath(path = "") {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function getSourceBaseName(path = "") {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

function ensureLocalSourceFolder(root, folderPath = "") {
  const normalizedPath = normalizeSourcePath(folderPath);
  if (isLegacySourceRootPath(normalizedPath)) {
    return findSourceTreeNodeByPath(root, normalizedPath) || root;
  }
  const usesDefaultSourcePath = isDefaultSourcePath(normalizedPath);
  const parts = (usesDefaultSourcePath ? stripDefaultSourcePrefix(normalizedPath) : normalizedPath)
    .split("/")
    .filter(Boolean);
  let currentPath = usesDefaultSourcePath ? SOURCE_DEFAULT_ROOT : "";
  let currentNode = usesDefaultSourcePath
    ? findSourceTreeNodeByPath(root, SOURCE_DEFAULT_ROOT) || root
    : root;
  parts.forEach((part) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    let nextNode = findSourceTreeNodeByPath(currentNode, currentPath);
    if (!nextNode) {
      nextNode = addSourceFolder(currentNode, part, {
        path: currentPath,
        defaultOpen: true,
        searchValues: [currentPath, part]
      });
    }
    currentNode = nextNode;
  });
  return currentNode;
}

function ensureLocalSourceFolderWithPathMap(root, folderPath = "", pathMap = new Map()) {
  const normalizedPath = normalizeSourcePath(folderPath);
  if (isLegacySourceRootPath(normalizedPath)) {
    return pathMap.get(normalizedPath) || findSourceTreeNodeByPath(root, normalizedPath) || root;
  }
  const usesDefaultSourcePath = isDefaultSourcePath(normalizedPath);
  const parts = (usesDefaultSourcePath ? stripDefaultSourcePrefix(normalizedPath) : normalizedPath)
    .split("/")
    .filter(Boolean);
  let currentPath = usesDefaultSourcePath ? SOURCE_DEFAULT_ROOT : "";
  let currentNode = usesDefaultSourcePath
    ? pathMap.get(SOURCE_DEFAULT_ROOT) || findSourceTreeNodeByPath(root, SOURCE_DEFAULT_ROOT) || root
    : root;
  parts.forEach((part) => {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const normalizedCurrentPath = normalizeSourcePath(currentPath);
    let nextNode = pathMap.get(normalizedCurrentPath);
    if (!nextNode) {
      nextNode = addSourceFolder(currentNode, part, {
        path: currentPath,
        defaultOpen: true,
        searchValues: [currentPath, part]
      });
      pathMap.set(normalizedCurrentPath, nextNode);
    }
    currentNode = nextNode;
  });
  return currentNode;
}

function applyLocalSourceOverlay(root, options = {}) {
  pruneDeletedSourcePaths(root);
  const pathMap = collectSourceNodePathMap(root);
  const includeEntry = typeof options.includeEntry === "function" ? options.includeEntry : null;
  Array.from(localSourceEntries.values())
    .sort((left, right) => (left.path || "").localeCompare(right.path || ""))
    .forEach((entry) => {
      if (!entry.path || isDeletedSourcePath(entry.path) || isRetiredMyFoldersPath(entry.path)) {
        return;
      }
      if (includeEntry && !includeEntry(entry)) {
        return;
      }
      if (isLegacySourceRootPath(entry.path)) {
        return;
      }
      const normalizedEntryPath = normalizeSourcePath(entry.path);
      const parent = ensureLocalSourceFolderWithPathMap(root, entry.parentPath || getParentSourcePath(entry.path), pathMap);
      if (entry.kind === "folder") {
        const folder = addSourceFolder(parent, entry.name || getSourceBaseName(entry.path), {
          path: entry.path,
          label: entry.label || "",
          alwaysOpen: entry.autoOpen === true,
          autoRetrieve: entry.autoRetrieve !== false,
          contentKind: entry.contentKind || "",
          sourceOrigin: entry.sourceOrigin || "",
          localUid: entry.localUid || "",
          lastModifiedDate: entry.lastModifiedDate || "",
          lastModifiedByName: entry.lastModifiedByName || "",
          searchValues: [entry.path, entry.name, entry.label, entry.fileName, entry.localUid].filter(Boolean)
        });
        pathMap.set(normalizedEntryPath, folder);
        return;
      }
      if (pathMap.has(normalizedEntryPath)) {
        return;
      }
      const file = addSourceFile(
        parent,
        entry.name || getSourceBaseName(entry.path),
        {
          type: "localFile",
          sourcePath: entry.path
        },
        {
          path: entry.path,
          label: entry.label || "",
          metaText: entry.typeLabel || "local",
          autoRetrieve: entry.autoRetrieve !== false,
          contentKind: entry.contentKind || "",
          sourceOrigin: entry.sourceOrigin || "",
          localUid: entry.localUid || "",
          lastModifiedDate: entry.lastModifiedDate || "",
          lastModifiedByName: entry.lastModifiedByName || "",
          searchValues: [entry.path, entry.name, entry.label, entry.fileName, entry.localUid].filter(Boolean)
        }
      );
      pathMap.set(normalizedEntryPath, file);
    });
  sortSourceChildren(root);
}

function getBoundedCacheValue(cache, key) {
  if (!cache.has(key)) {
    return undefined;
  }

  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setBoundedCacheValue(cache, key, value, limit) {
  if (!key) {
    return;
  }

  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function clearSearchDetailCaches() {
  searchDetailEntryCache.clear();
}

function resetMetadataWorkspaceCacheState() {
  selectedNode = null;
  pendingDetailLineFocus = null;
  clearSourceNavigationHistory();
  detailRequestId += 1;
  activeFileFilterSearchRequestId += 1;
  activeSearchTerm = "";
  activeSearchIncludeAllNamespaces = false;
  activeSearchInstalledPackageNamespaces = [];
  activeSourceFolderPath = "";
  availableMetadataTypes = getSchemaMetadataTypes();
  availableInstalledPackages = [];
  if (explorerFilterInput) {
    explorerFilterInput.value = "";
  }
  if (schemaFileFilterInput) {
    schemaFileFilterInput.value = "";
  }
  if (schemaFolderSearchInput) {
    schemaFolderSearchInput.value = "";
  }
  schemaFileFilterTerm = "";
  schemaFolderSearchTerm = "";
  describeCache.clear();
  metadataDetailCache.clear();
  toolingSourceDetailCache.clear();
  clearSearchDetailCaches();
  folderRetrieveInProgress.clear();
  folderNamespaceScopeByPath.clear();
  openObjectKeys.clear();
  closedSourceFolderKeys.clear();
  selectedPackageMembers.clear();
  packageSelectionTreeDirty = true;
  editedDetailFileContents.clear();
  detailFileBaselineContents.clear();
  changedDetailFiles.clear();
  selectedChangedFileKeys.clear();
  selectedChangedFileKey = "";
  localSourceEntries.clear();
  restorePersistedManifestLocalFiles();
  myOrgSearchLocalPaths.clear();
  myOrgBranchTreeLocalPaths.clear();
  deletedSourcePaths.clear();
  clearSourceTreeVirtualRenderers();
  invalidateFolderSearchCache();
}

function releaseRuntimeMemory() {
  describeCache.clear();
  metadataDetailCache.clear();
  toolingSourceDetailCache.clear();
  clearSearchDetailCaches();
  folderRetrieveInProgress.clear();
  folderNamespaceScopeByPath.clear();
  clearSourceTreeVirtualRenderers();
  schemaSearchResultsTreeEl?.replaceChildren();
  packageSelectionTreeDirty = true;
}

function getNamespacedApiNamePrefix(value = "") {
  const match = String(value || "").match(/^([A-Za-z][A-Za-z0-9_]*?)__.+__/);
  return match ? match[1] : "";
}

function getMetadataRecordNamespace(record = {}) {
  return String(record.NamespacePrefix || record.namespacePrefix || "").trim()
    || getNamespacedApiNamePrefix(record.name)
    || getNamespacedApiNamePrefix(record.apiName)
    || getNamespacedApiNamePrefix(record.DeveloperName)
    || getNamespacedApiNamePrefix(record.Name)
    || getNamespacedApiNamePrefix(record.fullName)
    || getNamespacedApiNamePrefix(record.FullName)
    || getNamespacedApiNamePrefix(record.fileName);
}

function getMetadataItemNamespace(item = {}) {
  return getMetadataRecordNamespace(item.record || {})
    || getNamespacedApiNamePrefix(item.apiName)
    || getNamespacedApiNamePrefix(item.key)
    || getNamespacedApiNamePrefix(item.id);
}

function getSelectionNamespace(selection = {}) {
  if (selection.type === "metadataItem") {
    return getMetadataItemNamespace(findMetadataItem(selection.metadataType, selection.itemKey));
  }

  if (selection.type === "object") {
    return getNamespacedApiNamePrefix(getObjectApiName(selection.objectKey));
  }

  if (selection.type === "field") {
    return getNamespacedApiNamePrefix(getObjectApiName(selection.objectKey))
      || getNamespacedApiNamePrefix(splitSchemaKey(selection.fieldKey).apiName);
  }

  return getNamespacedApiNamePrefix(selection.sourcePath);
}

function createRetrieveNamespaceScope(options = getSelectedRetrieveNamespaceOptions()) {
  return {
    includeInstalledPackages: options.includeInstalledPackages === true,
    namespaceSet: new Set(getValidInstalledPackageNamespaces(options.installedPackageNamespaces || []))
  };
}

function isNamespaceIncludedInRetrieveScope(namespacePrefix = "", scope = createRetrieveNamespaceScope()) {
  const namespace = String(namespacePrefix || "").trim();
  if (!namespace) {
    return true;
  }

  return scope.includeInstalledPackages === true || scope.namespaceSet.has(namespace);
}

function isObjectIncludedInRetrieveScope(objectKey = "", scope = createRetrieveNamespaceScope()) {
  return isNamespaceIncludedInRetrieveScope(
    getNamespacedApiNamePrefix(getObjectApiName(objectKey)),
    scope
  );
}

function isFieldIncludedInRetrieveScope(objectKey = "", fieldKey = "", scope = createRetrieveNamespaceScope()) {
  return isNamespaceIncludedInRetrieveScope(
    getNamespacedApiNamePrefix(getObjectApiName(objectKey))
      || getNamespacedApiNamePrefix(splitSchemaKey(fieldKey).apiName),
    scope
  );
}

function isMetadataItemIncludedInRetrieveScope(item = {}, scope = createRetrieveNamespaceScope()) {
  return isNamespaceIncludedInRetrieveScope(getMetadataItemNamespace(item), scope);
}

function isNamespaceIncludedInActiveSearch(namespacePrefix = "") {
  const namespace = String(namespacePrefix || "").trim();
  return !namespace
    || activeSearchIncludeAllNamespaces
    || getActiveSearchInstalledPackageNamespaceSet().has(namespace)
    || getOrgNamespacePrefixes().has(namespace);
}

function sourceNodeMatchesSearchInstalledPackages(node = {}) {
  if (!hasActiveSearch()) {
    return true;
  }

  return isNamespaceIncludedInActiveSearch(getSelectionNamespace(node.selection || {}));
}

function getExplorerSearchStatus(term = activeSearchTerm) {
  const searchTerm = String(term || "").trim();
  if (!searchTerm) {
    return "Search cleared.";
  }

  const selectedCount = getSelectedSearchFolderNames().length;
  const totalCount = getSearchFolderCandidates().length;
  const scope = selectedCount === totalCount
    ? "all search folders"
    : `${selectedCount} selected metadata ${selectedCount === 1 ? "folder" : "folders"}`;
  const packageScope = getSearchNamespaceScopeLabel(activeSearchInstalledPackageNamespaces, activeSearchIncludeAllNamespaces)
    ? ` plus ${getSearchNamespaceScopeLabel(activeSearchInstalledPackageNamespaces, activeSearchIncludeAllNamespaces)}`
    : "";
  return `Search filter: "${searchTerm}" in folder names and file names for ${scope}${packageScope}.`;
}

function getSearchMetadataTypeLabel(metadataTypeId = "") {
  const metadataType = getAvailableMetadataType(metadataTypeId);
  return metadataType?.label || metadataTypeId || "metadata";
}

function appendSearchEntry(entries, label, value, options = {}) {
  if (value === null || typeof value === "undefined" || value === "") {
    return;
  }

  const text = String(value);
  const lineNumber = Number(options.lineNumber || 0);
  const columnNumber = Number(options.columnNumber || 0);
  const key = [
    options.sourcePath || "",
    Number.isFinite(lineNumber) ? lineNumber : 0,
    Number.isFinite(columnNumber) ? columnNumber : 0,
    text.trim().toLocaleLowerCase()
  ].join("|");
  if (entries.some((entry) => entry.key === key)) {
    return;
  }

  entries.push({
    key,
    label,
    value: text,
    sourcePath: options.sourcePath || "",
    lineNumber: Number.isFinite(lineNumber) ? lineNumber : 0,
    columnNumber: Number.isFinite(columnNumber) ? columnNumber : 0,
    searchTerm: options.searchTerm || "",
    matchCount: Number(options.matchCount || 0) || undefined,
    hideSnippet: options.hideSnippet === true
  });
}

function appendFlattenedSearchEntries(entries, label, value, seen = new WeakSet()) {
  if (value === null || typeof value === "undefined" || value === "") {
    return;
  }

  if (typeof value !== "object") {
    appendSearchEntry(entries, label, value);
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFlattenedSearchEntries(entries, `${label}[${index}]`, item, seen));
    return;
  }

  Object.entries(value).forEach(([key, item]) => {
    appendFlattenedSearchEntries(entries, label ? `${label}.${key}` : key, item, seen);
  });
}

function getCachedDetailSearchEntries(node = {}) {
  if (node.kind !== "file" || !sourceNodeMatchesSearchMetadataTypes(node)) {
    return [];
  }

  const selection = node.selection || {};
  const sourcePath = node.path || selection.sourcePath || "";
  return [...(getBoundedCacheValue(searchDetailEntryCache, sourcePath) || [])];
}

function getNodeSearchEntries(node = {}) {
  const entries = [];
  if (node.kind !== "file") {
    return entries;
  }

  appendSearchEntry(entries, "Name", node.name);
  appendSearchEntry(entries, "Path", getSourceBaseName(node.path || ""));
  appendSearchEntry(entries, "Description", node.secondary);
  (node.searchValues || [])
    .filter((value) => !isFolderOnlyPathSearchMatch(value))
    .forEach((value) => appendSearchEntry(entries, "Search tag", value));
  entries.push(...getCachedDetailSearchEntries(node));
  return entries;
}

function sourceNodeMatchesFilters(node = {}) {
  if (!hasActiveSearch()) {
    return true;
  }

  if (!sourceNodeMatchesSearchMetadataTypes(node)) {
    return false;
  }

  if (!sourceNodeMatchesSearchInstalledPackages(node)) {
    return false;
  }

  return matchesSchemaFilters(...getNodeSearchEntries(node).map((entry) => entry.value));
}

function sourceNodeHasVisibleMatch(node = {}) {
  if (sourceNodeMatchesFilters(node)) {
    return true;
  }

  return (node.children || []).some((child) => sourceNodeHasVisibleMatch(child));
}

function filterSourceTree(node, searchActive, isRoot = false) {
  const children = node.children
    .map((child) => filterSourceTree(child, searchActive))
    .filter(Boolean);
  const matches = sourceNodeMatchesFilters(node);

  if (!searchActive || isRoot || matches || children.length) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function hideEmptySourceFolders(node = {}, isRoot = false) {
  const children = (node.children || [])
    .map((child) => hideEmptySourceFolders(child))
    .filter(Boolean);

  if (isRoot || node.kind === "file" || node.keepEmpty || node.lazyChildrenFactory || children.length) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function excludeManifestSourceTreePaths(node = {}, isRoot = false) {
  if (!isRoot && isManifestSourcePath(node.path || node.selection?.sourcePath || "")) {
    return null;
  }

  return {
    ...node,
    children: (node.children || [])
      .map((child) => excludeManifestSourceTreePaths(child))
      .filter(Boolean)
  };
}

function countSearchMatchesForTerm(value = "", term = activeSearchTerm) {
  const terms = getSearchTerms(term);
  if (!terms.length) {
    return 0;
  }

  const text = String(value || "").toLocaleLowerCase();
  return terms.reduce((total, needle) => {
    let count = 0;
    let index = text.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(needle, index + needle.length);
    }
    return total + count;
  }, 0);
}

function normalizeSearchResultSnippetText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createFolderTreeSearchSnippet(value = "", needle = "", maxLength = 140) {
  const text = normalizeSearchResultSnippetText(value);
  if (!text) {
    return String(needle || "").trim();
  }

  const maxSnippetLength = Math.max(20, Number(maxLength) || 140);
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = String(needle || "").toLocaleLowerCase();
  const matchIndex = lowerNeedle ? lowerText.indexOf(lowerNeedle) : -1;
  if (text.length <= maxSnippetLength) {
    return text;
  }
  if (matchIndex < 0) {
    return `${text.slice(0, maxSnippetLength).trim()}...`;
  }

  const contextLength = Math.max(0, maxSnippetLength - lowerNeedle.length);
  const beforeLength = Math.floor(contextLength * 0.45);
  const afterLength = contextLength - beforeLength;
  const start = Math.max(0, matchIndex - beforeLength);
  const end = Math.min(text.length, matchIndex + lowerNeedle.length + afterLength);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

function createSearchMatchText(entry = {}, term = activeSearchTerm) {
  const value = normalizeSearchResultSnippetText(entry.value);
  const terms = getSearchTerms(term);
  const lowerValue = value.toLocaleLowerCase();
  const needle = terms.find((searchTerm) => lowerValue.includes(searchTerm)) || "";
  const matchIndex = needle ? lowerValue.indexOf(needle) : -1;
  const snippet = createFolderTreeSearchSnippet(value, matchIndex >= 0 ? needle : "", 140);

  const label = String(entry.label || "").trim();
  if (!label) {
    return snippet;
  }
  return snippet.toLocaleLowerCase().startsWith(`${label.toLocaleLowerCase()}:`)
    ? snippet
    : `${label}: ${snippet}`;
}

function getFolderSearchMatchTerm(entry = {}, fallbackTerm = schemaFolderSearchTerm) {
  const searchTerm = String(fallbackTerm || "");
  const entrySearchTerm = String(entry.searchTerm || "");
  const entrySearchTermLower = entrySearchTerm.toLocaleLowerCase();
  const searchTerms = getSearchTerms(searchTerm);
  const entryValueText = [
    entry.label,
    entry.value
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join("\n")
    .toLocaleLowerCase();

  if (entrySearchTerm && entryValueText.includes(entrySearchTermLower)) {
    return entrySearchTerm;
  }

  const entryText = [
    entryValueText,
    entry.searchTerm
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join("\n")
    .toLocaleLowerCase();
  const matchedInputTerm = searchTerms.find((term) => entryText.includes(term)) || "";

  if (!matchedInputTerm) {
    return "";
  }

  if (
    entrySearchTerm
    && (entrySearchTermLower.includes(matchedInputTerm) || matchedInputTerm.includes(entrySearchTermLower))
  ) {
    return entrySearchTerm;
  }

  return matchedInputTerm;
}

function getActiveSourceTreeSearchMatchTerm() {
  if (activeSidebarTab === "search" && schemaFolderSearchTerm) {
    return schemaFolderSearchTerm;
  }
  return "";
}

function getFolderSearchLineMatchesFromNode(node = {}) {
  const activeMatchTerm = getActiveSourceTreeSearchMatchTerm();
  if (!activeMatchTerm || node.kind !== "file") {
    return [];
  }

  const sourcePath = node.path || node.selection?.sourcePath || "";
  if (!sourcePath) {
    return [];
  }

  const seen = new Set();
  const matches = [];
  const renderLimit = SEARCH_RENDERED_MATCH_ROWS_PER_FILE;
  for (const entry of (searchDetailEntryCache.get(sourcePath) || [])) {
    const searchTerm = getFolderSearchMatchTerm(entry, activeMatchTerm);
    const match = {
      count: Number(entry.matchCount || 0) || countSearchMatchesForTerm(entry.value, searchTerm),
      label: entry.label,
      text: entry.hideSnippet ? "" : createSearchMatchText(entry, searchTerm),
      sourcePath: entry.sourcePath || sourcePath,
      lineNumber: entry.lineNumber || 0,
      columnNumber: entry.columnNumber || 0,
      searchTerm
    };
    if (!match.searchTerm || (!match.lineNumber && !match.text) || match.count <= 0) {
      continue;
    }

    const key = [
      match.sourcePath,
      match.lineNumber,
      String(match.text || "").trim().toLocaleLowerCase()
    ].join("|");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push(match);
    if (matches.length >= renderLimit) {
      break;
    }
  }
  return matches;
}

function createSearchResultMatchRow(result, match, level = 1) {
  const row = document.createElement("div");
  row.className = "schema-search-match-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.dataset.sourcePath = match.sourcePath || result.path || "";
  row.dataset.sourceKind = "file";
  row.title = match.text || "";
  const selection = getSourceFileClickSelection(result.selection, match.sourcePath || result.path || "");
  if (selection) {
    createSelectionDataset(row, selection);
  }
  setTreeIndent(row, level);
  const openMatch = () => {
    if (!selection) {
      return;
    }

    pendingDetailLineFocus = match.lineNumber
      ? {
        sourcePath: match.sourcePath || result.path || "",
        lineNumber: match.lineNumber
      }
      : null;
    setSelectedSourceNodeFromPath(selection, match.sourcePath || result.path || "", {
      revealInExplorer: true,
      clearFilterIfHidden: false
    });
  };
  row.addEventListener("click", openMatch);
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openMatch();
  });
  const spacer = document.createElement("span");
  spacer.className = "schema-tree-indent";
  row.appendChild(spacer);

  const line = document.createElement("span");
  line.className = "schema-tree-match-line";
  if (match.lineNumber) {
    line.textContent = match.columnNumber
      ? `[${match.lineNumber}:${match.columnNumber}]`
      : `[${match.lineNumber}]`;
    line.title = match.columnNumber
      ? `Line ${match.lineNumber}, column ${match.columnNumber}`
      : `Line ${match.lineNumber}`;
  } else {
    line.setAttribute("aria-hidden", "true");
  }
  row.appendChild(line);

  const snippet = document.createElement("span");
  snippet.className = "schema-search-match-snippet";
  const highlightTerm = match.searchTerm || schemaFolderSearchTerm || activeSearchTerm;
  withSearchHighlightTerm(highlightTerm, () => {
    appendHighlightedExplorerText(snippet, match.text, {
      maxMatches: SEARCH_MATCH_HIGHLIGHT_LIMIT_PER_ROW
    });
  });
  row.appendChild(snippet);

  if (match.count > 1) {
    const count = document.createElement("span");
    count.className = "schema-tree-meta";
    count.textContent = String(match.count);
    row.appendChild(count);
  }

  return row;
}

function countSourceSelections(node = {}) {
  const children = Array.isArray(node.children) ? node.children : [];
  const current = node.selection ? 1 : 0;
  if (node.lazyChildrenFactory && !node.lazyChildrenLoaded && Number.isFinite(node.sourceFileCount)) {
    return current + node.sourceFileCount;
  }
  return current + children.reduce((total, child) => total + countSourceSelections(child), 0);
}

function getTextByteSize(value = "") {
  const text = String(value || "");
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

function formatSourceSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  if (bytes <= 0) {
    return "0K";
  }

  const units = ["K", "M", "G"];
  let value = Math.max(1, bytes / 1024);
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0
    ? Math.round(value)
    : Math.round(value * 100) / 100;
  return `${rounded}${units[unitIndex]}`;
}

function formatSourceFolderMeta(count, bytes) {
  const countText = Number.isFinite(count) && count > 0 ? String(count) : "0";
  const sizeText = formatSourceSize(bytes);
  return sizeText === "-" ? countText : `${countText}(${sizeText})`;
}

function formatSourceFileMeta(type = "", bytes) {
  const sizeText = formatSourceSize(bytes);
  if (type) {
    return sizeText === "-" ? type : `${type}(${sizeText})`;
  }
  return sizeText === "-" ? "" : `file(${sizeText})`;
}

function getKnownSourceFileContent(node = {}) {
  const path = node.path || "";
  const localEntry = localSourceEntries.get(path);
  if (localEntry?.kind === "file" && typeof localEntry.content !== "undefined" && localEntry.content !== "") {
    return localEntry.content;
  }

  return null;
}

function getKnownSourceFileSize(node = {}) {
  const content = getKnownSourceFileContent(node);
  if (typeof content === "string") {
    return getTextByteSize(content);
  }

  const fallbackText = [
    node.path || "",
    node.name || "",
    node.metaText || "",
    node.secondary || ""
  ].filter(Boolean).join("\n");
  return fallbackText ? getTextByteSize(fallbackText) : null;
}

function getSourceTreeFileCount(node = {}) {
  if (sourceTreeFileCountCache.has(node)) {
    return sourceTreeFileCountCache.get(node);
  }
  if (node.lazyChildrenFactory && !node.lazyChildrenLoaded && Number.isFinite(node.sourceFileCount)) {
    sourceTreeFileCountCache.set(node, node.sourceFileCount);
    return node.sourceFileCount;
  }
  if (node.kind === "file") {
    sourceTreeFileCountCache.set(node, 1);
    return 1;
  }
  const count = (node.children || []).reduce((total, child) => total + getSourceTreeFileCount(child), 0);
  sourceTreeFileCountCache.set(node, count);
  return count;
}

function getSourceTreeKnownSize(node = {}) {
  if (sourceTreeKnownSizeCache.has(node)) {
    return sourceTreeKnownSizeCache.get(node);
  }
  if (node.kind === "file") {
    const fileSize = getKnownSourceFileSize(node);
    sourceTreeKnownSizeCache.set(node, fileSize);
    return fileSize;
  }

  let total = 0;
  let hasKnownSize = false;
  (node.children || []).forEach((child) => {
    const childSize = getSourceTreeKnownSize(child);
    if (Number.isFinite(childSize)) {
      total += childSize;
      hasKnownSize = true;
    }
  });
  const knownSize = hasKnownSize ? total : null;
  sourceTreeKnownSizeCache.set(node, knownSize);
  return knownSize;
}

function createSourceTreeMeta(parts = [], title = "") {
  const meta = document.createElement("span");
  meta.className = "schema-tree-meta schema-tree-size-meta";
  meta.textContent = parts.filter((part) => part !== null && typeof part !== "undefined" && part !== "").join("");
  if (title) {
    meta.title = title;
  }
  return meta;
}

function isForceAppSourcePath(path = "") {
  return isDefaultSourcePath(path);
}

function getFirstSourceSelection(node = {}) {
  if (node.selection) {
    return getSourceClickSelection(node.selection, node.path);
  }

  if (node.kind === "folder" && node.path) {
    return {
      type: "sourceFolder",
      sourcePath: node.path
    };
  }

  for (const child of (Array.isArray(node.children) ? node.children : [])) {
    const selection = getFirstSourceSelection(child);
    if (selection) {
      return selection;
    }
  }

  return null;
}

function clearSourceTreeVirtualRenderer(target) {
  if (!target) {
    return;
  }
  const state = sourceTreeVirtualRendererStates.get(target);
  if (state?.renderRange) {
    sourceTreeVirtualRenderers.delete(state.renderRange);
  }
  sourceTreeVirtualRendererStates.delete(target);
  target.removeAttribute("aria-activedescendant");
  target.removeAttribute("aria-rowcount");
}

function clearSourceTreeVirtualRenderers() {
  clearSourceTreeVirtualRenderer(schemaTreeEl);
  clearSourceTreeVirtualRenderer(schemaSearchResultsTreeEl);
  clearSourceTreeVirtualRenderer(schemaPackageTreeEl);
  sourceTreeVirtualRenderers.clear();
  if (sourceTreeVirtualRenderFrame) {
    window.cancelAnimationFrame(sourceTreeVirtualRenderFrame);
    sourceTreeVirtualRenderFrame = 0;
  }
}

function clearSourceTreeRenderCaches() {
  sourceTreeFileCountCache = new WeakMap();
  sourceTreeKnownSizeCache = new WeakMap();
}

function scheduleSourceTreeVirtualRenderers() {
  if (sourceTreeVirtualRenderFrame) {
    return;
  }

  sourceTreeVirtualRenderFrame = window.requestAnimationFrame(() => {
    sourceTreeVirtualRenderFrame = 0;
    sourceTreeVirtualRenderers.forEach((renderer) => renderer());
  });
}

function isObjectBucketSourceFolder(node = {}) {
  return node.contentKind === "objectBucket";
}

function getSourceTreeFolderKey(node = {}) {
  return `source:${node.path || ""}`;
}

function setSourceTreeFolderOpen(node = {}, shouldOpen = false) {
  const folderKey = getSourceTreeFolderKey(node);
  if (shouldOpen) {
    closedSourceFolderKeys.delete(folderKey);
    openObjectKeys.add(folderKey);
    return;
  }

  openObjectKeys.delete(folderKey);
  if (node.defaultOpen) {
    closedSourceFolderKeys.add(folderKey);
  }
}

function isSourceTreeFolderOpen(node = {}, forceOpen = false) {
  if (!node || node.kind !== "folder") {
    return false;
  }

  const folderKey = getSourceTreeFolderKey(node);
  const shouldFilterAutoOpen = activeSidebarTab === "search" && Boolean(schemaFolderSearchTerm);
  return node.alwaysOpen
    || (forceOpen && sourceNodeHasVisibleMatch(node))
    || (shouldFilterAutoOpen && !node.lazyChildrenFactory && (node.children || []).length > 0)
    || (!forceOpen && node.defaultOpen && !closedSourceFolderKeys.has(folderKey))
    || (!forceOpen && openObjectKeys.has(folderKey));
}

function getCheapSourceRowSelection(node = {}) {
  const sourcePath = normalizeMyOrgResultPath(node.path || node.selection?.sourcePath || "");
  if (node.selection) {
    return {
      ...node.selection,
      ...(sourcePath ? { sourcePath } : {})
    };
  }
  if (!sourcePath) {
    return null;
  }
  return node.kind === "folder"
    ? {
      type: "sourceFolder",
      sourcePath
    }
    : {
      type: "localFile",
      sourcePath
    };
}

function shouldRenderVirtualSourceEmptyRow(node = {}, children = []) {
  if (children.length) {
    return false;
  }
  if (node.keepEmpty && !node.lazyChildrenFactory) {
    return false;
  }
  return node.lazyChildrenLoaded === true;
}

function flattenVirtualSourceTreeRows(visibleSourceRoot = {}, forceOpen = false) {
  const rows = [];

  function visit(node = {}, level = 0, options = {}) {
    if (!node) {
      return;
    }

    // The root has never had a row; transparent folders (force-app, main,
    // default) now behave the same way, so their children render at top level.
    if (node.kind === "root" || node.transparent === true) {
      (node.children || []).forEach((child) => visit(child, level, options));
      return;
    }

    const flatObjectFolder = options.flatObjectFolder === true && node.kind === "folder";
    const selection = getCheapSourceRowSelection(node);
    const isOpen = node.kind === "folder" && !flatObjectFolder && isSourceTreeFolderOpen(node, forceOpen);
    const rowIndex = rows.length;
    const row = {
      id: node.localUid || node.path || `${node.kind || "node"}:${rows.length}`,
      index: rowIndex,
      type: node.kind === "folder" ? "folder" : "file",
      node,
      level,
      selection,
      open: isOpen,
      flatObjectFolder,
      selected: selection ? isSelected(selection) : false
    };
    rows.push(row);

    if (node.kind === "file") {
      const lineMatches = getFolderSearchLineMatchesFromNode(node);
      lineMatches.forEach((match, matchIndex) => {
        const matchRowIndex = rows.length;
        rows.push({
          id: `${node.path || row.id}:match:${match.lineNumber || 0}:${match.columnNumber || 0}:${matchIndex}`,
          index: matchRowIndex,
          type: "match",
          node,
          level: level + 1,
          selection,
          match
        });
      });
      return;
    }

    if (flatObjectFolder || !row.open) {
      return;
    }

    if (!isObjectBucketSourceFolder(node)) {
      ensureSourceTreeLazyChildren(node);
    }
    const childOptions = {};
    const children = node.children || [];
    if (shouldRenderVirtualSourceEmptyRow(node, children)) {
      const emptyRowIndex = rows.length;
      rows.push({
        id: `empty:${node.path || row.id}`,
        index: emptyRowIndex,
        type: "empty",
        node,
        level: level + 1,
        parentId: row.id,
        label: "(no files)"
      });
      return;
    }
    children.forEach((child) => visit(child, level + 1, childOptions));
  }

  visit(visibleSourceRoot, 0);
  return rows;
}

function getVirtualSourceTreeRange(target, rowCount = 0) {
  if (!target || !rowCount) {
    return {
      start: 0,
      end: 0
    };
  }

  const viewportHeight = target.clientHeight || window.innerHeight || SOURCE_TREE_VIRTUAL_ROW_HEIGHT * 24;
  const visibleRows = Math.ceil(viewportHeight / SOURCE_TREE_VIRTUAL_ROW_HEIGHT);
  const availableBufferRows = Math.max(0, SOURCE_TREE_VIRTUAL_MAX_MOUNTED_ROWS - visibleRows);
  const bufferRows = Math.min(SOURCE_TREE_VIRTUAL_BUFFER_ROWS, Math.floor(availableBufferRows / 2));
  const start = Math.max(0, Math.floor(target.scrollTop / SOURCE_TREE_VIRTUAL_ROW_HEIGHT) - bufferRows);
  const end = Math.min(
    rowCount,
    Math.ceil((target.scrollTop + viewportHeight) / SOURCE_TREE_VIRTUAL_ROW_HEIGHT) + bufferRows
  );
  return {
    start,
    end: Math.max(start, end)
  };
}

function getSourceTreeRowDomId(row = {}) {
  const value = String(row.id || row.node?.path || row.index || "row");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `schema-source-row-${Math.abs(hash)}`;
}

function clearVirtualSourceRowDataset(rowEl) {
  [
    "type",
    "metadataType",
    "objectKey",
    "fieldKey",
    "itemKey",
    "sourcePath",
    "sourceKind",
    "virtualIndex",
    "virtualId",
    "rowType",
    "kind",
    "skeletonReady"
  ].forEach((key) => {
    delete rowEl.dataset[key];
  });
}

function ensureVirtualSourceRowSkeleton(rowEl) {
  if (
    rowEl.dataset.skeletonReady === "true"
    && rowEl.querySelector(".schema-tree-icon")
    && rowEl.querySelector(".schema-tree-primary")
    && rowEl.querySelector(".schema-tree-secondary")
    && rowEl.querySelector(".schema-tree-meta")
    && rowEl.querySelector(".schema-tree-row-action-btn")
  ) {
    return;
  }
  rowEl.replaceChildren();
  const caret = document.createElement("span");
  caret.className = "schema-tree-caret";
  const icon = document.createElement("span");
  icon.className = "schema-tree-icon";
  const name = document.createElement("span");
  name.className = "schema-tree-name";
  const primary = document.createElement("span");
  primary.className = "schema-tree-primary";
  const secondary = document.createElement("span");
  secondary.className = "schema-tree-secondary";
  name.append(primary, secondary);

  const trailing = document.createElement("span");
  trailing.className = "schema-tree-trailing";
  const meta = document.createElement("span");
  meta.className = "schema-tree-meta";
  // Bound once per pooled element: the handler reads the row's current node
  // from the renderer state at click time, so recycling never rebinds it.
  const action = document.createElement("button");
  action.type = "button";
  action.className = "schema-tree-row-action-btn";
  action.tabIndex = -1;
  action.textContent = "⋮";
  action.setAttribute("aria-label", t("schema.rowActions"));
  action.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSourceRowActionMenu(rowEl, action);
  });
  trailing.append(meta, action);

  rowEl.append(caret, icon, name, trailing);
  rowEl.dataset.skeletonReady = "true";
}

function acquireVirtualSourceRow(state) {
  return state.pool.pop() || document.createElement("button");
}

function releaseVirtualSourceRow(state, rowEl) {
  rowEl.remove();
  rowEl.onclick = null;
  rowEl.replaceChildren();
  rowEl.className = "";
  rowEl.removeAttribute("style");
  rowEl.removeAttribute("title");
  rowEl.removeAttribute("aria-expanded");
  rowEl.removeAttribute("aria-selected");
  rowEl.removeAttribute("aria-level");
  rowEl.removeAttribute("aria-posinset");
  rowEl.removeAttribute("aria-setsize");
  rowEl.removeAttribute("id");
  clearVirtualSourceRowDataset(rowEl);
  if (state.pool.length < SOURCE_TREE_VIRTUAL_DETACHED_ROW_POOL_LIMIT) {
    state.pool.push(rowEl);
  }
}

function hydrateVirtualSourceMatchRow(rowEl, row = {}) {
  rowEl.type = "button";
  clearVirtualSourceRowDataset(rowEl);
  rowEl.className = "schema-search-match-row";
  rowEl.dataset.rowType = "match";
  rowEl.dataset.sourcePath = row.match?.sourcePath || row.node?.path || "";
  rowEl.dataset.sourceKind = "file";
  rowEl.title = row.match?.text || "";
  rowEl.setAttribute("role", "treeitem");
  rowEl.setAttribute("aria-level", String((row.level || 0) + 1));
  rowEl.setAttribute("aria-selected", "false");
  rowEl.removeAttribute("aria-expanded");
  setTreeIndent(rowEl, row.level || 0);

  rowEl.replaceChildren();
  const spacer = document.createElement("span");
  spacer.className = "schema-tree-indent";
  const line = document.createElement("span");
  line.className = "schema-tree-match-line";
  if (row.match?.lineNumber) {
    line.textContent = row.match.columnNumber
      ? `[${row.match.lineNumber}:${row.match.columnNumber}]`
      : `[${row.match.lineNumber}]`;
    line.title = row.match.columnNumber
      ? `Line ${row.match.lineNumber}, column ${row.match.columnNumber}`
      : `Line ${row.match.lineNumber}`;
  } else {
    line.setAttribute("aria-hidden", "true");
  }
  const snippet = document.createElement("span");
  snippet.className = "schema-search-match-snippet";
  const highlightTerm = row.match?.searchTerm || schemaFolderSearchTerm || activeSearchTerm;
  withSearchHighlightTerm(highlightTerm, () => {
    appendHighlightedExplorerText(snippet, row.match?.text || "", {
      maxMatches: SEARCH_MATCH_HIGHLIGHT_LIMIT_PER_ROW
    });
  });
  rowEl.append(spacer, line, snippet);
  if (Number(row.match?.count || 0) > 1) {
    const count = document.createElement("span");
    count.className = "schema-tree-meta";
    count.textContent = String(row.match.count);
    rowEl.appendChild(count);
  }
}

function hydrateVirtualSourceEmptyRow(rowEl, row = {}) {
  rowEl.type = "button";
  clearVirtualSourceRowDataset(rowEl);
  ensureVirtualSourceRowSkeleton(rowEl);
  rowEl.className = "schema-tree-row schema-tree-row-empty";
  rowEl.dataset.rowType = "empty";
  rowEl.dataset.kind = "empty";
  rowEl.setAttribute("role", "treeitem");
  rowEl.setAttribute("aria-level", String((row.level || 0) + 1));
  rowEl.setAttribute("aria-selected", "false");
  rowEl.removeAttribute("aria-expanded");
  rowEl.title = row.label || "(no files)";
  setTreeIndent(rowEl, row.level || 0);
  rowEl.querySelector(".schema-tree-caret, .schema-tree-indent").className = "schema-tree-indent";
  rowEl.querySelector(".schema-tree-icon").className = "schema-tree-icon";
  rowEl.querySelector(".schema-tree-primary").textContent = row.label || "(no files)";
  rowEl.querySelector(".schema-tree-secondary").textContent = "";
  rowEl.querySelector(".schema-tree-meta").textContent = "";
}

function hydrateVirtualSourceNodeRow(rowEl, row = {}) {
  const { node = {}, selection = null } = row;
  rowEl.type = "button";
  clearVirtualSourceRowDataset(rowEl);
  ensureVirtualSourceRowSkeleton(rowEl);
  rowEl.className = row.type === "folder"
    ? "schema-tree-row schema-tree-folder-row"
    : "schema-tree-row schema-tree-file-row";
  if (row.flatObjectFolder) {
    rowEl.classList.add("schema-tree-flat-folder-row");
  }
  if (row.open) {
    rowEl.classList.add("open");
  }
  if (selection) {
    createSelectionDataset(rowEl, selection);
  }
  if (row.selected || (selection && isSelected(selection))) {
    rowEl.classList.add("selected");
  }
  if (getFolderSearchLineMatchesFromNode(node).length) {
    rowEl.classList.add("schema-tree-file-row-has-matches");
  }

  rowEl.dataset.rowType = row.type;
  rowEl.dataset.kind = row.type;
  rowEl.dataset.sourcePath = node.path || "";
  rowEl.dataset.sourceKind = row.type === "folder" ? "folder" : "file";
  rowEl.setAttribute("role", "treeitem");
  rowEl.setAttribute("aria-level", String((row.level || 0) + 1));
  rowEl.setAttribute("aria-selected", String(Boolean(row.selected || (selection && isSelected(selection)))));
  if (row.type === "folder") {
    rowEl.setAttribute("aria-expanded", row.flatObjectFolder ? "false" : String(Boolean(row.open)));
  } else {
    rowEl.removeAttribute("aria-expanded");
  }
  const display = getSourceTreeNodeDisplayParts(node);
  rowEl.title = [
    display.primary,
    display.secondary,
    node.path
  ].filter(Boolean).join(" - ");
  setTreeIndent(rowEl, row.level || 0);

  const caret = rowEl.querySelector(".schema-tree-caret, .schema-tree-indent");
  caret.className = row.type === "folder" && !row.flatObjectFolder ? "schema-tree-caret" : "schema-tree-indent";
  const icon = rowEl.querySelector(".schema-tree-icon");
  icon.className = `schema-tree-icon ${row.type === "folder" ? "folder" : "file"}`;
  const primary = rowEl.querySelector(".schema-tree-primary");
  const secondary = rowEl.querySelector(".schema-tree-secondary");
  primary.textContent = "";
  secondary.textContent = "";
  appendHighlightedExplorerText(primary, display.primary);
  if (display.secondary) {
    appendHighlightedExplorerText(secondary, display.secondary);
    secondary.style.removeProperty("display");
  } else {
    secondary.style.display = "none";
  }

  const meta = rowEl.querySelector(".schema-tree-meta");
  const showOnlyName = sourceTreePathShowsOnlyName(node.path || "");
  if (row.type === "folder") {
    const childCount = Array.isArray(node.children) ? node.children.length : 0;
    const lazyChildCount = node.lazyChildrenFactory && !node.lazyChildrenLoaded && Number.isFinite(node.lazyChildCount)
      ? node.lazyChildCount
      : null;
    const displayCount = lazyChildCount ?? childCount;
    meta.textContent = showOnlyName ? "" : (row.flatObjectFolder ? "object" : (displayCount ? String(displayCount) : ""));
    meta.title = showOnlyName ? "" : (displayCount ? `${displayCount} children` : "");
  } else {
    meta.textContent = showOnlyName ? "" : (node.metaText || "");
    meta.title = showOnlyName ? "" : (node.metaText || "");
  }
}

function hydrateVirtualSourceTreeRow(rowEl, row = {}, state) {
  rowEl.id = getSourceTreeRowDomId(row);
  rowEl.style.height = `${SOURCE_TREE_VIRTUAL_ROW_HEIGHT}px`;
  rowEl.tabIndex = -1;
  if (row.type === "match") {
    hydrateVirtualSourceMatchRow(rowEl, row);
  } else if (row.type === "empty") {
    hydrateVirtualSourceEmptyRow(rowEl, row);
  } else {
    hydrateVirtualSourceNodeRow(rowEl, row);
  }
  rowEl.dataset.virtualId = row.id || "";
  rowEl.dataset.virtualIndex = String(row.index || 0);
  rowEl.setAttribute("aria-posinset", String((row.index || 0) + 1));
  rowEl.setAttribute("aria-setsize", String(state.rows.length || 1));
  rowEl.classList.toggle("focused", state.focusedId === row.id);
}

function activateVirtualSourceTreeRow(row = {}, target) {
  if (!row || row.type === "empty") {
    return;
  }
  if (row.type === "match") {
    pendingDetailLineFocus = row.match?.lineNumber
      ? {
        sourcePath: row.match.sourcePath || row.node?.path || "",
        lineNumber: row.match.lineNumber
      }
      : null;
    setSelectedSourceNodeFromPath(row.node?.selection || row.selection, row.match?.sourcePath || row.node?.path || "", {
      target,
      clearFilterIfHidden: false
    });
    return;
  }
  if (row.type === "file") {
    setSelectedSourceNodeFromPath(row.selection || row.node?.selection, row.node?.path || row.selection?.sourcePath || "", {
      target,
      clearFilterIfHidden: false
    });
    return;
  }
  if (row.type !== "folder") {
    return;
  }

  const sourcePath = normalizeMyOrgResultPath(row.node?.path || "");
  const selection = row.selection || (sourcePath ? {
    type: "sourceFolder",
    sourcePath
  } : null);
  if (!selection) {
    return;
  }
  if (!row.flatObjectFolder && !row.node?.alwaysOpen) {
    setSourceTreeFolderOpen(row.node, !row.open);
  }
  setSelectedNode(selection);
  if (target === schemaSearchResultsTreeEl || activeSidebarTab === "search") {
    renderSearchPanel({ preserveScroll: true });
  } else if (target === schemaPackageTreeEl || activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  } else {
    renderSchema({ renderDetail: false, preserveScroll: true, treeOnly: true });
  }
}

let manifestContextMenuEl = null;

function closeManifestContextMenu() {
  manifestContextMenuEl?.remove();
  manifestContextMenuEl = null;
}

function getSourceTreeRowFromEvent(event) {
  return event.target?.closest?.(".schema-tree-row");
}

function createManifestContextMenuButton(label = "", handler = () => {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schema-context-menu-item";
  button.textContent = label;
  button.addEventListener("click", () => {
    closeManifestContextMenu();
    handler();
  });
  return button;
}

function showManifestContextMenu(event, actions = []) {
  closeManifestContextMenu();
  if (!actions.length) {
    return;
  }
  const menu = document.createElement("div");
  menu.className = "schema-context-menu";
  menu.setAttribute("role", "menu");
  actions.forEach((action) => {
    menu.appendChild(createManifestContextMenuButton(action.label, action.handler));
  });
  document.body.appendChild(menu);

  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - margin);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - margin);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
  manifestContextMenuEl = menu;
}

function getRenderedSourceTreeRowByPath(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  if (!path) {
    return null;
  }
  const target = activeSidebarTab === "package" ? schemaPackageTreeEl : schemaTreeEl;
  if (!target) {
    return null;
  }
  return Array.from(target.querySelectorAll(".schema-tree-row"))
    .find((row) => row.dataset.sourcePath === path) || null;
}

function startManifestInlineRename(sourcePath = "") {
  const path = normalizeMyOrgResultPath(sourcePath);
  const entry = getManifestLocalFileEntry(path);
  if (!entry) {
    setStatus(t("schemaStatus.renameCustomOnly"), true);
    return;
  }
  const row = getRenderedSourceTreeRowByPath(path);
  const primary = row?.querySelector?.(".schema-tree-primary");
  if (!primary) {
    const nextName = window.prompt("Rename manifest file", getSourceBaseName(path));
    if (nextName) {
      renameManifestLocalFile(path, nextName);
    }
    return;
  }

  const originalName = getSourceBaseName(path);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "schema-tree-inline-rename";
  input.value = originalName;
  input.setAttribute("aria-label", t("schemaUi.renameManifestAria"));
  let completed = false;

  const finish = (commit) => {
    if (completed) {
      return;
    }
    completed = true;
    if (commit) {
      renameManifestLocalFile(path, input.value);
      return;
    }
    if (activeSidebarTab === "package") {
      renderPackageXmlTree({ preserveScroll: true });
    } else {
      renderSchema({ renderDetail: false, preserveScroll: true, treeOnly: true });
    }
  };

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));

  primary.replaceChildren(input);
  input.focus();
  input.select();
}

// Shared by right-click and the per-row ⋮ button, so both offer the same menu.
function getSourceRowContextActions(sourcePath = "") {
  const actions = [];
  if (!isMetadataFolderReadOnly && (isManifestFolderPath(sourcePath) || sourcePath === PACKAGE_XML_SOURCE_PATH)) {
    actions.push({
      label: "Create",
      handler: createManifestFileFromContext
    });
  }
  if (!isMetadataFolderReadOnly && isManifestLocalFilePath(sourcePath)) {
    actions.push(
      {
        label: "Rename",
        handler: () => startManifestInlineRename(sourcePath)
      },
      {
        label: "Delete",
        handler: () => deleteManifestLocalFile(sourcePath)
      }
    );
  }
  actions.push({
    label: t("schema.copyPath"),
    handler: async () => {
      try {
        await copyTextToClipboard(sourcePath);
        setStatus(t("schema.copiedPath"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    }
  });
  return actions;
}

function handleManifestTreeContextMenu(event) {
  const row = getSourceTreeRowFromEvent(event);
  const sourcePath = normalizeMyOrgResultPath(row?.dataset?.sourcePath || "");
  if (!sourcePath) {
    return;
  }

  const actions = getSourceRowContextActions(sourcePath);
  if (!actions.length) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  showManifestContextMenu(event, actions);
}

// The ⋮ button anchors the same menu under itself. showManifestContextMenu only
// reads clientX/clientY, so a plain point stands in for the event.
function openSourceRowActionMenu(rowEl, anchorEl) {
  const sourcePath = normalizeMyOrgResultPath(rowEl?.dataset?.sourcePath || "");
  if (!sourcePath) {
    return;
  }
  const rect = anchorEl.getBoundingClientRect();
  showManifestContextMenu(
    { clientX: rect.left, clientY: rect.bottom + 2 },
    getSourceRowContextActions(sourcePath)
  );
}

function setVirtualSourceTreeFocusedRow(state, row = {}, options = {}) {
  if (!state || !row?.id) {
    return;
  }
  state.focusedId = row.id;
  state.target.setAttribute("aria-activedescendant", getSourceTreeRowDomId(row));
  renderVirtualSourceTreeWindow(state);
  if (options.scroll !== false) {
    scrollVirtualSourceRowIntoView(state, row.id, {
      smooth: options.smooth === true,
      align: options.align || "nearest"
    });
  }
}

function getVirtualSourceTreeFocusedIndex(state) {
  if (!state?.rows?.length) {
    return -1;
  }
  const selectedIndex = state.rows.findIndex((row) => row.selection && isSelected(row.selection));
  if (!state.focusedId && selectedIndex >= 0) {
    state.focusedId = state.rows[selectedIndex].id;
  }
  let focusedIndex = state.rows.findIndex((row) => row.id === state.focusedId);
  if (focusedIndex < 0) {
    focusedIndex = selectedIndex >= 0 ? selectedIndex : 0;
    state.focusedId = state.rows[focusedIndex]?.id || "";
  }
  return focusedIndex;
}

function scrollVirtualSourceRowIntoView(state, rowId = "", options = {}) {
  const index = state.rows.findIndex((row) => row.id === rowId);
  if (index < 0) {
    return;
  }
  const target = state.target;
  const rowTop = index * SOURCE_TREE_VIRTUAL_ROW_HEIGHT;
  const rowBottom = rowTop + SOURCE_TREE_VIRTUAL_ROW_HEIGHT;
  const behavior = options.smooth ? "smooth" : "auto";
  if (options.align === "center") {
    const maxTop = Math.max(0, state.spacer.offsetHeight - target.clientHeight);
    target.scrollTo({
      top: Math.max(0, Math.min(maxTop, rowTop - Math.floor((target.clientHeight - SOURCE_TREE_VIRTUAL_ROW_HEIGHT) / 2))),
      behavior
    });
    scheduleSourceTreeVirtualRenderers();
    return;
  }
  if (rowTop < target.scrollTop) {
    target.scrollTo({ top: rowTop, behavior });
  } else if (rowBottom > target.scrollTop + target.clientHeight) {
    target.scrollTo({ top: rowBottom - target.clientHeight, behavior });
  }
  scheduleSourceTreeVirtualRenderers();
}

function handleVirtualSourceTreeTypeAhead(state, key = "") {
  const now = Date.now();
  if (now - state.typeAhead.lastKeyTime > SOURCE_TREE_TYPEAHEAD_RESET_MS) {
    state.typeAhead.buffer = "";
  }
  const char = key.toLocaleLowerCase();
  state.typeAhead.buffer = state.typeAhead.buffer === char ? char : `${state.typeAhead.buffer}${char}`;
  state.typeAhead.lastKeyTime = now;

  const focusedIndex = getVirtualSourceTreeFocusedIndex(state);
  const searchFrom = focusedIndex < 0 ? 0 : focusedIndex + 1;
  const candidates = [
    ...state.rows.slice(searchFrom),
    ...state.rows.slice(0, searchFrom)
  ];
  const match = candidates.find((row) => (
    (row.type === "folder" || row.type === "file")
    && String(row.node?.name || "").toLocaleLowerCase().startsWith(state.typeAhead.buffer)
  ));
  if (match) {
    setVirtualSourceTreeFocusedRow(state, match, { smooth: false, align: "nearest" });
  }
}

function toggleVirtualSourceTreeFolder(row = {}, target) {
  if (row.type !== "folder" || row.flatObjectFolder || row.node?.alwaysOpen) {
    return;
  }
  setSourceTreeFolderOpen(row.node, !row.open);
  if (target === schemaSearchResultsTreeEl || activeSidebarTab === "search") {
    renderSearchPanel({ preserveScroll: true });
  } else if (target === schemaPackageTreeEl || activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  } else {
    renderSchema({ renderDetail: false, preserveScroll: true, treeOnly: true });
  }
}

function handleVirtualSourceTreeKeydown(event, state) {
  if (!state?.rows?.length) {
    return;
  }
  if (event.key === "*" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const focusedIndex = getVirtualSourceTreeFocusedIndex(state);
    const focusedRow = state.rows[focusedIndex];
    if (!focusedRow) {
      return;
    }
    state.rows
      .filter((row) => row.type === "folder" && row.level === focusedRow.level && !row.flatObjectFolder && !row.node?.alwaysOpen)
      .forEach((row) => setSourceTreeFolderOpen(row.node, true));
    if (state.target === schemaSearchResultsTreeEl || activeSidebarTab === "search") {
      renderSearchPanel({ preserveScroll: true });
    } else if (state.target === schemaPackageTreeEl || activeSidebarTab === "package") {
      renderPackageXmlTree({ preserveScroll: true });
    } else {
      renderSchema({ renderDetail: false, preserveScroll: true, treeOnly: true });
    }
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    handleVirtualSourceTreeTypeAhead(state, event.key);
    return;
  }

  const focusedIndex = getVirtualSourceTreeFocusedIndex(state);
  const focusedRow = state.rows[focusedIndex];
  if (!focusedRow) {
    return;
  }
  const visibleCount = Math.max(1, Math.floor((state.target.clientHeight || SOURCE_TREE_VIRTUAL_ROW_HEIGHT) / SOURCE_TREE_VIRTUAL_ROW_HEIGHT));
  let nextIndex = focusedIndex;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      nextIndex = Math.min(state.rows.length - 1, focusedIndex + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      nextIndex = Math.max(0, focusedIndex - 1);
      break;
    case "PageDown":
      event.preventDefault();
      nextIndex = Math.min(state.rows.length - 1, focusedIndex + visibleCount);
      break;
    case "PageUp":
      event.preventDefault();
      nextIndex = Math.max(0, focusedIndex - visibleCount);
      break;
    case "Home":
      event.preventDefault();
      nextIndex = 0;
      break;
    case "End":
      event.preventDefault();
      nextIndex = state.rows.length - 1;
      break;
    case "ArrowRight":
      event.preventDefault();
      if (focusedRow.type === "folder") {
        if (focusedRow.open) {
          const child = state.rows.find((row, index) => index > focusedIndex && row.level === focusedRow.level + 1);
          if (child) {
            setVirtualSourceTreeFocusedRow(state, child, { smooth: true, align: "nearest" });
          }
        } else {
          toggleVirtualSourceTreeFolder(focusedRow, state.target);
        }
      }
      return;
    case "ArrowLeft":
      event.preventDefault();
      if (focusedRow.type === "folder" && focusedRow.open) {
        toggleVirtualSourceTreeFolder(focusedRow, state.target);
        return;
      }
      for (let index = focusedIndex - 1; index >= 0; index -= 1) {
        if (state.rows[index].level === focusedRow.level - 1) {
          setVirtualSourceTreeFocusedRow(state, state.rows[index], { smooth: true, align: "nearest" });
          return;
        }
      }
      return;
    case "Enter":
    case " ":
      event.preventDefault();
      activateVirtualSourceTreeRow(focusedRow, state.target);
      return;
    case "Escape":
      event.preventDefault();
      if (focusedRow.type === "folder" && focusedRow.open) {
        toggleVirtualSourceTreeFolder(focusedRow, state.target);
      }
      return;
    default:
      return;
  }

  if (nextIndex !== focusedIndex) {
    setVirtualSourceTreeFocusedRow(state, state.rows[nextIndex], { smooth: true, align: "nearest" });
  }
}

function handleVirtualSourceTreeClick(event, target, fallbackRow = null) {
  const currentState = sourceTreeVirtualRendererStates.get(target);
  if (!currentState) {
    return false;
  }
  const rowEl = event.target?.closest?.("[data-virtual-index]");
  if (!rowEl || !target.contains(rowEl)) {
    return false;
  }
  const rowIndex = Number(rowEl.dataset.virtualIndex);
  const row = currentState.rows[rowIndex]
    || currentState.rows.find((candidate) => candidate.id === rowEl.dataset.virtualId)
    || fallbackRow;
  if (!row) {
    return false;
  }
  event.preventDefault();
  target.focus({ preventScroll: true });
  currentState.focusedId = row.id;
  renderVirtualSourceTreeWindow(currentState);
  activateVirtualSourceTreeRow(row, target);
  return true;
}

function bindVirtualSourceTreeTarget(state) {
  const target = state.target;
  if (sourceTreeVirtualBoundTargets.has(target)) {
    return;
  }
  sourceTreeVirtualBoundTargets.add(target);
  target.tabIndex = 0;
  target.setAttribute("role", "tree");
  target.setAttribute(
    "aria-label",
    target === schemaSearchResultsTreeEl
      ? "Search result files"
      : target === schemaPackageTreeEl
        ? "Package XML files"
        : "Source files"
  );
  target.addEventListener("click", (event) => {
    handleVirtualSourceTreeClick(event, target);
  });
  target.addEventListener("keydown", (event) => {
    const currentState = sourceTreeVirtualRendererStates.get(target);
    if (currentState) {
      handleVirtualSourceTreeKeydown(event, currentState);
    }
  });
  target.addEventListener("dragstart", (event) => event.preventDefault());
}

function renderVirtualSourceTreeWindow(state) {
  const range = getVirtualSourceTreeRange(state.target, state.rows.length);
  const slice = state.rows.slice(range.start, range.end);
  const sliceSignature = slice
    .map((row, offset) => {
      const display = row.node ? getSourceTreeNodeDisplayParts(row.node) : {};
      const childCount = Array.isArray(row.node?.children) ? row.node.children.length : 0;
      const lazyChildCount = row.node?.lazyChildrenFactory && !row.node?.lazyChildrenLoaded && Number.isFinite(row.node?.lazyChildCount)
        ? row.node.lazyChildCount
        : "";
      return [
        row.id || "",
        row.type || "",
        row.open ? "1" : "0",
        row.selected || (row.selection && isSelected(row.selection)) ? "1" : "0",
        state.focusedId === row.id ? "1" : "0",
        display.primary || row.label || "",
        display.secondary || "",
        row.node?.metaText || "",
        childCount,
        lazyChildCount,
        row.match?.lineNumber || "",
        row.match?.columnNumber || "",
        row.match?.text || "",
        range.start + offset
      ].join(":");
    })
    .join("|");
  const signature = `${range.start}:${range.end}:${state.rows.length}:${state.target.clientHeight}:${state.focusedId}:${sliceSignature}`;
  if (state.signature === signature) {
    return;
  }
  state.signature = signature;

  const current = Array.from(state.windowEl.children);
  current.slice(range.end - range.start).forEach((rowEl) => releaseVirtualSourceRow(state, rowEl));
  slice.forEach((row, offset) => {
    const index = range.start + offset;
    const rowEl = current[offset] || acquireVirtualSourceRow(state);
    hydrateVirtualSourceTreeRow(rowEl, {
      ...row,
      index
    }, state);
    rowEl.onclick = (event) => {
      if (handleVirtualSourceTreeClick(event, state.target, row)) {
        event.stopPropagation();
      }
    };
    if (!rowEl.parentNode) {
      state.windowEl.appendChild(rowEl);
    }
  });
  state.windowEl.style.transform = `translateY(${range.start * SOURCE_TREE_VIRTUAL_ROW_HEIGHT}px)`;
  const focusedRow = state.rows.find((row) => row.id === state.focusedId)
    || state.rows.find((row) => row.selection && isSelected(row.selection));
  if (focusedRow) {
    state.target.setAttribute("aria-activedescendant", getSourceTreeRowDomId(focusedRow));
  } else {
    state.target.removeAttribute("aria-activedescendant");
  }
}

function renderVirtualSourceTreeRows(target, rows = []) {
  const selectedRow = rows.find((row) => row.selection && isSelected(row.selection));
  const previousState = sourceTreeVirtualRendererStates.get(target);
  if (previousState?.root?.parentNode === target) {
    previousState.rows = rows;
    previousState.spacer.style.height = `${Math.max(rows.length * SOURCE_TREE_VIRTUAL_ROW_HEIGHT, 1)}px`;
    previousState.focusedId = rows.some((row) => row.id === previousState.focusedId)
      ? previousState.focusedId
      : selectedRow?.id || rows[0]?.id || "";
    previousState.signature = "";
    target.setAttribute("aria-rowcount", String(rows.length));
    previousState.renderRange();
    return;
  }
  if (previousState?.renderRange) {
    sourceTreeVirtualRenderers.delete(previousState.renderRange);
  }

  const root = document.createElement("div");
  root.className = "schema-tree-virtual-root";

  const spacer = document.createElement("div");
  spacer.className = "schema-tree-virtual-spacer";
  spacer.style.height = `${Math.max(rows.length * SOURCE_TREE_VIRTUAL_ROW_HEIGHT, 1)}px`;

  const windowEl = document.createElement("div");
  windowEl.className = "schema-tree-virtual-window";
  spacer.appendChild(windowEl);
  root.appendChild(spacer);
  target.replaceChildren(root);

  const state = {
    target,
    root,
    spacer,
    windowEl,
    rows,
    pool: previousState?.pool || [],
    signature: "",
    focusedId: previousState?.focusedId || selectedRow?.id || rows[0]?.id || "",
    typeAhead: previousState?.typeAhead || { buffer: "", lastKeyTime: 0 }
  };
  sourceTreeVirtualRendererStates.set(target, state);
  bindVirtualSourceTreeTarget(state);
  target.setAttribute("aria-rowcount", String(rows.length));

  const renderRange = () => renderVirtualSourceTreeWindow(state);
  state.renderRange = renderRange;
  sourceTreeVirtualRenderers.add(renderRange);
  renderRange();
}

function getSearchTerms(term = "") {
  return [...new Set(
    String(term || "")
      .toLocaleLowerCase()
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function stringifySearchValue(value) {
  try {
    return JSON.stringify(value).toLocaleLowerCase();
  } catch (_error) {
    return String(value || "").toLocaleLowerCase();
  }
}

function matchesNeedle(needle, ...values) {
  const terms = getSearchTerms(needle);
  if (!terms.length) {
    return true;
  }

  const haystack = values
    .filter((value) => value !== null && typeof value !== "undefined")
    .map((value) => stringifySearchValue(value))
    .join("\n");
  return terms.every((term) => haystack.includes(term));
}

function matchesSchemaFilters(...values) {
  return matchesNeedle(activeSearchTerm, ...values);
}

function hasActiveSearch() {
  return Boolean(activeSearchTerm);
}

function getFindSearchTerm() {
  return explorerFilterInput?.value?.trim() || schemaFileFilterInput?.value?.trim() || "";
}

function getMetadataDetailCacheKey(selection = {}) {
  const item = findMetadataItem(selection.metadataType, selection.itemKey);
  return getMetadataItemCacheKey(selection.metadataType, item);
}

function metadataErrorMatchesTypes(error = {}, metadataTypes = []) {
  const typeSet = new Set(metadataTypes);
  if (typeSet.has("objects") && error.objectApiName) {
    return true;
  }

  return typeSet.has(error.metadataType);
}

function getStoreMetadataItemCount(store = {}) {
  return Object.values(store.metadata || {}).reduce((total, group) => total + getGroupItemCount(group), 0);
}

function mergeRetrievedSchemaStore(currentStore = {}, retrievedStore = {}, metadataTypes = []) {
  const typeSet = new Set(metadataTypes);
  const metadata = {
    ...(currentStore.metadata || {}),
    ...(retrievedStore.metadata || {})
  };
  const nextStore = {
    ...currentStore,
    ...retrievedStore,
    metadata,
    metadataTypes: [
      ...new Set([
        ...(currentStore.metadataTypes || []),
        ...(retrievedStore.metadataTypes || []),
        ...metadataTypes
      ])
    ],
    errors: [
      ...(currentStore.errors || []).filter((error) => !metadataErrorMatchesTypes(error, metadataTypes)),
      ...(retrievedStore.errors || [])
    ]
  };

  if (!typeSet.has("objects")) {
    nextStore.map = currentStore.map || {};
    nextStore.objectCount = currentStore.objectCount || 0;
    nextStore.fieldCount = currentStore.fieldCount || 0;
  }

  nextStore.metadataItemCount = getStoreMetadataItemCount(nextStore);
  return nextStore;
}

function clearCachesForMetadataTypes(metadataTypes = [], options = {}) {
  const metadataTypeSet = new Set(metadataTypes);
  const shouldClearAllSearchDetails = options.clearSearchDetails !== false;
  const matchesMetadataType = (cacheKey = "") => {
    const separatorIndex = String(cacheKey || "").indexOf(":");
    const metadataType = separatorIndex === -1 ? String(cacheKey || "") : String(cacheKey || "").slice(0, separatorIndex);
    return metadataTypeSet.has(metadataType);
  };

  if (metadataTypes.includes("objects")) {
    describeCache.clear();
    objectMetadataDetailCache.clear();
  } else if (metadataTypes.some((metadataTypeId) => OBJECT_RELATED_METADATA_TYPE_IDS.includes(metadataTypeId))) {
    objectMetadataDetailCache.clear();
  }

  for (const cacheKey of [...metadataDetailCache.keys()]) {
    if (matchesMetadataType(cacheKey)) {
      metadataDetailCache.delete(cacheKey);
    }
  }
  for (const cacheKey of [...toolingSourceDetailCache.keys()]) {
    if (matchesMetadataType(cacheKey)) {
      toolingSourceDetailCache.delete(cacheKey);
    }
  }

  if (shouldClearAllSearchDetails) {
    clearSearchDetailCaches();
  }
}

function selectionIsVisible(visibleGroups) {
  if (!selectedNode) {
    return false;
  }

  return visibleGroups.some((visibleGroup) => {
    if (selectedNode.type === "metadataType") {
      return selectedNode.metadataType === visibleGroup.group.id;
    }

    if (selectedNode.type === "metadataItem") {
      return selectedNode.metadataType === visibleGroup.group.id
        && visibleGroup.items?.some((item) => item.key === selectedNode.itemKey);
    }

    if (selectedNode.type === "object") {
      return visibleGroup.group.id === "objects"
        && visibleGroup.objectEntries?.some(([objectKey]) => selectedNode.objectKey === objectKey);
    }

    return visibleGroup.group.id === "objects"
      && visibleGroup.objectEntries?.some(([objectKey, fieldKeys]) => (
        selectedNode.objectKey === objectKey && fieldKeys.includes(selectedNode.fieldKey)
      ));
  });
}

function selectFirstVisibleNode(visibleGroups) {
  if (!visibleGroups.length) {
    selectedNode = null;
    return;
  }

  const firstGroup = visibleGroups[0].group;
  selectedNode = {
    type: "metadataType",
    metadataType: firstGroup.id
  };
}

function selectFirstVisibleSourceNode(visibleSourceRoot) {
  const packageXmlNode = findSourceTreeNodeByPath(visibleSourceRoot || {}, PACKAGE_XML_SOURCE_PATH);
  if (packageXmlNode?.selection) {
    preparePackageXmlCreateDetail({ previewXml: true });
    selectedNode = {
      ...packageXmlNode.selection,
      sourcePath: PACKAGE_XML_SOURCE_PATH,
      previewXml: true
    };
    return;
  }
  selectedNode = getFirstSourceSelection(visibleSourceRoot);
}

function createAllSourceVisibleGroups(groups = getMetadataGroups()) {
  const namespaceScope = createRetrieveNamespaceScope();
  return groups.map((group) => {
    if (isObjectsGroup(group)) {
      const objectMap = group.items && typeof group.items === "object" ? group.items : {};
      const objectEntries = Object.entries(objectMap)
        .filter(([objectKey]) => isObjectIncludedInRetrieveScope(objectKey, namespaceScope))
        .map(([objectKey, fieldMap]) => [
          objectKey,
          getFieldKeys(fieldMap)
            .filter((fieldKey) => isFieldIncludedInRetrieveScope(objectKey, fieldKey, namespaceScope))
            .sort((left, right) => left.localeCompare(right))
        ])
        .sort(([left], [right]) => left.localeCompare(right));

      return {
        group,
        objectEntries,
        items: [],
        visibleItemCount: objectEntries.reduce((total, [, fieldKeys]) => total + 1 + fieldKeys.length, 0)
      };
    }

    const items = getGroupItems(group)
      .filter((item) => isMetadataItemIncludedInRetrieveScope(item, namespaceScope))
      .sort((left, right) => left.key.localeCompare(right.key));
    return {
      group,
      objectEntries: [],
      items,
      visibleItemCount: items.length
    };
  });
}

function createSearchVisibleGroups(groups = getMetadataGroups()) {
  const selectedSearchMetadataTypes = hasActiveSearch()
    ? getSelectedSearchMetadataTypeSet()
    : null;
  const visibleGroups = [];

  groups.forEach((group) => {
    if (selectedSearchMetadataTypes && !selectedSearchMetadataTypes.has(group.id)) {
      return;
    }

    const groupMatches = matchesSchemaFilters(...getMetadataTypeSearchValues(group));

    if (isObjectsGroup(group)) {
      const objectMap = group.items && typeof group.items === "object" ? group.items : {};
      const objectEntries = Object.entries(objectMap).sort(([left], [right]) => left.localeCompare(right));
      const visibleObjectEntries = [];
      let visibleItemCount = 0;

      objectEntries.forEach(([objectKey, fieldMap]) => {
        const objectParts = splitSchemaKey(objectKey);
        const objectName = toSourceFileSegment(objectParts.apiName || objectKey, "Object");
        const allFieldKeys = getFieldKeys(fieldMap).sort((left, right) => left.localeCompare(right));
        const objectMatches = groupMatches || matchesSchemaFilters(
          ...getMetadataTypeSearchValues(group),
          objectKey,
          objectParts.apiName,
          objectParts.label,
          objectName,
          `${objectName}.object-meta.xml`,
          `objects/${objectName}`
        );
        const visibleFields = objectMatches
            ? allFieldKeys
            : allFieldKeys.filter((fieldKey) => {
              const fieldParts = splitSchemaKey(fieldKey);
              const fieldName = toSourceFileSegment(fieldParts.apiName || fieldKey, "Field");
              return matchesSchemaFilters(
                ...getMetadataTypeSearchValues(group),
                objectKey,
                fieldKey,
                fieldParts.apiName,
                fieldParts.label,
                `${fieldName}.field-meta.xml`
              );
            });

        if (objectMatches || visibleFields.length) {
          visibleObjectEntries.push([objectKey, visibleFields]);
          visibleItemCount += 1 + visibleFields.length;
        }
      });

      if (groupMatches || visibleObjectEntries.length) {
        visibleGroups.push({
          group,
          objectEntries: groupMatches && !visibleObjectEntries.length ? objectEntries : visibleObjectEntries,
          items: [],
          visibleItemCount: groupMatches ? getGroupItemCount(group) : visibleItemCount
        });
      }
      return;
    }

    const allItems = getGroupItems(group).sort((left, right) => left.key.localeCompare(right.key));
    const visibleItems = groupMatches
      ? allItems
      : allItems.filter((item) => {
        const display = getMetadataExplorerDisplay(group, item);
        const sourceFiles = getMetadataSourceFileNames(group, item);
        return matchesSchemaFilters(
          ...getMetadataTypeSearchValues(group),
          item.key,
          item.apiName,
          item.label,
          display.primary,
          display.secondary,
          ...sourceFiles
        );
      });

    if (groupMatches || visibleItems.length) {
      visibleGroups.push({
        group,
        objectEntries: [],
        items: visibleItems,
        visibleItemCount: visibleItems.length
      });
    }
  });

  return visibleGroups;
}

function renderSourceTreeNodes(target, visibleSourceRoot = {}, forceOpen = false) {
  const rows = flattenVirtualSourceTreeRows(visibleSourceRoot, forceOpen);
  if (target === schemaTreeEl) {
    lastRenderedTreeRows = rows;
  }
  renderVirtualSourceTreeRows(target, rows);
  return rows.length;
}

function createExtensionSearchSourceTree() {
  const root = createSourceTreeNode("workspace", "", "root", { alwaysOpen: true });
  const entries = [];
  for (const entry of localSourceEntries.values()) {
    if (entry?.path && !isSearchLogSource(entry.path) && (entry.searchTerm || myOrgSearchLocalPaths.has(entry.path))) {
      entries.push(entry);
    }
  }

  entries.sort((left, right) => (left.path || "").localeCompare(right.path || ""));
  for (const entry of entries) {
    const parent = ensureLocalSourceFolder(root, entry.parentPath || getParentSourcePath(entry.path));
    if (entry.kind === "folder") {
      addSourceFolder(parent, entry.name || getSourceBaseName(entry.path), {
        path: entry.path,
        searchValues: [entry.path, entry.name || ""]
      });
      continue;
    }

    addSourceFile(parent, entry.name || getSourceBaseName(entry.path), {
      type: "localFile",
      sourcePath: entry.path
    }, {
      path: entry.path,
      metaText: entry.typeLabel || entry.metadataType || "Search",
      searchValues: [entry.path, entry.name || "", entry.typeLabel || "", entry.metadataType || ""]
    });
  }
  return sortSourceChildren(root);
}

function hasExtensionSearchSourceEntries() {
  for (const entry of localSourceEntries.values()) {
    if (entry?.path && !isSearchLogSource(entry.path) && (entry.searchTerm || myOrgSearchLocalPaths.has(entry.path))) {
      return true;
    }
  }
  return false;
}

function createBrowserSearchSourceTree() {
  const groups = getMetadataGroups();
  const visibleGroups = schemaStore?.generatedAt && groups.length
    ? createSearchVisibleGroups(groups)
    : [];
  return createSourceExplorerTree(visibleGroups);
}

function renderSearchPanel(options = {}) {
  if (!schemaSearchResultsTreeEl) {
    return 0;
  }

  const previousScrollTop = schemaSearchResultsTreeEl.scrollTop || 0;
  clearSourceTreeRenderCaches();
  if (!schemaFolderSearchTerm) {
    clearSourceTreeVirtualRenderer(schemaSearchResultsTreeEl);
    schemaSearchResultsTreeEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-search-empty";
    empty.textContent = t("schemaUi.searchFilesHint");
    schemaSearchResultsTreeEl.appendChild(empty);
    updateMetadataSelectionState({ renderManifest: false });
    return 0;
  }

  const visibleSourceRoot = getSearchSourceTree() || {
    kind: "root",
    path: "",
    name: "workspace",
    children: []
  };
  const count = countSourceSelections(visibleSourceRoot || {});
  if (!visibleSourceRoot?.children?.length) {
    clearSourceTreeVirtualRenderer(schemaSearchResultsTreeEl);
    schemaSearchResultsTreeEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "schema-empty schema-search-empty";
    empty.textContent = t("schemaUi.noMatchingFiles");
    schemaSearchResultsTreeEl.appendChild(empty);
    updateMetadataSelectionState({ renderManifest: false });
    return 0;
  }

  renderSourceTreeNodes(schemaSearchResultsTreeEl, visibleSourceRoot, false);
  if (options.preserveScroll === true) {
    schemaSearchResultsTreeEl.scrollTop = previousScrollTop;
  }
  scheduleSourceTreeVirtualRenderers();
  updateMetadataSelectionState({ renderManifest: false });
  return count;
}

function scheduleSearchPanelRender() {
  if (activeSidebarTab !== "search" || searchPanelRenderFrame) {
    return;
  }

  searchPanelRenderFrame = window.requestAnimationFrame(() => {
    searchPanelRenderFrame = 0;
    if (activeSidebarTab === "search") {
      renderSearchPanel();
    }
  });
}

function openSearchPanel() {
  activeSearchOpenRequestId += 1;
  renderSearchPanel();
}

function renderPackageXmlTree(options = {}) {
  if (!schemaPackageTreeEl) {
    return 0;
  }

  const previousScrollTop = schemaPackageTreeEl.scrollTop || 0;
  clearSourceTreeRenderCaches();
  const visibleSourceRoot = createPackageXmlSourceTree();
  const count = countSourceSelections(visibleSourceRoot || {});
  if (!visibleSourceRoot?.children?.length) {
    clearSourceTreeVirtualRenderer(schemaPackageTreeEl);
    schemaPackageTreeEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "schema-empty";
    empty.textContent = t("schemaUi.noPackageXmlFiles");
    schemaPackageTreeEl.appendChild(empty);
    return 0;
  }

  renderSourceTreeNodes(schemaPackageTreeEl, visibleSourceRoot, false);
  if (options.preserveScroll === true) {
    schemaPackageTreeEl.scrollTop = previousScrollTop;
  }
  scheduleSourceTreeVirtualRenderers();
  updateMetadataSelectionState({ renderManifest: false });
  return count;
}

function renderSchema(options = {}) {
  const treeOnly = options.treeOnly === true;
  const previousScrollTop = schemaTreeEl.scrollTop || 0;
  if (!treeOnly) {
    clearSourceTreeRenderCaches();
  }
  const groups = treeOnly ? [] : getMetadataGroups();
  const visibleGroups = !treeOnly && schemaStore?.generatedAt && groups.length
    ? createAllSourceVisibleGroups(groups)
    : [];

  const sourceRoot = getBaseExplorerSourceTree();
  if (!treeOnly) {
    updateFileFilterSuggestions(sourceRoot);
  }
  const explorerSourceRoot = schemaFileFilterTerm
    ? filterSourceTreeByFileName(sourceRoot, schemaFileFilterTerm, true)
    : sourceRoot;
  if (schemaFileFilterTerm && explorerSourceRoot) {
    openFilteredSourceTreeFileAncestors(explorerSourceRoot);
  }
  const visibleSourceRoot = explorerSourceRoot || {
      kind: "root",
      path: "",
      name: "workspace",
      children: []
    };

  const selectedSourcePathVisible = treeOnly
    ? Boolean(selectedNode?.sourcePath)
    : selectedNode?.sourcePath && hasSourcePath(visibleSourceRoot || {}, selectedNode.sourcePath);
  if (!treeOnly && !selectionIsVisible(visibleGroups) && !selectedSourcePathVisible) {
    selectFirstVisibleSourceNode(visibleSourceRoot);
    if (!selectedNode) {
      selectFirstVisibleNode(visibleGroups);
    }
  }

  const visibleFileCount = treeOnly ? 0 : countSourceSelections(visibleSourceRoot || {});

  if (!visibleSourceRoot?.children?.length) {
    clearSourceTreeVirtualRenderer(schemaTreeEl);
    schemaTreeEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "schema-empty";
    empty.textContent = t("schemaUi.noFilesLoaded");
    schemaTreeEl.appendChild(empty);
  } else {
    renderSourceTreeNodes(schemaTreeEl, visibleSourceRoot, false);
    if (options.preserveScroll === true && !options.scrollSelectedIntoView) {
      schemaTreeEl.scrollTop = previousScrollTop;
    }
    scheduleSourceTreeVirtualRenderers();
  }

  if (options.renderDetail !== false) {
    scheduleDetailRenderAfterTree();
  }

  if (!treeOnly) {
    const generatedAt = formatGeneratedAt(schemaStore?.generatedAt || "");
    const errorText = schemaStore?.errors?.length ? ` · ${schemaStore.errors.length} skipped` : "";
    const totalItemCount = groups.reduce((total, group) => total + getGroupItemCount(group), 0);
    setSchemaSummary(
      `${t("schemaStatus.explorerSummary", { visible: visibleGroups.length, total: groups.length, files: visibleFileCount, items: totalItemCount })}${generatedAt ? ` · ${generatedAt}` : ""}${errorText}`
    );
    updateMetadataSelectionState();
  }
  if (options.scrollSelectedIntoView) {
    scrollSelectedExplorerRowIntoView();
  }
  if (activeSidebarTab === "search" && hasSearchSidebarTab()) {
    renderSearchPanel();
  }
}

function runExplorerFind() {
  const term = getFindSearchTerm();
  if (!hasSearchSidebarTab()) {
    if (schemaFileFilterInput) {
      schemaFileFilterInput.value = term;
    }
    void runFileNameFilter();
    return;
  }

  activeSearchTerm = term;
  activeSearchIncludeAllNamespaces = getSearchIncludeAllNamespaces();
  activeSearchInstalledPackageNamespaces = getSelectedSearchInstalledPackageNamespaces();
  searchResultReachedMax = false;
  clearSearchDetailCaches();

  if (term) {
    openObjectKeys.clear();
    closedSourceFolderKeys.clear();
    clearMyOrgSearchLocalFiles();
  } else {
    clearMyOrgSearchLocalFiles();
  }

  renderSchema(term ? { renderDetail: false } : {});
  if (activeSidebarTab !== "search") {
    setSidebarTab("search");
  }

  if (term && !getSelectedSearchMetadataTypeIds().length) {
    setStatus(t("schemaStatus.searchingLocalFiles", { term: term }));
    setSchemaSummary(getExplorerSearchStatus(term));
    return;
  }

  if (term) {
    setStatus(t("schemaStatus.searchingLocalCache", { term: term }));
    setSchemaSummary(`${getExplorerSearchStatus(term)} ${t("schemaStatus.searchScopeNote")}`);
    return;
  }

  setSchemaSummary(getExplorerSearchStatus(term));
}

function clearSearchPanel() {
  if (schemaFolderSearchInput) {
    schemaFolderSearchInput.value = "";
  }
  void runFolderTreeSearch();
}

function getSelectedRetrieveNamespaceOptions() {
  return {
    includeInstalledPackages: getWorkspaceIncludeAllNamespaces(),
    installedPackageNamespaces: getSelectedWorkspaceInstalledPackageNamespaces()
  };
}

function getSelectedSearchNamespaceOptions() {
  return getSelectedRetrieveNamespaceOptions();
}

function getNamespaceScopeKey(options = getSelectedRetrieveNamespaceOptions()) {
  if (options.includeInstalledPackages === true) {
    return "all";
  }

  return getValidInstalledPackageNamespaces(options.installedPackageNamespaces || [])
    .sort((left, right) => left.localeCompare(right))
    .join(",") || "none";
}

function getFolderMetadataTypesForNamespaceScope(sourcePath = "", metadataTypes = [], namespaceOptions = {}) {
  const uniqueMetadataTypes = getExpandedObjectMetadataTypeIds(metadataTypes);
  if (folderNamespaceScopeByPath.get(sourcePath) !== getNamespaceScopeKey(namespaceOptions)) {
    return uniqueMetadataTypes;
  }

  return getUnloadedMetadataTypes(uniqueMetadataTypes);
}

function getInstalledPackageRetrieveLabel(installedPackageNamespaces = [], includeInstalledPackages = false) {
  if (includeInstalledPackages) {
    return " and all namespaces";
  }
  return installedPackageNamespaces.length
    ? ` and ${installedPackageNamespaces.length} namespace${installedPackageNamespaces.length === 1 ? "" : "s"}`
    : "";
}

const OBJECT_RELATED_METADATA_TYPE_IDS = OBJECT_CHILD_SOURCE_METADATA_CONFIGS
  .map((config) => config.metadataTypeIds?.[0])
  .filter(Boolean);

function getMissingObjectRelatedMetadataTypes(store = schemaStore) {
  const loadedTypes = new Set(store?.metadataTypes || []);
  if (!loadedTypes.has("objects")) {
    return [];
  }
  return OBJECT_RELATED_METADATA_TYPE_IDS
    .filter((metadataTypeId) => metadataTypeId && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataTypeId))
    .filter((metadataTypeId) => !loadedTypes.has(metadataTypeId));
}

function getExpandedObjectMetadataTypeIds(metadataTypes = []) {
  const typeIds = [...new Set(metadataTypes)].filter(Boolean);
  if (!typeIds.includes("objects")) {
    return typeIds;
  }

  const relatedTypeIds = OBJECT_RELATED_METADATA_TYPE_IDS
    .filter((metadataTypeId) => metadataTypeId && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataTypeId));
  const expandedTypeIds = [];
  typeIds.forEach((metadataTypeId) => {
    expandedTypeIds.push(metadataTypeId);
    if (metadataTypeId === "objects") {
      expandedTypeIds.push(...relatedTypeIds);
    }
  });
  return [...new Set(expandedTypeIds)];
}

async function retrieveSelectedMetadata() {
  const metadataTypes = getSelectedMetadataTypeIds();
  if (!metadataTypes.length) {
    setStatus(t("schemaStatus.selectAtLeastOneType"), true);
    return;
  }

  metadataActionInProgress = true;
  updateMetadataSelectionState();
  try {
    const { includeInstalledPackages, installedPackageNamespaces } = getSelectedRetrieveNamespaceOptions();
    const packageLabel = getInstalledPackageRetrieveLabel(installedPackageNamespaces, includeInstalledPackages);
    await retrieveMetadataTypes(metadataTypes, t("schemaStatus.selectedTypes", { count: metadataTypes.length, packageLabel }), {
      statusPrefix: t("schemaStatus.prefixLoadMetadata"),
      summaryPrefix: t("schemaStatus.prefixLoadingNames"),
      completionMessage: t("schemaStatus.loadedMetadataNames", { packageLabel }),
      includeInstalledPackages,
      installedPackageNamespaces,
      namesOnly: true,
      persist: false
    });
  } finally {
    metadataActionInProgress = false;
    updateMetadataSelectionState();
  }
}

async function clearSchema() {
  if (!session?.host) {
    setStatus(t("schemaStatus.missingSession"), true);
    return;
  }

  metadataActionInProgress = true;
  updateMetadataSelectionState();
  try {
    setStatus(t("schemaStatus.clearingCache"));
    setSchemaSummary(t("schemaStatus.clearingCache"));
    schemaStore = await clearSchemaObjectStore(session.host);
    globalThis.salesforceSchemaObjectStore = schemaStore;
    globalThis.salesforceSchemaObjectMap = {};
    resetMetadataWorkspaceCacheState();
    clearMyOrgBranchTreeLocalFiles();
    renderWorkspaceSettingsSelectors();
    renderMetadataSelectionIfVisible();
    renderChangedFilesList();
    renderSchema();
    setStatus(t("schemaStatus.clearAllDoneCache"));
    setSchemaSummary(t("schemaStatus.clearAllDoneReload"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    setSchemaSummary(message, true);
  } finally {
    metadataActionInProgress = false;
    updateMetadataSelectionState();
  }
}

function resetFolderTreeForReload() {
  invalidateFolderSearchCache();
  clearCompactMetadataSourceTreeCache();
  selectedNode = null;
  pendingDetailLineFocus = null;
  clearSourceNavigationHistory();
  detailRequestId += 1;
  activeFileFilterSearchRequestId += 1;
  activeSearchTerm = "";
  activeSearchIncludeAllNamespaces = false;
  activeSearchInstalledPackageNamespaces = [];
  searchResultReachedMax = false;
  activeSourceFolderPath = "";
  if (explorerFilterInput) {
    explorerFilterInput.value = "";
  }
  if (schemaFileFilterInput) {
    schemaFileFilterInput.value = "";
  }
  if (schemaFolderSearchInput) {
    schemaFolderSearchInput.value = "";
  }
  schemaFileFilterTerm = "";
  schemaFolderSearchTerm = "";
  describeCache.clear();
  metadataDetailCache.clear();
  toolingSourceDetailCache.clear();
  clearSearchDetailCaches();
  folderRetrieveInProgress.clear();
  folderNamespaceScopeByPath.clear();
  openObjectKeys.clear();
  closedSourceFolderKeys.clear();
  localSourceEntries.clear();
  restorePersistedManifestLocalFiles();
  myOrgSearchLocalPaths.clear();
  schemaStore = createFolderListOnlySchemaStore({
    ...schemaStore,
    availableMetadataTypes: availableMetadataTypes.map((metadataType) => ({ ...metadataType })),
    installedPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    subscriberPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    installedPackageNamespaces: availableInstalledPackages
      .map((installedPackage) => installedPackage.namespacePrefix)
      .filter(Boolean),
    defaultMetadataFolders: createDefaultMetadataFolderCache(availableMetadataTypes),
    defaultMetadataFolderNames: getDefaultMetadataFolderNames(),
    defaultNamespaceScope: getNamespaceScopeKey()
  });
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = {};
}

async function reloadFolderTree() {
  if (!session?.host || !session?.sid) {
    setStatus(t("schemaStatus.missingSession"), true);
    return;
  }

  if (metadataActionInProgress) {
    return;
  }

  closeSearchMetadataTypesMenu();
  metadataActionInProgress = true;
  updateMetadataSelectionState({ renderManifest: false });
  try {
    setStartupLoading(t("schemaStatus.reloadingCache"), {
      title: "Reloading Workspace",
      percent: 8
    });
    setStatus(t("schemaStatus.connectedClearingCache", { host: session.host }));
    setSchemaSummary(t("schemaStatus.clearingCacheBeforeReload"));
    await clearAllMetadataFolderCaches("reload");
    schemaStore = await clearSchemaObjectStore(session.host);
    globalThis.salesforceSchemaObjectStore = schemaStore;
    globalThis.salesforceSchemaObjectMap = {};
    resetMetadataWorkspaceCacheState();
    workspaceMetadataCacheLoadPromise = null;
    resetFolderTreeForReload();
    renderSchema({ renderDetail: false });

    setStatus(t("schemaStatus.connectedReloadingCache", { host: session.host }));
    setSchemaSummary(t("schemaStatus.reloadingFromSalesforce"));
    const discoveryWarnings = await refreshEndUserMetadataDiscovery();
    schemaStore = createFolderListOnlySchemaStore({
      ...schemaStore,
      availableMetadataTypes: availableMetadataTypes.map((metadataType) => ({ ...metadataType })),
      installedPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
      subscriberPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
      installedPackageNamespaces: availableInstalledPackages
        .map((installedPackage) => installedPackage.namespacePrefix)
        .filter(Boolean),
      defaultMetadataFolders: createDefaultMetadataFolderCache(availableMetadataTypes),
      defaultMetadataFolderNames: getDefaultMetadataFolderNames(),
      defaultNamespaceScope: getNamespaceScopeKey(),
      discoveryCachedAt: new Date().toISOString()
    });
    try {
      schemaStore = await saveSchemaObjectStoreWithDevLogging(session.host, schemaStore);
    } catch (_error) {
      // Keep the live discovery data in memory even if sync storage is unavailable.
    }
    globalThis.salesforceSchemaObjectStore = schemaStore;
    globalThis.salesforceSchemaObjectMap = {};
    updateSearchRunButtonState();
    const warnings = [...discoveryWarnings];

    renderWorkspaceSettingsSelectors();
    renderMetadataSelectionIfVisible({ renderManifest: false });
    renderSchema({ renderDetail: false });
    if (activeSidebarTab === "search") {
      renderSearchPanel();
    }

    const loadedWorkspace = await loadWorkspaceMetadataCache({ force: true });
    if (!loadedWorkspace) {
      return;
    }
    if (selectedNode?.type === "packageCreate") {
      renderPackageXmlCreateDetail();
    }

    if (warnings.length) {
      const warningText = warnings.slice(0, 3).join(" ");
      setStatus(t("schemaStatus.connectedReloadedWarnings", { host: session.host }), true);
      setSchemaSummary(t("schemaStatus.reloadedWithWarnings", { warnings: warningText }), true);
      return;
    }

    setStatus(t("schemaStatus.connectedReloaded", { host: session.host }));
    setSchemaSummary(t("schemaStatus.workspaceReloaded"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    setSchemaSummary(message, true);
  } finally {
    metadataActionInProgress = false;
    updateMetadataSelectionState({ renderManifest: false });
    hideStartupLoading();
  }
}

function normalizeSourceChildName(name = "") {
  return String(name || "").trim().replace(/^\/+|\/+$/g, "");
}

function createLocalSourceEntry(path, kind, content = "", options = {}) {
  const cleanPath = normalizeSourceChildName(path);
  if (!cleanPath) {
    throw new Error("Missing path.");
  }
  if (isRetiredMyFoldersPath(cleanPath)) {
    return null;
  }
  localSourceEntries.set(cleanPath, {
    kind,
    path: cleanPath,
    name: getSourceBaseName(cleanPath),
    parentPath: getParentSourcePath(cleanPath),
    content: kind === "file" ? content : "",
    searchTerm: options.searchTerm || "",
    recordId: options.recordId || "",
    metadataType: options.metadataType || "",
    typeLabel: options.typeLabel || "",
    metadataApiType: options.metadataApiType || "",
    metadataName: options.metadataName || "",
    label: options.label || "",
    fullName: options.fullName || "",
    fileName: options.fileName || "",
    apiVersion: options.apiVersion || "",
    status: options.status || "",
    namespacePrefix: options.namespacePrefix || "",
    codeSize: options.codeSize || "",
    lastModifiedDate: options.lastModifiedDate || "",
    lastModifiedByName: options.lastModifiedByName || "",
    salesforceUrl: options.salesforceUrl || "",
    deployInfo: options.deployInfo || null,
    contentKind: options.contentKind || (kind === "file" ? "source" : "folder"),
    sourceOrigin: options.sourceOrigin || "",
    localUid: options.localUid || "",
    autoOpen: options.autoOpen === true,
    autoRetrieve: options.autoRetrieve !== false,
    createdAt: options.createdAt || ""
  });
  invalidateExplorerSourceTreeCache();
  deletedSourcePaths.delete(cleanPath);
  for (const deletedPath of [...deletedSourcePaths]) {
    if (deletedPath.startsWith(`${cleanPath}/`)) {
      deletedSourcePaths.delete(deletedPath);
    }
  }
}

function createFallbackFieldSourceFile(selection = {}, field = {}) {
  const objectParts = splitSchemaKey(selection.objectKey);
  const fieldParts = splitSchemaKey(selection.fieldKey);
  const sourcePath = selection.sourcePath || `${SOURCE_DEFAULT_PREFIX}objects/${toSourceFileSegment(objectParts.apiName || selection.objectKey, "Object")}/fields/${toSourceFileSegment(fieldParts.apiName || selection.fieldKey, "Field")}.field-meta.xml`;
  const values = {
    fullName: `${objectParts.apiName}.${fieldParts.apiName}`,
    label: field.label || fieldParts.label,
    type: field.type,
    required: field.nillable === false,
    unique: field.unique,
    externalId: field.externalId,
    length: field.length,
    precision: field.precision,
    scale: field.scale,
    referenceTo: field.referenceTo,
    relationshipName: field.relationshipName,
    calculatedFormula: field.calculatedFormula,
    defaultValue: field.defaultValue,
    inlineHelpText: field.inlineHelpText
  };
  return createSourceFile(sourcePath, createMetadataXmlDocument("CustomField", values));
}

function isWorkspaceSettingsOpen() {
  return Boolean(workspaceSettingsPopupEl && !workspaceSettingsPopupEl.hidden);
}

function openWorkspaceSettingsPopup() {
  if (!workspaceSettingsPopupEl) {
    return;
  }

  workspaceSettingsReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : workspaceSettingsButton;
  renderWorkspaceSettingsSelectors({ force: true });
  if (searchMetadataTypesMenuEl) {
    searchMetadataTypesMenuEl.open = true;
  }
  if (searchInstalledPackagesMenuEl) {
    searchInstalledPackagesMenuEl.open = true;
  }
  workspaceSettingsPopupEl.hidden = false;
  workspaceSettingsButton?.setAttribute("aria-expanded", "true");
  workspaceSettingsCloseButton?.focus();
}

function closeWorkspaceSettingsPopup(options = {}) {
  if (!workspaceSettingsPopupEl || workspaceSettingsPopupEl.hidden) {
    return;
  }

  workspaceSettingsPopupEl.hidden = true;
  workspaceSettingsButton?.setAttribute("aria-expanded", "false");
  if (options.restoreFocus !== false) {
    workspaceSettingsReturnFocus?.focus?.();
  }
  workspaceSettingsReturnFocus = null;
}

function closeSearchMetadataTypesMenu() {
  if (workspaceFoldersMenuEl) {
    workspaceFoldersMenuEl.open = false;
  }
  if (workspaceNamespacesMenuEl) {
    workspaceNamespacesMenuEl.open = false;
  }
  if (searchMetadataTypesMenuEl) {
    searchMetadataTypesMenuEl.open = false;
  }
  if (searchInstalledPackagesMenuEl) {
    searchInstalledPackagesMenuEl.open = false;
  }
}

async function retrieveMetadataTypes(metadataTypes = [], label = t("schemaStatus.labelMetadata"), options = {}) {
  const uniqueMetadataTypes = getExpandedObjectMetadataTypeIds(metadataTypes);
  const statusPrefix = options.statusPrefix || t("schemaStatus.prefixLoadMetadata");
  const summaryPrefix = options.summaryPrefix || t("schemaStatus.prefixLoading");
  const completionMessage = options.completionMessage || t("schemaStatus.completeFor", { prefix: statusPrefix, label });
  const persist = options.persist !== false;
  if (!uniqueMetadataTypes.length) {
    setStatus(t("schemaStatus.noRetrievableType"), true);
    return false;
  }

  if (!session?.host || !session?.sid) {
    setStatus(t("schemaStatus.missingSession"), true);
    return false;
  }

  const currentStore = typeof options.getBaseStore === "function"
    ? options.getBaseStore()
    : schemaStore;

  try {
    const objectNamesOnly = options.objectNamesOnly === true || uniqueMetadataTypes.includes("objects");
    setStatus(`${statusPrefix} ${label} 0%`);
    setSchemaSummary(`${summaryPrefix} ${label}...`);
    const retrievedStore = await buildSchemaObjectStore(session.host, session.sid, {
      metadataTypes: uniqueMetadataTypes,
      includeInstalledPackages: options.includeInstalledPackages === true,
      installedPackageNamespaces: options.installedPackageNamespaces || [],
      namesOnly: options.namesOnly === true,
      objectNamesOnly,
      persist,
      onProgress(progress) {
        const message = formatRetrieveProgress(progress);
        setStatus(`${statusPrefix} ${label} ${message}`);
        setSchemaSummary(`${summaryPrefix} ${label}: ${message}`);
      }
    });
    if (typeof options.shouldApplyResult === "function" && !options.shouldApplyResult()) {
      return false;
    }

    const mergedStore = mergeRetrievedSchemaStore(currentStore, retrievedStore, uniqueMetadataTypes);
    schemaStore = persist
      ? await saveSchemaObjectStoreWithDevLogging(session.host, mergedStore)
      : mergedStore;
    clearCompactMetadataSourceTreeCache();
    globalThis.salesforceSchemaObjectStore = schemaStore;
    globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
    renderWorkspaceSettingsSelectors();
    clearCachesForMetadataTypes(uniqueMetadataTypes, {
      clearSearchDetails: options.clearSearchDetails !== false
    });
    if (options.render !== false) {
      renderMetadataSelectionIfVisible();
      renderSchema();
    }
    setStatus(completionMessage);
    if (options.loadSearchSupport !== false) {
      void loadSearchSupportDataForActiveSearch();
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    setSchemaSummary(message, true);
    return false;
  }
}

async function cacheOpenMetadataDiscovery() {
  if (!session?.host || !schemaStore) {
    return;
  }

  const installedPackageNamespaces = availableInstalledPackages
    .map((installedPackage) => installedPackage.namespacePrefix)
    .filter(Boolean);
  const nextStore = {
    ...createFolderListOnlySchemaStore(schemaStore),
    availableMetadataTypes: availableMetadataTypes.map((metadataType) => ({ ...metadataType })),
    installedPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    subscriberPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    installedPackageNamespaces,
    defaultMetadataFolders: createDefaultMetadataFolderCache(availableMetadataTypes),
    defaultMetadataFolderNames: getDefaultMetadataFolderNames(),
    defaultNamespaceScope: getNamespaceScopeKey(),
    discoveryCachedAt: new Date().toISOString()
  };

  try {
    schemaStore = await saveSchemaObjectStoreWithDevLogging(session.host, nextStore);
  } catch (_error) {
    // Keep the live discovery data for this session if sync storage cannot cache it.
  }
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
}

function getStartupMetadataIndexFolderSet() {
  const availableFolders = new Set(getSourceDefaultFolders());
  const folderNames = getDefaultMetadataFolderNames()
    .filter((folderName) => availableFolders.has(folderName));
  return new Set(folderNames);
}

function getMetadataIndexTypeIdsForFolderNames(folderNames = []) {
  const folderSet = new Set(folderNames);
  return availableMetadataTypes
    .filter((metadataType) => folderSet.has(getSourceFolderForMetadataDefinition(metadataType)))
    .map((metadataType) => metadataType.id)
    .filter((metadataTypeId) => metadataTypeId && !EXCLUDED_METADATA_FOLDER_IDS.has(metadataTypeId));
}

function getLoadedMetadataFolderNameSet(store = schemaStore) {
  return new Set(
    (store?.metadataTypes || [])
      .map((metadataTypeId) => getSourceFolderForMetadataType(metadataTypeId))
      .filter(Boolean)
  );
}

function getDeferredWorkspaceFolderNames(store = schemaStore) {
  const loadedFolderNames = getLoadedMetadataFolderNameSet(store);
  return [...getStartupMetadataIndexFolderSet()]
    .filter((folderName) => !loadedFolderNames.has(folderName));
}

function getStartupMetadataIndexTypeIds() {
  const startupFolderSet = getStartupMetadataIndexFolderSet();
  return getMetadataIndexTypeIdsForFolderNames([...startupFolderSet]);
}

function getAllMetadataIndexTypeIds() {
  return availableMetadataTypes
    .map((metadataType) => metadataType.id)
    .filter((metadataTypeId) => isRetrievableFolderMetadataType(metadataTypeId));
}

function getAllMetadataIndexFolderNames(metadataTypes = getAllMetadataIndexTypeIds()) {
  const folderNames = metadataTypes
    .map((metadataTypeId) => getSourceFolderForMetadataType(metadataTypeId))
    .filter(Boolean);
  return [...new Set(folderNames)].sort((left, right) => left.localeCompare(right));
}

function getMetadataIndexRetrieveTypeIds(metadataTypes = []) {
  return getExpandedObjectMetadataTypeIds(metadataTypes);
}

async function buildAndCacheStartupMetadataIndex(options = {}) {
  const metadataTypes = Array.isArray(options.metadataTypes) && options.metadataTypes.length
    ? [...new Set(options.metadataTypes)].filter((metadataTypeId) => isRetrievableFolderMetadataType(metadataTypeId))
    : getStartupMetadataIndexTypeIds();
  const retrieveInputMetadataTypes = Array.isArray(options.retrieveMetadataTypes)
    ? [...new Set(options.retrieveMetadataTypes)].filter((metadataTypeId) => isRetrievableFolderMetadataType(metadataTypeId))
    : metadataTypes;
  const retrieveMetadataTypes = getMetadataIndexRetrieveTypeIds(retrieveInputMetadataTypes);
  const startupFolderNames = Array.isArray(options.folderNames) && options.folderNames.length
    ? [...new Set(options.folderNames)].filter(Boolean)
    : [...getStartupMetadataIndexFolderSet()];
  const folderLabel = options.folderLabel || "default folders";
  if (!retrieveMetadataTypes.length) {
    return {
      recordCount: 0,
      warnings: [`No ${folderLabel} are available to load.`]
    };
  }

  const namespaceOptions = getSelectedRetrieveNamespaceOptions();
  const namespaceScopeKey = getNamespaceScopeKey(namespaceOptions);
  const namespaceLabel = getInstalledPackageRetrieveLabel(
    namespaceOptions.installedPackageNamespaces,
    namespaceOptions.includeInstalledPackages
  ) || " without namespaces";
  const objectNamesOnly = retrieveMetadataTypes.includes("objects");
  const shouldCacheObjectDescribes = retrieveMetadataTypes.includes("objects") && !objectNamesOnly;
  setStartupLoading(t("schemaStatus.loadingFolders", { count: startupFolderNames.length, folderLabel: folderLabel, namespaceLabel: namespaceLabel }), {
    title: "Loading Metadata Folders",
    percent: 32
  });

  logRuntimeTraceTransaction({
    direction: "user -> endUser",
    target: "build-schema-object-store",
    action: "request",
    host: session.host,
    metadataTypes,
    folderNames: startupFolderNames,
    objectNamesOnly,
    includeInstalledPackages: namespaceOptions.includeInstalledPackages,
    installedPackageNamespaces: namespaceOptions.installedPackageNamespaces
  });
  const retrievedStore = await buildSchemaObjectStore(session.host, session.sid, {
    metadataTypes: retrieveMetadataTypes,
    namesOnly: true,
    objectNamesOnly,
    includeObjectDescribeCache: shouldCacheObjectDescribes,
    includeInstalledPackages: namespaceOptions.includeInstalledPackages,
    installedPackageNamespaces: namespaceOptions.installedPackageNamespaces,
    persist: false,
    onProgress(progress) {
      const percent = 32 + (Math.max(0, Math.min(100, progress.percent || 0)) * 0.56);
      setStartupLoading(`${progress.detail || progress.label || t("schemaStatus.retrievingNames")}...`, {
        title: "Loading Metadata Folders",
        percent
      });
      setSchemaSummary(t("schemaStatus.loadingFoldersProgress", { progress: formatRetrieveProgress(progress) }));
    }
  });
  logRuntimeTraceTransaction({
    direction: "endUser -> user",
    target: "build-schema-object-store",
    action: "response",
    host: session.host,
    store: createRuntimeTraceSchemaStoreSummary(retrievedStore)
  });
  const objectDescribeCount = cacheObjectDescribeMap(retrievedStore.objectDescribes);

  const schemaStoreSaveWarnings = [];
  const nextRetrievedStore = options.mergeExisting === true
    ? mergeRetrievedSchemaStore(schemaStore, retrievedStore, retrieveMetadataTypes)
    : retrievedStore;
  schemaStore = {
    ...nextRetrievedStore,
    availableMetadataTypes: availableMetadataTypes.map((metadataType) => ({ ...metadataType })),
    installedPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    subscriberPackages: availableInstalledPackages.map((installedPackage) => ({ ...installedPackage })),
    installedPackageNamespaces: availableInstalledPackages
      .map((installedPackage) => installedPackage.namespacePrefix)
      .filter(Boolean),
    defaultMetadataFolders: createDefaultMetadataFolderCache(availableMetadataTypes),
    defaultMetadataFolderNames: getDefaultMetadataFolderNames(),
    defaultNamespaceScope: namespaceScopeKey,
    discoveryCachedAt: schemaStore?.discoveryCachedAt || new Date().toISOString()
  };
  try {
    schemaStore = await saveSchemaObjectStoreWithDevLogging(session.host, schemaStore);
  } catch (error) {
    schemaStoreSaveWarnings.push(`Could not save the metadata cache: ${error instanceof Error ? error.message : String(error)}`);
  }
  globalThis.salesforceSchemaObjectStore = schemaStore;
  globalThis.salesforceSchemaObjectMap = schemaStore.map || {};

  setStartupLoading(t("schemaStatus.preparingCache"), {
    title: "Preparing Metadata Folders",
    percent: 92
  });
  const indexSnapshot = createCompactMetadataIndexSnapshot(schemaStore);
  const records = indexSnapshot.records;
  startupFolderNames.forEach((folderName) => {
    folderNamespaceScopeByPath.set(`${SOURCE_DEFAULT_PREFIX}${folderName}`, namespaceScopeKey);
  });
  const warnings = [
    ...(retrievedStore.errors || []).map((error) => error.message || String(error)),
    ...schemaStoreSaveWarnings
  ];
  try {
    const compactIndexGeneratedAt = new Date().toISOString();
    if (COMPACT_METADATA_INDEXEDDB_CACHE_ENABLED) {
      await saveCompactMetadataIndexRecords(session.host, records, {
        generatedAt: compactIndexGeneratedAt,
        metadataTypes: retrieveMetadataTypes,
        startupFolders: startupFolderNames,
        apiVersion: schemaStore.apiVersion || "",
        namespaceScope: namespaceScopeKey
      });
    }
    compactMetadataSourceRoot = indexSnapshot.root;
    compactMetadataIndexMeta = {
      id: "latest",
      host: session.host,
      generatedAt: compactIndexGeneratedAt,
      count: records.length,
      formatVersion: COMPACT_METADATA_INDEX_FORMAT_VERSION,
      metadataTypes: retrieveMetadataTypes,
      startupFolders: startupFolderNames,
      apiVersion: schemaStore.apiVersion || "",
      namespaceScope: namespaceScopeKey
    };
    invalidateExplorerSourceTreeCache();
  } catch (error) {
    warnings.push(`Could not save search data: ${error instanceof Error ? error.message : String(error)}`);
  }

  setStartupLoading(t("schemaStatus.loadedFolderFileRecords", { count: records.length }), {
    title: "Metadata Folders Ready",
    percent: 100
  });
  return {
    recordCount: records.length,
    objectDescribeCount,
    warnings
  };
}

function formatMetadataIndexResultSummary(prefix = t("schemaStatus.prefixLoaded"), indexResult = {}) {
  const parts = [t("schemaStatus.indexSummary", { prefix, count: indexResult.recordCount || 0 })];
  if (indexResult.objectDescribeCount) {
    parts.push(t("schemaStatus.indexObjectDescribes", { count: indexResult.objectDescribeCount }));
  }
  return `${parts.join(" · ")}${t("schemaStatus.sentenceEnd")}`;
}

let workspaceMetadataCacheLoadPromise = null;

async function loadWorkspaceMetadataCache(options = {}) {
  if (!session?.host || !session?.sid) {
    return false;
  }
  if (workspaceMetadataCacheLoadPromise) {
    return workspaceMetadataCacheLoadPromise;
  }

  workspaceMetadataCacheLoadPromise = (async () => {
    metadataActionInProgress = true;
    updateSearchRunButtonState();
    updateMetadataSelectionState({ renderManifest: false });
    try {
      const label = "default Files folders";
      setStartupLoading(t("schemaStatus.loadingLabelFromSalesforce", { label: label }), {
        title: "Loading Metadata Folders",
        percent: 18
      });
      setStatus(t("schemaStatus.loadingLabelFromSalesforce", { label: label }));
      setSchemaSummary(t("schemaStatus.loadingLabelFromSalesforce", { label: label }));

      if (!getSchemaDiscoveryCacheValidation(schemaStore).valid) {
        await refreshEndUserMetadataDiscovery();
      }

      const workspaceFolderNames = [...getStartupMetadataIndexFolderSet()];
      const workspaceMetadataTypes = getStartupMetadataIndexTypeIds();
      const indexResult = await buildAndCacheStartupMetadataIndex({
        metadataTypes: workspaceMetadataTypes,
        folderNames: workspaceFolderNames,
        folderLabel: "workspace folders"
      });
      renderWorkspaceSettingsSelectors({ force: true });
      renderMetadataSelectionIfVisible({ renderManifest: false });
      renderSchema({ renderDetail: false });
      if (activeSidebarTab === "search") {
        renderSearchPanel();
      }

      const warningText = indexResult.warnings?.length
        ? ` Warnings: ${indexResult.warnings.slice(0, 3).join(" ")}`
        : "";
      setStatus(indexResult.warnings?.length
        ? "Workspace folders loaded with warnings."
        : "Workspace folders loaded.");
      setSchemaSummary(`${formatMetadataIndexResultSummary(t("schemaStatus.prefixLoaded"), indexResult)}${warningText}`, Boolean(indexResult.warnings?.length));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, true);
      setSchemaSummary(message, true);
      return false;
    } finally {
      metadataActionInProgress = false;
      workspaceMetadataCacheLoadPromise = null;
      updateSearchRunButtonState();
      updateMetadataSelectionState({ renderManifest: false });
      hideStartupLoading();
    }
  })();
  return workspaceMetadataCacheLoadPromise;
}

function markDefaultFolderNamespaceScopes(store = schemaStore) {
  const namespaceScopeKey = store?.defaultNamespaceScope || getNamespaceScopeKey(getSelectedRetrieveNamespaceOptions());
  [...getStartupMetadataIndexFolderSet()].forEach((folderName) => {
    folderNamespaceScopeByPath.set(`${SOURCE_DEFAULT_PREFIX}${folderName}`, namespaceScopeKey);
  });
}

async function ensureFilesTabWorkspaceFoldersLoaded(options = {}) {
  if (!session?.host || !session?.sid || activeSidebarTab !== "explorer") {
    return false;
  }

  if (hasFreshCompactMetadataSourceTree() && options.force !== true) {
    markCompactMetadataIndexNamespaceScopes();
    return true;
  }

  const cacheStatus = getWorkspaceFolderNameCacheValidation(schemaStore);
  if (cacheStatus.valid && options.force !== true) {
    markDefaultFolderNamespaceScopes(schemaStore);
    return true;
  }

  if (metadataActionInProgress && workspaceMetadataCacheLoadPromise) {
    return workspaceMetadataCacheLoadPromise;
  }

  if (options.force === true) {
    invalidateFolderSearchCache();
  }
  return loadWorkspaceMetadataCache({
    background: options.background === true
  });
}

async function refreshEndUserMetadataDiscovery(options = {}) {
  if (!session?.host || !session?.sid || !schemaStore) {
    return [];
  }

  const warnings = [];
  if (options.background === true) {
    setStatus(t("schemaStatus.refreshingList"));
  } else {
    setStatus(t("schemaStatus.loadingList"));
    setSchemaSummary(t("schemaStatus.loadingList"));
  }

  logRuntimeTraceTransaction({
    direction: "user -> endUser",
    target: "metadata-discovery",
    action: "request",
    host: session.host
  });
  const [metadataTypesResult, installedPackagesResult] = await Promise.allSettled([
    loadAvailableSchemaMetadataTypes(session.host, session.sid, {
      timeoutMs: getMetadataTypeLoadTimeoutMs()
    }),
    loadInstalledPackageNamespaces(session.host, session.sid, {
      timeoutMs: getInstalledPackageLoadTimeoutMs()
    })
  ]);
  logRuntimeTraceTransaction({
    direction: "endUser -> user",
    target: "metadata-discovery",
    action: "response",
    host: session.host,
    metadataTypeStatus: metadataTypesResult.status,
    metadataTypeCount: metadataTypesResult.status === "fulfilled" ? metadataTypesResult.value.length : 0,
    installedPackageStatus: installedPackagesResult.status,
    installedPackageCount: installedPackagesResult.status === "fulfilled" ? installedPackagesResult.value.length : 0
  });

  if (metadataTypesResult.status === "fulfilled") {
    availableMetadataTypes = metadataTypesResult.value;
  } else {
    const error = metadataTypesResult.reason;
    warnings.push(`Metadata type discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    availableMetadataTypes = availableMetadataTypes.length ? availableMetadataTypes : getSchemaMetadataTypes();
  }

  if (installedPackagesResult.status === "fulfilled") {
    availableInstalledPackages = installedPackagesResult.value;
  } else {
    const error = installedPackagesResult.reason;
    warnings.push(`Installed package discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    availableInstalledPackages = availableInstalledPackages.length ? availableInstalledPackages : [];
  }
  syncSchemaUiSettingsWithCachedDefaults(schemaStore);
  ensureSearchIncludesInstalledPackagesByDefault();

  renderWorkspaceSettingsSelectors();
  renderMetadataSelectionIfVisible({ renderManifest: false });

  await cacheOpenMetadataDiscovery();
  return warnings;
}

async function loadSession() {
  const host = params.get("host");
  setStartupLoading(host ? `Connecting to ${host}...` : "Finding active Salesforce session...", {
    title: `Opening ${schemaRuntimeFeatureLabel}`,
    percent: 4
  });
  setStatus(host ? `Connecting to ${host}...` : "Finding active Salesforce session...");
  setSchemaSummary(host ? `Connecting to ${host}...` : "Finding active Salesforce session...");

  try {
    session = await withStartupTimeout(
      host ? getSessionForHost(host) : getActiveSession(),
      getSessionLoadTimeoutMs(),
      "Timed out while loading the Salesforce session. Open a Salesforce tab and reopen this page."
    );

    setStartupLoading(t("schemaStatus.loadingCache"), {
      title: `Opening ${schemaRuntimeFeatureLabel}`,
      percent: 12
    });
    setStatus(t("schemaStatus.connectedLoadingCache", { host: session.host }));
    setSchemaSummary(t("schemaStatus.loadingCache"));
    schemaStore = await loadSchemaObjectStoreWithDevLogging(session.host);
    if (schemaStore.availableMetadataTypes?.length) {
      availableMetadataTypes = schemaStore.availableMetadataTypes;
    } else {
      availableMetadataTypes = getSchemaMetadataTypes();
    }
    if (schemaStore.installedPackages?.length || schemaStore.subscriberPackages?.length) {
      availableInstalledPackages = schemaStore.installedPackages?.length
        ? schemaStore.installedPackages
        : schemaStore.subscriberPackages;
    } else {
      availableInstalledPackages = [];
    }
    clearCompactMetadataSourceTreeCache();
    syncSchemaUiSettingsWithCachedDefaults(schemaStore);
    ensureSearchIncludesInstalledPackagesByDefault();
    const hasValidCompactRecordCache = hasFreshCompactMetadataSourceTree();
    const hasValidWorkspaceCache = hasValidCompactRecordCache || getWorkspaceFolderNameCacheValidation(schemaStore).valid;
    if (!hasValidWorkspaceCache) {
      schemaStore = createFolderListOnlySchemaStore(schemaStore);
    }
    schemaUiSettings = {
      ...schemaUiSettings,
      searchIncludeAllNamespaces: false,
      searchInstalledPackageNamespaces: []
    };
    saveSchemaUiSettings();
    selectedPackageMembers.clear();
    packageSelectionTreeDirty = true;
    editedDetailFileContents.clear();
    detailFileBaselineContents.clear();
    changedDetailFiles.clear();
    selectedChangedFileKeys.clear();
    selectedChangedFileKey = "";
    describeCache.clear();
    metadataDetailCache.clear();
    toolingSourceDetailCache.clear();
    clearSearchDetailCaches();
    restorePersistedManifestLocalFiles();
    folderRetrieveInProgress.clear();
    folderNamespaceScopeByPath.clear();
    if (hasValidCompactRecordCache) {
      markCompactMetadataIndexNamespaceScopes();
    } else if (hasValidWorkspaceCache) {
      markDefaultFolderNamespaceScopes(schemaStore);
    }
    activeSearchTerm = "";
    activeSearchInstalledPackageNamespaces = [];
    activeFileFilterSearchRequestId += 1;
    activeSourceFolderPath = "";
    globalThis.salesforceSchemaObjectStore = schemaStore;
    globalThis.salesforceSchemaObjectMap = schemaStore.map || {};
    renderWorkspaceSettingsSelectors();
    renderMetadataSelectionIfVisible();
    renderSchema();
    updateSearchRunButtonState();
    setStatus(t("schemaStatus.connectedFeatureReady", { host: session.host, feature: schemaRuntimeFeatureLabel }));
    setSchemaSummary(hasValidCompactRecordCache
      ? "Files folders loaded for this session. Click a file to retrieve body."
      : "Metadata folder list is ready. Loading default Files folders...");
    if (activeSidebarTab === "explorer") {
      void ensureFilesTabWorkspaceFoldersLoaded();
    }
  } finally {
    hideStartupLoading();
  }
}

explorerFindButton?.addEventListener("click", runExplorerFind);
filesNavBackButton?.addEventListener("click", () => navigateSourceHistory("back"));
filesNavForwardButton?.addEventListener("click", () => navigateSourceHistory("forward"));
updateSourceNavigationControls();
schemaTreeEl?.addEventListener("contextmenu", handleManifestTreeContextMenu);
schemaPackageTreeEl?.addEventListener("contextmenu", handleManifestTreeContextMenu);
document.addEventListener("click", closeManifestContextMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeManifestContextMenu();
  }
});
schemaFileFilterButton?.addEventListener("click", () => void runFileNameFilter());
schemaFileFilterInput?.addEventListener("input", () => {
  clearFileNameFilterIfInputEmpty();
  updateFileFilterInlineSuggestions();
});
schemaFileFilterInput?.addEventListener("search", () => {
  clearFileNameFilterIfInputEmpty();
  updateFileFilterInlineSuggestions();
});
schemaFileFilterInput?.addEventListener("focus", updateFileFilterInlineSuggestions);
schemaFileFilterInput?.addEventListener("blur", () => {
  window.setTimeout(hideFileFilterInlineSuggestions, 120);
});
schemaFileFilterInput?.addEventListener("keydown", handleFileFilterKeydown);
schemaFolderSearchButton?.addEventListener("click", () => void runFolderTreeSearch());
schemaFolderSearchInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  void runFolderTreeSearch();
});
schemaFolderSearchInput?.addEventListener("input", updateSearchRunButtonState);
searchClearButton?.addEventListener("click", clearSearchPanel);
retrieveMetadataButton?.addEventListener("click", () => void retrieveSelectedMetadata());
clearSchemaButton?.addEventListener("click", () => void clearSchema());
reloadFolderTreeButton?.addEventListener("click", () => void reloadFolderTree());
changedCheckAllInput?.addEventListener("change", () => toggleAllChangedFiles(changedCheckAllInput.checked));
deploySelectedChangedButton?.addEventListener("click", () => void deploySelectedChangedFiles());
validateSelectedChangedButton?.addEventListener("click", () => void validateSelectedChangedFiles());
discardSelectedChangedButton?.addEventListener("click", () => void discardSelectedChangedFiles());
workspaceSettingsButton?.addEventListener("click", () => {
  if (isWorkspaceSettingsOpen()) {
    closeWorkspaceSettingsPopup();
  } else {
    openWorkspaceSettingsPopup();
  }
});
workspaceSettingsCloseButton?.addEventListener("click", () => closeWorkspaceSettingsPopup());
workspaceSettingsPopupEl?.addEventListener("click", (event) => {
  if (event.target === workspaceSettingsPopupEl) {
    closeWorkspaceSettingsPopup({ restoreFocus: false });
  }
});
schemaBodySearchButton?.addEventListener("click", () => void runBodySearch());
schemaBodySearchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runBodySearch();
  }
});
schemaBodySearchInput?.addEventListener("search", () => {
  if (!schemaBodySearchInput.value.trim()) void runBodySearch();
});
searchClearButton?.addEventListener("click", () => {
  if (schemaBodySearchInput) schemaBodySearchInput.value = "";
  void runBodySearch();
});
explorerTabButton?.addEventListener("click", () => setSidebarTab("explorer"));
searchTabButton?.addEventListener("click", () => setSidebarTab("search"));
changedTabButton?.addEventListener("click", () => setSidebarTab("changed"));
packageTabButton?.addEventListener("click", () => setSidebarTab("package"));
schemaChangeSetsTabEl?.addEventListener("click", () => setSidebarTab("changeSets"));
schemaChangeSetsRefreshEl?.addEventListener("click", () => void loadOutboundChangeSets({ force: true }));
workspaceFoldersMenuEl?.addEventListener("toggle", () => {
  if (!workspaceFoldersMenuEl.open) {
    return;
  }
  renderWorkspaceFolderSelector();
  if (workspaceFoldersOptionsEl) {
    workspaceFoldersOptionsEl.scrollTop = 0;
  }
});
workspaceNamespacesMenuEl?.addEventListener("toggle", () => {
  if (!workspaceNamespacesMenuEl.open) {
    return;
  }
  renderWorkspaceInstalledPackageSelector();
  if (!getWorkspaceNamespaceCandidates().length) {
    void ensureWorkspaceNamespaceCandidatesLoaded();
  }
  if (workspaceNamespacesOptionsEl) {
    workspaceNamespacesOptionsEl.scrollTop = 0;
  }
});
searchMetadataTypesMenuEl?.addEventListener("toggle", () => {
  if (!searchMetadataTypesMenuEl.open) {
    return;
  }
  renderSearchMetadataTypeSelector();
  if (searchMetadataTypesOptionsEl) {
    searchMetadataTypesOptionsEl.scrollTop = 0;
  }
});
searchInstalledPackagesMenuEl?.addEventListener("toggle", () => {
  if (!searchInstalledPackagesMenuEl.open) {
    return;
  }
  renderSearchInstalledPackageSelector();
  if (searchInstalledPackagesOptionsEl) {
    searchInstalledPackagesOptionsEl.scrollTop = 0;
  }
});
document.addEventListener("click", (event) => {
  const clickedWorkspaceSettingsButton = workspaceSettingsButton?.contains(event.target);
  const clickedWorkspaceSettingsPanel = workspaceSettingsPanelEl?.contains(event.target);
  if (isWorkspaceSettingsOpen() && !clickedWorkspaceSettingsButton && !clickedWorkspaceSettingsPanel) {
    closeWorkspaceSettingsPopup({ restoreFocus: false });
  }
  const clickedSearchMenu = searchMetadataTypesMenuEl?.contains(event.target)
    || searchInstalledPackagesMenuEl?.contains(event.target)
    || workspaceFoldersMenuEl?.contains(event.target)
    || workspaceNamespacesMenuEl?.contains(event.target);
  if (!clickedSearchMenu && !clickedWorkspaceSettingsPanel && !clickedWorkspaceSettingsButton) {
    closeSearchMetadataTypesMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (isWorkspaceSettingsOpen()) {
      closeWorkspaceSettingsPopup();
      event.preventDefault();
      return;
    }
    closeSearchMetadataTypesMenu();
  }
});
window.addEventListener("blur", () => {
  closeWorkspaceSettingsPopup({ restoreFocus: false });
  closeSearchMetadataTypesMenu();
});
window.addEventListener("app-language-change", () => {
  renderSchema({ renderDetail: false });
  if (activeSidebarTab === "package") {
    renderPackageXmlTree({ preserveScroll: true });
  }
  if (activeSidebarTab === "changeSets") {
    renderOutboundChangeSets(outboundChangeSets.length ? "" : t("schema.changeSetsEmpty"));
    renderOutboundChangeSetSourceList();
    if (outboundChangeSetSource) {
      setOutboundChangeSetSummary(t("schema.changeSetSourceLoaded", {
        name: selectedOutboundChangeSetName,
        count: outboundChangeSetSource.files.length
      }));
    } else if (!outboundChangeSetSourceLoading) {
      setOutboundChangeSetSummary(t("schema.changeSetSelect"));
    }
  }
  renderMetadataSelectionIfVisible();
});
window.addEventListener("pagehide", releaseRuntimeMemory);
schemaTreeEl.addEventListener("scroll", () => {
  scheduleSourceTreeVirtualRenderers();
}, { passive: true });
schemaSearchResultsTreeEl?.addEventListener("scroll", () => {
  scheduleSourceTreeVirtualRenderers();
}, { passive: true });
schemaPackageTreeEl?.addEventListener("scroll", () => {
  scheduleSourceTreeVirtualRenderers();
}, { passive: true });
applySchemaUiSettings();
initializeSidebarResizer();
initializeDetailsToggle();
renderSchemaBreadcrumb("");

loadRuntimeUiPreferences()
  .then(() => {
    applySchemaUiSettings();
    const storedWidth = getStoredSidebarWidth();
    if (storedWidth) {
      setSidebarWidth(storedWidth);
    }
    setDetailsCollapsed(detailsCollapsed, { persist: false });
    return loadSession();
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    setSchemaSummary(message, true);
    renderEmptyDetail(message);
  });
