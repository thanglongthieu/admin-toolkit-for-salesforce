import { SALESFORCE_API_VERSION, getActiveSession, getSessionForHost, salesforceRequest } from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";
import { confirmOrgMutation, ORG_RISK } from "./org-safety.js";
import { recordOperation } from "./operation-history.js";

const params = new URLSearchParams(window.location.search);
const methodInput = document.getElementById("method");
const pathInput = document.getElementById("path");
const pathBaseInput = document.getElementById("path-base");
const apiVersionInput = document.getElementById("api-version");
const pathTemplateInput = document.getElementById("path-template");
const builderInput1 = document.getElementById("builder-input1");
const builderInput2 = document.getElementById("builder-input2");
const builderInput3 = document.getElementById("builder-input3");
const builderInput1Field = document.getElementById("builder-input1-field");
const builderInput2Field = document.getElementById("builder-input2-field");
const builderInput3Field = document.getElementById("builder-input3-field");
const sobjectOptionsEl = document.getElementById("builder-sobject-options");
const toolingOptionsEl = document.getElementById("builder-tooling-options");
const sampleBodyButton = document.getElementById("sample-body");
const bodyInput = document.getElementById("body");
const statusEl = document.getElementById("status");
const responseEl = document.getElementById("response");
const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";

const REST_PATH_TEMPLATES = [
  {
    id: "resources",
    label: "Version Resources",
    labelKey: "rest.template.resources",
    method: "GET",
    inputs: [],
    build: ({ root }) => root
  },
  {
    id: "limits",
    label: "Limits",
    labelKey: "rest.template.limits",
    method: "GET",
    inputs: [],
    build: ({ root }) => `${root}/limits`
  },
  {
    id: "sobjects",
    label: "sObject List",
    labelKey: "rest.template.sobjects",
    method: "GET",
    inputs: [],
    build: ({ root }) => `${root}/sobjects`
  },
  {
    id: "sobject-resource",
    label: "sObject Resource",
    labelKey: "rest.template.sobjectResource",
    method: "GET",
    inputs: [{ label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" }],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}`
  },
  {
    id: "sobject-describe",
    label: "sObject Describe",
    labelKey: "rest.template.sobjectDescribe",
    method: "GET",
    inputs: [{ label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" }],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}/describe`
  },
  {
    id: "sobject-record",
    label: "sObject Record by ID",
    labelKey: "rest.template.sobjectRecord",
    method: "GET",
    inputs: [
      { label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" },
      { label: "Record ID", labelKey: "rest.recordId", defaultValue: "001000000000000AAA" }
    ],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}/${encodePathSegment(values[1] || "")}`
  },
  {
    id: "sobject-create",
    label: "Create sObject Record",
    labelKey: "rest.template.sobjectCreate",
    method: "POST",
    inputs: [{ label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" }],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}`,
    sampleBody: ({ values }) => createSObjectSampleBody(values[0] || "Account")
  },
  {
    id: "sobject-update",
    label: "Update sObject Record",
    labelKey: "rest.template.sobjectUpdate",
    method: "PATCH",
    inputs: [
      { label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" },
      { label: "Record ID", labelKey: "rest.recordId", defaultValue: "001000000000000AAA" }
    ],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}/${encodePathSegment(values[1] || "")}`,
    sampleBody: ({ values }) => createSObjectSampleBody(values[0] || "Account")
  },
  {
    id: "sobject-upsert",
    label: "Upsert by External ID",
    labelKey: "rest.template.sobjectUpsert",
    method: "PATCH",
    inputs: [
      { label: "sObject", labelKey: "rest.sobject", list: "sobject", defaultValue: "Account" },
      { label: "External ID Field", labelKey: "rest.externalIdField", defaultValue: "External_Id__c" },
      { label: "External ID Value", labelKey: "rest.externalIdValue", defaultValue: "EXT-001" }
    ],
    build: ({ root, values }) => `${root}/sobjects/${encodePathSegment(values[0] || "Account")}/${encodePathSegment(values[1] || "External_Id__c")}/${encodePathSegment(values[2] || "")}`,
    sampleBody: ({ values }) => createSObjectSampleBody(values[0] || "Account")
  },
  {
    id: "query",
    label: "SOQL Query",
    labelKey: "rest.template.query",
    method: "GET",
    inputs: [{ label: "SOQL", labelKey: "rest.soql", defaultValue: "SELECT Id, Name FROM Account LIMIT 10" }],
    build: ({ root, values }) => createQueryPath(`${root}/query`, values[0] || "SELECT Id, Name FROM Account LIMIT 10")
  },
  {
    id: "query-all",
    label: "SOQL Query All",
    labelKey: "rest.template.queryAll",
    method: "GET",
    inputs: [{ label: "SOQL", labelKey: "rest.soql", defaultValue: "SELECT Id, Name FROM Account LIMIT 10" }],
    build: ({ root, values }) => createQueryPath(`${root}/queryAll`, values[0] || "SELECT Id, Name FROM Account LIMIT 10")
  },
  {
    id: "search",
    label: "SOSL Search",
    labelKey: "rest.template.search",
    method: "GET",
    inputs: [{ label: "SOSL", labelKey: "rest.sosl", defaultValue: "FIND {Acme}" }],
    build: ({ root, values }) => createQueryPath(`${root}/search/`, values[0] || "FIND {Acme}")
  },
  {
    id: "tooling-sobjects",
    label: "Tooling sObject List",
    labelKey: "rest.template.toolingSobjects",
    method: "GET",
    inputs: [],
    build: ({ root }) => `${root}/tooling/sobjects`
  },
  {
    id: "tooling-describe",
    label: "Tooling Describe",
    labelKey: "rest.template.toolingDescribe",
    method: "GET",
    inputs: [{ label: "Tooling Object", labelKey: "rest.toolingObject", list: "tooling", defaultValue: "ApexClass" }],
    build: ({ root, values }) => `${root}/tooling/sobjects/${encodePathSegment(values[0] || "ApexClass")}/describe`
  },
  {
    id: "tooling-record",
    label: "Tooling Record by ID",
    labelKey: "rest.template.toolingRecord",
    method: "GET",
    inputs: [
      { label: "Tooling Object", labelKey: "rest.toolingObject", list: "tooling", defaultValue: "ApexClass" },
      { label: "Record ID", labelKey: "rest.recordId", defaultValue: "01p000000000000AAA" }
    ],
    build: ({ root, values }) => `${root}/tooling/sobjects/${encodePathSegment(values[0] || "ApexClass")}/${encodePathSegment(values[1] || "")}`
  },
  {
    id: "tooling-query",
    label: "Tooling Query",
    labelKey: "rest.template.toolingQuery",
    method: "GET",
    inputs: [{ label: "SOQL", labelKey: "rest.soql", defaultValue: "SELECT Id, Name FROM ApexClass LIMIT 10" }],
    build: ({ root, values }) => createQueryPath(`${root}/tooling/query`, values[0] || "SELECT Id, Name FROM ApexClass LIMIT 10")
  },
  {
    id: "execute-anonymous",
    label: "Execute Anonymous Apex",
    labelKey: "rest.template.executeAnonymous",
    method: "GET",
    inputs: [{ label: "Apex Code", labelKey: "rest.apexCode", defaultValue: "System.debug('Hello from REST API');" }],
    build: ({ root, values }) => `${root}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(values[0] || "")}`
  },
  {
    id: "composite",
    label: "Composite Request",
    labelKey: "rest.template.composite",
    method: "POST",
    inputs: [],
    build: ({ root }) => `${root}/composite`,
    sampleBody: ({ version }) => ({
      allOrNone: false,
      compositeRequest: [
        {
          method: "GET",
          url: `/services/data/${version}/limits`,
          referenceId: "limits"
        }
      ]
    })
  },
  {
    id: "composite-batch",
    label: "Composite Batch",
    labelKey: "rest.template.compositeBatch",
    method: "POST",
    inputs: [],
    build: ({ root }) => `${root}/composite/batch`,
    sampleBody: ({ version }) => ({
      haltOnError: false,
      batchRequests: [
        {
          method: "GET",
          url: `/services/data/${version}/limits`
        }
      ]
    })
  }
];

let session = null;
let sobjectInfos = [];
let toolingObjectInfos = [];
let isSyncingPath = false;

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

async function loadSession() {
  const host = params.get("host") || window.localStorage.getItem(LAST_HOST_STORAGE_KEY) || "";
  setStatus(host ? `Connecting to ${host}...` : "Finding active Salesforce session...");
  session = host ? await getSessionForHost(host) : await getActiveSession();
  window.localStorage.setItem(LAST_HOST_STORAGE_KEY, session.host);
  setStatus(t("rest.status.connected", { host: session.host }));
}

function withPathSync(callback) {
  isSyncingPath = true;
  try {
    callback();
  } finally {
    isSyncingPath = false;
  }
}

function normalizePath(value = "") {
  const path = String(value || "").trim();
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeBasePath(value = "") {
  return `${normalizePath(value || "/services/data/").replace(/\/+$/g, "")}/`;
}

function normalizeApiVersion(value = "") {
  const version = String(value || SALESFORCE_API_VERSION).trim().replace(/^\/+|\/+$/g, "");
  if (!version) {
    return SALESFORCE_API_VERSION;
  }
  return /^\d/.test(version) ? `v${version}` : version;
}

function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "));
  } catch {
    return String(value || "");
  }
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function getApiRoot() {
  return `${normalizeBasePath(pathBaseInput.value).replace(/\/+$/g, "")}/${normalizeApiVersion(apiVersionInput.value)}`;
}

function createQueryPath(basePath, query) {
  return `${basePath}?q=${encodeURIComponent(query)}`;
}

function getSelectedPathTemplate() {
  return REST_PATH_TEMPLATES.find((template) => template.id === pathTemplateInput.value) || REST_PATH_TEMPLATES[0];
}

function getTemplateById(templateId = "") {
  return REST_PATH_TEMPLATES.find((template) => template.id === templateId) || null;
}

function getTemplateLabel(template = {}) {
  return template.labelKey ? t(template.labelKey) : template.label || "";
}

function getBuilderInputValues() {
  return [builderInput1, builderInput2, builderInput3].map((input) => input.value.trim());
}

function createBuilderContext(template = getSelectedPathTemplate(), values = getBuilderInputValues()) {
  return {
    root: getApiRoot(),
    template,
    values,
    version: normalizeApiVersion(apiVersionInput.value)
  };
}

function createSObjectSampleBody(sobjectName = "Account") {
  const normalizedName = String(sobjectName || "").toLowerCase();
  if (normalizedName === "contact") {
    return { LastName: "Sample Contact" };
  }
  if (normalizedName === "case") {
    return {
      Subject: "Sample Case",
      Status: "New",
      Origin: "Web"
    };
  }
  if (normalizedName === "lead") {
    return {
      LastName: "Sample Lead",
      Company: "Sample Company"
    };
  }
  return { Name: `Sample ${sobjectName || "Record"}` };
}

function populatePathTemplates() {
  const selectedValue = pathTemplateInput.value || "sobject-describe";
  pathTemplateInput.innerHTML = "";
  REST_PATH_TEMPLATES.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = getTemplateLabel(template);
    pathTemplateInput.appendChild(option);
  });
  pathTemplateInput.value = getTemplateById(selectedValue) ? selectedValue : "sobject-describe";
}

function populateDatalist(datalistEl, objectInfos, fallbackNames = []) {
  datalistEl.innerHTML = "";
  const names = [...objectInfos]
    .map((objectInfo) => objectInfo.name || objectInfo.label || "")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  [...new Set([...fallbackNames, ...names])].forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    datalistEl.appendChild(option);
  });
}

function populateBuilderDatalists() {
  populateDatalist(sobjectOptionsEl, sobjectInfos, ["Account", "Contact", "Lead", "Opportunity", "Case"]);
  populateDatalist(toolingOptionsEl, toolingObjectInfos, ["ApexClass", "ApexTrigger", "Flow", "CustomField", "CustomObject"]);
}

function setBuilderInput(field, input, config, index, values = null) {
  field.hidden = !config;
  if (!config) {
    input.removeAttribute("list");
    input.value = "";
    return;
  }

  const label = field.querySelector("label");
  label.textContent = config.labelKey ? t(config.labelKey) : config.label || t(`rest.input${index + 1}`);
  input.placeholder = config.defaultValue || config.label || "";
  if (Array.isArray(values)) {
    input.value = values[index] || "";
  } else if (input.dataset.templateId !== pathTemplateInput.value) {
    input.value = config.defaultValue || "";
  }
  input.dataset.templateId = pathTemplateInput.value;

  if (config.list === "sobject") {
    input.setAttribute("list", "builder-sobject-options");
  } else if (config.list === "tooling") {
    input.setAttribute("list", "builder-tooling-options");
  } else {
    input.removeAttribute("list");
  }
}

function syncBuilderInputs(values = null) {
  const template = getSelectedPathTemplate();
  const inputs = template.inputs || [];
  setBuilderInput(builderInput1Field, builderInput1, inputs[0], 0, values);
  setBuilderInput(builderInput2Field, builderInput2, inputs[1], 1, values);
  setBuilderInput(builderInput3Field, builderInput3, inputs[2], 2, values);
}

function buildPathFromBuilder() {
  const template = getSelectedPathTemplate();
  return normalizePath(template.build(createBuilderContext(template)));
}

function syncApiPathFromBuilder({ updateMethod = true } = {}) {
  if (isSyncingPath) {
    return;
  }
  const template = getSelectedPathTemplate();
  withPathSync(() => {
    if (updateMethod) {
      methodInput.value = template.method || "GET";
    }
    pathInput.value = buildPathFromBuilder();
  });
}

function parseApiPath(rawPath = pathInput.value, method = methodInput.value) {
  let url;
  try {
    url = new URL(normalizePath(rawPath), "https://example.invalid");
  } catch {
    return null;
  }

  const pathMatch = url.pathname.match(/^(.*\/services\/data\/)(v[\d.]+)(\/.*)?$/i);
  if (!pathMatch) {
    return null;
  }

  const basePath = pathMatch[1];
  const version = pathMatch[2];
  const restPath = (pathMatch[3] || "").replace(/\/+$/g, "");
  const segments = restPath.replace(/^\/+/g, "").split("/").filter(Boolean).map(safeDecode);
  const queryValue = url.searchParams.get("q") || "";
  const normalizedMethod = String(method || "GET").toUpperCase();

  if (!segments.length) {
    return { basePath, version, templateId: "resources", values: [] };
  }
  if (segments[0] === "limits") {
    return { basePath, version, templateId: "limits", values: [] };
  }
  if (segments[0] === "sobjects") {
    if (segments.length === 1) {
      return { basePath, version, templateId: "sobjects", values: [] };
    }
    if (segments.length === 2) {
      return {
        basePath,
        version,
        templateId: normalizedMethod === "POST" ? "sobject-create" : "sobject-resource",
        values: [segments[1]]
      };
    }
    if (segments.length === 3 && segments[2] === "describe") {
      return { basePath, version, templateId: "sobject-describe", values: [segments[1]] };
    }
    if (segments.length === 3) {
      return {
        basePath,
        version,
        templateId: normalizedMethod === "PATCH" ? "sobject-update" : "sobject-record",
        values: [segments[1], segments[2]]
      };
    }
    if (segments.length >= 4) {
      return { basePath, version, templateId: "sobject-upsert", values: [segments[1], segments[2], segments[3]] };
    }
  }
  if (segments[0] === "query") {
    return { basePath, version, templateId: "query", values: [queryValue] };
  }
  if (segments[0] === "queryAll") {
    return { basePath, version, templateId: "query-all", values: [queryValue] };
  }
  if (segments[0] === "search") {
    return { basePath, version, templateId: "search", values: [queryValue] };
  }
  if (segments[0] === "tooling") {
    if (segments[1] === "sobjects" && segments.length === 2) {
      return { basePath, version, templateId: "tooling-sobjects", values: [] };
    }
    if (segments[1] === "sobjects" && segments.length === 4 && segments[3] === "describe") {
      return { basePath, version, templateId: "tooling-describe", values: [segments[2]] };
    }
    if (segments[1] === "sobjects" && segments.length >= 4) {
      return { basePath, version, templateId: "tooling-record", values: [segments[2], segments[3]] };
    }
    if (segments[1] === "query") {
      return { basePath, version, templateId: "tooling-query", values: [queryValue] };
    }
    if (segments[1] === "executeAnonymous") {
      return {
        basePath,
        version,
        templateId: "execute-anonymous",
        values: [url.searchParams.get("anonymousBody") || ""]
      };
    }
  }
  if (segments[0] === "composite" && segments.length === 1) {
    return { basePath, version, templateId: "composite", values: [] };
  }
  if (segments[0] === "composite" && segments[1] === "batch") {
    return { basePath, version, templateId: "composite-batch", values: [] };
  }

  return { basePath, version, templateId: "", values: [] };
}

function syncBuilderFromApiPath() {
  if (isSyncingPath) {
    return;
  }

  const parsed = parseApiPath();
  if (!parsed) {
    return;
  }

  withPathSync(() => {
    pathBaseInput.value = parsed.basePath;
    apiVersionInput.value = parsed.version;
    if (getTemplateById(parsed.templateId)) {
      pathTemplateInput.value = parsed.templateId;
      syncBuilderInputs(parsed.values);
    }
  });
}

function getQueryParamsSample(rawPath = pathInput.value) {
  let url;
  try {
    url = new URL(normalizePath(rawPath), "https://example.invalid");
  } catch {
    return {};
  }

  const paramsObject = {};
  url.searchParams.forEach((value, key) => {
    if (Object.hasOwn(paramsObject, key)) {
      paramsObject[key] = Array.isArray(paramsObject[key])
        ? [...paramsObject[key], value]
        : [paramsObject[key], value];
      return;
    }
    paramsObject[key] = value;
  });
  return paramsObject;
}

function applySampleBody() {
  const parsed = parseApiPath();
  const template = getTemplateById(parsed?.templateId) || getSelectedPathTemplate();
  const values = parsed?.values?.length ? parsed.values : getBuilderInputValues();
  const version = parsed?.version || normalizeApiVersion(apiVersionInput.value);
  const context = {
    root: getApiRoot(),
    template,
    values,
    version
  };

  if (typeof template.sampleBody === "function") {
    bodyInput.value = JSON.stringify(template.sampleBody(context), null, 2);
    setStatus(t("rest.status.sampleBodyLoaded", { template: getTemplateLabel(template) }));
    return;
  }

  const queryParams = getQueryParamsSample();
  if (Object.keys(queryParams).length) {
    bodyInput.value = JSON.stringify({ queryParams }, null, 2);
    setStatus(t("rest.status.sampleParamsLoaded", { template: getTemplateLabel(template) }));
    return;
  }

  bodyInput.value = "{}";
  setStatus(t("rest.status.noBodyNeeded", { template: getTemplateLabel(template) }));
}

function initializePathBuilder() {
  apiVersionInput.value = SALESFORCE_API_VERSION;
  populatePathTemplates();
  populateBuilderDatalists();
  syncBuilderInputs();
  syncBuilderFromApiPath();
}

async function loadRestBuilderSuggestions() {
  if (!session?.host || !session?.sid) {
    return;
  }

  setStatus(t("rest.status.loadingSuggestions", { host: session.host }));
  const [sobjectsResult, toolingResult] = await Promise.allSettled([
    salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/sobjects`),
    salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects`)
  ]);
  sobjectInfos = sobjectsResult.status === "fulfilled" && Array.isArray(sobjectsResult.value?.sobjects)
    ? sobjectsResult.value.sobjects
    : [];
  toolingObjectInfos = toolingResult.status === "fulfilled" && Array.isArray(toolingResult.value?.sobjects)
    ? toolingResult.value.sobjects
    : [];

  populateBuilderDatalists();
  setStatus(t("rest.status.loadedSuggestions", { host: session.host }));
}

async function sendRequest() {
  try {
    setStatus(t("rest.status.sending"));
    const method = methodInput.value;
    const options = { method };

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await confirmOrgMutation({
        host: session.host,
        operation: `Send ${method} REST request`,
        target: pathInput.value,
        risk: ORG_RISK.DATA_MUTATION
      });
    }

    if (method !== "GET" && method !== "DELETE") {
      options.body = bodyInput.value.trim() ? bodyInput.value : "{}";
    }

    const result = await salesforceRequest(session.host, session.sid, pathInput.value, options);
    responseEl.textContent = JSON.stringify(result, null, 2);
    setStatus(t("rest.status.completedWith", { method }));
    await recordOperation({ kind: "rest-request", status: "success", host: session.host, method, path: pathInput.value });
  } catch (error) {
    const message = formatUserFacingMessage(error instanceof Error ? error.message : String(error));
    responseEl.textContent = message;
    setStatus(message, true);
    if (session?.host) await recordOperation({ kind: "rest-request", status: "failed", host: session.host, method: methodInput.value, path: pathInput.value, message });
  }
}

document.getElementById("send-request").addEventListener("click", sendRequest);
sampleBodyButton.addEventListener("click", applySampleBody);
methodInput.addEventListener("change", () => {
  syncBuilderFromApiPath();
});
pathInput.addEventListener("input", syncBuilderFromApiPath);
pathBaseInput.addEventListener("input", () => syncApiPathFromBuilder({ updateMethod: false }));
apiVersionInput.addEventListener("input", () => syncApiPathFromBuilder({ updateMethod: false }));
pathTemplateInput.addEventListener("change", () => {
  syncBuilderInputs();
  syncApiPathFromBuilder();
});
[builderInput1, builderInput2, builderInput3].forEach((input) => {
  input.addEventListener("input", () => syncApiPathFromBuilder({ updateMethod: false }));
});

initializePathBuilder();

window.addEventListener("app-language-change", () => {
  populatePathTemplates();
  syncBuilderInputs(getBuilderInputValues());
});

loadSession().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
}).then(() => loadRestBuilderSuggestions()).catch((error) => {
  setStatus(t("rest.status.suggestionsUnavailable", { message: error instanceof Error ? error.message : String(error) }), true);
});
