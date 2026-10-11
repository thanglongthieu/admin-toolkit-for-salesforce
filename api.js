import {
  normalizeSourcePath,
  SOURCE_DEFAULT_PREFIX,
  SOURCE_PROJECT_PREFIX,
  stripDefaultSourcePrefix,
  toDefaultSourcePath
} from "./metadata-source-paths.js";
import {
  buildIdListLiteral,
  escapeSoqlLiteral,
  isSafeSalesforceName,
  isSalesforceId
} from "./permission-access.js";

export async function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({
          ok: false,
          error: runtimeError.message || String(runtimeError),
          logs: []
        });
        return;
      }

      resolve(response);
    });
  });
}

export const SALESFORCE_API_VERSION = "v67.0";
const SCHEMA_DESCRIBE_CONCURRENCY = 6;
const METADATA_SEARCH_SOSL_CONCURRENCY = 4;
const TOOLING_CODE_CONTENT_SNIPPET_LIMIT = 3;
const METADATA_DETAIL_TEXT_SEARCH_BATCH_SIZE = 10;
const METADATA_DETAIL_TEXT_SEARCH_CONCURRENCY = 2;
const METADATA_DETAIL_TEXT_SEARCH_DEFAULT_SCAN_LIMIT = 320;
const METADATA_DETAIL_TEXT_SEARCH_MAX_SCAN_LIMIT = 1000;
const DEFAULT_SCHEMA_METADATA_TYPES = ["objects"];
const DEFAULT_SOURCE_BASE_FOLDERS = ["objects"];
const COMPACT_METADATA_INDEX_DB_PREFIX = "sf-metadata-folder-index";
const COMPACT_METADATA_INDEX_RECORD_STORE = "records";
const COMPACT_METADATA_INDEX_META_STORE = "meta";
const COMPACT_METADATA_INDEX_DB_VERSION = 15;
const METADATA_RETRIEVE_POLL_INTERVAL_MS = 2000;
const METADATA_RETRIEVE_MAX_POLLS = 120;
const EXCLUDED_SCHEMA_METADATA_API_TYPES = new Set([
  "Dashboard",
  "DashboardFolder",
  "Report",
  "ReportFolder",
  "ReportType"
]);
const FOLDER_METADATA_API_TYPES = {
  Document: "DocumentFolder",
  EmailTemplate: "EmailFolder"
};
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
const COMMON_METADATA_SEARCH_TYPE_PRIORITY = new Map([
  ["objects", 0],
  ["customobject", 0],
  ["entitydefinition", 0],
  ["object", 0],
  ["customfields", 1],
  ["customfield", 1],
  ["fielddefinition", 1],
  ["field", 1],
  ["apexclasses", 2],
  ["apexclass", 2],
  ["apextriggers", 2],
  ["apextrigger", 2],
  ["apexpages", 2],
  ["apexpage", 2],
  ["apexcomponents", 2],
  ["apexcomponent", 2],
  ["lwcbundles", 2],
  ["lightningcomponentbundle", 2],
  ["aurabundles", 2],
  ["auradefinitionbundle", 2],
  ["flows", 2],
  ["flow", 2],
  ["recordtypes", 3],
  ["recordtype", 3],
  ["validationrules", 3],
  ["validationrule", 3],
  ["layouts", 3],
  ["layout", 3],
  ["weblinks", 3],
  ["weblink", 3]
]);
const METADATA_DETAIL_TEXT_SEARCH_TARGETS = [
  {
    metadataType: "customFields",
    metadataApiType: "CustomField",
    label: "Custom Field",
    fields: [
      { label: "Field Description", keys: ["description", "Description"] },
      { label: "Inline Help", keys: ["inlineHelpText", "InlineHelpText"] },
      { label: "Formula", keys: ["formula", "calculatedFormula", "Formula", "CalculatedFormula"] },
      { label: "Default Value", keys: ["defaultValue", "DefaultValue"] }
    ]
  },
  {
    metadataType: "validationRules",
    metadataApiType: "ValidationRule",
    label: "Validation Rule",
    fields: [
      { label: "Validation Description", keys: ["description", "Description"] },
      { label: "Validation Formula", keys: ["errorConditionFormula", "ErrorConditionFormula"] },
      { label: "Error Message", keys: ["errorMessage", "ErrorMessage"] }
    ]
  }
];

const METADATA_API_SETTINGS_TYPES = [
  "AccountSettings",
  "ActivitiesSettings",
  "AnalyticsSettings",
  "ApexSettings",
  "CaseSettings",
  "ChatterSettings",
  "CommunitiesSettings",
  "CompanySettings",
  "ContentSettings",
  "ContractSettings",
  "CurrencySettings",
  "EmailAdministrationSettings",
  "EmailIntegrationSettings",
  "EntitlementSettings",
  "ExperienceBundleSettings",
  "FlowSettings",
  "ForecastingSettings",
  "KnowledgeSettings",
  "LanguageSettings",
  "LightningExperienceSettings",
  "LiveAgentSettings",
  "MobileSettings",
  "NameSettings",
  "NotificationsSettings",
  "OmniChannelSettings",
  "OpportunitySettings",
  "OrderSettings",
  "OrgPreferenceSettings",
  "PathAssistantSettings",
  "PicklistSettings",
  "PlatformEncryptionSettings",
  "PortalSettings",
  "ProductSettings",
  "QuoteSettings",
  "SecuritySettings",
  "SharingSettings",
  "SiteSettings",
  "Territory2Settings"
];

const BASE_SCHEMA_METADATA_TYPE_DEFINITIONS = [
  {
    id: "applications",
    label: "Applications",
    itemLabel: "Application",
    kind: "metadata",
    metadataApiType: "CustomApplication",
    directoryName: "applications",
    suffix: "app",
    defaultSelected: false
  },
  {
    id: "objects",
    label: "Objects",
    itemLabel: "Object",
    kind: "objects",
    metadataApiType: "CustomObject",
    directoryName: "objects",
    sourceFolder: "objects"
  },
  {
    id: "customFields",
    label: "Custom Fields",
    itemLabel: "Custom Field",
    kind: "metadata",
    metadataApiType: "CustomField",
    listWithToolingApi: true,
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "field",
    defaultSelected: false
  },
  {
    id: "recordTypes",
    label: "Record Types",
    itemLabel: "Record Type",
    kind: "metadata",
    metadataApiType: "RecordType",
    listWithToolingApi: true,
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "recordType",
    defaultSelected: false
  },
  {
    id: "fieldSets",
    label: "Field Sets",
    itemLabel: "Field Set",
    kind: "metadata",
    metadataApiType: "FieldSet",
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "fieldSet",
    defaultSelected: false
  },
  {
    id: "validationRules",
    label: "Validation Rules",
    itemLabel: "Validation Rule",
    kind: "metadata",
    metadataApiType: "ValidationRule",
    listWithToolingApi: true,
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "validationRule",
    defaultSelected: false
  },
  {
    id: "listViews",
    label: "List Views",
    itemLabel: "List View",
    kind: "metadata",
    metadataApiType: "ListView",
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "listView",
    defaultSelected: false
  },
  {
    id: "compactLayouts",
    label: "Compact Layouts",
    itemLabel: "Compact Layout",
    kind: "metadata",
    metadataApiType: "CompactLayout",
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "compactLayout",
    defaultSelected: false
  },
  {
    id: "businessProcesses",
    label: "Business Processes",
    itemLabel: "Business Process",
    kind: "metadata",
    metadataApiType: "BusinessProcess",
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "businessProcess",
    defaultSelected: false
  },
  {
    id: "webLinks",
    label: "Web Links",
    itemLabel: "Web Link",
    kind: "metadata",
    metadataApiType: "WebLink",
    listWithToolingApi: true,
    directoryName: "objects",
    sourceFolder: "objects",
    suffix: "webLink",
    defaultSelected: false
  },
  {
    id: "contentassets",
    label: "Content Assets",
    itemLabel: "Content Asset",
    kind: "metadata",
    metadataApiType: "ContentAsset",
    directoryName: "contentassets",
    suffix: "asset",
    defaultSelected: false
  },
  {
    id: "customMetadata",
    label: "Custom Metadata",
    itemLabel: "Custom Metadata",
    kind: "metadata",
    metadataApiType: "CustomMetadata",
    directoryName: "customMetadata",
    suffix: "md",
    defaultSelected: false
  },
  {
    id: "duplicateRules",
    label: "Duplicate Rules",
    itemLabel: "Duplicate Rule",
    kind: "metadata",
    metadataApiType: "DuplicateRule",
    directoryName: "duplicateRules",
    suffix: "duplicateRule",
    defaultSelected: false
  },
  {
    id: "email",
    label: "Email Templates",
    itemLabel: "Email Template",
    kind: "metadata",
    metadataApiType: "EmailTemplate",
    folderMetadataApiType: "EmailFolder",
    directoryName: "email",
    suffix: "email",
    defaultSelected: false
  },
  {
    id: "flexipages",
    label: "FlexiPages",
    itemLabel: "FlexiPage",
    kind: "metadata",
    metadataApiType: "FlexiPage",
    directoryName: "flexipages",
    suffix: "flexipage",
    defaultSelected: false
  },
  {
    id: "globalValueSets",
    label: "Global Value Sets",
    itemLabel: "Global Value Set",
    kind: "metadata",
    metadataApiType: "GlobalValueSet",
    directoryName: "globalValueSets",
    suffix: "globalValueSet",
    defaultSelected: false
  },
  {
    id: "groups",
    label: "Groups",
    itemLabel: "Group",
    kind: "metadata",
    metadataApiType: "Group",
    directoryName: "groups",
    suffix: "group",
    defaultSelected: false
  },
  {
    id: "labels",
    label: "Labels",
    itemLabel: "Custom Labels",
    kind: "metadata",
    metadataApiType: "CustomLabels",
    directoryName: "labels",
    suffix: "labels",
    defaultSelected: false
  },
  {
    id: "layouts",
    label: "Layouts",
    itemLabel: "Layout",
    kind: "metadata",
    metadataApiType: "Layout",
    listWithToolingApi: true,
    directoryName: "layouts",
    suffix: "layout",
    defaultSelected: false
  },
  {
    id: "apexClasses",
    label: "Apex Classes",
    itemLabel: "Apex Class",
    kind: "tooling",
    queryObject: "ApexClass",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "NamespacePrefix", "ApiVersion", "Status", "IsValid", "LengthWithoutComments", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    detailFields: ["Body"],
    sizeField: "LengthWithoutComments",
    orderBy: "Name"
  },
  {
    id: "apexPages",
    label: "Apex Pages",
    itemLabel: "Apex Page",
    kind: "tooling",
    queryObject: "ApexPage",
    nameField: "Name",
    labelField: "MasterLabel",
    fields: ["Id", "Name", "NamespacePrefix", "ApiVersion", "MasterLabel", "Description", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    detailFields: ["Markup"],
    orderBy: "Name"
  },
  {
    id: "apexTriggers",
    label: "Apex Triggers",
    itemLabel: "Apex Trigger",
    kind: "tooling",
    queryObject: "ApexTrigger",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "NamespacePrefix", "ApiVersion", "Status", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    detailFields: ["Body"],
    sizeField: "LengthWithoutComments",
    orderBy: "Name"
  },
  {
    id: "apexComponents",
    label: "Apex Components",
    itemLabel: "Apex Component",
    kind: "tooling",
    queryObject: "ApexComponent",
    nameField: "Name",
    labelField: "MasterLabel",
    fields: ["Id", "Name", "NamespacePrefix", "ApiVersion", "MasterLabel", "Description", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    detailFields: ["Markup"],
    orderBy: "Name"
  },
  {
    id: "lwcBundles",
    label: "Lightning Web Components",
    itemLabel: "LWC Bundle",
    kind: "tooling",
    queryObject: "LightningComponentBundle",
    nameField: "DeveloperName",
    labelField: "MasterLabel",
    fields: ["Id", "DeveloperName", "NamespacePrefix", "MasterLabel", "ApiVersion", "Description", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    orderBy: "DeveloperName"
  },
  {
    id: "auraBundles",
    label: "Aura Bundles",
    itemLabel: "Aura Bundle",
    kind: "tooling",
    queryObject: "AuraDefinitionBundle",
    nameField: "DeveloperName",
    labelField: "DeveloperName",
    fields: ["Id", "DeveloperName", "NamespacePrefix", "CreatedDate", "LastModifiedDate", "LastModifiedBy.Name"],
    orderBy: "DeveloperName"
  },
  {
    id: "flows",
    label: "Flows",
    itemLabel: "Flow",
    kind: "tooling",
    queryObject: "Flow",
    metadataApiType: "Flow",
    directoryName: "flows",
    suffix: "flow",
    nameField: "MasterLabel",
    labelField: "MasterLabel",
    fields: ["Id", "MasterLabel", "VersionNumber", "Status", "ProcessType", "ApiVersion", "CreatedDate", "LastModifiedDate"],
    where: "Status = 'Active'",
    orderBy: "MasterLabel, VersionNumber DESC",
    latestActiveOnly: true
  },
  {
    id: "staticResources",
    label: "Static Resources",
    itemLabel: "Static Resource",
    kind: "data",
    queryObject: "StaticResource",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "NamespacePrefix", "ContentType", "CacheControl", "CreatedDate", "LastModifiedDate"],
    orderBy: "Name"
  },
  {
    id: "permissionsets",
    label: "Permission Sets",
    itemLabel: "Permission Set",
    kind: "metadata",
    metadataApiType: "PermissionSet",
    listWithToolingApi: true,
    directoryName: "permissionsets",
    suffix: "permissionset",
    defaultSelected: false
  },
  {
    id: "profiles",
    label: "Profiles",
    itemLabel: "Profile",
    kind: "metadata",
    metadataApiType: "Profile",
    listWithToolingApi: true,
    directoryName: "profiles",
    suffix: "profile",
    defaultSelected: false
  },
  {
    id: "quickActions",
    label: "Quick Actions",
    itemLabel: "Quick Action",
    kind: "metadata",
    metadataApiType: "QuickAction",
    directoryName: "quickActions",
    suffix: "quickAction",
    defaultSelected: false
  },
  {
    id: "remoteSiteSettings",
    label: "Remote Site Settings",
    itemLabel: "Remote Site Setting",
    kind: "metadata",
    metadataApiType: "RemoteSiteSetting",
    directoryName: "remoteSiteSettings",
    suffix: "remoteSite",
    defaultSelected: false
  },
  {
    id: "roles",
    label: "Roles",
    itemLabel: "Role",
    kind: "metadata",
    metadataApiType: "Role",
    directoryName: "roles",
    suffix: "role",
    defaultSelected: false
  },
  {
    id: "settings",
    label: "Settings",
    itemLabel: "Setting",
    kind: "metadata",
    metadataApiTypes: METADATA_API_SETTINGS_TYPES,
    directoryName: "settings",
    suffix: "settings",
    defaultSelected: false
  },
  {
    id: "sharingRules",
    label: "Sharing Rules",
    itemLabel: "Sharing Rules",
    kind: "metadata",
    metadataApiType: "SharingRules",
    directoryName: "sharingRules",
    suffix: "sharingRules",
    defaultSelected: false
  },
  {
    id: "tabs",
    label: "Tabs",
    itemLabel: "Tab",
    kind: "metadata",
    metadataApiType: "CustomTab",
    directoryName: "tabs",
    suffix: "tab",
    defaultSelected: false
  },
  {
    id: "workflows",
    label: "Workflows",
    itemLabel: "Workflow",
    kind: "metadata",
    metadataApiType: "Workflow",
    directoryName: "workflows",
    suffix: "workflow",
    defaultSelected: false
  }
];

let schemaMetadataTypeDefinitions = [...BASE_SCHEMA_METADATA_TYPE_DEFINITIONS];

function getPublicMetadataType(definition = {}) {
  return {
    id: definition.id,
    label: definition.label,
    itemLabel: definition.itemLabel,
    defaultSelected: definition.defaultSelected !== false,
    kind: definition.kind,
    metadataApiType: definition.metadataApiType || "",
    metadataApiTypes: Array.isArray(definition.metadataApiTypes) ? [...definition.metadataApiTypes] : [],
    directoryName: definition.directoryName || "",
    suffix: definition.suffix || "",
    sourceFolder: definition.sourceFolder || definition.directoryName || "",
    inFolder: definition.inFolder === true
  };
}

function getPublicMetadataTypes(definitions = schemaMetadataTypeDefinitions) {
  return definitions
    .filter((definition) => !isExcludedSchemaMetadataType(definition))
    .map((definition) => getPublicMetadataType(definition));
}

export const SCHEMA_METADATA_TYPES = getPublicMetadataTypes(BASE_SCHEMA_METADATA_TYPE_DEFINITIONS);

export function getSchemaMetadataTypes() {
  return getPublicMetadataTypes();
}

function getSourceFolderForMetadataDefinition(metadataType = {}) {
  return metadataType.sourceFolder
    || metadataType.directoryName
    || metadataType.id
    || "";
}

export function createDefaultMetadataFolderCache(metadataTypes = getSchemaMetadataTypes(), options = {}) {
  const folders = new Map();
  const baseFolders = Array.isArray(options.baseFolders) && options.baseFolders.length
    ? options.baseFolders
    : DEFAULT_SOURCE_BASE_FOLDERS;
  baseFolders.forEach((folderName) => {
    if (!folderName) {
      return;
    }
    folders.set(folderName, {
      name: folderName,
      path: `${SOURCE_DEFAULT_PREFIX}${folderName}`,
      label: "",
      metadataTypes: []
    });
  });

  (Array.isArray(metadataTypes) ? metadataTypes : []).forEach((metadataType) => {
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
      sourceFolder: folderName,
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

export const schemaObjectStore = {
  host: "",
  generatedAt: "",
  objectCount: 0,
  fieldCount: 0,
  map: {},
  metadata: {},
  metadataTypes: [],
  availableMetadataTypes: [],
  installedPackages: [],
  subscriberPackages: [],
  includeInstalledPackages: false,
  installedPackageNamespaces: [],
  defaultMetadataFolders: [],
  metadataItemCount: 0,
  details: {},
  errors: []
};

function createRuntimeError(response, fallbackMessage) {
  const error = new Error(response?.error || fallbackMessage);
  error.debugLogs = Array.isArray(response?.logs) ? response.logs : [];
  return error;
}

function createEmptySchemaObjectStore(host = "") {
  return {
    host: host || "",
    generatedAt: "",
    objectCount: 0,
    fieldCount: 0,
    map: {},
    metadata: {},
    metadataTypes: [],
    availableMetadataTypes: [],
    installedPackages: [],
    subscriberPackages: [],
    includeInstalledPackages: false,
    installedPackageNamespaces: [],
    defaultMetadataFolders: [],
    metadataItemCount: 0,
    details: {},
    errors: []
  };
}

function normalizeSchemaObjectStore(store = {}, host = "") {
  const metadata = store.metadata && typeof store.metadata === "object" ? { ...store.metadata } : {};
  let objectMap = store.map && typeof store.map === "object" ? store.map : {};

  if (!Object.keys(objectMap).length && metadata.objects?.items && typeof metadata.objects.items === "object") {
    objectMap = metadata.objects.items;
  }

  if (metadata.objects) {
    metadata.objects = {
      ...metadata.objects,
      items: metadata.objects.items && typeof metadata.objects.items === "object"
        ? metadata.objects.items
        : objectMap
    };
  } else if (Object.keys(objectMap).length) {
    metadata.objects = {
      id: "objects",
      label: "Objects",
      itemLabel: "Object",
      kind: "objects",
      count: Object.keys(objectMap).length,
      childCount: Object.values(objectMap).reduce((total, fieldMap) => total + getFieldKeysFromSchemaStore(fieldMap), 0),
      items: objectMap
    };
  }

  return {
    ...createEmptySchemaObjectStore(host),
    ...store,
    host: host || store.host || "",
    objectCount: store.objectCount || Object.keys(objectMap).length || 0,
    fieldCount: store.fieldCount || Object.values(objectMap).reduce(
      (total, fieldMap) => total + getFieldKeysFromSchemaStore(fieldMap),
      0
    ),
    map: objectMap,
    metadata,
    metadataTypes: Array.isArray(store.metadataTypes) ? store.metadataTypes : [],
    availableMetadataTypes: Array.isArray(store.availableMetadataTypes) ? store.availableMetadataTypes : [],
    installedPackages: Array.isArray(store.installedPackages) ? store.installedPackages : [],
    subscriberPackages: Array.isArray(store.subscriberPackages) ? store.subscriberPackages : [],
    includeInstalledPackages: store.includeInstalledPackages === true,
    installedPackageNamespaces: Array.isArray(store.installedPackageNamespaces) ? store.installedPackageNamespaces : [],
    defaultMetadataFolders: Array.isArray(store.defaultMetadataFolders) ? store.defaultMetadataFolders : [],
    metadataItemCount: store.metadataItemCount || 0,
    details: {},
    errors: Array.isArray(store.errors) ? store.errors : []
  };
}

function getFieldKeysFromSchemaStore(fieldMap) {
  if (Array.isArray(fieldMap)) {
    return fieldMap.length;
  }

  if (fieldMap && typeof fieldMap === "object") {
    return Object.keys(fieldMap).length;
  }

  return 0;
}

function updateSchemaObjectStore(store = {}) {
  const normalizedStore = normalizeSchemaObjectStore(store, store.host);
  schemaObjectStore.host = normalizedStore.host;
  schemaObjectStore.generatedAt = normalizedStore.generatedAt;
  schemaObjectStore.objectCount = normalizedStore.objectCount;
  schemaObjectStore.fieldCount = normalizedStore.fieldCount;
  schemaObjectStore.map = normalizedStore.map;
  schemaObjectStore.metadata = normalizedStore.metadata;
  schemaObjectStore.metadataTypes = normalizedStore.metadataTypes;
  schemaObjectStore.availableMetadataTypes = normalizedStore.availableMetadataTypes;
  schemaObjectStore.installedPackages = normalizedStore.installedPackages;
  schemaObjectStore.subscriberPackages = normalizedStore.subscriberPackages;
  schemaObjectStore.includeInstalledPackages = normalizedStore.includeInstalledPackages;
  schemaObjectStore.installedPackageNamespaces = normalizedStore.installedPackageNamespaces;
  schemaObjectStore.defaultMetadataFolders = normalizedStore.defaultMetadataFolders;
  schemaObjectStore.metadataItemCount = normalizedStore.metadataItemCount;
  schemaObjectStore.details = normalizedStore.details;
  schemaObjectStore.errors = normalizedStore.errors;
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
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("Browser storage is not available."));
  }

  const request = globalThis.indexedDB.open(getCompactMetadataIndexDbName(host), COMPACT_METADATA_INDEX_DB_VERSION);
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

function deleteIndexedDbDatabase(name = "") {
  if (!name || !globalThis.indexedDB) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result = true) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const request = globalThis.indexedDB.deleteDatabase(name);
      request.onsuccess = () => finish(true);
      request.onerror = () => finish(false);
      request.onblocked = () => globalThis.setTimeout(() => finish(false), 500);
    } catch (_error) {
      finish(false);
    }
  });
}

function createObjectSchemaKey(objectInfo = {}) {
  const apiName = objectInfo.name || objectInfo.apiName || objectInfo.QualifiedApiName || "";
  const label = objectInfo.label || objectInfo.labelPlural || apiName;
  return `${apiName}: ${label}`;
}

function createFieldSchemaKey(field = {}) {
  const apiName = field.name || field.apiName || "";
  const label = field.label || apiName;
  return `${apiName}: ${label}`;
}

function getMetadataTypeDefinition(metadataType) {
  return schemaMetadataTypeDefinitions.find((definition) => definition.id === metadataType);
}

function getSelectedMetadataTypes(options = {}) {
  const requestedTypes = Array.isArray(options.metadataTypes) && options.metadataTypes.length
    ? options.metadataTypes
    : DEFAULT_SCHEMA_METADATA_TYPES;
  const validTypes = requestedTypes.filter((metadataType) => getMetadataTypeDefinition(metadataType));
  return validTypes.length ? [...new Set(validTypes)] : DEFAULT_SCHEMA_METADATA_TYPES;
}

function reportSchemaProgress(options = {}, progress = {}) {
  if (typeof options.onProgress !== "function") {
    return;
  }

  options.onProgress({
    percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
    label: progress.label || "",
    detail: progress.detail || ""
  });
}

function shouldIncludeInstalledPackages(options = {}) {
  return options.includeInstalledPackages === true || getInstalledPackageNamespaceSet(options).size > 0;
}

function hasNamespacePrefix(record = {}) {
  return Boolean(String(record.NamespacePrefix || record.namespacePrefix || "").trim());
}

function getInstalledPackageNamespaceSet(options = {}) {
  return new Set(
    (Array.isArray(options.installedPackageNamespaces) ? options.installedPackageNamespaces : [])
      .map((namespacePrefix) => String(namespacePrefix || "").trim())
      .filter(Boolean)
  );
}

function getRecordNamespacePrefix(record = {}) {
  return String(record.NamespacePrefix || record.namespacePrefix || "").trim();
}

function getNamespacedApiNamePrefix(value = "") {
  const match = String(value || "").match(/^([A-Za-z][A-Za-z0-9_]*?)__.+__/);
  return match ? match[1] : "";
}

function isNamespacedApiName(value = "") {
  return Boolean(getNamespacedApiNamePrefix(value));
}

