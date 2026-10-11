import { getSObjectDescribe, getSessionForHost, loadInstalledPackageNamespaces, SALESFORCE_API_VERSION, salesforceRequest } from "./api.js";
import { mountAppLauncher } from "./app-launcher.js";
import { buildSchemaGraph, filterSchemaGraph, findSchemaPath, isSchemaObjectPickable, limitSchemaGraph, renderSchemaMapSvg } from "./schema-map.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

mountAppLauncher({ translate: t });

const params = new URLSearchParams(location.search);
const sessionStatus = document.getElementById("object-schema-session-status");
const objectInput = document.getElementById("schema-map-object");
const objectSuggestions = document.getElementById("schema-map-object-suggestions");
const parentInput = document.getElementById("schema-map-parent-levels");
const childInput = document.getElementById("schema-map-child-levels");
const namespaceFilter = document.getElementById("schema-map-namespaces");
const namespaceFilterMenu = namespaceFilter.querySelector(".schema-map-namespace-filter-menu");
const showAllStandardInput = document.getElementById("schema-map-show-all-standard");
const buildButton = document.getElementById("schema-map-build");
const resetButton = document.getElementById("schema-map-reset");
const status = document.querySelector(".schema-map-status");
const summaryRow = document.querySelector(".schema-map-summary-row");
const viewControls = document.querySelector(".schema-map-view-controls");
const searchInput = document.getElementById("schema-map-search");
const objectFilter = document.getElementById("schema-map-object-filter");
const objectFilterMenu = objectFilter.querySelector(".schema-map-object-filter-menu");
const fitButton = document.getElementById("schema-map-fit");
const zoomOutButton = document.getElementById("schema-map-zoom-out");
const zoomInButton = document.getElementById("schema-map-zoom-in");
const zoomLevelOutput = document.getElementById("schema-map-zoom-level");
const layoutInput = document.getElementById("schema-map-layout");
const expandButton = document.getElementById("schema-map-expand");
const resetViewButton = document.getElementById("schema-map-reset-view");
const viewport = document.querySelector(".schema-map-viewport");
const mobileTree = document.querySelector(".schema-map-mobile-tree");
const detail = document.querySelector(".schema-map-detail");
const alternativeBody = document.querySelector(".schema-map-alternative-body");
const alternative = document.querySelector(".schema-map-alternative");
const fieldsSection = document.getElementById("schema-map-fields");
const fieldsTitle = document.getElementById("schema-map-fields-title");
const fieldsMeta = document.getElementById("schema-map-fields-meta");
const fieldsSearch = document.getElementById("schema-map-fields-search");
const fieldsSearchButton = document.getElementById("schema-map-fields-search-button");
const fieldsSearchClear = document.getElementById("schema-map-fields-search-clear");
const fieldsObjectFilter = document.getElementById("schema-map-fields-object-filter");
const fieldsDownload = document.getElementById("schema-map-fields-download");
const fieldsFullscreen = document.getElementById("schema-map-fields-fullscreen");
const fieldsSheetFrame = document.getElementById("schema-map-fields-sheet");
const fieldsEmpty = document.getElementById("schema-map-fields-empty");
const NAMESPACE_SELECTION_STORAGE_KEY = "objectSchema.packagedObjectsByHost.v1";

let session = null;
let fullGraph = null;
let visibleLevels = 2;
let fitView = true;
let zoomLevel = 1;
let layoutMode = "horizontal";
let excludedObjectNames = new Set();
let searchMatchName = "";
let selectedMapObjectName = "";
let objectChoices = [];
let namespaceCandidates = [];
let includeAllNamespaces = false;
let selectedNamespaces = new Set();
let namespaceFilterText = "";
let visibleObjectFilterText = "";
let objectSuggestionItems = [];
let objectSuggestionIndex = 0;
let objectSuggestionTimer = 0;
let selectedFieldsObjectName = "";
let schemaFieldRows = [];
let schemaFieldObjectCount = 0;
let fieldsRenderToken = 0;
let fieldsSheetReady = false;
let fieldsSheetPromise = null;
let fieldsSheetResolve = null;
let fieldsSheetReject = null;
let renderedFieldsMatrix = [];
let fieldsSearchQuery = "";
const describeCache = new Map();