function isInstalledPackageComponent(record = {}) {
  const manageableState = String(record.manageableState || record.ManageableState || "").toLowerCase();
  if (manageableState && manageableState !== "unmanaged") {
    return true;
  }

  return hasNamespacePrefix(record)
    || isNamespacedApiName(record.name)
    || isNamespacedApiName(record.apiName)
    || isNamespacedApiName(record.DeveloperName)
    || isNamespacedApiName(record.Name)
    || isNamespacedApiName(record.fullName)
    || isNamespacedApiName(record.FullName)
    || isNamespacedApiName(record.fileName);
}

function getInstalledPackageComponentNamespace(record = {}) {
  return getRecordNamespacePrefix(record)
    || getNamespacedApiNamePrefix(record.name)
    || getNamespacedApiNamePrefix(record.apiName)
    || getNamespacedApiNamePrefix(record.DeveloperName)
    || getNamespacedApiNamePrefix(record.Name)
    || getNamespacedApiNamePrefix(record.fullName)
    || getNamespacedApiNamePrefix(record.FullName)
    || getNamespacedApiNamePrefix(record.fileName);
}

function shouldUseNamespaceInSourceName(metadataType = "") {
  return ["apexClasses", "apexPages", "apexTriggers", "apexComponents"].includes(String(metadataType || ""));
}

function getNamespacedSourceName(name = "", record = {}, metadataType = "") {
  const cleanName = String(name || "").trim();
  if (!cleanName || !shouldUseNamespaceInSourceName(metadataType)) {
    return cleanName;
  }

  const namespacePrefix = getInstalledPackageComponentNamespace(record);
  if (!namespacePrefix || cleanName.startsWith(`${namespacePrefix}__`)) {
    return cleanName;
  }

  return `${namespacePrefix}__${cleanName}`;
}

function shouldIncludeMetadataRecord(record = {}, options = {}) {
  if (!isInstalledPackageComponent(record)) {
    return options.includeUnmanagedMetadata !== false;
  }

  const namespaceSet = getInstalledPackageNamespaceSet(options);
  if (namespaceSet.size > 0) {
    return namespaceSet.has(getInstalledPackageComponentNamespace(record));
  }

  return options.includeInstalledPackages === true;
}

function getObjectApiNameFromInfo(objectInfo = {}) {
  return objectInfo.name || objectInfo.apiName || objectInfo.QualifiedApiName || objectInfo.Name || "";
}

function isExcludedObjectFolderName(objectApiName = "") {
  const name = String(objectApiName || "");
  return /(?:ChangeEvent|History|Share)$/i.test(name);
}

function isCustomObjectFolder(objectInfo = {}) {
  const objectApiName = getObjectApiNameFromInfo(objectInfo);
  return objectInfo.custom === true
    || objectInfo.isCustom === true
    || objectInfo.IsCustom === true
    || /__(?:b|c|e|mdt|x)$/i.test(objectApiName);
}

function isCommonStandardObjectFolder(objectInfo = {}) {
  return COMMON_STANDARD_OBJECT_API_NAMES.has(getObjectApiNameFromInfo(objectInfo));
}

function isCustomObjectField(field = {}) {
  const fieldApiName = field.name || field.apiName || field.QualifiedApiName || "";
  return field.custom === true
    || field.isCustom === true
    || field.IsCustom === true
    || /__c$/i.test(fieldApiName);
}

async function loadObjectInfosWithGlobalDescribe(host, sid, apiVersion) {
  const globalDescribe = await salesforceRequest(host, sid, `/services/data/${apiVersion}/sobjects`);
  return (Array.isArray(globalDescribe?.sobjects) ? globalDescribe.sobjects : [])
    .map((objectInfo) => ({
      ...objectInfo,
      name: objectInfo.name || objectInfo.QualifiedApiName || objectInfo.apiName || "",
      label: objectInfo.label || objectInfo.Label || objectInfo.QualifiedApiName || objectInfo.name || "",
      NamespacePrefix: objectInfo.NamespacePrefix || objectInfo.namespacePrefix || ""
    }))
    .filter((objectInfo) => objectInfo.name)
    .filter((objectInfo) => isCustomObjectFolder(objectInfo) || isCommonStandardObjectFolder(objectInfo));
}

async function loadObjectInfosForMetadataGroup(host, sid, apiVersion, options = {}) {
  return loadObjectInfosWithGlobalDescribe(host, sid, apiVersion);
}

function shouldIncludeObjectFolder(objectInfo = {}, customFieldObjectNames = new Set(), hasReliableCustomFieldMap = true, includeUnknownStandardObjects = true) {
  const objectApiName = getObjectApiNameFromInfo(objectInfo);
  if (!objectApiName || isExcludedObjectFolderName(objectApiName)) {
    return false;
  }

  if (isCustomObjectFolder(objectInfo)) {
    return true;
  }

  if (isCommonStandardObjectFolder(objectInfo)) {
    return true;
  }

  return hasReliableCustomFieldMap ? customFieldObjectNames.has(objectApiName) : includeUnknownStandardObjects;
}

function createMetadataItemKey(record = {}, definition = {}) {
  const rawApiName = record[definition.nameField] || record.fullName || record.DeveloperName || record.Name || record.Id || "";
  const apiName = getNamespacedSourceName(rawApiName, record, definition.id);
  const label = record[definition.labelField] || record.displayName || record.MasterLabel || record.Name || record.fullName || apiName;
  return `${apiName}: ${label}`;
}

function createNameLabelMetadataRecord(record = {}, definition = {}) {
  const minimalRecord = {};
  [
    "Id",
    "id",
    "Name",
    "DeveloperName",
    "MasterLabel",
    "displayName",
    "fullName",
    "FullName",
    "fileName",
    "type",
    "metadataApiType",
    "NamespacePrefix",
    "namespacePrefix",
    "ManageableState",
    "manageableState",
    "CreatedDate",
    "createdDate",
    "LastModifiedDate",
    "lastModifiedDate",
    "LastModifiedBy",
    "lastModifiedByName",
    "LengthWithoutComments",
    "lengthWithoutComments",
    "ApiVersion",
    "apiVersion",
    "Status",
    "status",
    "Description",
    "description",
    definition.nameField,
    definition.labelField
  ].filter(Boolean).forEach((fieldName) => {
    if (Object.prototype.hasOwnProperty.call(record, fieldName)) {
      minimalRecord[fieldName] = record[fieldName];
    }
  });
  return minimalRecord;
}

function createMetadataItem(record = {}, definition = {}, options = {}) {
  const key = createMetadataItemKey(record, definition);
  const { apiName, label } = splitSchemaStorageKey(key);
  const itemRecord = options.namesOnly === true
    ? createNameLabelMetadataRecord(record, definition)
    : record;
  return {
    key,
    apiName,
    label,
    id: record.Id || record.id || record.fullName || "",
    metadataType: definition.id,
    metadataObject: definition.queryObject || record.metadataApiType || definition.metadataApiType || "",
    record: itemRecord
  };
}

function filterMetadataRecords(records = [], definition = {}) {
  if (!definition.latestActiveOnly) {
    return records;
  }

  const seen = new Set();
  return [...records]
    .sort((left, right) => (right.VersionNumber || 0) - (left.VersionNumber || 0))
    .filter((record) => {
      const key = record.DefinitionId || record.DeveloperName || record.FullName || record.MasterLabel || record.Name || record.Id;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => String(left.MasterLabel || left.Name || "").localeCompare(String(right.MasterLabel || right.Name || "")));
}

function escapeSoqlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function createMetadataWhereClause(definition = {}, options = {}) {
  const conditions = [];
  if (definition.where) {
    conditions.push(`(${definition.where})`);
  }

  const namespaceSet = getInstalledPackageNamespaceSet(options);
  if (definition.fields.includes("NamespacePrefix")) {
    if (namespaceSet.size > 0) {
      const namespaces = [...namespaceSet].map((namespacePrefix) => `'${escapeSoqlString(namespacePrefix)}'`).join(", ");
      conditions.push(`(NamespacePrefix = null OR NamespacePrefix IN (${namespaces}))`);
    } else if (!shouldIncludeInstalledPackages(options)) {
      conditions.push("NamespacePrefix = null");
    }
  }

  return conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
}

function splitSchemaStorageKey(key) {
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

async function mapWithConcurrency(items, limit, worker) {
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
    { length: Math.min(limit, items.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function getMetadataApiVersion(apiVersion = SALESFORCE_API_VERSION) {
  return String(apiVersion || SALESFORCE_API_VERSION).replace(/^v/i, "");
}

function decodeXmlText(value = "") {
  return String(value || "").replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === "amp") {
      return "&";
    }
    if (entity === "lt") {
      return "<";
    }
    if (entity === "gt") {
      return ">";
    }
    if (entity === "quot") {
      return "\"";
    }
    if (entity === "apos") {
      return "'";
    }
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return match;
  });
}

function encodeXmlText(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getXmlLocalName(nodeName = "") {
  return String(nodeName || "").split(":").pop();
}

function getSimpleXmlDescendants(node, tagName = "*", results = []) {
  (node?.children || []).forEach((child) => {
    if (tagName === "*" || child.nodeName === tagName || child.localName === tagName) {
      results.push(child);
    }
    getSimpleXmlDescendants(child, tagName, results);
  });
  return results;
}

function createSimpleXmlElement(nodeName, rawAttributes = "") {
  const element = {
    __simpleXml: true,
    nodeType: 1,
    nodeName,
    localName: getXmlLocalName(nodeName),
    rawAttributes: rawAttributes || "",
    children: [],
    childNodes: [],
    parentNode: null,
    getElementsByTagName(tagName) {
      return getSimpleXmlDescendants(this, tagName);
    }
  };
  Object.defineProperty(element, "textContent", {
    enumerable: true,
    get() {
      return this.childNodes.map((child) => (
        typeof child === "string" ? child : child.textContent
      )).join("");
    }
  });
  return element;
}

function appendSimpleXmlChild(parent, child) {
  child.parentNode = parent;
  parent.children.push(child);
  parent.childNodes.push(child);
}

function appendSimpleXmlText(parent, text) {
  if (!parent || !text) {
    return;
  }
  parent.childNodes.push(decodeXmlText(text));
}

function createSimpleXmlDocument(documentElement) {
  return {
    __simpleXml: true,
    nodeType: 9,
    documentElement,
    children: documentElement ? [documentElement] : [],
    getElementsByTagName(tagName) {
      if (!this.documentElement) {
        return [];
      }
      const results = [];
      if (tagName === "*" || this.documentElement.nodeName === tagName || this.documentElement.localName === tagName) {
        results.push(this.documentElement);
      }
      return getSimpleXmlDescendants(this.documentElement, tagName, results);
    }
  };
}

function parseXmlDocumentFallback(xml = "") {
  const source = String(xml || "").replace(/^\uFEFF/, "");
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/\s*([A-Za-z_][\w:.-]*)\s*>|<\s*([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>|([^<]+)/g;
  const stack = [];
  let documentElement = null;
  let match = null;

  while ((match = tokenPattern.exec(source))) {
    const [token, cdataText, closeName, openName, rawAttributes, selfClosing, text] = match;
    if (!token) {
      continue;
    }

    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!DOCTYPE") || token.startsWith("<!doctype")) {
      continue;
    }

    if (typeof cdataText === "string") {
      appendSimpleXmlText(stack[stack.length - 1], cdataText);
      continue;
    }

    if (closeName) {
      const current = stack.pop();
      if (!current || current.nodeName !== closeName) {
        throw new Error(`Unable to parse Salesforce response. Unexpected closing tag: ${closeName}`);
      }
      continue;
    }

    if (openName) {
      const element = createSimpleXmlElement(openName, rawAttributes || "");
      const parent = stack[stack.length - 1];
      if (parent) {
        appendSimpleXmlChild(parent, element);
      } else if (!documentElement) {
        documentElement = element;
      } else {
        throw new Error("Unable to parse Salesforce response. Multiple root elements found.");
      }

      if (!selfClosing) {
        stack.push(element);
      }
      continue;
    }

    if (typeof text === "string") {
      appendSimpleXmlText(stack[stack.length - 1], text);
    }
  }

  if (stack.length) {
    throw new Error(`Unable to parse Salesforce response. Unclosed tag: ${stack[stack.length - 1].nodeName}`);
  }

  if (!documentElement) {
    throw new Error("Unable to parse Salesforce response.");
  }

  return createSimpleXmlDocument(documentElement);
}

function getElementsByLocalName(root, localName) {
  return Array.from(root?.getElementsByTagName?.("*") || [])
    .filter((element) => element.localName === localName || element.nodeName === localName);
}

function getFirstElementByLocalName(root, localName) {
  return getElementsByLocalName(root, localName)[0] || null;
}

function getDirectChildren(element) {
  return Array.from(element?.children || []);
}

function getDirectChildByLocalName(element, localName) {
  return getDirectChildren(element).find((child) => child.localName === localName || child.nodeName === localName) || null;
}

function getDirectChildText(element, localName) {
  return getDirectChildByLocalName(element, localName)?.textContent || "";
}

function isNilXmlElement(element) {
  const rawAttributes = String(element?.rawAttributes || "");
  if (/\b(?:xsi:)?nil\s*=\s*["']true["']/i.test(rawAttributes)) {
    return true;
  }

  if (!element?.getAttribute) {
    return false;
  }

  return ["nil", "xsi:nil"].some((attributeName) => (
    String(element.getAttribute(attributeName) || "").toLowerCase() === "true"
  ));
}

function parseXmlDocument(xml = "") {
  if (typeof DOMParser === "undefined") {
    return parseXmlDocumentFallback(xml);
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const parseError = document.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error(parseError.textContent || "Unable to parse Salesforce response.");
  }

  return document;
}

function serializeXmlElement(element) {
  if (!element) {
    return "";
  }

  if (!element.__simpleXml && typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(element);
  }

  const attributes = element.rawAttributes ? element.rawAttributes : "";
  const openTag = attributes ? `<${element.nodeName}${attributes}>` : `<${element.nodeName}>`;
  const body = (element.childNodes || []).map((child) => (
    typeof child === "string" ? encodeXmlText(child) : serializeXmlElement(child)
  )).join("");
  return `${openTag}${body}</${element.nodeName}>`;
}

const EMPTY_METADATA_SOAP_RESPONSE = "EMPTY_METADATA_SOAP_RESPONSE";

async function metadataSoapRequest(host, sid, apiVersion, bodyXml, options = {}) {
  const metadataVersion = getMetadataApiVersion(apiVersion);
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <SessionHeader xmlns="http://soap.sforce.com/2006/04/metadata">
      <sessionId>${escapeXml(sid)}</sessionId>
    </SessionHeader>
  </soapenv:Header>
  <soapenv:Body>${bodyXml}</soapenv:Body>
</soapenv:Envelope>`;
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0) || 0);
  const controller = !options.signal && timeoutMs > 0 ? new AbortController() : null;
  let didTimeout = false;
  const timeoutId = controller
    ? globalThis.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs)
    : null;

  try {
    const response = await fetch(`https://${host}/services/Soap/m/${metadataVersion}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "SOAPAction": "\"\""
      },
      body: envelope,
      signal: options.signal || controller?.signal
    });
    const text = await response.text();
    if (!text.trim()) {
      const error = new Error(
        response.ok
          ? "Salesforce returned an empty Metadata API response."
          : `Salesforce request failed with HTTP ${response.status}`
      );
      if (response.ok) error.code = EMPTY_METADATA_SOAP_RESPONSE;
      throw error;
    }
    const document = parseXmlDocument(text);
    const faultString = getFirstElementByLocalName(document, "faultstring")?.textContent;

    if (!response.ok || faultString) {
      throw new Error(faultString || `Salesforce request failed with HTTP ${response.status}`);
    }

    return document;
  } catch (error) {
    if (didTimeout || (controller && error?.name === "AbortError")) {
      throw new Error(`Salesforce request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function xmlElementToObject(element) {
  const children = getDirectChildren(element);
  if (!children.length) {
    return element.textContent || "";
  }

  const result = {};
  children.forEach((child) => {
    const value = xmlElementToObject(child);
    const key = child.localName || child.nodeName;
    if (Object.hasOwn(result, key)) {
      result[key] = Array.isArray(result[key]) ? result[key] : [result[key]];
      result[key].push(value);
    } else {
      result[key] = value;
    }
  });
  return result;
}

function textToBoolean(value = "") {
  return String(value || "").toLowerCase() === "true";
}

function toMetadataTypeLabel(value = "") {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function getFolderMetadataApiType(metadataApiType = "") {
  return FOLDER_METADATA_API_TYPES[metadataApiType] || `${metadataApiType}Folder`;
}

function getDefinitionMetadataApiTypes(definition = {}) {
  return [
    definition.metadataApiType,
    definition.queryObject,
    ...(Array.isArray(definition.metadataApiTypes) ? definition.metadataApiTypes : [])
  ].filter(Boolean);
}

function isExcludedSchemaMetadataType(definition = {}) {
  return getDefinitionMetadataApiTypes(definition)
    .some((metadataApiType) => EXCLUDED_SCHEMA_METADATA_API_TYPES.has(metadataApiType));
}

function parseMetadataDescribeObject(element) {
  const xmlName = getDirectChildText(element, "xmlName");
  const directoryName = getDirectChildText(element, "directoryName");
  const suffix = getDirectChildText(element, "suffix");
  const inFolder = textToBoolean(getDirectChildText(element, "inFolder"));
  const label = toMetadataTypeLabel(xmlName);

  return {
    id: xmlName,
    label,
    itemLabel: label || xmlName,
    kind: "metadata",
    metadataApiType: xmlName,
    folderMetadataApiType: inFolder ? getFolderMetadataApiType(xmlName) : "",
    directoryName: directoryName || xmlName,
    suffix,
    sourceFolder: directoryName || xmlName,
    inFolder,
    metaFile: textToBoolean(getDirectChildText(element, "metaFile")),
    childXmlNames: getDirectChildren(element)
      .filter((child) => child.localName === "childXmlNames" || child.nodeName === "childXmlNames")
      .map((child) => child.textContent || "")
      .filter(Boolean),
    defaultSelected: false
  };
}

async function describeMetadataTypeDefinitions(host, sid, apiVersion, options = {}) {
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<describeMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
      <asOfVersion>${escapeXml(getMetadataApiVersion(apiVersion))}</asOfVersion>
    </describeMetadata>`,
    options
  );

  return getElementsByLocalName(document, "metadataObjects")
    .map((element) => parseMetadataDescribeObject(element))
    .filter((definition) => definition.metadataApiType);
}

function createMergedMetadataTypeDefinitions(dynamicDefinitions = []) {
  const baseSchemaDefinitions = BASE_SCHEMA_METADATA_TYPE_DEFINITIONS
    .filter((definition) => !isExcludedSchemaMetadataType(definition));
  const availableDynamicDefinitions = dynamicDefinitions
    .filter((definition) => !isExcludedSchemaMetadataType(definition));
  const representedApiTypes = new Set(
    baseSchemaDefinitions.flatMap((definition) => getDefinitionMetadataApiTypes(definition))
  );
  const dynamicByApiType = new Map(
    availableDynamicDefinitions.map((definition) => [definition.metadataApiType, definition])
  );

  const baseDefinitions = baseSchemaDefinitions.map((definition) => {
    const matchingDynamicDefinition = getDefinitionMetadataApiTypes(definition)
      .map((metadataApiType) => dynamicByApiType.get(metadataApiType))
      .find(Boolean);

    if (!matchingDynamicDefinition) {
      return { ...definition };
    }

    return {
      ...matchingDynamicDefinition,
      ...definition,
      directoryName: definition.directoryName || matchingDynamicDefinition.directoryName,
      suffix: definition.suffix || matchingDynamicDefinition.suffix,
      sourceFolder: definition.sourceFolder || definition.directoryName || matchingDynamicDefinition.sourceFolder,
      inFolder: definition.inFolder === true || matchingDynamicDefinition.inFolder === true,
      folderMetadataApiType: definition.folderMetadataApiType || matchingDynamicDefinition.folderMetadataApiType,
      childXmlNames: matchingDynamicDefinition.childXmlNames || [],
      metaFile: matchingDynamicDefinition.metaFile
    };
  });

  const discoveredDefinitions = availableDynamicDefinitions
    .filter((definition) => !representedApiTypes.has(definition.metadataApiType))
    .sort((left, right) => (
      String(left.sourceFolder || left.directoryName || left.id)
        .localeCompare(String(right.sourceFolder || right.directoryName || right.id))
      || String(left.label).localeCompare(String(right.label))
    ));

  return [...baseDefinitions, ...discoveredDefinitions];
}

function mergeMetadataTypeDefinitions(dynamicDefinitions = []) {
  schemaMetadataTypeDefinitions = createMergedMetadataTypeDefinitions(dynamicDefinitions);
  return getSchemaMetadataTypes();
}

export async function loadAvailableSchemaMetadataTypes(host, sid, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const dynamicDefinitions = await describeMetadataTypeDefinitions(host, sid, apiVersion, options);
  return mergeMetadataTypeDefinitions(dynamicDefinitions);
}

export async function listMetadataManifestMembers(host, sid, apiTypes = [], options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const requestedTypes = [...new Set(
    (Array.isArray(apiTypes) ? apiTypes : [])
      .map((apiType) => String(apiType || "").trim())
      .filter(Boolean)
  )];
  if (!requestedTypes.length) {
    return { types: [], warnings: [] };
  }

  const dynamicDefinitions = await describeMetadataTypeDefinitions(host, sid, apiVersion, options);
  const definitions = createMergedMetadataTypeDefinitions(dynamicDefinitions);
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || 4) || 4, 6));
  let completed = 0;
  const results = await mapWithConcurrency(requestedTypes, concurrency, async (apiType) => {
    const definition = definitions.find((candidate) => getDefinitionMetadataApiTypes(candidate).includes(apiType));
    if (!definition) {
      return { type: null, warning: `${apiType}: metadata type is not available in this org.` };
    }

    try {
      let manifestApiType = apiType;
      let members;
      if (isSettingsMetadataApiType(apiType)) {
        manifestApiType = "Settings";
        members = options.includeUnmanagedMetadata === false ? [] : [getSettingsFullName(apiType)];
      } else {
        const records = await listMetadataRecords(
          host,
          sid,
          { ...definition, metadataApiType: apiType },
          apiVersion,
          options
        );
        members = records
          .filter((record) => shouldIncludeMetadataRecord(record, options))
          .map((record) => String(record.fullName || record.FullName || "").trim())
          .filter(Boolean);
      }

      return {
        type: {
          apiType: manifestApiType,
          members: [...new Set(members)].sort((left, right) => left.localeCompare(right))
        },
        warning: null
      };
    } catch (error) {
      return {
        type: null,
        warning: `${apiType}: ${error instanceof Error ? error.message : String(error || "Could not list metadata.")}`
      };
    } finally {
      completed += 1;
      if (typeof options.onProgress === "function") {
        options.onProgress({ completed, total: requestedTypes.length, apiType });
      }
    }
  });

  const typeMap = new Map();
  results.map((result) => result.type).filter(Boolean).forEach((type) => {
    const existing = typeMap.get(type.apiType) || [];
    typeMap.set(type.apiType, [...new Set([...existing, ...type.members])]);
  });
  return {
    types: [...typeMap.entries()]
      .map(([apiType, members]) => ({
        apiType,
        members: members.sort((left, right) => left.localeCompare(right))
      }))
      .filter((type) => type.members.length)
      .sort((left, right) => left.apiType.localeCompare(right.apiType)),
    warnings: results.map((result) => result.warning).filter(Boolean)
  };
}

function normalizeInstalledPackageRecord(record = {}) {
  const subscriberPackage = record.SubscriberPackage || {};
  const subscriberPackageVersion = record.SubscriberPackageVersion || {};
  const namespacePrefix = String(
    subscriberPackage.NamespacePrefix
    || record.NamespacePrefix
    || record.SubscriberPackageNamespacePrefix
    || ""
  ).trim();
  if (!namespacePrefix) {
    return null;
  }

  const versionParts = [
    subscriberPackageVersion.MajorVersion,
    subscriberPackageVersion.MinorVersion,
    subscriberPackageVersion.PatchVersion,
    subscriberPackageVersion.BuildNumber
  ].filter((part) => part !== null && typeof part !== "undefined" && part !== "");

  return {
    id: record.Id || namespacePrefix,
    namespacePrefix,
    name: subscriberPackage.Name || record.Name || namespacePrefix,
    version: versionParts.join(".")
  };
}

function normalizeOrgNamespaceRecord(record = {}) {
  const namespacePrefix = String(record.NamespacePrefix || record.namespacePrefix || "").trim();
  if (!namespacePrefix) {
    return null;
  }

  return {
    id: `org:${record.Id || namespacePrefix}`,
    namespacePrefix,
    name: record.Name ? `Org Namespace: ${record.Name}` : "Org Namespace",
    version: ""
  };
}

async function loadOrgNamespaceRecord(host, sid, apiVersion, options = {}) {
  try {
    const soql = "SELECT Id, Name, NamespacePrefix FROM Organization LIMIT 1";
    const records = await queryAllRecords(
      host,
      sid,
      `/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`,
      {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }
    );
    return normalizeOrgNamespaceRecord(records[0] || {});
  } catch (_error) {
    return null;
  }
}

export async function loadInstalledPackageNamespaces(host, sid, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const queries = [
    "SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name",
    "SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name"
  ];
  const packageMap = new Map();

  for (const soql of queries) {
    try {
      const records = await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, soql), {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      });
      records
        .map((record) => normalizeInstalledPackageRecord(record))
        .filter(Boolean)
        .forEach((record) => {
          if (!packageMap.has(record.namespacePrefix)) {
            packageMap.set(record.namespacePrefix, record);
          }
        });
      break;
    } catch (_error) {
      // Some users do not have access to InstalledSubscriberPackage; try the smaller query, then fall back to no package selector values.
    }
  }

  const orgNamespaceRecord = await loadOrgNamespaceRecord(host, sid, apiVersion, options);
  if (orgNamespaceRecord && !packageMap.has(orgNamespaceRecord.namespacePrefix)) {
    packageMap.set(orgNamespaceRecord.namespacePrefix, orgNamespaceRecord);
  }

  return [...packageMap.values()].sort((left, right) => (
    String(left.name || left.namespacePrefix).localeCompare(String(right.name || right.namespacePrefix), undefined, { sensitivity: "base" })
  ));
}

async function listMetadataForQuery(host, sid, apiVersion, metadataApiType, folder = "", options = {}) {
  const folderXml = folder ? `<folder>${escapeXml(folder)}</folder>` : "";
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<listMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
      <queries>
        ${folderXml}
        <type>${escapeXml(metadataApiType)}</type>
      </queries>
      <asOfVersion>${escapeXml(getMetadataApiVersion(apiVersion))}</asOfVersion>
    </listMetadata>`,
    options
  );

  return getElementsByLocalName(document, "result").map((element) => ({
    createdById: getDirectChildText(element, "createdById"),
    createdByName: getDirectChildText(element, "createdByName"),
    createdDate: getDirectChildText(element, "createdDate"),
    fileName: getDirectChildText(element, "fileName"),
    fullName: getDirectChildText(element, "fullName"),
    id: getDirectChildText(element, "id"),
    lastModifiedById: getDirectChildText(element, "lastModifiedById"),
    lastModifiedByName: getDirectChildText(element, "lastModifiedByName"),
    lastModifiedDate: getDirectChildText(element, "lastModifiedDate"),
    manageableState: getDirectChildText(element, "manageableState"),
    namespacePrefix: getDirectChildText(element, "namespacePrefix"),
    type: getDirectChildText(element, "type") || metadataApiType,
    metadataApiType
  })).filter((record) => record.fullName);
}

const TOOLING_METADATA_LIST_DEFINITIONS = {
  CustomField: {
    queryObject: "CustomField",
    orderBy: "TableEnumOrId, DeveloperName",
    attempts: [
      ["Id", "DeveloperName", "NamespacePrefix", "EntityDefinition.QualifiedApiName", "TableEnumOrId"],
      ["Id", "DeveloperName", "EntityDefinition.QualifiedApiName", "TableEnumOrId"],
      ["Id", "DeveloperName", "NamespacePrefix", "TableEnumOrId"],
      ["Id", "DeveloperName", "TableEnumOrId"]
    ],
    getParentName: (record) => record.EntityDefinition?.QualifiedApiName || record.TableEnumOrId || "",
    getChildName: (record) => normalizeToolingCustomFieldApiName(record)
  },
  Layout: {
    queryObject: "Layout",
    orderBy: "Name",
    separator: "-",
    attempts: [
      ["Id", "Name", "NamespacePrefix", "ManageableState", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "NamespacePrefix", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "TableEnumOrId"]
    ],
    getParentName: (record) => record.EntityDefinition?.QualifiedApiName || (/^01I/i.test(String(record.TableEnumOrId || "")) ? "" : record.TableEnumOrId) || "",
    getChildName: (record) => record.Name || ""
  },
  PermissionSet: {
    queryObject: "PermissionSet",
    orderBy: "Name",
    where: "IsOwnedByProfile = false",
    attempts: [
      ["Id", "Name", "Label", "NamespacePrefix", "ManageableState", "IsOwnedByProfile"],
      ["Id", "Name", "Label", "NamespacePrefix", "IsOwnedByProfile"],
      ["Id", "Name", "Label", "IsOwnedByProfile"],
      ["Id", "Name", "IsOwnedByProfile"]
    ],
    getChildName: (record) => record.Name || ""
  },
  Profile: {
    queryObject: "Profile",
    orderBy: "Name",
    attempts: [
      ["Id", "Name"]
    ],
    getChildName: (record) => record.Name || ""
  },
  RecordType: {
    queryObject: "RecordType",
    orderBy: "Name",
    attempts: [
      ["Id", "Name", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "SobjectType", "NamespacePrefix"],
      ["Id", "Name", "SobjectType"]
    ],
    getParentName: (record) => record.EntityDefinition?.QualifiedApiName || record.SobjectType || "",
    getChildName: (record) => record.Name || ""
  },
  ValidationRule: {
    queryObject: "ValidationRule",
    orderBy: "ValidationName",
    attempts: [
      ["Id", "ValidationName", "NamespacePrefix", "EntityDefinition.QualifiedApiName", "Active", "ManageableState"],
      ["Id", "ValidationName", "NamespacePrefix", "EntityDefinition.QualifiedApiName"],
      ["Id", "ValidationName", "EntityDefinition.QualifiedApiName"]
    ],
    getParentName: (record) => record.EntityDefinition?.QualifiedApiName || "",
    getChildName: (record) => record.ValidationName || ""
  },
  WebLink: {
    queryObject: "WebLink",
    orderBy: "Name",
    attempts: [
      ["Id", "Name", "MasterLabel", "NamespacePrefix", "EntityDefinition.QualifiedApiName", "EntityDefinition.DeveloperName", "ManageableState"],
      ["Id", "Name", "MasterLabel", "NamespacePrefix", "EntityDefinition.QualifiedApiName", "ManageableState"],
      ["Id", "Name", "NamespacePrefix", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "EntityDefinition.QualifiedApiName"]
    ],
    getParentName: (record) => record.EntityDefinition?.QualifiedApiName || record.EntityDefinition?.DeveloperName || "",
    getChildName: (record) => record.Name || ""
  }
};

function normalizeToolingMetadataChildName(childName = "", metadataApiType = "") {
  const name = String(childName || "").trim();
  if (!name) {
    return "";
  }
  return name;
}

function getToolingMetadataListFullName(record = {}, metadataApiType = "", config = {}) {
  const recordFullName = String(record.FullName || record.fullName || "").trim();
  const parentName = String(config.getParentName?.(record) || "").trim();
  const childName = normalizeToolingMetadataChildName(config.getChildName?.(record), metadataApiType);
  const separator = config.separator || ".";
  return recordFullName || (parentName && childName ? `${parentName}${separator}${childName}` : childName);
}

function createToolingMetadataListWhereClause(config = {}, fields = [], options = {}) {
  const clauses = [];
  if (config.where) {
    clauses.push(`(${config.where})`);
  }

  if (!fields.includes("NamespacePrefix")) {
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  const namespaceSet = getInstalledPackageNamespaceSet(options);
  if (namespaceSet.size > 0) {
    const namespaces = [...namespaceSet].map((namespacePrefix) => `'${escapeSoqlString(namespacePrefix)}'`).join(", ");
    clauses.push(`(NamespacePrefix = null OR NamespacePrefix IN (${namespaces}))`);
  } else if (!shouldIncludeInstalledPackages(options)) {
    clauses.push("NamespacePrefix = null");
  }
  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
}

function createToolingMetadataListSoql(config = {}, fields = [], options = {}) {
  const orderBy = config.orderBy ? ` ORDER BY ${config.orderBy}` : "";
  return `SELECT ${fields.join(", ")} FROM ${config.queryObject}${createToolingMetadataListWhereClause(config, fields, options)}${orderBy}`;
}

function normalizeToolingMetadataListRecord(record = {}, metadataApiType = "", config = {}) {
  const fullName = getToolingMetadataListFullName(record, metadataApiType, config);
  if (!fullName) {
    return null;
  }

  return {
    ...record,
    fullName,
    FullName: fullName,
    fileName: `${fullName}.${metadataApiType}`,
    id: record.Id || record.id || fullName,
    type: metadataApiType,
    metadataApiType,
    namespacePrefix: record.NamespacePrefix || record.namespacePrefix || "",
    manageableState: record.ManageableState || record.manageableState || ""
  };
}

async function listToolingMetadataRecords(host, sid, definition, apiVersion, options = {}) {
  const metadataApiType = definition.metadataApiType;
  const config = TOOLING_METADATA_LIST_DEFINITIONS[metadataApiType];
  if (!config) {
    return null;
  }

  let lastError = null;
  for (const fields of config.attempts) {
    try {
      const records = await queryAllRecords(
        host,
        sid,
        createToolingQueryPath(apiVersion, createToolingMetadataListSoql(config, fields, options)),
        {
          timeoutMs: options.timeoutMs,
          signal: options.signal
        }
      );
      return records
        .map((record) => normalizeToolingMetadataListRecord(record, metadataApiType, config))
        .filter(Boolean);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Could not list ${metadataApiType}.`);
}

async function listMetadataRecords(host, sid, definition, apiVersion, options = {}) {
  const metadataApiType = definition.metadataApiType;
  if (definition.listWithToolingApi) {
    try {
      const toolingRecords = await listToolingMetadataRecords(host, sid, definition, apiVersion, options);
      if (Array.isArray(toolingRecords)) {
        return toolingRecords;
      }
    } catch (_error) {
      // Fall back so older orgs or restricted access still work.
    }
  }

  if (!definition.folderMetadataApiType) {
    return listMetadataForQuery(host, sid, apiVersion, metadataApiType, "", options);
  }

  const folders = (await listMetadataForQuery(host, sid, apiVersion, definition.folderMetadataApiType, "", options))
    .filter((folder) => shouldIncludeMetadataRecord(folder, options));
  const records = [];
  for (const folder of folders) {
    const folderNamespace = getInstalledPackageComponentNamespace(folder);
    const folderManageableState = folder.manageableState || folder.ManageableState || "";
    const folderRecords = await listMetadataForQuery(host, sid, apiVersion, metadataApiType, folder.fullName, options);
    records.push(...folderRecords.map((record) => ({
      ...record,
      namespacePrefix: record.namespacePrefix || folderNamespace,
      manageableState: record.manageableState || folderManageableState
    })));
  }

  return records;
}

function getSettingsFullName(metadataApiType = "") {
  return String(metadataApiType || "").replace(/Settings$/, "");
}

function createSettingsMetadataRecords(definition = {}) {
  return (definition.metadataApiTypes || []).map((metadataApiType) => {
    const fullName = getSettingsFullName(metadataApiType);
    return {
      fullName,
      fileName: `${definition.directoryName}/${fullName}.${definition.suffix}`,
      type: metadataApiType,
      metadataApiType
    };
  });
}

async function readMetadataRecord(host, sid, definition, record = {}, apiVersion) {
  const metadataApiType = record.metadataApiType || definition.metadataApiType;
  const fullName = record.fullName || record.FullName || record.id;
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<readMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
      <type>${escapeXml(metadataApiType)}</type>
      <fullNames>${escapeXml(fullName)}</fullNames>
    </readMetadata>`
  );
  const result = getFirstElementByLocalName(document, "result");
  const directRecordElement = getDirectChildByLocalName(result, "records");
  const recordElement = directRecordElement && !isNilXmlElement(directRecordElement)
    ? directRecordElement
    : !directRecordElement && getDirectChildText(result, "fullName")
      ? result
      : null;

  return {
    fullName,
    metadataApiType,
    metadataType: definition.id,
    fileName: record.fileName || "",
    rawXml: recordElement ? serializeXmlElement(recordElement) : "",
    metadata: recordElement ? xmlElementToObject(recordElement) : {}
  };
}

async function readMetadataRecords(host, sid, definition, records = [], apiVersion, options = {}) {
  const requestedRecords = (Array.isArray(records) ? records : [])
    .map((sourceRecord) => {
      const record = sourceRecord && typeof sourceRecord === "object" ? sourceRecord : {};
      return {
        ...record,
        metadataApiType: record.metadataApiType || definition.metadataApiType,
        fullName: record.fullName || record.FullName || record.id || ""
      };
    })
    .filter((record) => record.fullName);
  if (!requestedRecords.length) {
    return [];
  }

  const metadataApiType = requestedRecords[0].metadataApiType || definition.metadataApiType;
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<readMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
      <type>${escapeXml(metadataApiType)}</type>
      ${requestedRecords.map((record) => `<fullNames>${escapeXml(record.fullName)}</fullNames>`).join("\n      ")}
    </readMetadata>`,
    options
  );
  const result = getFirstElementByLocalName(document, "result");
  const recordElements = getDirectChildren(result)
    .filter((child) => (child.localName === "records" || child.nodeName === "records") && !isNilXmlElement(child));
  const elements = recordElements.length
    ? recordElements
    : getDirectChildText(result, "fullName")
      ? [result]
      : [];
  const requestedByFullName = new Map(requestedRecords.map((record) => [String(record.fullName || ""), record]));
  return elements.map((recordElement, index) => {
    const fullName = getDirectChildText(recordElement, "fullName") || requestedRecords[index]?.fullName || "";
    const requestedRecord = requestedByFullName.get(fullName) || requestedRecords[index] || {};
    return {
      fullName,
      metadataApiType,
      metadataType: definition.id,
      fileName: requestedRecord.fileName || "",
      rawXml: serializeXmlElement(recordElement),
      metadata: xmlElementToObject(recordElement),
      record: requestedRecord
    };
  });
}

function getMetadataDeployFileName(definition = {}, record = {}, fullName = "") {
  const existingFileName = normalizeSourcePath(record.fileName || "");
  if (existingFileName && !existingFileName.startsWith(SOURCE_PROJECT_PREFIX)) {
    return existingFileName.replace(/-meta\.xml$/i, "");
  }

  const folder = definition.directoryName || definition.sourceFolder || definition.id;
  const suffix = definition.suffix || "xml";
  const name = String(fullName || record.fullName || record.FullName || "metadata")
    .split("/")
    .map((segment) => segment.replace(/[<>:"\\|?*\u0000-\u001F]/g, "_"))
    .join("/");
  return `${folder}/${name}.${suffix}`;
}

function isSettingsMetadataApiType(metadataApiType = "") {
  const typeName = String(metadataApiType || "").trim();
  return typeName !== "Settings" && typeName.endsWith("Settings");
}

function getSettingsPackageMember(metadataApiType = "") {
  return String(metadataApiType || "").trim().replace(/Settings$/, "");
}

function normalizeMetadataPackageEntry(metadataApiType, fullName) {
  const typeName = String(metadataApiType || "").trim();
  const memberName = String(fullName || "").trim();
  if (isSettingsMetadataApiType(typeName)) {
    return {
      metadataApiType: "Settings",
      fullName: memberName === "*" ? getSettingsPackageMember(typeName) : memberName
    };
  }

  return {
    metadataApiType: typeName,
    fullName: memberName
  };
}

function createMetadataPackageXml(metadataApiType, fullName, apiVersion) {
  const packageEntry = normalizeMetadataPackageEntry(metadataApiType, fullName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${escapeXml(packageEntry.fullName)}</members>
    <name>${escapeXml(packageEntry.metadataApiType)}</name>
  </types>
  <version>${escapeXml(getMetadataApiVersion(apiVersion))}</version>
</Package>`;
}

function getPackageXmlUnpackagedBody(packageXml = "", apiVersion) {
  const document = parseXmlDocument(packageXml);
  const packageElement = document.documentElement;
  if (!packageElement || (packageElement.localName || packageElement.nodeName) !== "Package") {
    throw new Error("Metadata retrieve requires a package.xml Package document.");
  }

  const children = getDirectChildren(packageElement)
    .filter((child) => {
      const localName = child.localName || child.nodeName;
      return localName === "types" || localName === "version";
    });
  const hasTypes = children.some((child) => (child.localName || child.nodeName) === "types");
  if (!hasTypes) {
    throw new Error("Metadata retrieve requires at least one package.xml type.");
  }

  const hasVersion = children.some((child) => (child.localName || child.nodeName) === "version");
  const body = children.map((child) => serializeXmlElement(child)).join("");
  return hasVersion
    ? body
    : `${body}<version>${escapeXml(getMetadataApiVersion(apiVersion))}</version>`;
}

function base64ToBlob(base64 = "", type = "application/zip") {
  const binary = atob(String(base64 || "").replace(/\s+/g, ""));
  const chunks = [];
  const chunkSize = 32768;
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let index = 0; index < slice.length; index += 1) {
      bytes[index] = slice.charCodeAt(index);
    }
    chunks.push(bytes);
  }
  return new Blob(chunks, { type });
}

function parseMetadataRetrieveResult(document, retrieveId = "") {
  const result = getFirstElementByLocalName(document, "result");
  if (!result) {
    throw new Error("Salesforce did not return a Metadata retrieve result.");
  }

  const messages = getElementsByLocalName(result, "messages").map((message) => ({
    fileName: getDirectChildText(message, "fileName"),
    problem: getDirectChildText(message, "problem")
  }));
  return {
    id: retrieveId || getDirectChildText(result, "id"),
    status: getDirectChildText(result, "status"),
    done: textToBoolean(getDirectChildText(result, "done")),
    success: textToBoolean(getDirectChildText(result, "success")),
    errorMessage: getDirectChildText(result, "errorMessage"),
    zipFile: getDirectChildText(result, "zipFile"),
    messages
  };
}

async function startMetadataRetrieve(host, sid, apiVersion, packageXml, options = {}) {
  const unpackagedBody = getPackageXmlUnpackagedBody(packageXml, apiVersion);
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<retrieve xmlns="http://soap.sforce.com/2006/04/metadata">
      <retrieveRequest>
        <apiVersion>${escapeXml(getMetadataApiVersion(apiVersion))}</apiVersion>
        <singlePackage>true</singlePackage>
        <unpackaged>${unpackagedBody}</unpackaged>
      </retrieveRequest>
    </retrieve>`,
    options
  );
  const retrieveId = getDirectChildText(getFirstElementByLocalName(document, "result"), "id");
  if (!retrieveId) {
    throw new Error("Salesforce did not return a Metadata retrieve id.");
  }
  return retrieveId;
}

async function startMetadataNamedPackageRetrieve(host, sid, apiVersion, packageName, options = {}) {
  const cleanName = String(packageName || "").trim();
  if (!cleanName) {
    throw new Error("Metadata retrieve requires an outbound change set name.");
  }
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<retrieve xmlns="http://soap.sforce.com/2006/04/metadata">
      <retrieveRequest>
        <apiVersion>${escapeXml(getMetadataApiVersion(apiVersion))}</apiVersion>
        <packageNames>${escapeXml(cleanName)}</packageNames>
        <singlePackage>true</singlePackage>
      </retrieveRequest>
    </retrieve>`,
    options
  );
  const retrieveId = getDirectChildText(getFirstElementByLocalName(document, "result"), "id");
  if (!retrieveId) {
    throw new Error("Salesforce did not return a Metadata retrieve id.");
  }
  return retrieveId;
}

async function checkMetadataRetrieveStatus(host, sid, apiVersion, retrieveId, includeZip, options = {}) {
  const document = await metadataSoapRequest(
    host,
    sid,
    apiVersion,
    `<checkRetrieveStatus xmlns="http://soap.sforce.com/2006/04/metadata">
      <asyncProcessId>${escapeXml(retrieveId)}</asyncProcessId>
      <includeZip>${includeZip ? "true" : "false"}</includeZip>
    </checkRetrieveStatus>`,
    options
  );
  return parseMetadataRetrieveResult(document, retrieveId);
}

async function finishMetadataRetrieve(host, sid, apiVersion, retrieveId, options = {}) {
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs) || METADATA_RETRIEVE_POLL_INTERVAL_MS);
  const maxPolls = Math.max(1, Number(options.maxPolls) || METADATA_RETRIEVE_MAX_POLLS);
  const startedAt = Date.now();
  const maxWaitMs = maxPolls * pollIntervalMs;
  let lastStatus = "";

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    let result;
    try {
      result = await checkMetadataRetrieveStatus(host, sid, apiVersion, retrieveId, false, options);
    } catch (error) {
      if (error?.code !== EMPTY_METADATA_SOAP_RESPONSE) throw error;
      options.onProgress?.({
        id: retrieveId,
        status: lastStatus || "InProgress",
        done: false,
        attempt: attempt + 1,
        maxPolls,
        elapsedMs: Date.now() - startedAt,
        maxWaitMs
      });
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    lastStatus = result.status;
    options.onProgress?.({
      id: retrieveId,
      status: result.status,
      done: result.done,
      attempt: attempt + 1,
      maxPolls,
      elapsedMs: Date.now() - startedAt,
      maxWaitMs
    });

    if (result.done) {
      if (!result.success) {
        const messages = result.messages
          .map((message) => [message.fileName, message.problem].filter(Boolean).join(": "))
          .filter(Boolean);
        throw new Error(messages.join("; ") || result.errorMessage || `Metadata retrieve ${result.status || "failed"}.`);
      }

      const zipResult = await checkMetadataRetrieveStatus(host, sid, apiVersion, retrieveId, true, options);
      const zipFile = zipResult.zipFile;
      if (!zipFile) {
        throw new Error("Salesforce completed the Metadata retrieve without returning a ZIP file.");
      }
      return {
        id: retrieveId,
        status: zipResult.status || result.status,
        blob: base64ToBlob(zipFile),
        messages: zipResult.messages.length ? zipResult.messages : result.messages
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Metadata retrieve ${retrieveId} did not finish within ${Math.ceil(maxWaitMs / 60000)} minutes`
    + ` (last status: ${lastStatus || "unknown"}). Salesforce may still be processing the job; retry the comparison.`
  );
}

function isDeletedMetadataRetrieveResultError(error) {
  return /INVALID_LOCATOR[\s\S]*Retrieve result has been deleted/i
    .test(error instanceof Error ? error.message : String(error || ""));
}

async function runMetadataRetrieveWithDeletedResultRecovery(startRetrieve, host, sid, apiVersion, options = {}) {
  let retrieveId = await startRetrieve();
  try {
    return await finishMetadataRetrieve(host, sid, apiVersion, retrieveId, options);
  } catch (error) {
    if (!isDeletedMetadataRetrieveResultError(error)) throw error;
    options.onRestart?.({ attempt: 2, maxAttempts: 2 });
    retrieveId = await startRetrieve();
    return finishMetadataRetrieve(host, sid, apiVersion, retrieveId, options);
  }
}

export async function retrieveMetadataPackageZip(host, sid, packageXml, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  return runMetadataRetrieveWithDeletedResultRecovery(
    () => startMetadataRetrieve(host, sid, apiVersion, packageXml, options),
    host,
    sid,
    apiVersion,
    options
  );
}

export async function retrieveMetadataNamedPackageZip(host, sid, packageName, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  return runMetadataRetrieveWithDeletedResultRecovery(
    () => startMetadataNamedPackageRetrieve(host, sid, apiVersion, packageName, options),
    host,
    sid,
    apiVersion,
    options
  );
}

function getXmlFileContent(xml) {
  const document = parseXmlDocument(xml);
  if (!document.documentElement) {
    throw new Error("Metadata XML is empty.");
  }

  return serializeXmlElement(document.documentElement);
}

function getCrc32Table() {
  if (getCrc32Table.table) {
    return getCrc32Table.table;
  }

  getCrc32Table.table = Array.from({ length: 256 }, (_value, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
  return getCrc32Table.table;
}

function getCrc32(bytes) {
  const table = getCrc32Table();
  let crc = 0xFFFFFFFF;
  bytes.forEach((byte) => {
    crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  });
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
}

function writeUint32(target, offset, value) {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
  target[offset + 2] = (value >>> 16) & 0xFF;
  target[offset + 3] = (value >>> 24) & 0xFF;
}

function getZipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function createZipArchive(files = []) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const entries = [];
  const { time, date } = getZipDateTime();
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = getCrc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    writeUint32(local, 0, 0x04034B50);
    writeUint16(local, 4, 20);
    writeUint16(local, 6, 0x0800);
    writeUint16(local, 8, 0);
    writeUint16(local, 10, time);
    writeUint16(local, 12, date);
    writeUint32(local, 14, crc);
    writeUint32(local, 18, dataBytes.length);
    writeUint32(local, 22, dataBytes.length);
    writeUint16(local, 26, nameBytes.length);
    local.set(nameBytes, 30);

    localParts.push(local, dataBytes);
    entries.push({ nameBytes, crc, size: dataBytes.length, offset });
    offset += local.length + dataBytes.length;
  });

  entries.forEach((entry) => {
    const central = new Uint8Array(46 + entry.nameBytes.length);
    writeUint32(central, 0, 0x02014B50);
    writeUint16(central, 4, 20);
    writeUint16(central, 6, 20);
    writeUint16(central, 8, 0x0800);
    writeUint16(central, 10, 0);
    writeUint16(central, 12, time);
    writeUint16(central, 14, date);
    writeUint32(central, 16, entry.crc);
    writeUint32(central, 20, entry.size);
    writeUint32(central, 24, entry.size);
    writeUint16(central, 28, entry.nameBytes.length);
    writeUint32(central, 42, entry.offset);
    central.set(entry.nameBytes, 46);
    centralParts.push(central);
  });

  const centralDirectory = concatBytes(centralParts);
  const localFiles = concatBytes(localParts);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054B50);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralDirectory.length);
  writeUint32(end, 16, localFiles.length);
  return new Blob([localFiles, centralDirectory, end], { type: "application/zip" });
}

function createMetadataDeployOptionsJson(options = {}) {
  return JSON.stringify({
    deployOptions: {
      allowMissingFiles: false,
      autoUpdatePackage: false,
      checkOnly: options.checkOnly === true,
      ignoreWarnings: false,
      performRetrieve: false,
      purgeOnDelete: false,
      rollbackOnError: true,
      runTests: null,
      singlePackage: true,
      testLevel: "NoTestRun"
    }
  });
}