function mountObjectSchemaHeader() {
  const row = document.querySelector(".object-schema-shell .hero-eyebrow-row");
  if (!row || sessionStatus.parentElement === row) return;
  row.insertBefore(sessionStatus, row.querySelector(".app-language-picker"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountObjectSchemaHeader, { once: true });
} else {
  mountObjectSchemaHeader();
}

function setStatus(element, message, error = false) {
  element.textContent = formatUserFacingMessage(message);
  element.classList.toggle("error", error);
}

async function restoreNamespaceSelection() {
  try {
    const stored = await chrome.storage.local.get(NAMESPACE_SELECTION_STORAGE_KEY);
    const preference = stored?.[NAMESPACE_SELECTION_STORAGE_KEY]?.[session.host];
    includeAllNamespaces = preference?.includeAll === true;
    selectedNamespaces = new Set(Array.isArray(preference?.namespaces) ? preference.namespaces : []);
  } catch (_error) {
    includeAllNamespaces = false;
    selectedNamespaces.clear();
  }
}

async function persistNamespaceSelection() {
  if (!session?.host) return;
  try {
    const stored = await chrome.storage.local.get(NAMESPACE_SELECTION_STORAGE_KEY);
    const preferences = stored?.[NAMESPACE_SELECTION_STORAGE_KEY] && typeof stored[NAMESPACE_SELECTION_STORAGE_KEY] === "object"
      ? stored[NAMESPACE_SELECTION_STORAGE_KEY]
      : {};
    await chrome.storage.local.set({
      [NAMESPACE_SELECTION_STORAGE_KEY]: {
        ...preferences,
        [session.host]: {
          includeAll: includeAllNamespaces,
          namespaces: [...selectedNamespaces].sort()
        }
      }
    });
  } catch (_error) {
    // The selection still applies for this page when extension storage is unavailable.
  }
}

function relationshipKindLabel(kind) {
  return t(kind === "Master-Detail" ? "objectSchema.kind.masterDetail" : "objectSchema.kind.lookup");
}

function getObjectNamespace(apiName = "") {
  const name = String(apiName || "");
  return namespaceCandidates
    .map((item) => item.namespacePrefix)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((namespacePrefix) => name.startsWith(`${namespacePrefix}__`)) || "";
}

function isObjectNamespaceIncluded(apiName = "") {
  const namespacePrefix = getObjectNamespace(apiName);
  return !namespacePrefix || includeAllNamespaces || selectedNamespaces.has(namespacePrefix);
}

function getPickableObjectChoices() {
  return objectChoices.filter((objectInfo) => isSchemaObjectPickable(
    objectInfo.name,
    showAllStandardInput.checked,
    isObjectNamespaceIncluded
  ));
}

function ensurePickableObjectValue(choices = getPickableObjectChoices()) {
  if (choices.some((choice) => choice.name === objectInput.value.trim())) return;
  objectInput.value = choices.find((choice) => choice.name === "Contact")?.name
    || choices.find((choice) => choice.name === "Account")?.name
    || choices[0]?.name
    || "";
}

function refreshPickableObjectCatalog({ rebuildGraph = true } = {}) {
  const choices = getPickableObjectChoices();
  ensurePickableObjectValue(choices);
  hideObjectSuggestions();
  void renderSelectableObjectFields(choices);
  if (rebuildGraph && fullGraph && objectInput.value) void execute();
}

async function getDescribe(objectName) {
  if (!describeCache.has(objectName)) {
    describeCache.set(objectName, Promise.resolve(getSObjectDescribe(session.host, session.sid, objectName)));
  }
  return describeCache.get(objectName);
}

async function loadObjectChoices() {
  const response = await salesforceRequest(
    session.host,
    session.sid,
    `/services/data/${SALESFORCE_API_VERSION}/sobjects`
  );
  objectChoices = (response?.sobjects || [])
    .filter((objectInfo) => objectInfo.queryable)
    .map((objectInfo) => ({ name: objectInfo.name, label: objectInfo.label || objectInfo.name }))
    .filter((objectInfo) => objectInfo.name)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (document.activeElement === objectInput) {
    renderObjectSuggestions();
  }
  return objectChoices;
}

function hideObjectSuggestions() {
  objectSuggestions.hidden = true;
  objectInput.setAttribute("aria-expanded", "false");
}

function highlightObjectSuggestion(nextIndex) {
  objectSuggestionIndex = nextIndex;
  [...objectSuggestions.children].forEach((option, index) => {
    option.classList.toggle("active", index === objectSuggestionIndex);
    option.setAttribute("aria-selected", String(index === objectSuggestionIndex));
  });
  objectSuggestions.children[objectSuggestionIndex]?.scrollIntoView({ block: "nearest" });
}

function chooseObjectSuggestion(item) {
  if (!item?.name) return;
  objectInput.value = item.name;
  hideObjectSuggestions();
}

function renderObjectSuggestions() {
  const needle = objectInput.value.trim().toLocaleLowerCase();
  const pickableNames = new Set(getPickableObjectChoices().map((choice) => choice.name));
  objectSuggestionItems = objectChoices
    .filter((objectInfo) => pickableNames.has(objectInfo.name))
    .filter((objectInfo) => !needle
      || objectInfo.name.toLocaleLowerCase().includes(needle)
      || objectInfo.label.toLocaleLowerCase().includes(needle))
    .slice(0, 12);
  objectSuggestions.replaceChildren();
  if (!objectSuggestionItems.length) {
    hideObjectSuggestions();
    return;
  }
  objectSuggestionItems.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `schema-map-object-suggestion${index === 0 ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === 0));
    button.tabIndex = -1;
    const apiName = document.createElement("span");
    apiName.className = "schema-map-object-suggestion-api";
    apiName.textContent = item.name;
    const label = document.createElement("span");
    label.className = "schema-map-object-suggestion-label";
    label.textContent = item.label;
    button.append(apiName, label);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      chooseObjectSuggestion(item);
    });
    objectSuggestions.appendChild(button);
  });
  objectSuggestionIndex = 0;
  objectSuggestions.hidden = false;
  objectInput.setAttribute("aria-expanded", "true");
}

function scheduleObjectSuggestions() {
  window.clearTimeout(objectSuggestionTimer);
  objectSuggestionTimer = window.setTimeout(() => renderObjectSuggestions(), 120);
}

function updateNamespaceSummary() {
  const summary = namespaceFilter.querySelector("summary");
  if (includeAllNamespaces) {
    summary.textContent = t("objectSchema.namespaces.allShort");
  } else if (!selectedNamespaces.size) {
    summary.textContent = t("objectSchema.namespaces.noneShort");
  } else {
    summary.textContent = t("objectSchema.namespaces.countShort", {
      selected: selectedNamespaces.size,
      total: namespaceCandidates.length
    });
  }
}

function setNamespaceSelection(namespaces = [], options = {}) {
  includeAllNamespaces = options.includeAll === true;
  selectedNamespaces = new Set(namespaces);
  renderNamespaceFilter();
  void persistNamespaceSelection();
  hideObjectSuggestions();
  refreshPickableObjectCatalog({ rebuildGraph: false });
  if (fullGraph) void execute();
}

function createNamespaceAction(labelKey, namespaces = [], options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = t(labelKey);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setNamespaceSelection(namespaces, options);
    namespaceFilter.open = true;
  });
  return button;
}

function renderNamespaceFilter() {
  const wasOpen = namespaceFilter.open;
  namespaceFilterMenu.replaceChildren();
  const actions = document.createElement("div");
  actions.className = "schema-map-namespace-filter-actions";
  actions.append(
    createNamespaceAction(
      "objectSchema.namespaces.selectAll",
      namespaceCandidates.map((item) => item.namespacePrefix),
      { includeAll: true }
    ),
    createNamespaceAction("common.clear", [])
  );
  namespaceFilterMenu.appendChild(actions);
  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.className = "schema-map-namespace-filter-input";
  filterInput.placeholder = t("objectSchema.namespaces.filter");
  filterInput.setAttribute("aria-label", t("objectSchema.namespaces.filter"));
  filterInput.value = namespaceFilterText;
  filterInput.addEventListener("click", (event) => event.stopPropagation());
  filterInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") event.stopPropagation();
  });
  filterInput.addEventListener("input", () => {
    namespaceFilterText = filterInput.value;
    const needle = namespaceFilterText.trim().toLocaleLowerCase();
    namespaceFilterMenu.querySelectorAll("label[data-namespace-search]").forEach((label) => {
      label.hidden = Boolean(needle) && !label.dataset.namespaceSearch.includes(needle) && !label.querySelector("input")?.checked;
    });
  });
  namespaceFilterMenu.appendChild(filterInput);
  if (!namespaceCandidates.length) {
    const empty = document.createElement("div");
    empty.className = "schema-map-namespace-empty";
    empty.textContent = t("objectSchema.namespaces.empty");
    namespaceFilterMenu.appendChild(empty);
  }
  namespaceCandidates.forEach((candidate) => {
    const selected = includeAllNamespaces || selectedNamespaces.has(candidate.namespacePrefix);
    const label = document.createElement("label");
    label.dataset.namespaceSearch = [candidate.name, candidate.namespacePrefix, candidate.version]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    label.classList.toggle("selected", selected);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected;
    checkbox.value = candidate.namespacePrefix;
    checkbox.addEventListener("change", () => {
      const next = new Set(includeAllNamespaces
        ? namespaceCandidates.map((item) => item.namespacePrefix)
        : selectedNamespaces);
      if (checkbox.checked) next.add(candidate.namespacePrefix);
      else next.delete(candidate.namespacePrefix);
      setNamespaceSelection([...next]);
      namespaceFilter.open = true;
    });
    const text = document.createElement("span");
    text.className = "schema-map-namespace-option-text";
    const name = document.createElement("span");
    name.className = "schema-map-namespace-option-name";
    name.textContent = candidate.name || candidate.namespacePrefix;
    const meta = document.createElement("span");
    meta.className = "schema-map-namespace-option-meta";
    meta.textContent = [candidate.namespacePrefix, candidate.version ? `v${candidate.version}` : ""].filter(Boolean).join(" · ");
    text.append(name, meta);
    label.append(checkbox, text);
    const needle = namespaceFilterText.trim().toLocaleLowerCase();
    label.hidden = Boolean(needle) && !label.dataset.namespaceSearch.includes(needle) && !selected;
    namespaceFilterMenu.appendChild(label);
  });
  updateNamespaceSummary();
  namespaceFilter.open = wasOpen;
}

async function loadNamespaceCandidates() {
  try {
    namespaceCandidates = await loadInstalledPackageNamespaces(session.host, session.sid);
  } catch (_error) {
    namespaceCandidates = [];
  }
  renderNamespaceFilter();
  return namespaceCandidates;
}

function getFieldColumns() {
  return [
    { key: "objectLabel", label: t("objectSchema.fields.objectLabel") },
    { key: "objectApiName", label: t("objectSchema.fields.objectApiName") },
    { key: "name", label: t("objectSchema.fields.apiName") },
    { key: "label", label: t("objectSchema.fields.label") },
    { key: "type", label: t("objectSchema.fields.type") },
    { key: "required", label: t("objectSchema.fields.required") },
    { key: "custom", label: t("objectSchema.fields.custom") },
    { key: "length", label: t("objectSchema.fields.length") },
    { key: "value", label: t("objectSchema.fields.value") }
  ];
}

function getFieldDisplayValue(field = {}) {
  const picklistValues = (field.picklistValues || [])
    .filter((item) => item.active !== false)
    .map((item) => item.label || item.value)
    .filter(Boolean);
  if (picklistValues.length) return picklistValues.join(", ");
  const formula = field.calculatedFormula || field.formula || "";
  if (formula) return formula;
  return (field.referenceTo || []).join(", ");
}

function normalizeFieldRow(field = {}, objectInfo = {}) {
  return {
    objectLabel: objectInfo.label || objectInfo.apiName || "",
    objectApiName: objectInfo.apiName || "",
    name: field.name || "",
    label: field.label || "",
    type: field.type || "",
    required: !field.nillable && !field.defaultedOnCreate,
    custom: Boolean(field.custom),
    length: field.length || field.precision || "",
    value: getFieldDisplayValue(field)
  };
}

function getFieldCellValue(row, key) {
  if (key === "required" || key === "custom") {
    return t(row[key] ? "objectSchema.yes" : "objectSchema.no");
  }
  return row[key];
}

function renderFieldsSheet() {
  if (!fieldsSheetReady) return;
  const columns = getFieldColumns();
  const objectRows = selectedFieldsObjectName === "*"
    ? schemaFieldRows
    : schemaFieldRows.filter((row) => row.objectApiName === selectedFieldsObjectName);
  const needle = fieldsSearchQuery.trim().toLocaleLowerCase();
  const rows = objectRows.filter((row) => !needle || columns.some((column) => (
    String(getFieldCellValue(row, column.key) ?? "").toLocaleLowerCase().includes(needle)
  )));
  const highlightCells = [];
  if (needle) {
    rows.forEach((row, rowIndex) => {
      columns.forEach((column, columnIndex) => {
        if (String(getFieldCellValue(row, column.key) ?? "").toLocaleLowerCase().includes(needle)) {
          highlightCells.push({ row: rowIndex + 1, column: columnIndex });
        }
      });
    });
  }
  renderedFieldsMatrix = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => getFieldCellValue(row, column.key)))
  ];
  fieldsSheetFrame.contentWindow?.postMessage({
    type: "object-schema-sheet-render",
    matrix: renderedFieldsMatrix,
    highlightCells
  }, location.origin);
  fieldsDownload.disabled = rows.length === 0;
  const selectedLabel = selectedFieldsObjectName === "*"
    ? t("objectSchema.fields.allObjects")
    : fieldsObjectFilter.selectedOptions[0]?.textContent || selectedFieldsObjectName;
  fieldsTitle.textContent = t("objectSchema.fields.title");
  fieldsMeta.textContent = t("objectSchema.fields.count", {
    count: schemaFieldRows.length,
    objects: schemaFieldObjectCount,
    filter: selectedLabel
  });
  fieldsEmpty.textContent = needle && objectRows.length
    ? t("objectSchema.fields.noMatch")
    : t("objectSchema.fields.empty");
  fieldsEmpty.hidden = rows.length > 0;
}

function initializeFieldsSheet() {
  if (fieldsSheetPromise) return fieldsSheetPromise;
  fieldsSection.hidden = false;
  fieldsTitle.textContent = t("objectSchema.fields.title");
  fieldsMeta.textContent = t("objectSchema.fields.loadingEngine");
  fieldsSheetPromise = new Promise((resolve, reject) => {
    fieldsSheetResolve = resolve;
    fieldsSheetReject = reject;
  });
  return fieldsSheetPromise;
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== fieldsSheetFrame.contentWindow) return;
  if (event.data?.type === "object-schema-sheet-ready") {
    fieldsSheetReady = true;
    selectedFieldsObjectName ||= "*";
    if (!fieldsObjectFilter.options.length) {
      const option = document.createElement("option");
      option.value = "*";
      option.textContent = t("objectSchema.fields.allObjects");
      fieldsObjectFilter.appendChild(option);
    }
    fieldsObjectFilter.value = selectedFieldsObjectName;
    renderFieldsSheet();
    fieldsMeta.textContent = t("objectSchema.fields.ready");
    fieldsEmpty.hidden = true;
    fieldsSheetResolve?.();
    fieldsSheetResolve = null;
    fieldsSheetReject = null;
  } else if (event.data?.type === "object-schema-sheet-error") {
    const error = new Error(event.data.message || t("objectSchema.fields.engineError"));
    fieldsMeta.textContent = formatUserFacingMessage(error.message);
    fieldsEmpty.textContent = t("objectSchema.fields.empty");
    fieldsEmpty.hidden = false;
    fieldsSheetReject?.(error);
    fieldsSheetResolve = null;
    fieldsSheetReject = null;
  }
});

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadFieldsCsv() {
  if (renderedFieldsMatrix.length < 2) return;
  const csv = `\ufeff${renderedFieldsMatrix.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const scope = selectedFieldsObjectName === "*" ? "schema" : selectedFieldsObjectName;
  const safeScope = String(scope).replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "schema";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeScope}-fields.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setFieldsObjectFilter(objectName) {
  if (!objectName) return;
  selectedFieldsObjectName = objectName;
  if ([...fieldsObjectFilter.options].some((option) => option.value === objectName)) {
    fieldsObjectFilter.value = objectName;
  }
  renderFieldsSheet();
}

async function renderSelectableObjectFields(choices) {
  const token = ++fieldsRenderToken;
  if (!choices?.length) {
    selectedFieldsObjectName = "*";
    schemaFieldRows = [];
    schemaFieldObjectCount = 0;
    fieldsObjectFilter.replaceChildren();
    fieldsObjectFilter.disabled = true;
    renderFieldsSheet();
    return;
  }
  const nodes = choices.map((choice) => ({ apiName: choice.name, label: choice.label || choice.name }));
  selectedFieldsObjectName = "*";
  schemaFieldRows = [];
  schemaFieldObjectCount = nodes.length;
  fieldsSection.hidden = false;
  fieldsTitle.textContent = t("objectSchema.fields.title");
  fieldsMeta.textContent = t("objectSchema.fields.loading");
  fieldsObjectFilter.disabled = false;
  fieldsEmpty.hidden = true;
  fieldsObjectFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "*";
  allOption.textContent = t("objectSchema.fields.allObjects");
  fieldsObjectFilter.appendChild(allOption);
  nodes.forEach((node) => {
    const option = document.createElement("option");
    option.value = node.apiName;
    option.textContent = `${node.label} (${node.apiName})`;
    fieldsObjectFilter.appendChild(option);
  });
  fieldsObjectFilter.value = selectedFieldsObjectName;
  try {
    await initializeFieldsSheet();
    if (token !== fieldsRenderToken) return;
    const priorityObjectName = objectInput.value.trim();
    const orderedNodes = [...nodes].sort((left, right) => (
      Number(right.apiName === priorityObjectName) - Number(left.apiName === priorityObjectName)
      || left.apiName.localeCompare(right.apiName)
    ));
    let nextIndex = 0;
    let failed = 0;
    const loadedRows = [];
    const worker = async () => {
      while (nextIndex < orderedNodes.length) {
        const node = orderedNodes[nextIndex++];
        try {
          const describe = await getDescribe(node.apiName);
          if (token !== fieldsRenderToken) return;
          loadedRows.push(...(describe?.fields || []).map((field) => normalizeFieldRow(field, node)));
        } catch (_error) {
          failed += 1;
        }
        if (token !== fieldsRenderToken) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, orderedNodes.length) }, () => worker()));
    if (token !== fieldsRenderToken) return;
    schemaFieldRows = loadedRows.sort((left, right) => (
      left.objectApiName.localeCompare(right.objectApiName) || left.name.localeCompare(right.name)
    ));
    renderFieldsSheet();
    if (failed) {
      fieldsMeta.textContent += ` ${t("objectSchema.fields.partial", { count: failed })}`;
    }
  } catch (error) {
    if (token !== fieldsRenderToken) return;
    fieldsMeta.textContent = formatUserFacingMessage(error instanceof Error ? error.message : String(error));
    fieldsEmpty.textContent = t("objectSchema.fields.empty");
    fieldsEmpty.hidden = false;
  }
}