function createMultipartBoundary() {
  return `----sf-metadata-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeMultipartHeaderValue(value = "") {
  return String(value || "").replace(/[\r\n"]/g, "_");
}

function createMultipartFormDataBody(parts = [], boundary = createMultipartBoundary()) {
  const encoder = new TextEncoder();
  const chunks = [];

  parts.forEach((part) => {
    const disposition = [
      `form-data; name="${escapeMultipartHeaderValue(part.name)}"`,
      part.fileName ? `filename="${escapeMultipartHeaderValue(part.fileName)}"` : ""
    ].filter(Boolean).join("; ");
    const headerLines = [
      `--${boundary}`,
      `Content-Disposition: ${disposition}`
    ];
    if (part.contentType) {
      headerLines.push(`Content-Type: ${part.contentType}`);
    }
    chunks.push(encoder.encode(`${headerLines.join("\r\n")}\r\n\r\n`));
    chunks.push(part.content instanceof Blob
      ? part.content
      : part.content instanceof Uint8Array
        ? part.content
        : encoder.encode(String(part.content || "")));
    chunks.push(encoder.encode("\r\n"));
  });

  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  return new Blob(chunks, { type: `multipart/form-data; boundary=${boundary}` });
}

function getRestDeployStatusPayload(response = {}) {
  return response.deployResult || response.result || response;
}

function getRestDeployFailures(payload = {}) {
  const details = payload.details || payload.deployDetails || {};
  const failures = details.componentFailures || details.componentFailure || payload.componentFailures || [];
  return (Array.isArray(failures) ? failures : [failures])
    .filter(Boolean)
    .map((failure) => [
      failure.fullName || failure.fileName,
      failure.problem || failure.message
    ].filter(Boolean).join(": "))
    .filter(Boolean);
}

async function waitForMetadataRestDeploy(host, sid, apiVersion, deployId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await salesforceRequest(
      host,
      sid,
      `/services/data/${apiVersion}/metadata/deployRequest/${encodeURIComponent(deployId)}?includeDetails=true`
    );
    const payload = getRestDeployStatusPayload(response);
    const status = String(payload.status || response.status || "");
    const done = response.done === true || payload.done === true || ["Succeeded", "SucceededPartial", "Failed", "Canceled", "Canceling"].includes(status);

    if (done) {
      const success = response.success === true || payload.success === true || status === "Succeeded";
      if (success) {
        return {
          success: true,
          id: deployId,
          status,
          result: response
        };
      }

      const failures = getRestDeployFailures(payload);
      throw new Error(failures.join("; ") || payload.errorMessage || payload.message || `Metadata deploy ${status || "failed"}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for deploy to finish.");
}

async function deployMetadataZipByRest(host, sid, apiVersion, files = [], options = {}) {
  const boundary = createMultipartBoundary();
  const body = createMultipartFormDataBody([
    {
      name: "json",
      contentType: "application/json; charset=UTF-8",
      content: createMetadataDeployOptionsJson(options)
    },
    {
      name: "upload",
      fileName: "metadata.zip",
      contentType: "application/zip",
      content: createZipArchive(files)
    }
  ], boundary);

  const response = await salesforceRequest(
    host,
    sid,
    `/services/data/${apiVersion}/metadata/deployRequest`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body
    }
  );
  const deployId = response?.id || response?.deployRequest?.id;
  if (!deployId) {
    throw new Error("Salesforce did not return a deploy id.");
  }

  return waitForMetadataRestDeploy(host, sid, apiVersion, deployId);
}

export async function deployMetadataXml(host, sid, metadataType, itemId, xml, options = {}) {
  const definition = getMetadataTypeDefinition(metadataType);
  if (!definition || definition.kind !== "metadata") {
    throw new Error(`Deploy is not supported for this metadata type: ${metadataType}`);
  }

  const record = options.record && typeof options.record === "object"
    ? options.record
    : {};
  const metadataApiType = record.metadataApiType || definition.metadataApiType || definition.metadataApiTypes?.find((candidate) => (
    getSettingsFullName(candidate) === itemId
  ));
  const fullName = record.fullName || record.FullName || itemId;

  if (!metadataApiType || !fullName) {
    throw new Error("Missing metadata type or full name for deploy.");
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const metadataFileName = getMetadataDeployFileName(definition, record, fullName);
  return deployMetadataZipByRest(host, sid, apiVersion, [
    {
      name: metadataFileName,
      content: getXmlFileContent(xml)
    },
    {
      name: "package.xml",
      content: createMetadataPackageXml(metadataApiType, fullName, apiVersion)
    }
  ], options);
}

function normalizeMetadataSourceDeployFile(file = {}) {
  const name = stripDefaultSourcePrefix(file.name || file.fileName || file.path || "");
  const content = /-meta\.xml$/i.test(name)
    ? getXmlFileContent(file.content || "")
    : String(file.content || "");
  return {
    name,
    content
  };
}

export async function deployMetadataSourceFiles(host, sid, metadataApiType, fullName, files = [], options = {}) {
  const typeName = String(metadataApiType || "").trim();
  const memberName = String(fullName || "").trim();
  const metadataFiles = files.map((file) => normalizeMetadataSourceDeployFile(file)).filter((file) => file.name);

  if (!typeName || !memberName || !metadataFiles.length) {
    throw new Error("Missing metadata type, full name, or source files for deploy.");
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  return deployMetadataZipByRest(host, sid, apiVersion, [
    ...metadataFiles,
    {
      name: "package.xml",
      content: createMetadataPackageXml(typeName, memberName, apiVersion)
    }
  ], options);
}

function getToolingContainerMemberObject(sobject = "") {
  return {
    ApexClass: "ApexClassMember",
    ApexTrigger: "ApexTriggerMember"
  }[sobject] || "";
}

async function createToolingRecord(host, sid, apiVersion, sobject, fields = {}) {
  const result = await salesforceRequest(
    host,
    sid,
    `/services/data/${apiVersion}/tooling/sobjects/${encodeURIComponent(sobject)}`,
    {
      method: "POST",
      body: JSON.stringify(fields)
    }
  );

  if (!result?.id) {
    throw new Error(`Salesforce did not return an id for ${sobject}.`);
  }

  return result.id;
}

function parseCompilerErrors(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => item?.problem || item?.message || JSON.stringify(item)).join("; ");
  }

  if (typeof value === "object") {
    return value.problem || value.message || JSON.stringify(value);
  }

  return String(value);
}

async function waitForContainerAsyncRequest(host, sid, apiVersion, requestId) {
  const terminalStates = new Set(["Completed", "CompletedWithErrors", "Failed", "Error", "Aborted"]);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const request = await salesforceRequest(
      host,
      sid,
      `/services/data/${apiVersion}/tooling/sobjects/ContainerAsyncRequest/${encodeURIComponent(requestId)}`
    );
    const state = request?.State || "";

    if (terminalStates.has(state)) {
      if (state === "Completed") {
        return request;
      }

      const compilerErrors = parseCompilerErrors(request?.CompilerErrors || request?.DeployDetails?.componentFailures);
      throw new Error(
        compilerErrors
          || request?.ErrorMsg
          || request?.DeployDetails?.runTestResult?.failures?.message
          || `Apex deploy ${state}.`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for Apex deploy to finish.");
}

async function deployToolingContainerSource(host, sid, deployInfo = {}, content = "", apiVersion) {
  const memberObject = getToolingContainerMemberObject(deployInfo.sobject);
  if (!memberObject) {
    return null;
  }

  const containerId = await createToolingRecord(host, sid, apiVersion, "MetadataContainer", {
    Name: `CodexDeploy_${Date.now()}`
  });
  await createToolingRecord(host, sid, apiVersion, memberObject, {
    MetadataContainerId: containerId,
    ContentEntityId: deployInfo.id,
    Body: content
  });
  const requestId = await createToolingRecord(host, sid, apiVersion, "ContainerAsyncRequest", {
    MetadataContainerId: containerId,
    IsCheckOnly: false
  });
  return waitForContainerAsyncRequest(host, sid, apiVersion, requestId);
}

export async function deploySourceFileContent(host, sid, deployInfo = {}, content = "", options = {}) {
  if (deployInfo.kind !== "toolingSource" || !deployInfo.sobject || !deployInfo.id) {
    throw new Error("This source file does not have a supported Salesforce deploy target.");
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const containerResult = await deployToolingContainerSource(host, sid, deployInfo, content, apiVersion);
  if (containerResult) {
    return {
      success: true,
      id: deployInfo.id,
      sobject: deployInfo.sobject,
      via: "MetadataContainer"
    };
  }

  const field = deployInfo.field || "Source";
  await salesforceRequest(
    host,
    sid,
    `/services/data/${apiVersion}/tooling/sobjects/${encodeURIComponent(deployInfo.sobject)}/${encodeURIComponent(deployInfo.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ [field]: content })
    }
  );

  return {
    success: true,
    id: deployInfo.id,
    sobject: deployInfo.sobject,
    field
  };
}

export async function getActiveSession() {
  const response = await sendRuntimeMessage({ type: "get-active-salesforce-session" });
  if (!response?.ok) {
    throw createRuntimeError(response, "Unable to find an active Salesforce session.");
  }
  notifySalesforceUserLanguageDetected(response);
  return response;
}

export async function getSessionForHost(host) {
  const response = await sendRuntimeMessage({ type: "get-session-for-host", host });
  if (!response?.ok) {
    throw createRuntimeError(response, `Unable to load Salesforce session for ${host}.`);
  }
  notifySalesforceUserLanguageDetected(response);
  return response;
}

export async function getPopupOrgDashboard() {
  const response = await sendRuntimeMessage({ type: "get-popup-org-dashboard" });
  if (!response?.ok) {
    throw createRuntimeError(response, "Unable to inspect signed-in Salesforce sessions.");
  }
  notifySalesforceUserLanguageDetected(response.current || response.orgs?.[0] || {});
  return response;
}

function notifySalesforceUserLanguageDetected(session = {}) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined" || !session) {
    return;
  }

  const language =
    session.salesforceUserLanguage ||
    session.userLanguage ||
    session.language ||
    session.userInfo?.LanguageLocaleKey ||
    session.userInfo?.language ||
    session.userInfo?.locale ||
    "";

  const locale =
    session.salesforceUserLocale ||
    session.userLocale ||
    session.locale ||
    session.userInfo?.LocaleSidKey ||
    "";

  if (!language && !locale) {
    return;
  }

  window.dispatchEvent(new CustomEvent("salesforce-user-language-detected", {
    detail: {
      host: session.host || "",
      language: language || locale,
      locale
    }
  }));
}

export async function loadSchemaObjectStore(host) {
  const emptyStore = createEmptySchemaObjectStore(host);
  updateSchemaObjectStore(emptyStore);
  return emptyStore;
}

export async function saveSchemaObjectStore(host, store) {
  const nextStore = normalizeSchemaObjectStore(store, host);
  updateSchemaObjectStore(nextStore);
  return nextStore;
}

export async function clearSchemaObjectStore(host) {
  await deleteIndexedDbDatabase(getCompactMetadataIndexDbName(host));

  const emptyStore = createEmptySchemaObjectStore(host);
  updateSchemaObjectStore(emptyStore);
  return emptyStore;
}

async function queryAllRecords(host, sid, path, options = {}) {
  const records = [];
  let response = await salesforceRequest(host, sid, path, options);
  records.push(...(Array.isArray(response?.records) ? response.records : []));

  while (response && response.done === false && response.nextRecordsUrl) {
    response = await salesforceRequest(host, sid, normalizeQueryNextRecordsPath(response.nextRecordsUrl), options);
    records.push(...(Array.isArray(response?.records) ? response.records : []));
  }

  return records;
}

function normalizeQueryNextRecordsPath(nextRecordsUrl = "") {
  const path = String(nextRecordsUrl || "").trim();
  if (!path.startsWith("/services/data/")) {
    throw new Error("Invalid Salesforce query pagination path.");
  }

  const url = new URL(path, "https://salesforce.local");
  const isQueryPath = /^\/services\/data\/v[\d.]+\/(?:tooling\/)?query(?:\/|$)/.test(url.pathname);
  if (url.origin !== "https://salesforce.local" || !isQueryPath) {
    throw new Error("Invalid Salesforce query pagination path.");
  }

  return `${url.pathname}${url.search}`;
}

function getQueryMetadataFields(definition = {}, options = {}) {
  if (options.namesOnly !== true) {
    return definition.fields;
  }

  const fields = [
    "Id",
    definition.nameField,
    definition.labelField,
    "NamespacePrefix"
  ];

  if (definition.latestActiveOnly) {
    fields.push("VersionNumber", "DefinitionId", "DeveloperName", "MasterLabel", "Name");
  }

  if (definition.sizeField) {
    fields.push(definition.sizeField);
  }

  return [...new Set(fields.filter((fieldName) => (
    fieldName && (!Array.isArray(definition.fields) || definition.fields.includes(fieldName))
  )))];
}

function createSoqlQueryPath(definition, apiVersion, options = {}) {
  let soql = `SELECT ${getQueryMetadataFields(definition, options).join(", ")} FROM ${definition.queryObject}`;
  soql += createMetadataWhereClause(definition, options);
  soql += ` ORDER BY ${definition.orderBy || definition.nameField}`;
  const queryPath = definition.kind === "tooling" ? "tooling/query" : "query";
  return `/services/data/${apiVersion}/${queryPath}?q=${encodeURIComponent(soql)}`;
}

function getMetadataDetailFields(definition = {}) {
  const fields = [
    ...(Array.isArray(definition.fields) ? definition.fields : []),
    ...(Array.isArray(definition.detailFields) ? definition.detailFields : [])
  ];
  return [...new Set(fields.filter(Boolean))];
}

function createDetailSoqlQueryPath(definition, apiVersion, itemId) {
  const fields = getMetadataDetailFields(definition);
  const soql = `SELECT ${fields.join(", ")} FROM ${definition.queryObject} WHERE Id = '${escapeSoqlString(itemId)}' LIMIT 1`;
  const queryPath = definition.kind === "tooling" ? "tooling/query" : "query";
  return `/services/data/${apiVersion}/${queryPath}?q=${encodeURIComponent(soql)}`;
}

function createDetailByNameSoqlQueryPath(definition, apiVersion, itemName = "") {
  const fields = getMetadataDetailFields(definition);
  const nameField = definition.nameField || "Name";
  const soql = `SELECT ${fields.join(", ")} FROM ${definition.queryObject} WHERE ${nameField} = '${escapeSoqlString(itemName)}' LIMIT 1`;
  const queryPath = definition.kind === "tooling" ? "tooling/query" : "query";
  return `/services/data/${apiVersion}/${queryPath}?q=${encodeURIComponent(soql)}`;
}

async function queryMetadataRecordDetail(host, sid, definition, apiVersion, itemId, options = {}) {
  const records = await queryAllRecords(host, sid, createDetailSoqlQueryPath(definition, apiVersion, itemId), {
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });
  if (!records.length) {
    throw new Error(`Metadata detail not found for ${definition.queryObject}.`);
  }
  return records[0];
}

async function queryMetadataRecordDetailByName(host, sid, definition, apiVersion, itemName = "", options = {}) {
  const cleanName = String(itemName || "").trim();
  if (!cleanName) {
    throw new Error(`Missing ${definition.queryObject} name.`);
  }
  const records = await queryAllRecords(host, sid, createDetailByNameSoqlQueryPath(definition, apiVersion, cleanName), {
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });
  if (!records.length) {
    throw new Error(`Metadata detail not found for ${definition.queryObject}.`);
  }
  return records[0];
}

function isAbortOrTimeoutError(error) {
  return error?.name === "AbortError" || /timed out/i.test(String(error?.message || ""));
}

const SOURCE_FILE_PATH_DEFINITIONS = {
  apexClasses: {
    metadataType: "apexClasses",
    nameField: "Name",
    folder: "classes",
    extension: "cls"
  },
  apexTriggers: {
    metadataType: "apexTriggers",
    nameField: "Name",
    folder: "triggers",
    extension: "trigger"
  },
  apexPages: {
    metadataType: "apexPages",
    nameField: "Name",
    folder: "pages",
    extension: "page"
  },
  apexComponents: {
    metadataType: "apexComponents",
    nameField: "Name",
    folder: "components",
    extension: "component"
  },
  lwcBundles: {
    metadataType: "lwcBundles",
    nameField: "FilePath",
    folder: "lwc",
    extension: ""
  },
  auraBundles: {
    metadataType: "auraBundles",
    nameField: "DefType",
    folder: "aura",
    extension: ""
  }
};

function createToolingQueryPath(apiVersion, soql) {
  return `/services/data/${apiVersion}/tooling/query?q=${encodeURIComponent(soql)}`;
}

function getToolingLookupNeedles(searchText = "") {
  const rawText = String(searchText || "").trim();
  const normalizedParts = rawText
    .split(/[.\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const apiNameParts = normalizedParts
    .map((part) => part.replace(/__(?:b|c|e|mdt|pc|x)$/i, ""))
    .filter(Boolean);
  return [...new Set([rawText, ...normalizedParts, ...apiNameParts].filter(Boolean))];
}

const TOOLING_LIKE_SEARCH_FIELDS = new Set([
  "DeveloperName",
  "EntityDefinition.DeveloperName",
  "EntityDefinition.QualifiedApiName",
  "FullName",
  "Label",
  "MasterLabel",
  "Name",
  "PluralLabel",
  "QualifiedApiName",
  "SobjectType",
  "Title",
  "ValidationName"
]);

function isToolingLikeSearchField(fieldName = "") {
  return TOOLING_LIKE_SEARCH_FIELDS.has(String(fieldName || ""));
}

function createToolingLookupWhere(fields = [], searchText = "", fieldGroups = []) {
  const conditions = createToolingLookupConditions(fields, searchText, fieldGroups);
  return conditions.length ? ` WHERE ${conditions.join(" OR ")}` : "";
}

function getToolingLookupTermParts(searchText = "") {
  return String(searchText || "")
    .trim()
    .split(/[.\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function createToolingLikeCondition(fieldName = "", needle = "") {
  return `${fieldName} LIKE '%${escapeSoqlString(needle)}%'`;
}

function createToolingLookupConditions(fields = [], searchText = "", fieldGroups = []) {
  const fieldSet = new Set(fields);
  const conditions = [];
  const termParts = getToolingLookupTermParts(searchText);
  const needles = getToolingLookupNeedles(searchText);
  fieldGroups
    .filter((fieldName) => fieldSet.has(fieldName) && isToolingLikeSearchField(fieldName))
    .forEach((fieldName) => {
      if (termParts.length > 1) {
        const cleanSearchText = String(searchText || "").trim();
        if (cleanSearchText) {
          conditions.push(createToolingLikeCondition(fieldName, cleanSearchText));
        }
        conditions.push(`(${termParts.map((part) => createToolingLikeCondition(fieldName, part)).join(" AND ")})`);
        return;
      }

      needles.forEach((needle) => {
        conditions.push(createToolingLikeCondition(fieldName, needle));
      });
    });
  return conditions;
}

async function queryToolingLookupSplitConditions(host, sid, apiVersion, queryObject, fields = [], conditions = [], attempt = {}, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 50) || 50, 200));
  const orderBy = attempt.orderBy ? ` ORDER BY ${attempt.orderBy}` : "";
  const records = [];
  let lastError = null;

  for (const condition of conditions) {
    const soql = `SELECT ${fields.join(", ")} FROM ${queryObject} WHERE ${condition}${orderBy} LIMIT ${limit}`;
    try {
      records.push(...await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, soql), {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }));
    } catch (error) {
      lastError = error;
    }
  }

  if (!records.length && lastError) {
    throw lastError;
  }

  return records;
}

async function queryToolingLookupWithAttempts(host, sid, apiVersion, queryObject, attempts = [], options = {}) {
  let lastError = null;
  const limit = Math.max(1, Math.min(Number(options.limit || 50) || 50, 200));

  for (const attempt of attempts) {
    const fields = attempt.fields || [];
    const conditions = createToolingLookupConditions(fields, options.searchText, attempt.searchFields || []);
    const whereClause = conditions.length ? ` WHERE ${conditions.join(" OR ")}` : "";
    if (options.searchText && Array.isArray(attempt.searchFields) && attempt.searchFields.length && !conditions.length) {
      continue;
    }
    const orderBy = attempt.orderBy ? ` ORDER BY ${attempt.orderBy}` : "";
    const soql = `SELECT ${fields.join(", ")} FROM ${queryObject}${whereClause}${orderBy} LIMIT ${limit}`;
    try {
      return {
        records: attempt.splitSearchConditions === true && conditions.length
          ? await queryToolingLookupSplitConditions(host, sid, apiVersion, queryObject, fields, conditions, attempt, {
            ...options,
            limit
          })
          : await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, soql), {
            timeoutMs: options.timeoutMs,
            signal: options.signal
          }),
        fields,
        warning: null
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    records: [],
    fields: [],
    warning: lastError instanceof Error ? lastError.message : String(lastError || "Tooling lookup failed.")
  };
}

function normalizeToolingNamespaceName(name = "", namespacePrefix = "") {
  const cleanName = String(name || "").trim();
  const cleanNamespace = String(namespacePrefix || "").trim();
  if (!cleanName || !cleanNamespace || cleanName.startsWith(`${cleanNamespace}__`)) {
    return cleanName;
  }
  return `${cleanNamespace}__${cleanName}`;
}

function normalizeToolingCustomObjectApiName(record = {}) {
  const apiName = record.QualifiedApiName
    || record.FullName
    || record.TableEnumOrId
    || normalizeToolingNamespaceName(record.DeveloperName || record.Name || "", record.NamespacePrefix);
  if (!apiName || /__(?:b|c|e|mdt|x)$/i.test(apiName)) {
    return apiName || "";
  }
  return `${apiName}__c`;
}

function normalizeToolingCustomFieldApiName(record = {}) {
  const apiName = record.QualifiedApiName
    || record.Name
    || normalizeToolingNamespaceName(record.DeveloperName || "", record.NamespacePrefix);
  if (!apiName || /__(?:c|pc|x)$/i.test(apiName) || !record.DeveloperName) {
    return apiName || "";
  }
  return `${apiName}__c`;
}

function normalizeToolingLookupCustomObject(record = {}) {
  const apiName = normalizeToolingCustomObjectApiName(record);
  const label = record.MasterLabel
    || record.Label
    || record.PluralLabel
    || record.Metadata?.label
    || apiName;
  return {
    id: record.Id || record.DurableId || "",
    type: "object",
    typeLabel: "CustomObject",
    metadataType: "objects",
    metadataObject: "CustomObject",
    metadataApiType: "CustomObject",
    name: apiName,
    apiName,
    fullName: apiName,
    label,
    objectApiName: apiName,
    objectLabel: label,
    path: getMetadataXmlSearchPath({ metadataType: "objects" }, apiName),
    record
  };
}

function normalizeToolingLookupCustomField(record = {}) {
  const objectApiName = record.EntityDefinition?.QualifiedApiName
    || record.EntityDefinition?.DeveloperName
    || record.TableEnumOrId
    || "";
  const fieldApiName = normalizeToolingCustomFieldApiName(record);
  const label = record.Metadata?.label
    || record.MasterLabel
    || record.Label
    || fieldApiName;
  return {
    id: record.Id || record.DurableId || "",
    type: "field",
    typeLabel: "CustomField",
    metadataType: "customFields",
    metadataObject: "CustomField",
    metadataApiType: "CustomField",
    name: objectApiName ? `${objectApiName}.${fieldApiName}` : fieldApiName,
    apiName: fieldApiName,
    fullName: objectApiName ? `${objectApiName}.${fieldApiName}` : fieldApiName,
    label,
    objectApiName,
    objectLabel: objectApiName,
    path: getMetadataXmlSearchPath({ metadataType: "customFields" }, objectApiName ? `${objectApiName}.${fieldApiName}` : fieldApiName),
    record
  };
}

function normalizeToolingLookupEntityDefinition(record = {}) {
  const apiName = record.QualifiedApiName
    || record.Name
    || normalizeToolingNamespaceName(record.DeveloperName || "", record.NamespacePrefix);
  const label = record.Label
    || record.MasterLabel
    || record.Metadata?.label
    || apiName;
  return {
    id: record.Id || record.DurableId || "",
    type: "object",
    typeLabel: "Object",
    metadataType: "objects",
    metadataObject: "CustomObject",
    metadataApiType: "CustomObject",
    name: apiName,
    apiName,
    fullName: apiName,
    label,
    objectApiName: apiName,
    objectLabel: label,
    path: getMetadataXmlSearchPath({ metadataType: "objects" }, apiName),
    record
  };
}

function getMetadataSearchRecordDedupeKey(record = {}) {
  return [
    record.metadataObject || record.typeLabel || record.type || "metadata",
    record.name || record.apiName || record.fullName || record.id || ""
  ].join(":").toLocaleLowerCase();
}

function dedupeMetadataSearchMatches(matches = []) {
  const seen = new Set();
  return (Array.isArray(matches) ? matches : []).filter((match) => {
    const key = [
      match?.label || "",
      match?.lineNumber || 0,
      match?.snippet || ""
    ].join(":").toLocaleLowerCase();
    if (!String(match?.snippet || "").trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeMetadataSearchRecords(records = []) {
  const byKey = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = getMetadataSearchRecordDedupeKey(record);
    if (!key.trim()) {
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...record,
        matches: dedupeMetadataSearchMatches(record.matches || [])
      });
      return;
    }

    byKey.set(key, {
      ...existing,
      ...record,
      record: {
        ...(existing.record && typeof existing.record === "object" ? existing.record : {}),
        ...(record.record && typeof record.record === "object" ? record.record : {})
      },
      matches: dedupeMetadataSearchMatches([
        ...(existing.matches || []),
        ...(record.matches || [])
      ])
    });
  });
  return [...byKey.values()];
}

function dedupeMetadataSearchRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = getMetadataSearchRecordDedupeKey(record);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getMetadataSearchRank(record = {}, searchText = "") {
  const term = String(searchText || "").trim().toLocaleLowerCase();
  if (!term) {
    return 10;
  }

  const name = String(record.name || record.apiName || "").toLocaleLowerCase();
  const label = String(record.label || "").toLocaleLowerCase();
  const typeLabel = String(record.typeLabel || record.metadataObject || "").toLocaleLowerCase();
  const matchingSnippets = (Array.isArray(record.matches) ? record.matches : [])
    .map((match) => String(match?.snippet || "").toLocaleLowerCase())
    .filter((snippet) => snippet.includes(term));
  if (name === term || label === term) {
    return 0;
  }
  if (matchingSnippets.some((snippet) => snippet.includes(`body l`) || snippet.includes(`markup l`))) {
    return 1;
  }
  if (name.startsWith(term)) {
    return 2;
  }
  if (label.startsWith(term)) {
    return 3;
  }
  if (name.includes(term)) {
    return 4;
  }
  if (label.includes(term)) {
    return 5;
  }
  if (matchingSnippets.length) {
    return 6;
  }
  if (typeLabel.includes(term)) {
    return 7;
  }
  return 10;
}

function getMetadataSearchTypePriority(record = {}) {
  const candidates = [
    record.metadataType,
    record.metadataObject,
    record.metadataApiType,
    record.typeLabel,
    record.type
  ]
    .map((value) => String(value || "").trim().toLocaleLowerCase())
    .filter(Boolean);
  const matchedPriority = candidates
    .map((candidate) => COMMON_METADATA_SEARCH_TYPE_PRIORITY.get(candidate))
    .filter((priority) => Number.isFinite(priority));
  return matchedPriority.length ? Math.min(...matchedPriority) : 20;
}

function compareMetadataSearchRecords(searchText = "") {
  return (left, right) => (
    getMetadataSearchTypePriority(left) - getMetadataSearchTypePriority(right)
    || getMetadataSearchRank(left, searchText) - getMetadataSearchRank(right, searchText)
    || String(left.typeLabel || left.metadataObject || left.type || "").localeCompare(String(right.typeLabel || right.metadataObject || right.type || ""))
    || String(left.name || left.apiName || "").localeCompare(String(right.name || right.apiName || ""))
  );
}

function emitMetadataSearchProgress(options = {}, payload = {}) {
  if (typeof options.onProgress !== "function") {
    return;
  }

  try {
    options.onProgress({
      source: payload.source || "",
      metadataType: payload.metadataType || payload.definition?.metadataType || payload.definition?.id || "",
      metadataObject: payload.metadataObject || payload.definition?.metadataApiType || payload.definition?.metadataObject || payload.definition?.queryObject || "",
      typeLabel: payload.typeLabel || payload.definition?.itemLabel || payload.definition?.typeLabel || payload.definition?.label || "",
      records: Array.isArray(payload.records) ? payload.records : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : []
    });
  } catch (error) {
    console.warn("Metadata search progress callback failed", error);
  }
}

function getMetadataSearchSelectedTypeSet(options = {}) {
  return new Set((Array.isArray(options.metadataTypes) ? options.metadataTypes : [])
    .map((metadataType) => String(metadataType || "").trim().toLocaleLowerCase())
    .filter(Boolean));
}

function metadataSearchDefinitionIsSelected(definition = {}, selectedTypes = new Set()) {
  if (!selectedTypes.size) {
    return true;
  }
  return [
    definition.id,
    definition.metadataType,
    definition.metadataApiType,
    definition.metadataObject,
    definition.queryObject,
    definition.type
  ]
    .map((value) => String(value || "").trim().toLocaleLowerCase())
    .filter(Boolean)
    .some((value) => selectedTypes.has(value));
}

function metadataSearchRecordIsSelected(record = {}, selectedTypes = new Set()) {
  return metadataSearchDefinitionIsSelected({
    id: record.metadataType,
    metadataType: record.metadataType,
    metadataApiType: record.metadataApiType,
    metadataObject: record.metadataObject,
    queryObject: record.typeLabel,
    type: record.type
  }, selectedTypes);
}

const STANDARD_SOSL_METADATA_SEARCH_DEFINITIONS = [
  {
    metadataType: "staticResources",
    type: "staticResource",
    typeLabel: "StaticResource",
    metadataObject: "StaticResource",
    queryObject: "StaticResource",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "NamespacePrefix", "ContentType", "LastModifiedDate"]
  },
  {
    metadataType: "email",
    type: "emailTemplate",
    typeLabel: "EmailTemplate",
    metadataObject: "EmailTemplate",
    queryObject: "EmailTemplate",
    nameField: "Name",
    labelField: "Subject",
    fields: ["Id", "Name", "DeveloperName", "Subject", "FolderName", "NamespacePrefix", "LastModifiedDate"]
  },
  {
    metadataType: "documents",
    type: "document",
    typeLabel: "Document",
    metadataObject: "Document",
    queryObject: "Document",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "DeveloperName", "FolderName", "ContentType", "LastModifiedDate"]
  },
  {
    metadataType: "contentDocuments",
    type: "contentDocument",
    typeLabel: "ContentDocument",
    metadataObject: "ContentDocument",
    queryObject: "ContentDocument",
    nameField: "Title",
    labelField: "FileType",
    fields: ["Id", "Title", "FileType", "LatestPublishedVersionId", "LastModifiedDate"]
  },
  {
    metadataType: "reports",
    type: "report",
    typeLabel: "Report",
    metadataObject: "Report",
    queryObject: "Report",
    nameField: "Name",
    labelField: "DeveloperName",
    fields: ["Id", "Name", "DeveloperName", "FolderName", "LastRunDate", "LastModifiedDate"]
  },
  {
    metadataType: "dashboards",
    type: "dashboard",
    typeLabel: "Dashboard",
    metadataObject: "Dashboard",
    queryObject: "Dashboard",
    nameField: "Title",
    labelField: "DeveloperName",
    fields: ["Id", "Title", "DeveloperName", "FolderName", "LastModifiedDate"]
  }
];

const COMMON_TOOLING_SOSL_METADATA_SEARCH_DEFINITIONS = [
  {
    metadataType: "objects",
    type: "object",
    typeLabel: "Object",
    metadataObject: "CustomObject",
    queryObject: "EntityDefinition",
    nameField: "QualifiedApiName",
    labelField: "Label",
    fields: ["DurableId", "QualifiedApiName", "Label"],
    tooling: true
  },
  {
    metadataType: "customFields",
    type: "field",
    typeLabel: "Field",
    metadataObject: "CustomField",
    queryObject: "FieldDefinition",
    nameField: "QualifiedApiName",
    labelField: "Label",
    fields: ["DurableId", "QualifiedApiName", "Label", "DataType"],
    tooling: true
  },
  {
    metadataType: "customFields",
    type: "field",
    typeLabel: "CustomField",
    metadataObject: "CustomField",
    queryObject: "CustomField",
    nameField: "DeveloperName",
    labelField: "DeveloperName",
    fields: ["Id", "DeveloperName", "NamespacePrefix", "TableEnumOrId"],
    tooling: true
  },
  {
    metadataType: "validationRules",
    type: "validationRules",
    typeLabel: "Validation Rule",
    metadataObject: "ValidationRule",
    queryObject: "ValidationRule",
    nameField: "ValidationName",
    labelField: "ValidationName",
    fields: ["Id", "ValidationName", "Active", "Description", "ErrorMessage", "ErrorConditionFormula"],
    tooling: true
  }
];

function getToolingSoslMetadataSearchDefinitions() {
  const sourceMetadataDefinitions = schemaMetadataTypeDefinitions
    .filter((definition) => definition.kind === "tooling" && definition.queryObject)
    .map((definition) => ({
      metadataType: definition.id || definition.queryObject,
      type: definition.id || definition.queryObject,
      typeLabel: definition.itemLabel || definition.label || definition.queryObject,
      metadataObject: definition.metadataApiType || definition.queryObject,
      queryObject: definition.queryObject,
      nameField: definition.nameField,
      labelField: definition.labelField || definition.nameField,
      fields: definition.fields || [],
      detailFields: definition.detailFields || [],
      where: "",
      tooling: true
    }));
  return sourceMetadataDefinitions;
}

function escapeSoslSearchTerm(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([?&|!{}\[\]\(\)^~*:"'+-])/g, "\\$1");
}

function escapeSoslPhraseTerm(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function createSoslFindTerm(searchText = "") {
  const cleanSearchText = String(searchText || "").trim();
  const parts = cleanSearchText
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
  const wildcardParts = parts.map((part) => {
    const escaped = escapeSoslSearchTerm(part);
    return escaped.length >= 2 && !escaped.endsWith("*") ? `${escaped}*` : escaped;
  });
  if (parts.length <= 1) {
    return wildcardParts.join(" ");
  }

  return `"${escapeSoslPhraseTerm(cleanSearchText)}"`;
}

function getSoslReturningFields(definition = {}, fields = definition.fields || []) {
  const allowedFields = new Set(Array.isArray(definition.fields) ? definition.fields : []);
  const baseFields = [
    "Id",
    definition.nameField,
    definition.labelField
  ];
  return [...new Set([
    ...baseFields,
    ...(Array.isArray(fields) ? fields : [])
  ])]
    .filter(Boolean)
    .filter((fieldName) => !String(fieldName).includes("."))
    .filter((fieldName) => !allowedFields.size || allowedFields.has(fieldName));
}

function createMetadataSosl(definition = {}, searchText = "", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  const findTerm = createSoslFindTerm(searchText);
  const fields = getSoslReturningFields(definition, options.fields);
  const searchScope = Object.prototype.hasOwnProperty.call(definition, "searchScope")
    ? String(definition.searchScope || "")
    : "IN ALL FIELDS";
  const searchScopeClause = searchScope ? ` ${searchScope}` : "";
  const whereClause = definition.where ? ` WHERE ${definition.where}` : "";
  return `FIND {${findTerm}}${searchScopeClause} RETURNING ${definition.queryObject}(${fields.join(", ")}${whereClause} LIMIT ${limit})`;
}

function createSoslQueryPath(apiVersion, sosl, options = {}) {
  const searchResource = options.tooling === true ? "tooling/search" : "search";
  return `/services/data/${apiVersion}/${searchResource}/?q=${encodeURIComponent(sosl)}`;
}

function normalizeSoslMetadataName(record = {}, definition = {}) {
  const rawName = record[definition.nameField]
    || record.DeveloperName
    || record.Name
    || record.MasterLabel
    || record.Title
    || record.Id
    || "";
  return getNamespacedSourceName(rawName, record, definition.metadataType);
}

function normalizeSoslMetadataRecord(record = {}, definition = {}) {
  if (definition.queryObject === "EntityDefinition") {
    const apiName = record.QualifiedApiName || record.DurableId || record.Name || "";
    const label = record.Label || record.MasterLabel || apiName;
    return {
      id: record.DurableId || record.Id || "",
      type: "object",
      typeLabel: "Object",
      metadataType: "objects",
      metadataObject: "CustomObject",
      metadataApiType: "CustomObject",
      name: apiName,
      apiName,
      fullName: apiName,
      label,
      objectApiName: apiName,
      objectLabel: label,
      source: "tooling-sosl",
      path: getMetadataXmlSearchPath({ metadataType: "objects" }, apiName),
      record
    };
  }

  if (definition.queryObject === "FieldDefinition") {
    const durableId = String(record.DurableId || "").trim();
    const fieldApiName = record.QualifiedApiName || durableId.split(".").pop() || record.Name || "";
    const objectApiName = durableId.includes(".") ? durableId.split(".").slice(0, -1).join(".") : "";
    const fullName = objectApiName && fieldApiName ? `${objectApiName}.${fieldApiName}` : durableId || fieldApiName;
    const label = record.Label || record.MasterLabel || fieldApiName;
    return {
      id: durableId || record.Id || "",
      type: "field",
      typeLabel: "Field",
      metadataType: "customFields",
      metadataObject: "CustomField",
      metadataApiType: "CustomField",
      name: fullName,
      apiName: fieldApiName,
      fullName,
      label,
      objectApiName,
      objectLabel: objectApiName,
      source: "tooling-sosl",
      path: getMetadataXmlSearchPath({ metadataType: "customFields" }, fullName),
      record
    };
  }

  if (definition.queryObject === "CustomField") {
    return {
      ...normalizeToolingLookupCustomField(record),
      source: "tooling-sosl"
    };
  }

  if (definition.queryObject === "ValidationRule") {
    const childApiName = record.ValidationName || record.Name || record.Id || "";
    const objectApiName = record.EntityDefinition?.QualifiedApiName || record.SobjectType || "";
    const fullName = objectApiName && childApiName ? `${objectApiName}.${childApiName}` : childApiName;
    return {
      id: record.Id || "",
      type: definition.type || "validationRules",
      typeLabel: definition.typeLabel || "Validation Rule",
      metadataType: "validationRules",
      metadataObject: "ValidationRule",
      metadataApiType: "ValidationRule",
      name: fullName,
      apiName: childApiName,
      fullName,
      label: childApiName,
      objectApiName,
      objectLabel: objectApiName,
      source: "tooling-sosl",
      path: getMetadataXmlSearchPath({
        metadataType: "validationRules",
        metadataApiType: "ValidationRule",
        folder: "objects",
        extension: "validationRule-meta.xml"
      }, fullName),
      record
    };
  }

  const name = normalizeSoslMetadataName(record, definition);
  const label = record[definition.labelField]
    || record.MasterLabel
    || record.Label
    || record.Subject
    || record.Title
    || record.Name
    || name;
  return {
    id: record.Id || record.DurableId || "",
    type: definition.type || definition.metadataType || definition.queryObject || "metadata",
    typeLabel: definition.typeLabel || definition.metadataObject || definition.queryObject || "Metadata",
    metadataType: definition.metadataType || "",
    metadataObject: definition.metadataObject || definition.queryObject || "",
    name,
    apiName: name,
    label,
    objectApiName: "",
    objectLabel: "",
    source: definition.tooling ? "tooling-sosl" : "sosl",
    record
  };
}

function getToolingCodeContentFields(definition = {}) {
  if (definition.tooling !== true || !["ApexClass", "ApexTrigger", "ApexPage", "ApexComponent"].includes(definition.queryObject)) {
    return [];
  }
  return (Array.isArray(definition.detailFields) ? definition.detailFields : [])
    .filter((fieldName) => ["Body", "Markup"].includes(fieldName));
}

function getContentSnippetNeedles(searchText = "") {
  const cleanSearchText = String(searchText || "").trim();
  const parts = getToolingLookupTermParts(cleanSearchText);
  return {
    phrase: cleanSearchText,
    parts
  };
}

function lineMatchesContentSearch(line = "", needles = {}) {
  const lowerLine = String(line || "").toLocaleLowerCase();
  const phrase = String(needles.phrase || "").toLocaleLowerCase();
  const parts = Array.isArray(needles.parts) ? needles.parts : [];
  if (!phrase) {
    return false;
  }
  if (parts.length <= 1) {
    return lowerLine.includes(phrase);
  }
  return lowerLine.includes(phrase) || parts.every((part) => lowerLine.includes(String(part || "").toLocaleLowerCase()));
}

function getContentSnippetNeedle(line = "", needles = {}) {
  const lowerLine = String(line || "").toLocaleLowerCase();
  const phrase = String(needles.phrase || "").toLocaleLowerCase();
  if (phrase && lowerLine.includes(phrase)) {
    return needles.phrase;
  }
  return (Array.isArray(needles.parts) ? needles.parts : [])
    .find((part) => lowerLine.includes(String(part || "").toLocaleLowerCase())) || needles.phrase || "";
}

function createContentSnippetText(line = "", needle = "", maxLength = 180) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = String(needle || "").toLocaleLowerCase();
  const matchIndex = lowerNeedle ? lowerText.indexOf(lowerNeedle) : -1;
  if (matchIndex < 0) {
    return `${text.slice(0, maxLength - 3).trim()}...`;
  }

  const sideLength = Math.max(20, Math.floor((maxLength - lowerNeedle.length - 6) / 2));
  const start = Math.max(0, matchIndex - sideLength);
  const end = Math.min(text.length, matchIndex + lowerNeedle.length + sideLength);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

function createToolingCodeContentMatches(content = "", searchText = "", fieldName = "Body", maxMatches = 3) {
  const needles = getContentSnippetNeedles(searchText);
  const lines = String(content || "").split(/\r?\n/);
  const label = fieldName === "Markup" ? "Markup" : "Body";
  const matches = [];

  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    const line = lines[index];
    if (!lineMatchesContentSearch(line, needles)) {
      continue;
    }
    const needle = getContentSnippetNeedle(line, needles);
    const snippet = createContentSnippetText(line, needle);
    if (!snippet) {
      continue;
    }
    matches.push({
      label,
      lineNumber: index + 1,
      count: Math.max(1, countNeedleMatches(line, needle)),
      snippet: `${label} L${index + 1}: ${snippet}`
    });
  }

  return matches;
}

async function attachToolingCodeContentMatches(host, sid, apiVersion, definition = {}, records = [], searchText = "", options = {}) {
  const contentFields = getToolingCodeContentFields(definition);
  const recordIds = [...new Set((Array.isArray(records) ? records : [])
    .map((record) => String(record.id || record.record?.Id || "").trim())
    .filter(Boolean))];
  if (!contentFields.length || !recordIds.length) {
    return {
      records,
      warning: null
    };
  }

  try {
    const detailSoql = `SELECT Id, ${contentFields.join(", ")} FROM ${definition.queryObject} WHERE Id IN (${recordIds.map((id) => `'${escapeSoqlString(id)}'`).join(", ")})`;
    const detailRecords = await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, detailSoql), {
      timeoutMs: options.timeoutMs,
      signal: options.signal
    });
    const detailById = new Map(detailRecords.map((record) => [String(record.Id || ""), record]));
    return {
      records: records.map((record) => {
        const detail = detailById.get(String(record.id || record.record?.Id || ""));
        if (!detail) {
          return record;
        }
        const contentMatches = contentFields.flatMap((fieldName) => (
          createToolingCodeContentMatches(detail[fieldName], searchText, fieldName, TOOLING_CODE_CONTENT_SNIPPET_LIMIT)
        ));
        if (!contentMatches.length) {
          return record;
        }
        return {
          ...record,
          matches: [
            ...(Array.isArray(record.matches) ? record.matches : []),
            ...contentMatches
          ]
        };
      }),
      warning: null
    };
  } catch (error) {
    return {
      records,
      warning: `${definition.queryObject} content snippets: ${error instanceof Error ? error.message : String(error || "Search failed.")}`
    };
  }
}

async function querySoslMetadataDefinition(host, sid, apiVersion, definition = {}, searchText = "", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  const attempts = [
    getSoslReturningFields(definition, definition.fields),
    getSoslReturningFields(definition, ["Id", definition.nameField, definition.labelField, "DeveloperName", "Name", "NamespacePrefix"])
  ];
  let lastError = null;

  for (const fields of attempts) {
    try {
      const sosl = createMetadataSosl(definition, searchText, { limit, fields });
      const response = await salesforceRequest(
        host,
        sid,
        createSoslQueryPath(apiVersion, sosl, { tooling: definition.tooling === true }),
        {
          timeoutMs: options.timeoutMs,
          signal: options.signal
        }
      );
      const records = Array.isArray(response?.searchRecords) ? response.searchRecords : [];
      const normalizedRecords = records.map((record) => normalizeSoslMetadataRecord(record, definition));
      const contentResult = await attachToolingCodeContentMatches(host, sid, apiVersion, definition, normalizedRecords, searchText, options);
      return {
        records: contentResult.records,
        warning: contentResult.warning
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    records: [],
    warning: `${definition.queryObject} SOSL: ${lastError instanceof Error ? lastError.message : String(lastError || "Search failed.")}`
  };
}

async function searchSoslMetadataDefinitions(host, sid, searchText = "", definitions = [], options = {}) {
  if (!definitions.length) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || METADATA_SEARCH_SOSL_CONCURRENCY) || METADATA_SEARCH_SOSL_CONCURRENCY, METADATA_SEARCH_SOSL_CONCURRENCY));
  const results = await mapWithConcurrency(definitions, concurrency, async (definition) => {
    const result = await querySoslMetadataDefinition(host, sid, apiVersion, definition, searchText, {
      ...options,
      limit
    });
    emitMetadataSearchProgress(options, {
      source: definition.tooling ? "tooling-sosl" : "sosl",
      definition,
      records: result.records || [],
      warnings: result.warning ? [result.warning] : []
    });
    return result;
  });

  return {
    records: results.flatMap((result) => result.records || []),
    warnings: results.map((result) => result.warning).filter(Boolean)
  };
}

// SOSL only matches whole-token prefixes and depends on the async search index,
// so it misses substring name matches (e.g. "TriggerHandler" inside
// "OpportunityTriggerHandler") and newly created records. A direct Tooling SOQL
// LIKE query on the name/label fields covers both cases. This runs alongside the
// SOSL search (which still provides body/source-code matching), and duplicates
// collapse via getMetadataSearchRecordDedupeKey.
async function queryLikeMetadataDefinition(host, sid, apiVersion, definition = {}, searchText = "", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  const searchableFields = [...new Set([definition.nameField, definition.labelField].filter(Boolean))]
    .filter((fieldName) => isToolingLikeSearchField(fieldName));
  const conditions = createToolingLookupConditions(searchableFields, searchText, searchableFields);
  if (!conditions.length) {
    return { records: [], warning: null };
  }

  const attempts = [
    getSoslReturningFields(definition, definition.fields),
    getSoslReturningFields(definition, ["Id", definition.nameField, definition.labelField, "DeveloperName", "Name", "NamespacePrefix"])
  ];
  let lastError = null;

  for (const fields of attempts) {
    if (!fields.length) {
      continue;
    }
    const soql = `SELECT ${fields.join(", ")} FROM ${definition.queryObject} WHERE ${conditions.join(" OR ")} LIMIT ${limit}`;
    try {
      const records = await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, soql), {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      });
      return {
        records: records.map((record) => normalizeSoslMetadataRecord(record, definition)),
        warning: null
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    records: [],
    warning: lastError
      ? `${definition.queryObject} LIKE: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      : null
  };
}

async function searchLikeMetadataDefinitions(host, sid, searchText = "", definitions = [], options = {}) {
  if (!definitions.length) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || METADATA_SEARCH_SOSL_CONCURRENCY) || METADATA_SEARCH_SOSL_CONCURRENCY, METADATA_SEARCH_SOSL_CONCURRENCY));
  const results = await mapWithConcurrency(definitions, concurrency, async (definition) => {
    const result = await queryLikeMetadataDefinition(host, sid, apiVersion, definition, searchText, {
      ...options,
      limit
    });
    emitMetadataSearchProgress(options, {
      source: "tooling-like",
      definition,
      records: result.records || [],
      warnings: result.warning ? [result.warning] : []
    });
    return result;
  });

  return {
    records: results.flatMap((result) => result.records || []),
    warnings: results.map((result) => result.warning).filter(Boolean)
  };
}