function renderDetails(apiName, graph) {
  const node = graph.nodes.find((item) => item.apiName === apiName);
  if (!node) return;
  const related = graph.edges.filter((edge) => edge.from === apiName || edge.to === apiName);
  detail.textContent = "";
  const title = document.createElement("h4");
  title.textContent = node.label || node.apiName;
  const meta = document.createElement("p");
  meta.textContent = t("objectSchema.detailMeta", {
    apiName: node.apiName,
    type: t(node.custom ? "objectSchema.type.custom" : "objectSchema.type.standard"),
    count: related.length
  });
  const list = document.createElement("ul");
  related.slice(0, 12).forEach((edge) => {
    const item = document.createElement("li");
    item.textContent = `${edge.from} — ${edge.field || t("objectSchema.relationship")} → ${edge.to} (${relationshipKindLabel(edge.kind)})`;
    list.appendChild(item);
  });
  const rerootButton = document.createElement("button");
  rerootButton.type = "button";
  rerootButton.textContent = t("objectSchema.useAsRoot");
  rerootButton.addEventListener("click", () => {
    objectInput.value = node.apiName;
    void execute();
  });
  detail.append(title, meta, list, rerootButton);
  detail.hidden = false;
}

function renderMobileTree(graph) {
  mobileTree.textContent = "";
  const title = document.createElement("h4");
  title.textContent = t("objectSchema.treeTitle", { root: graph.root });
  mobileTree.appendChild(title);
  [[t("objectSchema.parents"), -1], [t("objectSchema.selected"), 0], [t("objectSchema.children"), 1]].forEach(([label, direction]) => {
    const group = document.createElement("details");
    group.open = true;
    const summary = document.createElement("summary");
    const nodes = graph.nodes.filter((node) => direction === 0 ? node.side === 0 : Math.sign(node.side) === direction);
    summary.textContent = `${label} (${nodes.length})`;
    const list = document.createElement("ul");
    nodes.sort((left, right) => left.apiName.localeCompare(right.apiName)).forEach((node) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${node.label} (${node.apiName})`;
      button.addEventListener("click", () => {
        renderDetails(node.apiName, graph);
        setFieldsObjectFilter(node.apiName);
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    group.append(summary, list);
    mobileTree.appendChild(group);
  });
}

function renderRelationshipTable(graph) {
  alternativeBody.textContent = "";
  const table = document.createElement("table");
  const headRow = document.createElement("tr");
  ["objectSchema.table.child", "objectSchema.table.field", "objectSchema.table.parent", "objectSchema.table.type"].forEach((key) => {
    const th = document.createElement("th");
    th.textContent = t(key);
    headRow.appendChild(th);
  });
  const thead = document.createElement("thead");
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  graph.edges.forEach((edge) => {
    const row = document.createElement("tr");
    [edge.from, edge.field, edge.to, relationshipKindLabel(edge.kind)].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.append(thead, tbody);
  alternativeBody.appendChild(table);
  alternative.hidden = false;
}

function applyViewportScale() {
  const svg = viewport.querySelector(".schema-map-svg");
  if (!svg) return;
  viewport.classList.toggle("is-fit", fitView);
  if (fitView) {
    svg.style.width = "";
    svg.style.height = "";
  } else {
    svg.style.width = `${Number(svg.getAttribute("width")) * zoomLevel}px`;
    svg.style.height = `${Number(svg.getAttribute("height")) * zoomLevel}px`;
  }
  fitButton.textContent = t(fitView ? "objectSchema.actualSize" : "objectSchema.fit");
  zoomLevelOutput.value = `${Math.round(zoomLevel * 100)}%`;
  zoomLevelOutput.textContent = zoomLevelOutput.value;
}

function setZoom(nextZoom) {
  zoomLevel = Math.min(2, Math.max(0.5, Math.round(nextZoom * 4) / 4));
  fitView = false;
  applyViewportScale();
}

function renderObjectFilter(graph) {
  const wasOpen = objectFilter.open;
  objectFilterMenu.textContent = "";
  const nodes = [...graph.nodes].sort((left, right) => (
    Number(right.apiName === graph.root) - Number(left.apiName === graph.root)
    || (left.label || left.apiName).localeCompare(right.label || right.apiName)
  ));
  const shownNodes = nodes.filter((node) => !excludedObjectNames.has(node.apiName));
  const previewNames = shownNodes.slice(0, 3).map((node) => node.apiName);
  const remainingCount = Math.max(0, shownNodes.length - previewNames.length);
  const summary = objectFilter.querySelector("summary");
  summary.textContent = t("objectSchema.visibleNames", {
    shown: shownNodes.length,
    total: nodes.length,
    names: previewNames.join(", "),
    more: remainingCount ? t("objectSchema.visibleMore", { count: remainingCount }) : ""
  }).trim();
  summary.title = shownNodes.map((node) => node.apiName).join(", ");

  const actions = document.createElement("div");
  actions.className = "schema-map-object-filter-actions";
  const showAll = document.createElement("button");
  showAll.type = "button";
  showAll.className = "secondary";
  showAll.textContent = t("objectSchema.showAll");
  showAll.addEventListener("click", () => {
    excludedObjectNames.clear();
    renderGraph();
    objectFilter.open = true;
  });
  const rootOnly = document.createElement("button");
  rootOnly.type = "button";
  rootOnly.className = "secondary";
  rootOnly.textContent = t("objectSchema.rootOnly");
  rootOnly.addEventListener("click", () => {
    excludedObjectNames = new Set(nodes.filter((node) => node.apiName !== graph.root).map((node) => node.apiName));
    searchMatchName = "";
    selectedMapObjectName = graph.root;
    searchInput.value = "";
    renderGraph();
    objectFilter.open = true;
  });
  actions.append(showAll, rootOnly);
  objectFilterMenu.appendChild(actions);

  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.className = "schema-map-object-filter-search";
  filterInput.placeholder = t("objectSchema.visibleFilter");
  filterInput.setAttribute("aria-label", t("objectSchema.visibleFilter"));
  filterInput.value = visibleObjectFilterText;
  filterInput.addEventListener("click", (event) => event.stopPropagation());
  filterInput.addEventListener("input", () => {
    visibleObjectFilterText = filterInput.value;
    const needle = visibleObjectFilterText.trim().toLocaleLowerCase();
    objectFilterMenu.querySelectorAll("label[data-object-search]").forEach((label) => {
      label.hidden = Boolean(needle) && !label.dataset.objectSearch.includes(needle);
    });
  });
  objectFilterMenu.appendChild(filterInput);

  nodes.forEach((node) => {
    const label = document.createElement("label");
    label.dataset.objectSearch = `${node.label || ""} ${node.apiName}`.toLocaleLowerCase();
    const visibleNeedle = visibleObjectFilterText.trim().toLocaleLowerCase();
    label.hidden = Boolean(visibleNeedle) && !label.dataset.objectSearch.includes(visibleNeedle);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !excludedObjectNames.has(node.apiName);
    checkbox.disabled = node.apiName === graph.root;
    checkbox.dataset.objectApiName = node.apiName;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) excludedObjectNames.delete(node.apiName);
      else excludedObjectNames.add(node.apiName);
      if (node.apiName === searchMatchName && !checkbox.checked) {
        searchMatchName = "";
        searchInput.value = "";
      }
      if (node.apiName === selectedMapObjectName && !checkbox.checked) {
        selectedMapObjectName = graph.root;
      }
      renderGraph();
      objectFilter.open = true;
    });
    const text = document.createElement("span");
    text.textContent = `${node.label || node.apiName} (${node.apiName})`;
    label.append(checkbox, text);
    objectFilterMenu.appendChild(label);
  });
  objectFilter.open = wasOpen;
}

function highlightSearchPath(graph) {
  if (!searchMatchName) return;
  const path = findSchemaPath(graph, graph.root, searchMatchName);
  const pathPairs = new Set();
  for (let index = 1; index < path.length; index += 1) {
    pathPairs.add([path[index - 1], path[index]].sort().join("\u0000"));
  }
  viewport.querySelectorAll(".schema-map-edge, .schema-map-edge-label").forEach((edge) => {
    const pair = [edge.dataset.edgeFrom, edge.dataset.edgeTo].sort().join("\u0000");
    const onPath = pathPairs.has(pair);
    edge.classList.toggle("schema-map-edge-root-path", onPath && edge.classList.contains("schema-map-edge"));
    edge.classList.toggle("schema-map-edge-label-root-path", onPath && edge.classList.contains("schema-map-edge-label"));
  });
  const target = [...viewport.querySelectorAll(".schema-map-node")].find((node) => node.dataset.objectApiName === searchMatchName);
  target?.classList.add("schema-map-node-search-match");
}

function activateMapObject(apiName, options = {}) {
  if (!fullGraph || !apiName) return;
  const match = fullGraph.nodes.find((node) => node.apiName === apiName);
  if (!match) return;
  if (Math.abs(match.side) > visibleLevels) visibleLevels = Math.abs(match.side);
  searchMatchName = match.apiName;
  selectedMapObjectName = match.apiName;
  if (options.updateInput !== false) searchInput.value = match.apiName;
  findSchemaPath(fullGraph, fullGraph.root, match.apiName).forEach((name) => excludedObjectNames.delete(name));
  renderGraph();
  setFieldsObjectFilter(match.apiName);
}

function renderGraph() {
  if (!fullGraph) return;
  const availableGraph = limitSchemaGraph(fullGraph, visibleLevels);
  renderObjectFilter(availableGraph);
  objectFilter.hidden = false;
  const includedNames = new Set(availableGraph.nodes.filter((node) => !excludedObjectNames.has(node.apiName)).map((node) => node.apiName));
  const graph = filterSchemaGraph(availableGraph, includedNames);
  viewport.innerHTML = renderSchemaMapSvg(graph, {
    layoutMode,
    labels: {
      mapTitle: t("objectSchema.mapTitle", { root: graph.root }),
      mapDescription: t(`objectSchema.mapDescription.${layoutMode}`),
      custom: t("objectSchema.type.custom"),
      standard: t("objectSchema.type.standard"),
      inspect: t("objectSchema.inspect", { object: "{object}" })
    }
  });
  applyViewportScale();
  viewControls.hidden = false;
  expandButton.hidden = availableGraph.hiddenNodeCount === 0;
  expandButton.textContent = availableGraph.hiddenNodeCount
    ? t("objectSchema.showDeeper", { count: availableGraph.hiddenNodeCount })
    : t("objectSchema.expandAll");
  renderRelationshipTable(graph);
  renderMobileTree(graph);
  const statusParts = [t("objectSchema.status.visible", { objects: graph.nodes.length, relationships: graph.edges.length })];
  if (graph.nodes.length < availableGraph.nodes.length) {
    statusParts.push(t("objectSchema.status.showing", { shown: graph.nodes.length, total: availableGraph.nodes.length }));
  }
  if (availableGraph.hiddenNodeCount) {
    statusParts.push(t("objectSchema.status.collapsed", { count: availableGraph.hiddenNodeCount }));
  }
  if (fullGraph.truncated) {
    statusParts.push(t("objectSchema.status.limited", { count: fullGraph.maxNodes }));
  }
  setStatus(status, statusParts.join(" "));
  viewport.querySelectorAll(".schema-map-node").forEach((node) => {
    const inspect = () => {
      activateMapObject(node.dataset.objectApiName || fullGraph.root);
    };
    node.addEventListener("click", inspect);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        inspect();
      }
    });
  });
  highlightSearchPath(graph);
  const detailObjectName = graph.nodes.some((node) => node.apiName === selectedMapObjectName)
    ? selectedMapObjectName
    : fullGraph.root;
  renderDetails(detailObjectName, graph);
}

async function execute() {
  summaryRow.hidden = false;
  if (!session?.host || !session?.sid) {
    setStatus(status, t("objectSchema.status.connectFirst"), true);
    return;
  }
  const objectName = objectInput.value.trim() || "Contact";
  buildButton.disabled = true;
  viewport.textContent = "";
  alternativeBody.textContent = "";
  alternative.hidden = true;
  alternative.open = false;
  setStatus(status, t("objectSchema.status.building", { object: objectName }));
  try {
    if (!getPickableObjectChoices().some((choice) => choice.name === objectName)) {
      throw new Error(t("objectSchema.objectName.invalid"));
    }
    fullGraph = await buildSchemaGraph(objectName, {
      parentLevels: parentInput.value,
      childLevels: childInput.value,
      maxNodes: 100,
      showAllStandardObjects: showAllStandardInput.checked,
      includeObjectName: isObjectNamespaceIncluded,
      describe: getDescribe
    });
    visibleLevels = 2;
    fitView = true;
    zoomLevel = 1;
    layoutMode = "horizontal";
    layoutInput.value = layoutMode;
    excludedObjectNames.clear();
    searchMatchName = "";
    selectedMapObjectName = fullGraph.root;
    searchInput.value = "";
    renderGraph();
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), true);
  } finally {
    buildButton.disabled = false;
  }
}

buildButton.addEventListener("click", () => void execute());
objectInput.addEventListener("input", scheduleObjectSuggestions);
objectInput.addEventListener("focus", scheduleObjectSuggestions);
objectInput.addEventListener("keydown", (event) => {
  if (objectSuggestions.hidden || !objectSuggestionItems.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightObjectSuggestion(Math.min(objectSuggestionIndex + 1, objectSuggestionItems.length - 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightObjectSuggestion(Math.max(objectSuggestionIndex - 1, 0));
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    chooseObjectSuggestion(objectSuggestionItems[objectSuggestionIndex]);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    hideObjectSuggestions();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!objectSuggestions.hidden && event.target !== objectInput && !objectSuggestions.contains(event.target)) {
    hideObjectSuggestions();
  }
  if (namespaceFilter.open && !namespaceFilter.contains(event.target)) {
    namespaceFilter.open = false;
  }
  if (objectFilter.open && !objectFilter.contains(event.target)) {
    objectFilter.open = false;
  }
}, true);
fieldsObjectFilter.addEventListener("change", () => setFieldsObjectFilter(fieldsObjectFilter.value));
function runFieldsSearch() {
  fieldsSearchQuery = fieldsSearch.value;
  fieldsSearchClear.hidden = !fieldsSearch.value;
  renderFieldsSheet();
}
fieldsSearch.addEventListener("input", () => {
  fieldsSearchClear.hidden = !fieldsSearch.value;
});
fieldsSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runFieldsSearch();
});
fieldsSearchButton.addEventListener("click", runFieldsSearch);
fieldsSearchClear.addEventListener("click", () => {
  fieldsSearch.value = "";
  fieldsSearchQuery = "";
  fieldsSearchClear.hidden = true;
  renderFieldsSheet();
  fieldsSearch.focus();
});
fieldsDownload.addEventListener("click", downloadFieldsCsv);
fieldsFullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === fieldsSection) await document.exitFullscreen();
    else await fieldsSection.requestFullscreen();
  } catch (error) {
    fieldsMeta.textContent = formatUserFacingMessage(error instanceof Error ? error.message : String(error));
  }
});
document.addEventListener("fullscreenchange", () => {
  const expanded = document.fullscreenElement === fieldsSection;
  const key = expanded ? "objectSchema.fields.exitFullscreen" : "objectSchema.fields.fullscreen";
  fieldsFullscreen.setAttribute("aria-label", t(key));
  fieldsFullscreen.title = t(key);
  fieldsFullscreen.classList.toggle("active", expanded);
});
showAllStandardInput.addEventListener("change", () => refreshPickableObjectCatalog());
fitButton.addEventListener("click", () => {
  fitView = !fitView;
  if (!fitView) zoomLevel = 1;
  applyViewportScale();
});
zoomOutButton.addEventListener("click", () => setZoom(zoomLevel - 0.25));
zoomInButton.addEventListener("click", () => setZoom(zoomLevel + 0.25));
layoutInput.addEventListener("change", () => {
  layoutMode = layoutInput.value === "vertical" ? "vertical" : "horizontal";
  renderGraph();
});
expandButton.addEventListener("click", () => {
  visibleLevels = 5;
  renderGraph();
});
resetViewButton.addEventListener("click", () => {
  visibleLevels = 2;
  fitView = true;
  zoomLevel = 1;
  layoutMode = "horizontal";
  layoutInput.value = layoutMode;
  excludedObjectNames.clear();
  searchMatchName = "";
  searchInput.value = "";
  viewport.scrollTo({ left: 0, top: 0 });
  renderGraph();
});
searchInput.addEventListener("input", () => {
  if (!fullGraph) return;
  const query = searchInput.value.trim().toLowerCase();
  searchMatchName = "";
  if (!query) {
    selectedMapObjectName = fullGraph.root;
    renderGraph();
    return;
  }
  const match = fullGraph.nodes.find((node) => node.apiName.toLowerCase().includes(query) || node.label.toLowerCase().includes(query));
  if (!match) {
    renderGraph();
    return;
  }
  activateMapObject(match.apiName);
});
resetButton.addEventListener("click", () => {
  objectInput.value = "Contact";
  parentInput.value = "1";
  childInput.value = "1";
  showAllStandardInput.checked = false;
  fullGraph = null;
  visibleLevels = 2;
  fitView = true;
  zoomLevel = 1;
  layoutMode = "horizontal";
  layoutInput.value = layoutMode;
  excludedObjectNames.clear();
  searchMatchName = "";
  selectedMapObjectName = "";
  searchInput.value = "";
  includeAllNamespaces = false;
  selectedNamespaces.clear();
  namespaceFilterText = "";
  visibleObjectFilterText = "";
  renderNamespaceFilter();
  void persistNamespaceSelection();
  viewport.textContent = "";
  viewControls.hidden = true;
  objectFilter.hidden = true;
  detail.hidden = true;
  mobileTree.textContent = "";
  alternativeBody.textContent = "";
  alternative.hidden = true;
  alternative.open = false;
  fieldsSearch.value = "";
  fieldsSearchQuery = "";
  fieldsSearchClear.hidden = true;
  refreshPickableObjectCatalog({ rebuildGraph: false });
  setStatus(status, "");
  summaryRow.hidden = true;
});

async function init() {
  buildButton.disabled = true;
  try {
    const host = params.get("host");
    if (!host) throw new Error("Missing host parameter. Open Object Schema from the popup Apps tab while connected to Salesforce.");
    session = await getSessionForHost(host);
    setStatus(sessionStatus, t("objectSchema.status.connected", { host: session.host }));
    await restoreNamespaceSelection();
    buildButton.disabled = false;
    await Promise.all([loadObjectChoices(), loadNamespaceCandidates()]);
    refreshPickableObjectCatalog({ rebuildGraph: false });
  } catch (error) {
    setStatus(sessionStatus, error instanceof Error ? error.message : String(error), true);
  }
}

void init();
void initializeFieldsSheet().catch(() => {});

window.addEventListener("app-language-change", () => {
  mountObjectSchemaHeader();
  if (session?.host) {
    setStatus(sessionStatus, t("objectSchema.status.connected", { host: session.host }));
  }
  if (fullGraph) {
    renderGraph();
  }
  renderNamespaceFilter();
  if (fieldsSheetReady) {
    const selectedValue = selectedFieldsObjectName;
    const allOption = fieldsObjectFilter.querySelector('option[value="*"]');
    if (allOption) allOption.textContent = t("objectSchema.fields.allObjects");
    fieldsObjectFilter.value = selectedValue;
    renderFieldsSheet();
    if (!schemaFieldRows.length) fieldsMeta.textContent = t("objectSchema.fields.ready");
  }
});

export { csvCell };