export async function searchToolingCustomObjectsAndFields(host, sid, searchText = "", options = {}) {
  const cleanSearchText = String(searchText || "").trim();
  if (!cleanSearchText) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const limit = Math.max(1, Math.min(Number(options.limit || 80) || 80, 200));
  const selectedTypes = getMetadataSearchSelectedTypeSet(options);
  const includeObjects = !selectedTypes.size
    || ["objects", "customobject", "entitydefinition"].some((metadataType) => selectedTypes.has(metadataType));
  const includeFields = !selectedTypes.size
    || ["customfields", "customfield", "fielddefinition"].some((metadataType) => selectedTypes.has(metadataType));
  const objectAttempts = [
    {
      fields: ["Id", "DeveloperName"],
      searchFields: ["DeveloperName"],
      orderBy: "DeveloperName"
    }
  ];
  const fieldAttempts = [
    {
      fields: ["Id", "DeveloperName", "TableEnumOrId", "EntityDefinition.QualifiedApiName"],
      searchFields: ["DeveloperName", "EntityDefinition.QualifiedApiName"],
      orderBy: "TableEnumOrId, DeveloperName"
    },
    {
      fields: ["Id", "DeveloperName", "TableEnumOrId"],
      searchFields: ["DeveloperName"],
      orderBy: "TableEnumOrId, DeveloperName"
    }
  ];
  const entityDefinitionAttempts = [
    {
      fields: ["DurableId", "QualifiedApiName", "Label"],
      searchFields: ["QualifiedApiName", "Label"],
      orderBy: "QualifiedApiName",
      splitSearchConditions: true
    },
    {
      fields: ["DurableId", "QualifiedApiName"],
      searchFields: ["QualifiedApiName"],
      orderBy: "QualifiedApiName",
      splitSearchConditions: true
    }
  ];

  const objectPromise = includeObjects ? queryToolingLookupWithAttempts(host, sid, apiVersion, "CustomObject", objectAttempts, {
    ...options,
    searchText: cleanSearchText,
    limit
  }).then((result) => {
    const records = result.records.map((record) => normalizeToolingLookupCustomObject(record));
    emitMetadataSearchProgress(options, {
      source: "tooling-lookup",
      metadataType: "objects",
      metadataObject: "CustomObject",
      typeLabel: "CustomObject",
      records,
      warnings: result.warning ? [`CustomObject lookup: ${result.warning}`] : []
    });
    return result;
  }) : Promise.resolve({ records: [], warning: null });
  const fieldPromise = includeFields ? queryToolingLookupWithAttempts(host, sid, apiVersion, "CustomField", fieldAttempts, {
    ...options,
    searchText: cleanSearchText,
    limit
  }).then((result) => {
    const records = result.records.map((record) => normalizeToolingLookupCustomField(record));
    emitMetadataSearchProgress(options, {
      source: "tooling-lookup",
      metadataType: "customFields",
      metadataObject: "CustomField",
      typeLabel: "CustomField",
      records,
      warnings: result.warning ? [`CustomField lookup: ${result.warning}`] : []
    });
    return result;
  }) : Promise.resolve({ records: [], warning: null });
  const entityDefinitionPromise = includeObjects ? queryToolingLookupWithAttempts(host, sid, apiVersion, "EntityDefinition", entityDefinitionAttempts, {
    ...options,
    searchText: cleanSearchText,
    limit
  }).then((result) => {
    const records = result.records.map((record) => normalizeToolingLookupEntityDefinition(record));
    emitMetadataSearchProgress(options, {
      source: "tooling-lookup",
      metadataType: "entityDefinitions",
      metadataObject: "EntityDefinition",
      typeLabel: "Object",
      records,
      warnings: result.warning ? [`EntityDefinition lookup: ${result.warning}`] : []
    });
    return result;
  }) : Promise.resolve({ records: [], warning: null });

  const [objectResult, fieldResult, entityDefinitionResult] = await Promise.all([
    objectPromise,
    fieldPromise,
    entityDefinitionPromise
  ]);

  const warnings = [
    objectResult.warning ? `CustomObject lookup: ${objectResult.warning}` : "",
    fieldResult.warning ? `CustomField lookup: ${fieldResult.warning}` : "",
    entityDefinitionResult.warning ? `EntityDefinition lookup: ${entityDefinitionResult.warning}` : ""
  ].filter(Boolean);
  const records = dedupeMetadataSearchRecords([
    ...objectResult.records.map((record) => normalizeToolingLookupCustomObject(record)),
    ...fieldResult.records.map((record) => normalizeToolingLookupCustomField(record)),
    ...entityDefinitionResult.records.map((record) => normalizeToolingLookupEntityDefinition(record))
  ])
    .filter((record) => record.name || record.apiName)
    .sort(compareMetadataSearchRecords(cleanSearchText))
    .slice(0, limit);

  return {
    records,
    warnings
  };
}

const EXTRA_TOOLING_METADATA_DESCRIPTION_DEFINITIONS = [
  {
    id: "recordTypes",
    metadataType: "recordTypes",
    label: "Record Types",
    itemLabel: "Record Type",
    kind: "tooling",
    queryObject: "RecordType",
    metadataApiType: "RecordType",
    directoryName: "objects",
    suffix: "recordType",
    idField: "Id",
    nameField: "Name",
    labelField: "Name",
    fields: ["Id", "Name", "EntityDefinition.QualifiedApiName"],
    fieldAttempts: [
      ["Id", "Name", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "SobjectType"]
    ],
    searchFields: ["Name", "EntityDefinition.QualifiedApiName"],
    orderBy: "Name"
  },
  {
    id: "validationRules",
    metadataType: "validationRules",
    label: "Validation Rules",
    itemLabel: "Validation Rule",
    kind: "tooling",
    queryObject: "ValidationRule",
    metadataApiType: "ValidationRule",
    directoryName: "objects",
    suffix: "validationRule",
    idField: "Id",
    nameField: "ValidationName",
    labelField: "ValidationName",
    fields: ["Id", "ValidationName", "EntityDefinition.QualifiedApiName"],
    fieldAttempts: [
      ["Id", "ValidationName", "EntityDefinition.QualifiedApiName"]
    ],
    searchFields: ["ValidationName", "EntityDefinition.QualifiedApiName"],
    orderBy: "ValidationName"
  },
  {
    id: "webLinks",
    metadataType: "webLinks",
    label: "Web Links",
    itemLabel: "Web Link",
    kind: "tooling",
    queryObject: "WebLink",
    metadataApiType: "WebLink",
    directoryName: "objects",
    suffix: "webLink",
    idField: "Id",
    nameField: "Name",
    labelField: "MasterLabel",
    fields: ["Id", "Name", "MasterLabel", "EntityDefinition.QualifiedApiName", "EntityDefinition.DeveloperName"],
    fieldAttempts: [
      ["Id", "Name", "MasterLabel", "EntityDefinition.QualifiedApiName", "EntityDefinition.DeveloperName"],
      ["Id", "Name", "MasterLabel", "EntityDefinition.QualifiedApiName"],
      ["Id", "Name", "EntityDefinition.QualifiedApiName"]
    ],
    searchFields: ["Name", "MasterLabel", "EntityDefinition.QualifiedApiName", "EntityDefinition.DeveloperName"],
    orderBy: "Name"
  }
];

function getToolingMetadataDescriptionDefinitions(metadataTypes = []) {
  const selectedTypes = new Set((Array.isArray(metadataTypes) ? metadataTypes : [])
    .map((metadataType) => String(metadataType || "").trim())
    .filter(Boolean));
  const entityDefinitions = selectedTypes.size
    ? []
    : [
      {
        id: "entityDefinitions",
        metadataType: "entityDefinitions",
        label: "Objects",
        itemLabel: "Object",
        kind: "tooling",
        queryObject: "EntityDefinition",
        metadataApiType: "CustomObject",
        idField: "DurableId",
        nameField: "QualifiedApiName",
        labelField: "Label",
        fields: ["DurableId", "QualifiedApiName", "Label"],
        orderBy: "QualifiedApiName",
        searchFields: ["QualifiedApiName", "Label"],
        splitSearchConditions: true
      },
      {
        id: "fieldDefinitions",
        metadataType: "fieldDefinitions",
        label: "Fields",
        itemLabel: "Field",
        kind: "tooling",
        queryObject: "FieldDefinition",
        metadataApiType: "CustomField",
        idField: "DurableId",
        nameField: "QualifiedApiName",
        labelField: "Label",
        fields: ["DurableId", "QualifiedApiName", "Label"],
        orderBy: "QualifiedApiName",
        searchFields: ["QualifiedApiName", "Label"],
        splitSearchConditions: true
      }
    ];
  const sourceDefinitions = schemaMetadataTypeDefinitions
    .filter((definition) => definition.kind === "tooling" && definition.queryObject)
    .filter((definition) => !selectedTypes.size || selectedTypes.has(definition.id))
    .map((definition) => ({
      ...definition,
      metadataType: definition.id,
      metadataObject: definition.metadataApiType || definition.queryObject
    }));
  const extraDefinitions = EXTRA_TOOLING_METADATA_DESCRIPTION_DEFINITIONS
    .filter((definition) => !selectedTypes.size || selectedTypes.has(definition.id) || selectedTypes.has(definition.metadataApiType))
    .map((definition) => ({
      ...definition,
      metadataObject: definition.metadataApiType || definition.queryObject
    }));
  return [...entityDefinitions, ...sourceDefinitions, ...extraDefinitions];
}

function getToolingDescriptionQueryFields(definition = {}) {
  return [...new Set([
    definition.idField || "Id",
    definition.nameField,
    definition.labelField,
    ...(Array.isArray(definition.fields) ? definition.fields : [])
  ].filter(Boolean))];
}

function getToolingDescriptionFallbackFields(definition = {}) {
  return [...new Set([
    definition.idField || "Id",
    definition.nameField,
    definition.labelField,
    ...(Array.isArray(definition.fields) ? definition.fields.filter((field) => !String(field).includes(".")) : [])
  ].filter(Boolean))];
}

function getToolingDescriptionFieldAttempts(definition = {}) {
  const attempts = Array.isArray(definition.fieldAttempts) && definition.fieldAttempts.length
    ? definition.fieldAttempts
    : [
      getToolingDescriptionQueryFields(definition),
      getToolingDescriptionFallbackFields(definition)
    ];
  return attempts
    .map((fields) => [...new Set((Array.isArray(fields) ? fields : []).filter(Boolean))])
    .filter((fields, index, source) => (
      fields.length
      && source.findIndex((candidate) => candidate.join(",") === fields.join(",")) === index
    ));
}

function getToolingDescriptionSearchFields(fields = [], definition = {}) {
  const fieldSet = new Set(fields);
  if (Array.isArray(definition.searchFields) && definition.searchFields.length) {
    return definition.searchFields.filter((field) => fieldSet.has(field));
  }
  return [
    "Name",
    "DeveloperName",
    "MasterLabel",
    "Label",
    "QualifiedApiName",
    "Title",
    "PluralLabel",
    "FullName"
  ].filter((field) => fieldSet.has(field));
}

function createToolingDescriptionSearchSoqls(definition = {}, fields = [], searchText = "", limit = 20) {
  const lookupConditions = createToolingLookupConditions(fields, searchText, getToolingDescriptionSearchFields(fields, definition));
  if (!lookupConditions.length) {
    return [];
  }

  const orderBy = definition.orderBy ? ` ORDER BY ${definition.orderBy}` : "";
  const createSoql = (lookupCondition) => {
    const conditions = [];
    if (definition.where) {
      conditions.push(`(${definition.where})`);
    }
    conditions.push(`(${lookupCondition})`);
    const whereClause = ` WHERE ${conditions.join(" AND ")}`;
    return `SELECT ${fields.join(", ")} FROM ${definition.queryObject}${whereClause}${orderBy} LIMIT ${limit}`;
  };

  return definition.splitSearchConditions
    ? lookupConditions.map((condition) => createSoql(condition))
    : [createSoql(lookupConditions.join(" OR "))];
}

function getToolingDescriptionRecordPath(definition = {}, record = {}, name = "") {
  const metadataType = definition.metadataType || definition.id || "";
  if (definition.metadataApiType === "CustomObject") {
    return getMetadataXmlSearchPath({ metadataType: "objects" }, name);
  }
  if (definition.metadataApiType === "CustomField") {
    const fullName = record.EntityDefinition?.QualifiedApiName
      && !String(name || "").includes(".")
      ? `${record.EntityDefinition.QualifiedApiName}.${name}`
      : name;
    return getMetadataXmlSearchPath({ metadataType: "customFields" }, fullName);
  }

  const sourceDefinition = SOURCE_FILE_PATH_DEFINITIONS[metadataType];
  if (sourceDefinition && !sourceDefinition.bundleQueryObject) {
    return getSourceFileRecordPath(sourceDefinition, record, {});
  }

  if (metadataType === "lwcBundles") {
    const folderName = toSourceSearchFileName(record.DeveloperName || name, "lwc");
    return `${SOURCE_DEFAULT_PREFIX}lwc/${folderName}/${folderName}.js-meta.xml`;
  }

  if (metadataType === "auraBundles") {
    const folderName = toSourceSearchFileName(record.DeveloperName || name, "aura");
    return `${SOURCE_DEFAULT_PREFIX}aura/${folderName}/${folderName}.cmp-meta.xml`;
  }

  if (definition.metadataApiType) {
    return getMetadataXmlSearchPath({
      metadataType,
      metadataApiType: definition.metadataApiType,
      folder: definition.directoryName,
      extension: definition.suffix ? `${definition.suffix}-meta.xml` : ""
    }, name);
  }

  return "";
}

function createToolingDescriptionMatches(record = {}, normalized = {}, searchText = "", fields = []) {
  const term = String(searchText || "").trim();
  const lowerTerm = term.toLocaleLowerCase();
  if (!lowerTerm) {
    return [];
  }

  const labels = {
    Name: "Name",
    DeveloperName: "Developer Name",
    MasterLabel: "Master Label",
    Label: "Label",
    Description: "Description",
    NamespacePrefix: "Namespace",
    QualifiedApiName: "API Name",
    DataType: "Data Type",
    SobjectType: "Object",
    ValidationName: "Validation Rule",
    "EntityDefinition.DeveloperName": "Object",
    "EntityDefinition.QualifiedApiName": "Object API Name",
    Status: "Status",
    ApiVersion: "API Version"
  };
  const candidates = [
    ...fields
      .filter((field) => !String(field).includes("."))
      .map((field) => [labels[field] || field, record[field]]),
    ["Name", normalized.name],
    ["Label", normalized.label],
    ["Object API Name", normalized.objectApiName],
    ["Type", normalized.typeLabel]
  ];
  const seen = new Set();
  return candidates.flatMap(([label, value]) => {
    const text = String(value || "").trim();
    const key = `${label}:${text}`.toLocaleLowerCase();
    if (!text || seen.has(key) || !text.toLocaleLowerCase().includes(lowerTerm)) {
      return [];
    }
    seen.add(key);
    return [{
      label,
      lineNumber: 0,
      count: countNeedleMatches(text, term),
      snippet: `${label}: ${text}`
    }];
  });
}

function normalizeToolingDescriptionRecord(record = {}, definition = {}, searchText = "", fields = []) {
  const rawName = record[definition.nameField]
    || record.DeveloperName
    || record.Name
    || record.MasterLabel
    || record.Id
    || "";
  const name = getNamespacedSourceName(rawName, record, definition.metadataType);
  const metadataApiType = definition.metadataApiType || definition.metadataObject || definition.queryObject || "";
  const toolingListConfig = TOOLING_METADATA_LIST_DEFINITIONS[metadataApiType];
  const toolingListFullName = toolingListConfig
    ? getToolingMetadataListFullName(record, metadataApiType, toolingListConfig)
    : "";
  const label = record[definition.labelField]
    || record.MasterLabel
    || record.Label
    || record.Description
    || name;
  const recordId = record[definition.idField] || record.Id || record.DurableId || "";
  const fieldObjectName = record.EntityDefinition?.QualifiedApiName
    || (definition.metadataApiType === "CustomField" && String(record.DurableId || "").includes(".")
      ? String(record.DurableId).split(".").slice(0, -1).join(".")
      : "");
  const fullName = definition.metadataApiType === "CustomField" && fieldObjectName
    ? `${fieldObjectName}.${name}`
    : toolingListFullName || name;
  const displayName = definition.metadataApiType === "CustomField" || toolingListFullName ? fullName : name;
  const objectApiName = fieldObjectName || (toolingListConfig ? String(toolingListConfig.getParentName?.(record) || "") : "");
  const normalized = {
    id: recordId,
    type: definition.metadataType || definition.id || definition.queryObject || "metadata",
    typeLabel: definition.itemLabel || definition.label || definition.queryObject || "Metadata",
    metadataType: definition.metadataApiType === "CustomObject"
      ? "objects"
      : definition.metadataApiType === "CustomField"
        ? "customFields"
        : definition.metadataType || definition.id || "",
    metadataObject: metadataApiType || definition.queryObject || "",
    metadataApiType,
    name: displayName,
    apiName: name,
    fullName,
    label,
    objectApiName,
    objectLabel: objectApiName,
    source: "tooling-query",
    path: getToolingDescriptionRecordPath(definition, record, fullName),
    record
  };
  normalized.matches = createToolingDescriptionMatches(record, normalized, searchText, fields);
  return normalized;
}

async function queryToolingMetadataDescriptionDefinition(host, sid, apiVersion, definition = {}, searchText = "", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20) || 20, 200));
  if (definition.useSosl === true) {
    const attempts = [
      getSoslReturningFields(definition, definition.fields),
      getSoslReturningFields(definition, ["Id", definition.nameField, definition.labelField, "DurableId", "QualifiedApiName", "MasterLabel"])
    ].filter((fields, index, source) => (
      fields.length
      && source.findIndex((candidate) => candidate.join(",") === fields.join(",")) === index
    ));
    let lastError = null;
    for (const fields of attempts) {
      try {
        const sosl = createMetadataSosl(definition, searchText, { limit, fields });
        const response = await salesforceRequest(
          host,
          sid,
          createSoslQueryPath(apiVersion, sosl, { tooling: true }),
          {
            timeoutMs: options.timeoutMs,
            signal: options.signal
          }
        );
        const records = Array.isArray(response?.searchRecords) ? response.searchRecords : [];
        return {
          records: records
            .filter((record) => shouldIncludeMetadataRecord(record, options))
            .map((record) => normalizeToolingDescriptionRecord(record, definition, searchText, fields)),
          warning: null
        };
      } catch (error) {
        lastError = error;
      }
    }
    return {
      records: [],
      warning: `${definition.queryObject} Tooling SOSL: ${lastError instanceof Error ? lastError.message : String(lastError || "Search failed.")}`
    };
  }

  const attempts = getToolingDescriptionFieldAttempts(definition);
  let lastError = null;

  for (const fields of attempts) {
    const soqls = createToolingDescriptionSearchSoqls(definition, fields, searchText, limit);
    if (!soqls.length) {
      continue;
    }
    try {
      const records = [];
      for (const soql of soqls) {
        records.push(...await queryAllRecords(host, sid, createToolingQueryPath(apiVersion, soql), {
          timeoutMs: options.timeoutMs,
          signal: options.signal
        }));
      }
      return {
        records: dedupeMetadataSearchRecords(records
          .filter((record) => shouldIncludeMetadataRecord(record, options))
          .map((record) => normalizeToolingDescriptionRecord(record, definition, searchText, fields))),
        warning: null
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    records: [],
    warning: `${definition.queryObject} Tooling query: ${lastError instanceof Error ? lastError.message : String(lastError || "Search failed.")}`
  };
}

export async function searchToolingMetadataDescriptions(host, sid, searchText = "", options = {}) {
  const cleanSearchText = String(searchText || "").trim();
  if (!cleanSearchText) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const limit = Math.max(1, Math.min(Number(options.limit || 80) || 80, 200));
  const selectedTypes = new Set((Array.isArray(options.metadataTypes) ? options.metadataTypes : [])
    .map((metadataType) => String(metadataType || "").trim())
    .filter(Boolean));
  const includeObjectFieldSearch = !selectedTypes.size || selectedTypes.has("objects") || selectedTypes.has("customFields");
  const definitionLimit = Math.max(5, Math.min(Number(options.perTypeLimit || Math.ceil(limit / 2)) || 20, 100));
  const definitions = getToolingMetadataDescriptionDefinitions([...selectedTypes]);
  const [objectFieldResult, definitionResults] = await Promise.all([
    includeObjectFieldSearch
      ? searchToolingCustomObjectsAndFields(host, sid, cleanSearchText, {
        ...options,
        limit
      })
      : Promise.resolve({ records: [], warnings: [] }),
    mapWithConcurrency(
      definitions,
      Math.max(1, Math.min(Number(options.concurrency || METADATA_SEARCH_SOSL_CONCURRENCY) || METADATA_SEARCH_SOSL_CONCURRENCY, METADATA_SEARCH_SOSL_CONCURRENCY)),
      async (definition) => {
        const result = await queryToolingMetadataDescriptionDefinition(host, sid, apiVersion, definition, cleanSearchText, {
          ...options,
          limit: definitionLimit
        });
        emitMetadataSearchProgress(options, {
          source: "tooling-query",
          definition,
          records: result.records || [],
          warnings: result.warning ? [result.warning] : []
        });
        return result;
      }
    )
  ]);

  const records = dedupeMetadataSearchRecords([
    ...(objectFieldResult.records || []),
    ...definitionResults.flatMap((result) => result.records || [])
  ])
    .filter((record) => record.name || record.apiName || record.id)
    .sort(compareMetadataSearchRecords(cleanSearchText))
    .slice(0, limit);

  return {
    records,
    warnings: [
      ...(objectFieldResult.warnings || []),
      ...definitionResults.map((result) => result.warning).filter(Boolean)
    ]
  };
}

const METADATA_CATALOG_EXTRA_SEARCH_DEFINITIONS = [
  {
    id: "reports",
    label: "Reports",
    itemLabel: "Report",
    kind: "metadata",
    metadataApiType: "Report",
    folderMetadataApiType: "ReportFolder",
    directoryName: "reports",
    suffix: "report"
  },
  {
    id: "dashboards",
    label: "Dashboards",
    itemLabel: "Dashboard",
    kind: "metadata",
    metadataApiType: "Dashboard",
    folderMetadataApiType: "DashboardFolder",
    directoryName: "dashboards",
    suffix: "dashboard"
  },
  {
    id: "reportTypes",
    label: "Report Types",
    itemLabel: "Report Type",
    kind: "metadata",
    metadataApiType: "ReportType",
    directoryName: "reportTypes",
    suffix: "reportType"
  }
];

function getMetadataCatalogSearchDefinitions() {
  const definitions = [
    ...schemaMetadataTypeDefinitions
      .filter((definition) => !isExcludedSchemaMetadataType(definition)),
    ...METADATA_CATALOG_EXTRA_SEARCH_DEFINITIONS
  ];
  const seen = new Set();
  return definitions
    .filter((definition) => (
      definition
      && (definition.kind === "metadata" || definition.kind === "objects")
      && (definition.metadataApiType || Array.isArray(definition.metadataApiTypes))
    ))
    .filter((definition) => {
      const key = definition.metadataApiType || (definition.metadataApiTypes || []).join(",");
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function getMetadataCatalogApiName(fullName = "", definition = {}) {
  const text = String(fullName || "").trim();
  if (!text) {
    return "";
  }

  const metadataType = definition.metadataType || definition.id || "";
  const layoutSeparatorIndex = definition.metadataApiType === "Layout" ? text.indexOf("-") : -1;
  if (layoutSeparatorIndex > 0) {
    return text.slice(layoutSeparatorIndex + 1);
  }
  if (String(metadataType || "").includes("Folder")) {
    return text.split("/").pop() || text;
  }
  if (text.includes(".")) {
    return text.split(".").pop() || text;
  }
  if (text.includes("/")) {
    return text.split("/").pop() || text;
  }
  return text;
}

function getMetadataCatalogObjectApiName(fullName = "", definition = {}) {
  const text = String(fullName || "").trim();
  if (!text) {
    return "";
  }
  if (definition.metadataApiType === "Layout" && text.includes("-")) {
    return text.split("-")[0] || "";
  }
  if (text.includes(".")) {
    return text.split(".").slice(0, -1).join(".");
  }
  return "";
}

function getMetadataCatalogLabel(record = {}, apiName = "") {
  return record.Label
    || record.label
    || record.MasterLabel
    || record.displayName
    || record.Name
    || record.DeveloperName
    || record.fullName
    || record.FullName
    || apiName
    || "";
}

function getMetadataCatalogSearchValues(record = {}, normalized = {}) {
  return [
    ["Name", normalized.name],
    ["API Name", normalized.apiName],
    ["Full Name", normalized.fullName],
    ["Label", normalized.label],
    ["Developer Name", record.DeveloperName],
    ["Object API Name", normalized.objectApiName],
    ["File Name", record.fileName]
  ].filter(([, value]) => String(value || "").trim());
}

function metadataCatalogValueMatches(value = "", needles = []) {
  const lowerValue = String(value || "").toLocaleLowerCase();
  const cleanNeedles = (Array.isArray(needles) ? needles : [])
    .map((needle) => String(needle || "").trim())
    .filter(Boolean);
  const phrase = cleanNeedles[0] || "";
  const parts = getToolingLookupTermParts(phrase);
  if (parts.length > 1) {
    const lowerPhrase = phrase.toLocaleLowerCase();
    return lowerValue.includes(lowerPhrase)
      || parts.every((part) => lowerValue.includes(part.toLocaleLowerCase()));
  }
  return cleanNeedles.some((needle) => lowerValue.includes(needle.toLocaleLowerCase()));
}

function createMetadataCatalogMatches(record = {}, normalized = {}, searchText = "") {
  const needles = getToolingLookupNeedles(searchText);
  const seen = new Set();
  return getMetadataCatalogSearchValues(record, normalized)
    .flatMap(([label, value]) => {
      const text = String(value || "").trim();
      const key = `${label}:${text}`.toLocaleLowerCase();
      if (!text || seen.has(key) || !metadataCatalogValueMatches(text, needles)) {
        return [];
      }
      seen.add(key);
      return [{
        label,
        lineNumber: 0,
        count: Math.max(0, ...needles.map((needle) => countNeedleMatches(text, needle))),
        snippet: `${label}: ${text}`
      }];
    });
}

function normalizeMetadataCatalogRecord(record = {}, definition = {}, searchText = "") {
  const fullName = String(record.fullName || record.FullName || record.Name || record.DeveloperName || record.Id || "").trim();
  const apiName = getMetadataCatalogApiName(fullName, definition);
  const label = getMetadataCatalogLabel(record, apiName);
  const metadataApiType = record.metadataApiType || definition.metadataApiType || record.type || "";
  const metadataType = definition.id || metadataApiType || "";
  const normalized = {
    id: record.id || record.Id || fullName,
    type: metadataType || metadataApiType || "metadata",
    typeLabel: definition.itemLabel || definition.label || metadataApiType || "Metadata",
    metadataType,
    metadataObject: metadataApiType,
    metadataApiType,
    name: fullName || apiName,
    apiName,
    fullName,
    label,
    objectApiName: getMetadataCatalogObjectApiName(fullName, definition),
    objectLabel: "",
    source: TOOLING_METADATA_LIST_DEFINITIONS[metadataApiType] ? "tooling-list" : "metadata-api-list",
    path: getMetadataXmlSearchPath({
      metadataType,
      metadataApiType,
      folder: definition.directoryName,
      extension: definition.suffix ? `${definition.suffix}-meta.xml` : ""
    }, fullName || apiName),
    record
  };
  normalized.matches = createMetadataCatalogMatches(record, normalized, searchText);
  return normalized;
}

function metadataCatalogRecordMatches(record = {}, definition = {}, searchText = "") {
  const normalized = normalizeMetadataCatalogRecord(record, definition, searchText);
  return normalized.matches.length ? normalized : null;
}

async function queryMetadataCatalogDefinition(host, sid, apiVersion, definition = {}, searchText = "", options = {}) {
  try {
    const records = Array.isArray(definition.metadataApiTypes)
      ? createSettingsMetadataRecords(definition)
      : await listMetadataRecords(host, sid, definition, apiVersion, options);
    return {
      records: records
        .filter((record) => shouldIncludeMetadataRecord(record, options))
        .map((record) => metadataCatalogRecordMatches(record, definition, searchText))
        .filter(Boolean),
      warning: null
    };
  } catch (error) {
    const metadataName = definition.metadataApiType || definition.id || definition.label || "metadata";
    return {
      records: [],
      warning: `${metadataName} catalog: ${error instanceof Error ? error.message : String(error || "Search failed.")}`
    };
  }
}

async function searchMetadataCatalog(host, sid, searchText = "", options = {}) {
  const cleanSearchText = String(searchText || "").trim();
  if (!cleanSearchText) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const selectedTypes = getMetadataSearchSelectedTypeSet(options);
  const definitions = getMetadataCatalogSearchDefinitions()
    .filter((definition) => metadataSearchDefinitionIsSelected(definition, selectedTypes));
  const concurrency = Math.max(1, Math.min(Number(options.metadataCatalogConcurrency || 3) || 3, 6));
  const results = await mapWithConcurrency(definitions, concurrency, async (definition) => {
    const result = await queryMetadataCatalogDefinition(host, sid, apiVersion, definition, cleanSearchText, options);
    emitMetadataSearchProgress(options, {
      source: "metadata-api-list",
      definition,
      records: result.records || [],
      warnings: result.warning ? [result.warning] : []
    });
    return result;
  });

  return {
    records: results.flatMap((result) => result.records || []),
    warnings: results.map((result) => result.warning).filter(Boolean)
  };
}

function getMetadataDetailTextSearchScanLimit(resultLimit = 80, options = {}) {
  const requestedLimit = Number(options.metadataDetailTextSearchScanLimit || options.metadataDetailSearchScanLimit || 0) || 0;
  const defaultLimit = Math.max(METADATA_DETAIL_TEXT_SEARCH_DEFAULT_SCAN_LIMIT, Math.ceil((Number(resultLimit) || 80) * 4));
  return Math.max(1, Math.min(requestedLimit || defaultLimit, METADATA_DETAIL_TEXT_SEARCH_MAX_SCAN_LIMIT));
}

function getMetadataDetailTextSearchTarget(record = {}) {
  const candidates = [
    record.metadataType,
    record.metadataApiType,
    record.metadataObject,
    record.type
  ].map((value) => String(value || "").trim().toLocaleLowerCase()).filter(Boolean);
  return METADATA_DETAIL_TEXT_SEARCH_TARGETS.find((target) => (
    candidates.includes(target.metadataType.toLocaleLowerCase())
    || candidates.includes(target.metadataApiType.toLocaleLowerCase())
  )) || null;
}

function getMetadataDetailTextRecordIdentifiers(record = {}) {
  return [
    record.id,
    record.Id,
    record.fullName,
    record.FullName,
    record.name,
    record.apiName
  ].map((value) => String(value || "").trim().toLocaleLowerCase()).filter(Boolean);
}

function getMetadataDetailTextExistingIdentifiers(records = [], target = {}) {
  const identifiers = new Set();
  (Array.isArray(records) ? records : [])
    .filter((record) => getMetadataDetailTextSearchTarget(record)?.metadataApiType === target.metadataApiType)
    .forEach((record) => {
      getMetadataDetailTextRecordIdentifiers(record).forEach((identifier) => identifiers.add(identifier));
    });
  return identifiers;
}

function hasMetadataDetailTextExistingIdentifier(record = {}, identifiers = new Set()) {
  return getMetadataDetailTextRecordIdentifiers(record).some((identifier) => identifiers.has(identifier));
}

function getMetadataDetailTextFullName(record = {}, target = {}) {
  const fullName = String(record.fullName || record.FullName || record.name || "").trim();
  if (!fullName || !["CustomField", "ValidationRule"].includes(target.metadataApiType)) {
    return "";
  }
  if (/^[A-Za-z0-9]{15,18}\./.test(fullName)) {
    return "";
  }
  return fullName.includes(".") ? fullName : "";
}

function getMetadataDetailTextCandidateKey(record = {}, target = {}) {
  const fullName = getMetadataDetailTextFullName(record, target);
  if (fullName) {
    return `${target.metadataApiType}:${fullName}`.toLocaleLowerCase();
  }
  const recordId = String(record.id || record.Id || "").trim();
  return recordId ? `${target.metadataApiType}:id:${recordId}`.toLocaleLowerCase() : "";
}

function normalizeMetadataDetailTextCandidate(record = {}, target = {}) {
  const fullName = getMetadataDetailTextFullName(record, target);
  if (!fullName) {
    return null;
  }
  return {
    ...record,
    fullName,
    FullName: fullName,
    metadataApiType: target.metadataApiType,
    type: record.type || target.metadataApiType
  };
}

function getMetadataDetailTextCandidatePriority(record = {}, definition = {}, searchText = "", existingIdentifiers = new Set()) {
  if (hasMetadataDetailTextExistingIdentifier(record, existingIdentifiers)) {
    return 0;
  }
  return metadataCatalogRecordMatches(record, definition, searchText) ? 1 : 2;
}

function addMetadataDetailTextCandidate(candidateMap, record = {}, target = {}) {
  const candidate = normalizeMetadataDetailTextCandidate(record, target);
  if (!candidate) {
    return;
  }
  const key = getMetadataDetailTextCandidateKey(candidate, target);
  if (!key || candidateMap.has(key)) {
    return;
  }
  candidateMap.set(key, candidate);
}

function getMetadataDetailTextValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => getMetadataDetailTextValue(item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${getMetadataDetailTextValue(item)}`)
      .filter((line) => line.trim() !== ":")
      .join("\n");
  }
  return String(value || "").trim();
}

function getMetadataDetailTextFieldValue(metadata = {}, field = {}) {
  for (const key of field.keys || []) {
    if (Object.hasOwn(metadata, key)) {
      const text = getMetadataDetailTextValue(metadata[key]);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function createMetadataDetailTextFieldMatches(label = "", value = "", searchText = "", maxMatches = 2) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const needles = getContentSnippetNeedles(searchText);
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    const line = lines[index];
    if (!lineMatchesContentSearch(line, needles)) {
      continue;
    }
    const needle = getContentSnippetNeedle(line, needles);
    const snippet = createContentSnippetText(line, needle);
    if (!snippet) {
      continue;
    }
    matches.push({
      label,
      lineNumber: index + 1,
      count: Math.max(1, countNeedleMatches(line, needle)),
      snippet: `${label}${lines.length > 1 ? ` L${index + 1}` : ""}: ${snippet}`
    });
  }

  if (!matches.length) {
    const compactText = text.replace(/\s+/g, " ").trim();
    if (lineMatchesContentSearch(compactText, needles)) {
      const needle = getContentSnippetNeedle(compactText, needles);
      matches.push({
        label,
        lineNumber: 0,
        count: Math.max(1, countNeedleMatches(compactText, needle)),
        snippet: `${label}: ${createContentSnippetText(compactText, needle)}`
      });
    }
  }

  return matches;
}

function createMetadataDetailTextMatches(detail = {}, target = {}, searchText = "") {
  const metadata = detail.metadata && typeof detail.metadata === "object" ? detail.metadata : {};
  return dedupeMetadataSearchMatches((target.fields || []).flatMap((field) => (
    createMetadataDetailTextFieldMatches(field.label, getMetadataDetailTextFieldValue(metadata, field), searchText)
  )));
}

function createMetadataDetailTextRecordFields(metadata = {}) {
  return {
    Description: metadata.description || metadata.Description || "",
    InlineHelpText: metadata.inlineHelpText || metadata.InlineHelpText || "",
    Formula: metadata.formula || metadata.calculatedFormula || metadata.Formula || metadata.CalculatedFormula || "",
    DefaultValue: metadata.defaultValue || metadata.DefaultValue || "",
    ErrorConditionFormula: metadata.errorConditionFormula || metadata.ErrorConditionFormula || "",
    ErrorMessage: metadata.errorMessage || metadata.ErrorMessage || ""
  };
}

function createMetadataDetailTextSearchRecord(candidate = {}, detail = {}, definition = {}, target = {}, searchText = "") {
  const fullName = detail.fullName || candidate.fullName || candidate.FullName || "";
  const metadata = detail.metadata && typeof detail.metadata === "object" ? detail.metadata : {};
  const baseRecord = {
    ...candidate,
    fullName,
    FullName: fullName,
    metadataApiType: target.metadataApiType,
    type: target.metadataApiType,
    fileName: candidate.fileName || detail.fileName || ""
  };
  const normalized = normalizeMetadataCatalogRecord(baseRecord, definition, searchText);
  const detailMatches = createMetadataDetailTextMatches(detail, target, searchText);
  return {
    ...normalized,
    id: candidate.id || candidate.Id || normalized.id,
    label: metadata.label || metadata.Label || normalized.label,
    source: "metadata-detail",
    record: {
      ...(normalized.record && typeof normalized.record === "object" ? normalized.record : {}),
      ...createMetadataDetailTextRecordFields(metadata),
      Metadata: metadata
    },
    matches: dedupeMetadataSearchMatches([
      ...(normalized.matches || []),
      ...detailMatches
    ])
  };
}

function chunkMetadataDetailTextCandidates(candidates = []) {
  const chunks = [];
  for (let index = 0; index < candidates.length; index += METADATA_DETAIL_TEXT_SEARCH_BATCH_SIZE) {
    chunks.push(candidates.slice(index, index + METADATA_DETAIL_TEXT_SEARCH_BATCH_SIZE));
  }
  return chunks;
}

async function readMetadataDetailTextCandidates(host, sid, definition = {}, candidates = [], apiVersion, options = {}) {
  const chunks = chunkMetadataDetailTextCandidates(candidates);
  const results = await mapWithConcurrency(chunks, METADATA_DETAIL_TEXT_SEARCH_CONCURRENCY, async (chunk) => {
    try {
      return {
        records: await readMetadataRecords(host, sid, definition, chunk, apiVersion, {
          timeoutMs: options.metadataDetailSearchTimeoutMs || options.timeoutMs,
          signal: options.signal
        }),
        warnings: []
      };
    } catch (error) {
      if (chunk.length > 1) {
        const singleResults = await mapWithConcurrency(chunk, 1, async (candidate) => {
          try {
            return {
              records: await readMetadataRecords(host, sid, definition, [candidate], apiVersion, {
                timeoutMs: options.metadataDetailSearchTimeoutMs || options.timeoutMs,
                signal: options.signal
              }),
              warnings: []
            };
          } catch (singleError) {
            return {
              records: [],
              warnings: [`${definition.metadataApiType || definition.id} detail read ${candidate.fullName || candidate.FullName || candidate.id || ""}: ${singleError instanceof Error ? singleError.message : String(singleError || "Search failed.")}`]
            };
          }
        });
        return {
          records: singleResults.flatMap((result) => result.records || []),
          warnings: singleResults.flatMap((result) => result.warnings || [])
        };
      }
      return {
        records: [],
        warnings: [`${definition.metadataApiType || definition.id} detail read: ${error instanceof Error ? error.message : String(error || "Search failed.")}`]
      };
    }
  });
  return {
    records: results.flatMap((result) => result.records || []),
    warnings: results.flatMap((result) => result.warnings || [])
  };
}

async function searchMetadataDetailTextDefinition(host, sid, apiVersion, target = {}, baseRecords = [], searchText = "", options = {}) {
  const definition = getMetadataTypeDefinition(target.metadataType);
  if (!definition) {
    return {
      records: [],
      warnings: []
    };
  }

  const scanLimit = getMetadataDetailTextSearchScanLimit(options.limit, options);
  const existingIdentifiers = getMetadataDetailTextExistingIdentifiers(baseRecords, target);
  let listedRecords = [];
  const warnings = [];
  try {
    listedRecords = (await listMetadataRecords(host, sid, definition, apiVersion, options))
      .filter((record) => shouldIncludeMetadataRecord(record, options));
  } catch (error) {
    warnings.push(`${target.label} detail search catalog: ${error instanceof Error ? error.message : String(error || "Search failed.")}`);
  }

  const candidateMap = new Map();
  (Array.isArray(baseRecords) ? baseRecords : [])
    .filter((record) => getMetadataDetailTextSearchTarget(record)?.metadataApiType === target.metadataApiType)
    .forEach((record) => addMetadataDetailTextCandidate(candidateMap, record, target));
  listedRecords
    .sort((left, right) => (
      getMetadataDetailTextCandidatePriority(left, definition, searchText, existingIdentifiers)
      - getMetadataDetailTextCandidatePriority(right, definition, searchText, existingIdentifiers)
      || String(left.fullName || left.FullName || "").localeCompare(String(right.fullName || right.FullName || ""))
    ))
    .forEach((record) => addMetadataDetailTextCandidate(candidateMap, record, target));

  const candidates = [...candidateMap.values()].slice(0, scanLimit);
  if (!candidates.length) {
    return {
      records: [],
      warnings
    };
  }
  if (candidateMap.size > candidates.length) {
    warnings.push(`${target.label} detail search scanned ${candidates.length} of ${candidateMap.size} records. Results may be incomplete; use Show more or a more specific name/object term for a deeper scan.`);
  }

  const detailResult = await readMetadataDetailTextCandidates(host, sid, definition, candidates, apiVersion, options);
  const candidateByFullName = new Map(candidates.map((candidate) => [String(candidate.fullName || candidate.FullName || ""), candidate]));
  const records = detailResult.records
    .map((detail) => {
      const candidate = candidateByFullName.get(String(detail.fullName || "")) || detail.record || {};
      const matches = createMetadataDetailTextMatches(detail, target, searchText);
      return matches.length
        ? createMetadataDetailTextSearchRecord(candidate, detail, definition, target, searchText)
        : null;
    })
    .filter(Boolean);

  emitMetadataSearchProgress(options, {
    source: "metadata-detail",
    metadataType: target.metadataType,
    metadataObject: target.metadataApiType,
    typeLabel: target.label,
    records,
    warnings: [...warnings, ...detailResult.warnings]
  });

  return {
    records,
    warnings: [...warnings, ...detailResult.warnings]
  };
}

async function searchMetadataDetailText(host, sid, searchText = "", baseRecords = [], options = {}) {
  if (options.includeMetadataDetailTextSearch === false || options.includeMetadataDetailSearch === false) {
    return {
      records: [],
      warnings: []
    };
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const selectedTypes = getMetadataSearchSelectedTypeSet(options);
  const targets = METADATA_DETAIL_TEXT_SEARCH_TARGETS
    .filter((target) => metadataSearchDefinitionIsSelected(target, selectedTypes));
  const results = await mapWithConcurrency(targets, 1, (target) => (
    searchMetadataDetailTextDefinition(host, sid, apiVersion, target, baseRecords, searchText, options)
  ));
  return {
    records: results.flatMap((result) => result.records || []),
    warnings: results.flatMap((result) => result.warnings || [])
  };
}

export async function searchMetadataByText(host, sid, searchText = "", options = {}) {
  const cleanSearchText = String(searchText || "").trim();
  if (!cleanSearchText) {
    return {
      records: [],
      warnings: []
    };
  }

  const limit = Math.max(1, Math.min(Number(options.limit || 80) || 80, 200));
  const soslLimit = Math.max(1, Math.min(Number(options.soslLimit || Math.ceil(limit / 3)) || 30, 100));
  const commonSoslLimit = Math.max(soslLimit, Math.ceil(limit / 2));
  const selectedTypes = getMetadataSearchSelectedTypeSet(options);
  const toolingSoslDefinitions = getToolingSoslMetadataSearchDefinitions()
    .filter((definition) => metadataSearchDefinitionIsSelected(definition, selectedTypes));
  const commonToolingSoslDefinitions = COMMON_TOOLING_SOSL_METADATA_SEARCH_DEFINITIONS
    .filter((definition) => metadataSearchDefinitionIsSelected(definition, selectedTypes));
  const standardSoslDefinitions = options.includeStandardSosl === false
    ? []
    : STANDARD_SOSL_METADATA_SEARCH_DEFINITIONS
      .filter((definition) => metadataSearchDefinitionIsSelected(definition, selectedTypes));
  const includeMetadataCatalog = options.includeMetadataCatalog !== false;
  const includeObjectFieldSearch = !selectedTypes.size
    || ["objects", "customobject", "entitydefinition", "customfields", "customfield", "fielddefinition"]
      .some((metadataType) => selectedTypes.has(metadataType));

  const [objectFieldResult, commonToolingSoslResult] = await Promise.all([
    includeObjectFieldSearch
      ? searchToolingCustomObjectsAndFields(host, sid, cleanSearchText, {
        ...options,
        limit
      })
      : Promise.resolve({ records: [], warnings: [] }),
    searchSoslMetadataDefinitions(host, sid, cleanSearchText, commonToolingSoslDefinitions, {
      ...options,
      limit: commonSoslLimit
    })
  ]);

  // Objects/fields already get substring name matching from
  // searchToolingCustomObjectsAndFields; FieldDefinition also cannot be queried
  // by name alone. Everything else only had SOSL, which misses substring and
  // just-created records, so back it with a Tooling SOQL LIKE name search.
  const toolingLikeDefinitions = toolingSoslDefinitions.filter(
    (definition) => !["EntityDefinition", "FieldDefinition"].includes(definition.queryObject)
  );

  const [toolingSoslResult, toolingLikeResult, standardSoslResult, metadataCatalogResult] = await Promise.all([
    searchSoslMetadataDefinitions(host, sid, cleanSearchText, toolingSoslDefinitions, {
      ...options,
      limit: soslLimit
    }),
    searchLikeMetadataDefinitions(host, sid, cleanSearchText, toolingLikeDefinitions, {
      ...options,
      limit: soslLimit
    }),
    searchSoslMetadataDefinitions(host, sid, cleanSearchText, standardSoslDefinitions, {
      ...options,
      limit: soslLimit
    }),
    includeMetadataCatalog
      ? searchMetadataCatalog(host, sid, cleanSearchText, {
        ...options,
        timeoutMs: options.metadataCatalogTimeoutMs || options.timeoutMs || 45000
      })
      : Promise.resolve({ records: [], warnings: [] })
  ]);

  const baseRecords = dedupeMetadataSearchRecords([
    ...(objectFieldResult.records || []),
    ...(commonToolingSoslResult.records || []),
    ...(toolingSoslResult.records || []),
    ...(toolingLikeResult.records || []),
    ...(standardSoslResult.records || []),
    ...(metadataCatalogResult.records || [])
  ])
    .filter((record) => record.name || record.apiName || record.id);
  const detailTextResult = await searchMetadataDetailText(host, sid, cleanSearchText, baseRecords, {
    ...options,
    limit
  });
  const records = mergeMetadataSearchRecords([
    ...baseRecords,
    ...(detailTextResult.records || [])
  ])
    .filter((record) => metadataSearchRecordIsSelected(record, selectedTypes))
    .filter((record) => record.name || record.apiName || record.id)
    .sort(compareMetadataSearchRecords(cleanSearchText))
    .slice(0, limit);

  return {
    records,
    warnings: [
      ...(objectFieldResult.warnings || []),
      ...(commonToolingSoslResult.warnings || []),
      ...(toolingSoslResult.warnings || []),
      ...(toolingLikeResult.warnings || []),
      ...(standardSoslResult.warnings || []),
      ...(metadataCatalogResult.warnings || []),
      ...(detailTextResult.warnings || [])
    ]
  };
}

function toSourceSearchFileName(value = "", fallback = "metadata") {
  const text = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[.]+|[.]+$/g, "");
  return text || fallback;
}

function getAuraSourceDefinitionSuffix(defType = "") {
  const type = String(defType || "").toUpperCase();
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

function getSourceFileRecordPath(definition, record = {}, context = {}) {
  if (definition.metadataType === "lwcBundles") {
    const filePath = String(record.FilePath || "").replace(/^[/]+/, "");
    if (filePath) {
      return toDefaultSourcePath(filePath);
    }

    const folderName = toSourceSearchFileName(record.LightningComponentBundleId || record.Id, "lwc");
    const extension = String(record.Format || "js").toLowerCase();
    return `${SOURCE_DEFAULT_PREFIX}lwc/${folderName}/${folderName}.${extension}`;
  }

  if (definition.metadataType === "auraBundles") {
    const rawBundleName = context.auraBundleNames?.get(record.AuraDefinitionBundleId) || record.AuraDefinitionBundleId || record.Id;
    const bundleName = toSourceSearchFileName(rawBundleName, "aura");
    return `${SOURCE_DEFAULT_PREFIX}aura/${bundleName}/${bundleName}${getAuraSourceDefinitionSuffix(record.DefType)}`;
  }

  const name = getNamespacedSourceName(record[definition.nameField] || record.Name || record.Id, {
    ...record,
    NamespacePrefix: getSourceFileRecordNamespace(definition, record, context)
  }, definition.metadataType);
  const fileName = toSourceSearchFileName(name, record.Id);
  return `${SOURCE_DEFAULT_PREFIX}${definition.folder}/${fileName}.${definition.extension}`;
}

function getSourceFileRecordNamespace(definition = {}, record = {}, context = {}) {
  if (definition.metadataType === "lwcBundles") {
    return context.lwcBundleInfo?.get(record.LightningComponentBundleId)?.namespacePrefix
      || getInstalledPackageComponentNamespace(record);
  }

  if (definition.metadataType === "auraBundles") {
    return context.auraBundleInfo?.get(record.AuraDefinitionBundleId)?.namespacePrefix
      || getInstalledPackageComponentNamespace(record);
  }

  return getInstalledPackageComponentNamespace(record);
}

function getObjectChildMetadataPath(definition, fullName = "") {
  const splitIndex = String(fullName || "").lastIndexOf(".");
  const objectName = splitIndex > 0 ? fullName.slice(0, splitIndex) : "";
  const childName = splitIndex > 0 ? fullName.slice(splitIndex + 1) : fullName;
  const childPathConfig = {
    customFields: ["fields", "field-meta.xml"],
    validationRules: ["validationRules", "validationRule-meta.xml"],
    recordTypes: ["recordTypes", "recordType-meta.xml"],
    fieldSets: ["fieldSets", "fieldSet-meta.xml"],
    listViews: ["listViews", "listView-meta.xml"],
    compactLayouts: ["compactLayouts", "compactLayout-meta.xml"],
    businessProcesses: ["businessProcesses", "businessProcess-meta.xml"],
    webLinks: ["webLinks", "webLink-meta.xml"]
  }[definition.metadataType];

  if (!objectName || !childPathConfig) {
    return "";
  }

  const [folder, extension] = childPathConfig;
  return [
    `${SOURCE_DEFAULT_PREFIX}objects`,
    toSourceSearchFileName(objectName, "Object"),
    folder,
    `${toSourceSearchFileName(childName, definition.metadataType)}.${extension}`
  ].join("/");
}

function getMetadataXmlSearchPath(definition = {}, fullName = "") {
  if (definition.metadataType === "objects") {
    const objectName = toSourceSearchFileName(fullName, "Object");
    return `${SOURCE_DEFAULT_PREFIX}objects/${objectName}/${objectName}.object-meta.xml`;
  }

  const objectChildPath = getObjectChildMetadataPath(definition, fullName);
  if (objectChildPath) {
    return objectChildPath;
  }

  const folder = definition.folder || definition.metadataType || "metadata";
  const extension = definition.extension || `${definition.metadataApiType || "metadata"}.xml`;
  const fileName = String(fullName || "metadata")
    .split("/")
    .map((segment) => toSourceSearchFileName(segment, "metadata"))
    .join("/");
  return `${SOURCE_DEFAULT_PREFIX}${folder}/${fileName}.${extension}`;
}

function countNeedleMatches(value = "", needle = "") {
  if (!needle) {
    return 0;
  }

  const text = String(value || "").toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  let count = 0;
  let index = text.indexOf(lowerNeedle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(lowerNeedle, index + lowerNeedle.length);
  }
  return count;
}

async function buildQueryMetadataGroup(host, sid, definition, apiVersion, options = {}) {
  const includeInstalledPackages = shouldIncludeInstalledPackages(options);
  const records = await queryAllRecords(host, sid, createSoqlQueryPath(definition, apiVersion, options), {
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });
  const filteredRecords = filterMetadataRecords(records, definition)
    .filter((record) => includeInstalledPackages || !isInstalledPackageComponent(record))
    .filter((record) => shouldIncludeMetadataRecord(record, options));
  const items = filteredRecords.map((record) => createMetadataItem(record, definition, options));
  return {
    id: definition.id,
    label: definition.label,
    itemLabel: definition.itemLabel,
    kind: definition.kind,
    metadataObject: definition.queryObject,
    count: items.length,
    items
  };
}

async function buildMetadataApiGroup(host, sid, definition, apiVersion, options = {}) {
  const includeInstalledPackages = shouldIncludeInstalledPackages(options);
  const records = definition.metadataApiTypes
    ? createSettingsMetadataRecords(definition)
    : await listMetadataRecords(host, sid, definition, apiVersion, options);
  const filteredRecords = records
    .filter((record) => record.fullName)
    .filter((record) => includeInstalledPackages || !isInstalledPackageComponent(record))
    .filter((record) => shouldIncludeMetadataRecord(record, options))
    .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
  const items = filteredRecords.map((record) => createMetadataItem(record, definition, options));

  return {
    id: definition.id,
    label: definition.label,
    itemLabel: definition.itemLabel,
    kind: definition.kind,
    metadataObject: definition.metadataApiType || definition.metadataApiTypes?.join(",") || "",
    directoryName: definition.directoryName || "",
    suffix: definition.suffix || "",
    count: items.length,
    items
  };
}

async function buildObjectMetadataGroup(host, sid, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const concurrency = options.concurrency || SCHEMA_DESCRIBE_CONCURRENCY;
  const includeDeprecatedAndHidden = options.includeDeprecatedAndHidden === true;
  const includeInstalledPackages = shouldIncludeInstalledPackages(options);
  const describes = options.includeObjectDescribeCache === true ? {} : null;
  const errors = [];
  const customFieldObjectNames = new Set();
  const hasReliableCustomFieldMap = false;

  if (options.objectNamesOnly === true) {
    const describableObjects = (await loadObjectInfosForMetadataGroup(host, sid, apiVersion, options))
      .filter((objectInfo) => objectInfo.name)
      .filter((objectInfo) => includeDeprecatedAndHidden || !objectInfo.deprecatedAndHidden)
      .filter((objectInfo) => includeInstalledPackages || !isInstalledPackageComponent(objectInfo))
      .filter((objectInfo) => shouldIncludeMetadataRecord(objectInfo, options))
      .filter((objectInfo) => shouldIncludeObjectFolder(objectInfo, customFieldObjectNames, hasReliableCustomFieldMap, false))
      .sort((left, right) => left.name.localeCompare(right.name));
    const map = {};
    describableObjects.forEach((objectInfo) => {
      map[createObjectSchemaKey(objectInfo)] = [];
    });
    reportSchemaProgress(options, {
      percent: Number.isFinite(options.progressBase) && Number.isFinite(options.progressWeight)
        ? options.progressBase + options.progressWeight
        : 100,
      label: "objects",
      detail: `${describableObjects.length} objects`
    });
    return {
      group: {
        id: "objects",
        label: "Objects",
        itemLabel: "Object",
        kind: "objects",
        count: Object.keys(map).length,
        childCount: 0,
        items: map
      },
      map,
      objectCount: Object.keys(map).length,
      fieldCount: 0,
      errors,
      describes: {}
    };
  }

  const describableObjects = (await loadObjectInfosForMetadataGroup(host, sid, apiVersion, options))
    .filter((objectInfo) => objectInfo?.name)
    .filter((objectInfo) => includeDeprecatedAndHidden || !objectInfo.deprecatedAndHidden)
    .filter((objectInfo) => includeInstalledPackages || !isInstalledPackageComponent(objectInfo))
    .filter((objectInfo) => shouldIncludeMetadataRecord(objectInfo, options))
    .filter((objectInfo) => shouldIncludeObjectFolder(objectInfo, customFieldObjectNames, hasReliableCustomFieldMap))
    .sort((left, right) => left.name.localeCompare(right.name));

  let completedObjects = 0;
  const totalObjects = Math.max(describableObjects.length, 1);
  const progressBase = Number.isFinite(options.progressBase) ? options.progressBase : 0;
  const progressWeight = Number.isFinite(options.progressWeight) ? options.progressWeight : 100;

  const entries = await mapWithConcurrency(describableObjects, concurrency, async (objectInfo) => {
    try {
      const describe = await salesforceRequest(
        host,
        sid,
        `/services/data/${apiVersion}/sobjects/${encodeURIComponent(objectInfo.name)}/describe`
      );
      const fields = Array.isArray(describe?.fields) ? describe.fields : [];
      const normalizedObjectInfo = {
        ...objectInfo,
        name: describe?.name || objectInfo.name,
        label: describe?.label || objectInfo.label,
        custom: describe?.custom ?? objectInfo.custom
      };
      const includedFields = fields
        .filter((field) => field?.name)
        .filter((field) => includeInstalledPackages || !isInstalledPackageComponent(field))
        .filter((field) => shouldIncludeMetadataRecord(field, options));
      if (!shouldIncludeObjectFolder(normalizedObjectInfo, customFieldObjectNames, hasReliableCustomFieldMap)
        || (!isCustomObjectFolder(normalizedObjectInfo) && !includedFields.some((field) => isCustomObjectField(field)))) {
        return null;
      }

      const fieldKeys = [];

      includedFields
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((field) => {
          const fieldKey = createFieldSchemaKey(field);
          fieldKeys.push(fieldKey);
        });

      const objectKey = createObjectSchemaKey({
        name: describe?.name || objectInfo.name,
        label: describe?.label || objectInfo.label
      });
      if (describes && (describe?.name || objectInfo.name)) {
        describes[describe?.name || objectInfo.name] = describe;
      }

      return [objectKey, fieldKeys];
    } catch (error) {
      errors.push({
        objectApiName: objectInfo.name,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    } finally {
      completedObjects += 1;
      reportSchemaProgress(options, {
        percent: progressBase + (progressWeight * completedObjects / totalObjects),
        label: "objects",
        detail: `${completedObjects} of ${describableObjects.length} objects`
      });
    }
  });

  const map = {};
  let fieldCount = 0;

  entries
    .filter(Boolean)
    .forEach(([objectKey, fieldKeys]) => {
      map[objectKey] = fieldKeys;
      fieldCount += fieldKeys.length;
    });

  return {
    group: {
      id: "objects",
      label: "Objects",
      itemLabel: "Object",
      kind: "objects",
      count: Object.keys(map).length,
      childCount: fieldCount,
      items: map
    },
    map,
    objectCount: Object.keys(map).length,
    fieldCount,
    errors,
    describes: describes || {}
  };
}

export async function buildSchemaObjectStore(host, sid, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const selectedMetadataTypes = getSelectedMetadataTypes(options);
  const totalMetadataTypes = Math.max(selectedMetadataTypes.length, 1);
  const metadata = {};
  const errors = [];
  let map = {};
  let objectCount = 0;
  let fieldCount = 0;
  let objectDescribes = {};

  reportSchemaProgress(options, {
    percent: 0,
    label: "Starting metadata retrieve"
  });

  for (const [metadataIndex, metadataType] of selectedMetadataTypes.entries()) {
    const definition = getMetadataTypeDefinition(metadataType);
    if (!definition) {
      continue;
    }

    const progressBase = metadataIndex / totalMetadataTypes * 100;
    const progressWeight = 100 / totalMetadataTypes;
    reportSchemaProgress(options, {
      percent: progressBase,
      label: definition.label,
      detail: `Retrieving ${definition.label}`
    });

    try {
      if (definition.kind === "objects") {
        const objectResult = await buildObjectMetadataGroup(host, sid, {
          ...options,
          progressBase,
          progressWeight
        });
        metadata.objects = objectResult.group;
        map = objectResult.map;
        objectCount = objectResult.objectCount;
        fieldCount = objectResult.fieldCount;
        objectDescribes = objectResult.describes || {};
        errors.push(...objectResult.errors);
      } else if (definition.kind === "metadata") {
        metadata[definition.id] = await buildMetadataApiGroup(host, sid, definition, apiVersion, options);
      } else {
        metadata[definition.id] = await buildQueryMetadataGroup(host, sid, definition, apiVersion, options);
      }
    } catch (error) {
      errors.push({
        metadataType: definition.id,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      reportSchemaProgress(options, {
        percent: (metadataIndex + 1) / totalMetadataTypes * 100,
        label: definition.label,
        detail: `Finished ${definition.label}`
      });
    }
  }

  const metadataItemCount = Object.values(metadata).reduce((total, group) => {
    if (group?.kind === "objects") {
      return total + (group.count || 0) + (group.childCount || 0);
    }

    return total + (group?.count || 0);
  }, 0);

  const nextStore = normalizeSchemaObjectStore({
    host,
    apiVersion,
    generatedAt: new Date().toISOString(),
    objectCount,
    fieldCount,
    metadataTypes: selectedMetadataTypes,
    includeInstalledPackages: shouldIncludeInstalledPackages(options),
    installedPackageNamespaces: [...getInstalledPackageNamespaceSet(options)],
    metadataItemCount,
    errors,
    map,
    metadata
  }, host);
  if (options.includeObjectDescribeCache === true && Object.keys(objectDescribes).length) {
    Object.defineProperty(nextStore, "objectDescribes", {
      value: objectDescribes,
      enumerable: false,
      configurable: true
    });
  }

  if (options.persist === false) {
    return nextStore;
  }

  return saveSchemaObjectStore(host, nextStore);
}

export async function getSObjectDescribe(host, sid, objectApiName, options = {}) {
  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  return salesforceRequest(
    host,
    sid,
    `/services/data/${apiVersion}/sobjects/${encodeURIComponent(objectApiName)}/describe`
  );
}

export async function getMetadataItemDetail(host, sid, metadataType, itemId, options = {}) {
  const definition = getMetadataTypeDefinition(metadataType);
  if (!definition) {
    throw new Error(`Unsupported metadata type: ${metadataType}`);
  }

  const apiVersion = options.apiVersion || SALESFORCE_API_VERSION;
  const record = options.record && typeof options.record === "object"
    ? options.record
    : {};
  const itemName = record[definition.nameField]
    || record.Name
    || record.DeveloperName
    || record.MasterLabel
    || record.fullName
    || record.FullName
    || itemId
    || "";
  const canQueryToolingByName = definition.kind === "tooling"
    && Array.isArray(definition.detailFields)
    && definition.detailFields.length
    && itemName;

  if (!itemId && !canQueryToolingByName) {
    throw new Error("Missing metadata item id.");
  }

  if (definition.kind === "objects") {
    return readMetadataRecord(host, sid, definition, {
      ...record,
      fullName: record.fullName || record.FullName || itemId,
      metadataApiType: record.metadataApiType || record.type || definition.metadataApiType
    }, apiVersion);
  }

  if (definition.kind === "metadata") {
    const metadataRecord = Object.keys(record).length
      ? record
      : {
        fullName: itemId,
        metadataApiType: definition.metadataApiType || definition.metadataApiTypes?.find((metadataApiType) => (
          getSettingsFullName(metadataApiType) === itemId
        ))
      };
    return readMetadataRecord(host, sid, definition, metadataRecord, apiVersion);
  }

  const detail = definition.kind === "tooling" && Array.isArray(definition.detailFields) && definition.detailFields.length
    ? itemId
      ? await queryMetadataRecordDetail(host, sid, definition, apiVersion, itemId, options)
        .catch((error) => {
          if (!canQueryToolingByName || isAbortOrTimeoutError(error)) {
            return Promise.reject(error);
          }
          return queryMetadataRecordDetailByName(host, sid, definition, apiVersion, itemName, options);
        })
      : await queryMetadataRecordDetailByName(host, sid, definition, apiVersion, itemName, options)
    : await salesforceRequest(
      host,
      sid,
      `/services/data/${apiVersion}/${definition.kind === "tooling" ? "tooling/sobjects" : "sobjects"}/${definition.queryObject}/${encodeURIComponent(itemId)}`,
      {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }
    );

  if (metadataType === "lwcBundles") {
    const records = await queryAllRecords(
      host,
      sid,
      `/services/data/${apiVersion}/tooling/query?q=${encodeURIComponent(
        `SELECT Id, FilePath, Format, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '${escapeSoqlString(itemId)}' ORDER BY FilePath`
      )}`,
      {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }
    );
    return {
      ...detail,
      resources: records
    };
  }

  if (metadataType === "auraBundles") {
    const records = await queryAllRecords(
      host,
      sid,
      `/services/data/${apiVersion}/tooling/query?q=${encodeURIComponent(
        `SELECT Id, DefType, Format, Source FROM AuraDefinition WHERE AuraDefinitionBundleId = '${escapeSoqlString(itemId)}' ORDER BY DefType`
      )}`,
      {
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }
    );
    return {
      ...detail,
      definitions: records
    };
  }

  return detail;
}

export async function openExtensionPage(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await sendRuntimeMessage({
    type: "open-extension-page",
    path,
    query
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Unable to open ${path}.`);
  }
}

export async function salesforceRequest(host, sid, path, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0) || 0);
  const controller = !options.signal && timeoutMs > 0 ? new AbortController() : null;
  let didTimeout = false;
  const timeoutId = controller
    ? globalThis.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs)
    : null;

  headers.set("Authorization", `Bearer ${sid}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(`https://${host}${path}`, {
      method,
      headers,
      body: options.body,
      signal: options.signal || controller?.signal
    });

    const text = await response.text();
    let data = text;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_error) {
      data = text;
    }

    if (!response.ok) {
      const message =
        typeof data === "string"
          ? data
          : data?.[0]?.message || data?.message || `HTTP ${response.status}`;
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.responseData = data;
      requestError.retryAt = response.headers.get("Retry-After") || response.headers.get("X-RateLimit-Reset") || "";
      throw requestError;
    }

    return data;
  } catch (error) {
    if (didTimeout || (controller && error?.name === "AbortError")) {
      throw new Error(`Salesforce request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function getCompactElementText(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

export function parseOutboundChangeSetsHtml(html = "") {
  if (typeof DOMParser !== "function") {
    throw new Error("Outbound change set discovery is not supported in this browser.");
  }
  const document = new DOMParser().parseFromString(String(html || ""), "text/html");
  const errorTitle = getCompactElementText(document.getElementById("errorTitle"));
  const errorDescription = getCompactElementText(document.getElementById("errorDesc"));
  if (errorTitle || errorDescription) {
    throw new Error([errorTitle, errorDescription].filter(Boolean).join(": "));
  }

  // A Setup page requested without a session the UI accepts comes back as the
  // login or identity-verification form rather than an error page. That still
  // parses as HTML and yields zero rows, which would otherwise be reported as
  // "this org has no outbound change sets".
  const looksLikeLoginPage = Boolean(
    document.querySelector('input[type="password"]')
    || document.getElementById("login")
    || document.querySelector('form[action*="login.salesforce.com"]')
  );

  const results = [];
  const seenIds = new Set();
  document.querySelectorAll('a[href*="outboundChangeSetDetailPage.apexp"]').forEach((link) => {
    const href = link.getAttribute("href") || "";
    const id = href.match(/[?&]id=([A-Za-z0-9]+)/)?.[1] || "";
    const name = getCompactElementText(link);
    if (!id || !name || seenIds.has(id)) {
      return;
    }
    const cells = [...(link.closest("tr")?.querySelectorAll("td") || [])];
    const nameCellIndex = cells.findIndex((cell) => cell === link.closest("td"));
    results.push({
      id,
      name,
      description: getCompactElementText(cells[nameCellIndex + 1]),
      status: getCompactElementText(cells[nameCellIndex + 2]),
      modifiedBy: getCompactElementText(cells[nameCellIndex + 3]),
      modifiedDate: getCompactElementText(cells[nameCellIndex + 4])
    });
    seenIds.add(id);
  });
  if (!results.length && looksLikeLoginPage) {
    throw new Error("Salesforce returned a sign-in page instead of the outbound change set list. Open the org in a tab to refresh the session, then try again.");
  }
  return results;
}

export async function listOutboundChangeSets(host, sid, options = {}) {
  const html = await salesforceRequest(host, sid, "/changemgmt/listOutboundChangeSet.apexp", {
    ...options,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      ...(options.headers || {})
    }
  });
  if (typeof html !== "string") {
    throw new Error("Salesforce did not return the outbound change set list page.");
  }
  return parseOutboundChangeSetsHtml(html);
}

export async function runSoql(host, sid, soql, options = {}) {
  const encoded = encodeURIComponent(soql);
  return salesforceRequest(host, sid, `/services/data/${SALESFORCE_API_VERSION}/query?q=${encoded}`, options);
}

export async function runSoqlAll(host, sid, soql, options = {}) {
  const encoded = encodeURIComponent(soql);
  return queryAllRecords(host, sid, `/services/data/${SALESFORCE_API_VERSION}/query?q=${encoded}`, options);
}

export async function runToolingSoqlAll(host, sid, soql, options = {}) {
  const encoded = encodeURIComponent(soql);
  return queryAllRecords(host, sid, `/services/data/${SALESFORCE_API_VERSION}/tooling/query?q=${encoded}`, options);
}

// ── DML write-back (composite/sobjects) ──────────────────────────────────────
// Update records in chunks of 200 (the composite collections limit) and
// return the flat per-record result array ([{ id, success, errors }, …]) in
// input order so callers can map each result back to its source row.
function chunk200(items) {
  const groups = [];
  for (let i = 0; i < items.length; i += 200) groups.push(items.slice(i, i + 200));
  return groups;
}

export async function updateRecords(host, sid, objectName, records, allOrNone = false) {
  const results = [];
  for (const group of chunk200(records)) {
    const res = await salesforceRequest(host, sid,
      `/services/data/${SALESFORCE_API_VERSION}/composite/sobjects`,
      { method: "PATCH", body: JSON.stringify({
        allOrNone,
        records: group.map(rec => ({ attributes: { type: objectName }, ...rec })),
      }) });
    if (Array.isArray(res)) results.push(...res);
  }
  return results;
}

async function runOptionalSoql(host, sid, soql) {
  try {
    return await runSoql(host, sid, soql);
  } catch (error) {
    return {
      records: [],
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getOrgSummary(host, sid, options = {}) {
  const org = await runSoql(
    host,
    sid,
    "SELECT Id, Name, InstanceName, OrganizationType, IsSandbox FROM Organization LIMIT 1",
    options
  );

  return org.records?.[0] || null;
}

export async function getUserSummary(host, sid, options = {}) {
  return salesforceRequest(host, sid, "/services/oauth2/userinfo", options);
}

export async function getApiLimitUsage(host, sid) {
  const [
    company,
    licenses,
    permissionSetLicenses,
    limits,
    userInfo,
    profiles,
    permissionSets,
    eventLogs,
    loginHistory,
    audit
  ] = await Promise.all([
    runSoql(
      host,
      sid,
      "SELECT Id, Name, InstanceName, OrganizationType, IsSandbox, CreatedDate, FiscalYearStartMonth FROM Organization LIMIT 1"
    ),
    runSoql(
      host,
      sid,
      "SELECT Id, Name, LicenseDefinitionKey, TotalLicenses, UsedLicenses FROM UserLicense ORDER BY Name"
    ),
    runSoql(
      host,
      sid,
      "SELECT Id, MasterLabel, DeveloperName, TotalLicenses, UsedLicenses FROM PermissionSetLicense ORDER BY MasterLabel"
    ),
    salesforceRequest(host, sid, `/services/data/${SALESFORCE_API_VERSION}/limits`),
    getUserSummary(host, sid),
    runOptionalSoql(
      host,
      sid,
      "SELECT Id, Name, UserType, CreatedDate, LastModifiedDate FROM Profile ORDER BY Name LIMIT 500"
    ),
    runOptionalSoql(
      host,
      sid,
      "SELECT Id, Name, Label, Type, ProfileId, IsOwnedByProfile, CreatedDate, LastModifiedDate FROM PermissionSet ORDER BY Label LIMIT 500"
    ),
    runOptionalSoql(
      host,
      sid,
      "SELECT Id, EventType, LogDate, LogFileLength, CreatedDate FROM EventLogFile ORDER BY LogDate DESC LIMIT 200"
    ),
    runOptionalSoql(
      host,
      sid,
      "SELECT Id, UserId, LoginTime, SourceIp, Status, Application, Browser, Platform FROM LoginHistory ORDER BY LoginTime DESC LIMIT 200"
    ),
    runOptionalSoql(
      host,
      sid,
      "SELECT Id, Action, Section, CreatedDate, CreatedBy.Name, Display, DelegateUser, ResponsibleNamespacePrefix FROM SetupAuditTrail ORDER BY CreatedDate DESC LIMIT 200"
    )
  ]);

  return {
    companyInformation: company.records?.[0] || null,
    userSession: userInfo || null,
    licenseSession: {
      userLicenses: licenses.records || [],
      permissionSetLicenses: permissionSetLicenses.records || []
    },
    latestApiUsageInformation: limits || {},
    orgListLimits: limits || {},
    setting: {
      profiles: profiles.records || [],
      profilesError: profiles.errorMessage || "",
      permissionSets: permissionSets.records || [],
      permissionSetsError: permissionSets.errorMessage || ""
    },
    apiUsage: {
      eventLogs: eventLogs.records || [],
      eventLogsError: eventLogs.errorMessage || ""
    },
    history: {
      loginHistory: loginHistory.records || [],
      loginHistoryError: loginHistory.errorMessage || ""
    },
    auditFile: {
      records: audit.records || [],
      errorMessage: audit.errorMessage || ""
    }
  };
}

export async function executeAnonymousApex(host, sid, apexCode) {
  return salesforceRequest(
    host,
    sid,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(apexCode)}`
  );
}

export async function createSObjectRecord(host, sid, sobjectApiName, fields = {}) {
  return salesforceRequest(host, sid, `/services/data/${SALESFORCE_API_VERSION}/sobjects/${encodeURIComponent(sobjectApiName)}`, {
    method: "POST",
    body: JSON.stringify(fields)
  });
}

// --- Permission & Access Explorer -------------------------------------------
// Every query below is scoped by the selected user's assigned permission set
// IDs. Unscoped permission queries return rows the user has nothing to do with
// (ObjectPermissions.ParentId also yields PermissionSetLicense and UserLicense
// records) and are an order of magnitude larger, so scoping is a correctness
// requirement, not an optimisation.

const USER_ACCESS_SEARCH_LIMIT = 25;

export async function searchAccessUsers(host, sid, searchText = "") {
  const term = escapeSoqlLiteral(String(searchText).trim());
  const where = term ? `AND (Name LIKE '%${term}%' OR Username LIKE '%${term}%')` : "";
  const result = await runSoql(
    host,
    sid,
    `SELECT Id, Name, Username, IsActive, UserType, ProfileId, Profile.Name FROM User ` +
      `WHERE IsActive = true ${where} ORDER BY Name LIMIT ${USER_ACCESS_SEARCH_LIMIT}`
  );
  return result?.records || [];
}

// runSoqlAll resolves to a flat array of records, not a query envelope.
export async function loadAssignedPermissionParents(host, sid, userId) {
  if (!isSalesforceId(userId)) throw new Error("Select a user before resolving permissions.");
  return runSoqlAll(
    host,
    sid,
    `SELECT PermissionSetId, PermissionSetGroupId, PermissionSet.Label, PermissionSet.Name, ` +
      `PermissionSet.Type, PermissionSet.IsOwnedByProfile, PermissionSet.PermissionSetGroupId, ` +
      `PermissionSet.PermissionSetGroup.Status, Assignee.Profile.Name ` +
      `FROM PermissionSetAssignment WHERE AssigneeId = '${escapeSoqlLiteral(userId)}'`
  );
}

export async function loadObjectAccessRows(host, sid, parentIds = [], objectApiName = "") {
  const idList = buildIdListLiteral(parentIds);
  if (!idList) return [];
  if (!isSafeSalesforceName(objectApiName)) throw new Error(`Unsupported object name: ${objectApiName}`);
  return runSoqlAll(
    host,
    sid,
    `SELECT ParentId, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, ` +
      `PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords ` +
      `FROM ObjectPermissions WHERE SobjectType = '${escapeSoqlLiteral(objectApiName)}' AND ParentId IN (${idList})`
  );
}

export async function loadAllObjectAccessRows(host, sid, parentIds = []) {
  const idList = buildIdListLiteral(parentIds);
  if (!idList) return [];
  return runSoqlAll(
    host,
    sid,
    `SELECT ParentId, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, ` +
      `PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords ` +
      `FROM ObjectPermissions WHERE ParentId IN (${idList})`
  );
}

// Every field of one object, scoped to one user's assigned records. The fan-out
// this must never become is all fields of *all* objects, which needs a describe
// per object; one object costs one describe.
export async function loadObjectFieldAccessRows(host, sid, parentIds = [], objectApiName = "") {
  const idList = buildIdListLiteral(parentIds);
  if (!idList) return [];
  if (!isSafeSalesforceName(objectApiName)) throw new Error(`Unsupported object name: ${objectApiName}`);
  return runSoqlAll(
    host,
    sid,
    `SELECT ParentId, SobjectType, Field, PermissionsRead, PermissionsEdit ` +
      `FROM FieldPermissions WHERE SobjectType = '${escapeSoqlLiteral(objectApiName)}' AND ParentId IN (${idList})`
  );
}

export async function loadFieldAccessRows(host, sid, parentIds = [], objectApiName = "", fieldApiName = "") {
  const idList = buildIdListLiteral(parentIds);
  if (!idList) return [];
  if (!isSafeSalesforceName(objectApiName)) throw new Error(`Unsupported object name: ${objectApiName}`);
  if (!isSafeSalesforceName(fieldApiName)) throw new Error(`Unsupported field name: ${fieldApiName}`);
  const target = `${escapeSoqlLiteral(objectApiName)}.${escapeSoqlLiteral(fieldApiName)}`;
  return runSoqlAll(
    host,
    sid,
    `SELECT ParentId, SobjectType, Field, PermissionsRead, PermissionsEdit ` +
      `FROM FieldPermissions WHERE Field = '${target}' AND ParentId IN (${idList})`
  );
}

export async function loadPermissionSetGroupComponents(host, sid, groupId = "") {
  if (!isSalesforceId(groupId)) return [];
  return runSoqlAll(
    host,
    sid,
    `SELECT PermissionSetId, PermissionSet.Label, PermissionSet.Name, PermissionSet.Type ` +
      `FROM PermissionSetGroupComponent WHERE PermissionSetGroupId = '${escapeSoqlLiteral(groupId)}'`
  );
}
