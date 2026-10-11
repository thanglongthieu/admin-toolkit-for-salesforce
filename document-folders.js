import {
  getActiveSession,
  getSessionForHost,
  runSoqlAll,
  SALESFORCE_API_VERSION,
  salesforceRequest
} from "./api.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";
import { confirmOrgMutation, ORG_RISK } from "./org-safety.js";
import { recordOperation } from "./operation-history.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("document-folders-status");
const operationStatusEl = document.getElementById("document-folders-operation-status");
const refreshButton = document.getElementById("refresh-document-folders");
const filterInput = document.getElementById("document-folder-filter");
const filterButton = document.getElementById("document-folder-filter-button");
const treeEl = document.getElementById("document-folder-tree");
const detailEl = document.getElementById("document-folder-detail");
const documentFoldersWorkbenchEl = document.querySelector(".document-folders-workbench");
const documentFolderColumnResizerEl = document.getElementById("document-folder-column-resizer");
const DOCUMENT_FOLDERS_SIDEBAR_WIDTH_STORAGE_KEY = "document-folders-sidebar-width";
const DOCUMENT_PREVIEW_AUTO_LIMIT_BYTES = 5 * 1024 * 1024;
const DOCUMENT_ZIP_WARN_BYTES = 100 * 1024 * 1024;
const DOCUMENT_ZIP_MAX_BYTES = 250 * 1024 * 1024;
const DOCUMENT_ZIP_MAX_FILES = 500;

let session = null;
let selectedKey = "";
let filterText = "";
let activeFindRequestId = 0;
let zipDownloadInProgress = false;
let activeZipController = null;
let selectionOperationId = 0;
let selectionInProgress = false;
let workspaceFoldersLoadPromise = null;
const activePreviewObjectUrls = new Set();
const activePreviewControllers = new Set();
const openDocumentFolderKeys = new Set();
const selectedDocumentFolderItems = new Set();
let documentState = createEmptyDocumentState();

function createEmptyDocumentState() {
  return {
    workspaces: [],
    folders: [],
    members: [],
    documents: [],
    workspaceFoldersLoaded: false,
    workspaceFoldersLoading: false,
    loadedFolderIds: new Set(),
    loadingFolderIds: new Set(),
    warnings: [],
    tree: null,
    nodesByKey: new Map(),
    documentsById: new Map()
  };
}

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.classList.toggle("error", Boolean(isError));
}

function setConnectedStatus() {
  if (session?.host) {
    setStatus(t("documentFolders.status.connected", { host: session.host }));
  }
}

function setOperationStatus(message = "", isError = false) {
  if (!operationStatusEl) {
    return;
  }
  operationStatusEl.hidden = !message;
  operationStatusEl.textContent = formatUserFacingMessage(message);
  operationStatusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(isBusy) {
  refreshButton.disabled = isBusy;
  refreshButton.setAttribute("aria-busy", String(Boolean(isBusy)));
  refreshButton.setAttribute("aria-label", isBusy ? "Loading document folders" : "Reload document folders");
  refreshButton.title = isBusy ? "Loading document folders" : "Reload document folders";
}

function getStoredSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(DOCUMENT_FOLDERS_SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch (_error) {
    return 0;
  }
}

function setSidebarWidth(width) {
  if (!documentFoldersWorkbenchEl) {
    return;
  }

  const workbenchWidth = documentFoldersWorkbenchEl.getBoundingClientRect().width;
  const maxWidth = Math.max(320, workbenchWidth - 360);
  const nextWidth = Math.min(Math.max(width, 280), maxWidth);
  documentFoldersWorkbenchEl.style.setProperty("--schema-sidebar-width", `${Math.round(nextWidth)}px`);
  try {
    localStorage.setItem(DOCUMENT_FOLDERS_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
  } catch (_error) {
    // Sidebar width is cosmetic; ignore storage failures.
  }
}

function initializeSidebarResizer() {
  const storedWidth = getStoredSidebarWidth();
  if (storedWidth) {
    setSidebarWidth(storedWidth);
  }

  if (!documentFoldersWorkbenchEl || !documentFolderColumnResizerEl) {
    return;
  }

  let dragStartX = 0;
  let dragStartWidth = 0;

  function stopResize(pointerId) {
    documentFolderColumnResizerEl.classList.remove("dragging");
    document.body.classList.remove("schema-resizing-columns");
    try {
      documentFolderColumnResizerEl.releasePointerCapture(pointerId);
    } catch (_error) {
      // Pointer capture can already be released by the browser.
    }
  }

  documentFolderColumnResizerEl.addEventListener("pointerdown", (event) => {
    dragStartX = event.clientX;
    dragStartWidth = documentFoldersWorkbenchEl.querySelector(".schema-explorer")?.getBoundingClientRect().width || 320;
    documentFolderColumnResizerEl.classList.add("dragging");
    document.body.classList.add("schema-resizing-columns");
    documentFolderColumnResizerEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  documentFolderColumnResizerEl.addEventListener("pointermove", (event) => {
    if (!documentFolderColumnResizerEl.classList.contains("dragging")) {
      return;
    }
    setSidebarWidth(dragStartWidth + event.clientX - dragStartX);
  });

  documentFolderColumnResizerEl.addEventListener("pointerup", (event) => stopResize(event.pointerId));
  documentFolderColumnResizerEl.addEventListener("pointercancel", (event) => stopResize(event.pointerId));
  documentFolderColumnResizerEl.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    const currentWidth = documentFoldersWorkbenchEl.querySelector(".schema-explorer")?.getBoundingClientRect().width || 320;
    setSidebarWidth(currentWidth + (event.key === "ArrowRight" ? 24 : -24));
    event.preventDefault();
  });
}

function escapeSoqlString(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function chunkArray(values = [], size = 100) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function queryAll(soql) {
  return runSoqlAll(session.host, session.sid, soql);
}

async function queryOptional(soql, warningLabel) {
  try {
    return await queryAll(soql);
  } catch (error) {
    documentState.warnings.push(`${warningLabel}: ${formatUserFacingMessage(error instanceof Error ? error.message : String(error))}`);
    return [];
  }
}

async function queryByIds(selectSoql, fieldName, ids = [], warningLabel) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) {
    return [];
  }

  const results = [];
  for (const chunk of chunkArray(uniqueIds, 100)) {
    const inClause = chunk.map((id) => `'${escapeSoqlString(id)}'`).join(", ");
    results.push(...await queryOptional(`${selectSoql} WHERE ${fieldName} IN (${inClause})`, warningLabel));
  }
  return results;
}

async function queryBySingleIds(selectSoql, fieldName, ids = [], warningLabel) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) {
    return [];
  }

  const results = [];
  for (const id of uniqueIds) {
    results.push(...await queryOptional(`${selectSoql} WHERE ${fieldName} = '${escapeSoqlString(id)}'`, warningLabel));
  }
  return results;
}

function normalizeDate(value = "") {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let nextSize = size / 1024;
  let unitIndex = 0;
  while (nextSize >= 1024 && unitIndex < units.length - 1) {
    nextSize /= 1024;
    unitIndex += 1;
  }
  return `${nextSize.toFixed(nextSize >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getDocumentOpenUrl(documentId = "") {
  return `https://${session.host}/lightning/r/ContentDocument/${encodeURIComponent(documentId)}/view`;
}

function getDocumentDownloadUrl(documentRecord = {}) {
  const versionId = documentRecord.LatestPublishedVersionId || "";
  if (versionId) {
    return `https://${session.host}/sfc/servlet.shepherd/version/download/${encodeURIComponent(versionId)}`;
  }
  return `https://${session.host}/sfc/servlet.shepherd/document/download/${encodeURIComponent(documentRecord.Id)}`;
}

function getPreviewKind(documentRecord = {}) {
  const fileType = String(documentRecord.FileType || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(fileType)) {
    return "image";
  }
  if (fileType === "pdf") {
    return "pdf";
  }
  if (["txt", "text", "csv", "html", "xml", "json"].includes(fileType)) {
    return "text";
  }
  if (["mp3", "wav", "m4a", "audio"].includes(fileType)) {
    return "audio";
  }
  if (["mp4", "mov", "avi", "video"].includes(fileType)) {
    return "video";
  }
  return "";
}

function clearActivePreviewObjectUrls() {
  activePreviewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activePreviewObjectUrls.clear();
}

function clearDetail() {
  activePreviewControllers.forEach((controller) => controller.abort());
  activePreviewControllers.clear();
  clearActivePreviewObjectUrls();
  detailEl.textContent = "";
}

function createTrackedObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  activePreviewObjectUrls.add(url);
  return url;
}

function getDocumentTitle(documentRecord = {}) {
  return documentRecord.Title || documentRecord.Id || "Untitled";
}

function getDocumentFileExtension(documentRecord = {}) {
  const fileType = String(documentRecord.FileType || "").toLowerCase();
  const extensionByType = {
    csv: "csv",
    excel: "xls",
    excel_x: "xlsx",
    html: "html",
    jpg: "jpg",
    jpeg: "jpg",
    link: "url",
    pdf: "pdf",
    png: "png",
    ppt: "ppt",
    ppt_x: "pptx",
    rtf: "rtf",
    text: "txt",
    txt: "txt",
    word: "doc",
    word_x: "docx",
    xml: "xml",
    zip: "zip"
  };
  return extensionByType[fileType] || fileType.replace(/[^a-z0-9]+/g, "");
}

function sanitizeZipPathPart(value = "", fallback = "item") {
  const sanitized = String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return sanitized || fallback;
}

function getDocumentZipFileName(documentRecord = {}) {
  const title = sanitizeZipPathPart(getDocumentTitle(documentRecord), documentRecord.Id || "document");
  if (/\.[A-Za-z0-9]{1,8}$/.test(title)) {
    return title;
  }
  const extension = getDocumentFileExtension(documentRecord);
  return extension ? `${title}.${extension}` : title;
}

function getUniqueZipPath(basePath = "", usedPaths = new Set()) {
  const cleanPath = String(basePath || "document").replace(/^\/+/, "");
  if (!usedPaths.has(cleanPath)) {
    usedPaths.add(cleanPath);
    return cleanPath;
  }

  const slashIndex = cleanPath.lastIndexOf("/");
  const folderPrefix = slashIndex >= 0 ? `${cleanPath.slice(0, slashIndex + 1)}` : "";
  const fileName = slashIndex >= 0 ? cleanPath.slice(slashIndex + 1) : cleanPath;
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";
  let counter = 2;
  while (usedPaths.has(`${folderPrefix}${baseName}-${counter}${extension}`)) {
    counter += 1;
  }
  const nextPath = `${folderPrefix}${baseName}-${counter}${extension}`;
  usedPaths.add(nextPath);
  return nextPath;
}

function createTreeNode({ key, kind, name, secondary = "", record = null, children = [], lazy = false, loaded = true, loading = false }) {
  return {
    key,
    kind,
    name,
    secondary,
    record,
    children,
    lazy,
    loaded,
    loading
  };
}

function indexTreeNode(node, map = new Map()) {
  map.set(node.key, node);
  (node.children || []).forEach((child) => indexTreeNode(child, map));
  return map;
}

function groupBy(records = [], keyGetter) {
  const grouped = new Map();
  records.forEach((record) => {
    const key = keyGetter(record);
    if (!key) {
      return;
    }
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(record);
  });
  return grouped;
}

function mergeRecords(existing = [], incoming = [], keyGetter) {
  const mergedByKey = new Map();
  [...existing, ...incoming].forEach((record) => {
    const key = keyGetter(record);
    if (key) {
      mergedByKey.set(key, record);
    }
  });
  return [...mergedByKey.values()];
}

function mergeFolderRecords(incoming = []) {
  const existingById = new Map(documentState.folders.map((folder) => [folder.Id, folder]));
  const normalized = incoming.map((folder) => {
    const existing = existingById.get(folder.Id) || {};
    return {
      ...existing,
      ...folder,
      DisplayName: existing.DisplayName || folder.DisplayName,
      WorkspaceId: existing.WorkspaceId || folder.WorkspaceId,
      WorkspaceName: existing.WorkspaceName || folder.WorkspaceName,
      IsWorkspaceRoot: existing.IsWorkspaceRoot || folder.IsWorkspaceRoot || false
    };
  });
  documentState.folders = mergeRecords(documentState.folders, normalized, (folder) => folder.Id);
}

function getIdLookupKeys(id = "") {
  const value = String(id || "").trim();
  if (!value) {
    return [];
  }
  const keys = [value];
  if (value.length === 18) {
    keys.push(value.slice(0, 15));
  }
  return [...new Set(keys)];
}

function mapWorkspacesByIdForms(workspaces = []) {
  const workspacesById = new Map();
  workspaces.forEach((workspace) => {
    getIdLookupKeys(workspace.Id).forEach((key) => workspacesById.set(key, workspace));
  });
  return workspacesById;
}

function getMemberChildType(member = {}) {
  return String(member.ChildRecord?.attributes?.type || "").toLowerCase();
}

function isDocumentMember(member = {}) {
  const childType = getMemberChildType(member);
  return childType === "contentdocument" || String(member.ChildRecordId || "").startsWith("069");
}

function sortTreeNodes(nodes = []) {
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "document" ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildFolderTree() {
  const foldersById = new Map(documentState.folders.map((folder) => [folder.Id, folder]));
  const documentsById = new Map(documentState.documents.map((documentRecord) => [documentRecord.Id, documentRecord]));
  documentState.documentsById = documentsById;

  const foldersByParent = groupBy(documentState.folders, (folder) => folder.ParentContentFolderId || "");
  const membersByParent = groupBy(documentState.members, (member) => member.ParentContentFolderId || "");

  function createDocumentNode(documentRecord, sourceKey = "") {
    return createTreeNode({
      key: `document:${documentRecord.Id}:${sourceKey}`,
      kind: "document",
      name: getDocumentTitle(documentRecord),
      secondary: documentRecord.FileType || "",
      record: documentRecord
    });
  }

  function createFolderNode(folderId, visited = new Set()) {
    const folder = foldersById.get(folderId);
    if (!folder || visited.has(folderId)) {
      return null;
    }
    visited.add(folderId);

    const folderLoaded = documentState.loadedFolderIds.has(folderId);
    const folderLoading = documentState.loadingFolderIds.has(folderId);
    const folderChildren = (foldersByParent.get(folderId) || [])
      .map((childFolder) => createFolderNode(childFolder.Id, new Set(visited)))
      .filter(Boolean);
    const documentChildren = (membersByParent.get(folderId) || [])
      .filter(isDocumentMember)
      .map((member) => documentsById.get(member.ChildRecordId))
      .filter(Boolean)
      .sort((left, right) => getDocumentTitle(left).localeCompare(getDocumentTitle(right)))
      .map((documentRecord) => createDocumentNode(documentRecord, folderId));
    const children = sortTreeNodes([...folderChildren, ...documentChildren]);

    return createTreeNode({
      key: `folder:${folderId}`,
      kind: "folder",
      name: folder.DisplayName || folder.WorkspaceName || folder.Name || folderId,
      secondary: folderLoading ? "Loading..." : folderLoaded ? `${children.length} item${children.length === 1 ? "" : "s"}` : "Open to load",
      record: folder,
      children,
      lazy: !folderLoaded,
      loaded: folderLoaded,
      loading: folderLoading
    });
  }

  const workspaceFolderChildren = documentState.folders
    .filter((folder) => folder.IsWorkspaceRoot)
    .map((folder) => createFolderNode(folder.Id))
    .filter(Boolean);
  const workspaceFoldersNode = createTreeNode({
    key: "workspace-folders",
    kind: "folder",
    name: "Workspace Folders",
    secondary: documentState.workspaceFoldersLoading ? "Loading..." : documentState.workspaceFoldersLoaded ? `${workspaceFolderChildren.length} folder${workspaceFolderChildren.length === 1 ? "" : "s"}` : "Open to load",
    record: {
      Id: "workspace-folders",
      Name: "Workspace Folders"
    },
    children: sortTreeNodes(workspaceFolderChildren),
    lazy: !documentState.workspaceFoldersLoaded,
    loaded: documentState.workspaceFoldersLoaded,
    loading: documentState.workspaceFoldersLoading
  });

  const root = createTreeNode({
    key: "root",
    kind: "root",
    name: "Document Folders",
    secondary: `${documentsById.size} ContentDocument`,
    children: [workspaceFoldersNode]
  });
  documentState.tree = root;
  documentState.nodesByKey = indexTreeNode(root);
}

function nodeMatchesFilter(node, text) {
  if (!text) {
    return true;
  }
  const haystack = [
    node.name,
    node.secondary,
    node.record?.Id,
    node.record?.Title,
    node.record?.FileType
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(text);
}

function filterTreeNode(node, text) {
  const filteredChildren = (node.children || [])
    .map((child) => filterTreeNode(child, text))
    .filter(Boolean);
  if (nodeMatchesFilter(node, text) || filteredChildren.length) {
    return {
      ...node,
      children: filteredChildren
    };
  }
  return null;
}

function setTreeIndent(row, level = 0) {
  row.style.setProperty("--tree-indent", `${level}rem`);
}

function appendHighlightedText(parent, text = "", searchText = "") {
  const value = String(text || "");
  const needle = String(searchText || "").trim();
  if (!needle) {
    parent.textContent = value;
    return;
  }

  const lowerValue = value.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let offset = 0;
  let matchIndex = lowerValue.indexOf(lowerNeedle, offset);

  while (matchIndex >= 0) {
    if (matchIndex > offset) {
      parent.append(document.createTextNode(value.slice(offset, matchIndex)));
    }

    const mark = document.createElement("mark");
    mark.className = "schema-tree-match";
    mark.textContent = value.slice(matchIndex, matchIndex + needle.length);
    parent.append(mark);
    offset = matchIndex + needle.length;
    matchIndex = lowerValue.indexOf(lowerNeedle, offset);
  }

  if (offset < value.length) {
    parent.append(document.createTextNode(value.slice(offset)));
  }
}

function createTreeName(node) {
  const nameWrap = document.createElement("span");
  nameWrap.className = "schema-tree-name";

  const primary = document.createElement("span");
  primary.className = "schema-tree-primary";
  appendHighlightedText(primary, node.name, filterText);
  nameWrap.append(primary);

  if (node.secondary) {
    const secondary = document.createElement("span");
    secondary.className = "schema-tree-secondary";
    appendHighlightedText(secondary, node.secondary, filterText);
    nameWrap.append(secondary);
  }

  return nameWrap;
}

function getTreeMetaText(node) {
  if (node.kind === "document") {
    return formatBytes(node.record?.ContentSize);
  }
  if (node.loading) {
    return "...";
  }
  const childCount = (node.children || []).length;
  return childCount ? String(childCount) : "";
}

function createTreeMeta(node) {
  const meta = document.createElement("span");
  meta.className = "schema-tree-meta schema-tree-size-meta";
  meta.textContent = getTreeMetaText(node);
  return meta;
}

function createTreeRowCheckbox(node) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "document-tree-check";
  const selectionState = getDocumentFolderSelectionState(node);
  checkbox.checked = selectionState === "checked";
  checkbox.indeterminate = selectionState === "mixed";
  checkbox.disabled = selectionInProgress || zipDownloadInProgress;
  checkbox.setAttribute("aria-busy", String(selectionInProgress));
  checkbox.setAttribute("aria-label", `Select ${node.name || node.kind}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => void updateDocumentFolderSelection(node.key, checkbox.checked));
  return checkbox;
}

function createTreeRow(node, onActivate) {
  const row = document.createElement("div");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.addEventListener("click", onActivate);
  row.addEventListener("keydown", (event) => {
    if (event.target === row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onActivate();
    }
  });
  if (node.key !== "workspace-folders") {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showDocumentFolderContextMenu(node, event.clientX, event.clientY);
    });
  }
  return row;
}

function appendTreeRowContent(row, node, level, options = {}) {
  row.classList.toggle("selected", node.key === selectedKey);
  row.dataset.kind = node.kind;
  row.dataset.nodeKey = node.key;
  setTreeIndent(row, level);
  if (node.key !== "workspace-folders") {
    row.appendChild(createTreeRowCheckbox(node));
  } else {
    const spacer = document.createElement("span");
    spacer.className = "schema-tree-indent document-tree-selection-spacer";
    row.appendChild(spacer);
  }

  if (options.caret) {
    const caret = document.createElement("span");
    caret.className = "schema-tree-caret";
    row.appendChild(caret);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "schema-tree-indent";
    row.appendChild(spacer);
  }

  const icon = document.createElement("span");
  icon.className = `schema-tree-icon ${node.kind === "document" ? "file" : "folder"}`;
  row.appendChild(icon);
  row.appendChild(createTreeName(node));
  row.appendChild(createTreeMeta(node));
}

function createDocumentTreeRow(node, level) {
  const row = createTreeRow(node, () => selectNode(node.key));
  row.className = "schema-tree-row schema-tree-file-row document-tree-row";
  appendTreeRowContent(row, node, level);
  return row;
}

function renderSelectedNodeDetail(node) {
  if (selectedDocumentFolderItems.size) {
    renderSelectionDetail();
  } else if (node.kind === "document") {
    void renderDocumentDetail(node);
  } else {
    renderFolderDetail(node);
  }
  renderWarnings();
}

function handleFolderTreeRowClick(node, isOpen) {
  selectedKey = node.key;
  if (isOpen) {
    openDocumentFolderKeys.delete(node.key);
  } else {
    openDocumentFolderKeys.add(node.key);
  }
  renderTree();
  renderSelectedNodeDetail(node);
  if (!isOpen && node.lazy && !node.loaded) {
    void ensureNodeLoaded(node.key);
  }
}

function renderTreeNode(node, parent, level = 0) {
  const hasChildren = (node.children || []).length > 0;
  const canExpand = node.kind !== "document" && (hasChildren || node.lazy);
  if (canExpand) {
    const isOpen = Boolean(filterText) || openDocumentFolderKeys.has(node.key) || (!node.lazy && (level < 2 || node.key === selectedKey));
    const wrapper = document.createElement("div");
    wrapper.className = "schema-tree-folder schema-object document-tree-folder";
    wrapper.classList.toggle("open", isOpen);

    const row = createTreeRow(node, () => handleFolderTreeRowClick(node, isOpen));
    row.className = "schema-tree-row schema-tree-folder-row document-tree-row";
    appendTreeRowContent(row, node, level, { caret: true });
    wrapper.append(row);

    const children = document.createElement("div");
    children.className = "schema-tree-children";
    const shouldRenderChildren = isOpen || Boolean(filterText);
    if (shouldRenderChildren && node.loading) {
      const loading = document.createElement("div");
      loading.className = "schema-empty document-tree-message";
      loading.textContent = "Loading...";
      children.append(loading);
    } else if (shouldRenderChildren && node.lazy && !node.loaded && !hasChildren) {
      const hint = document.createElement("div");
      hint.className = "schema-empty document-tree-message";
      hint.textContent = "Open to load folders and files.";
      children.append(hint);
    } else if (shouldRenderChildren) {
      node.children.forEach((child) => renderTreeNode(child, children, level + 1));
    }
    wrapper.append(children);
    parent.append(wrapper);
    return;
  }

  parent.append(createDocumentTreeRow(node, level));
}

function getTreeNodeForSelection(key = "") {
  const directNode = documentState.nodesByKey.get(key);
  if (directNode) {
    return {
      key,
      node: directNode
    };
  }

  if (key.startsWith("document:")) {
    const documentId = key.split(":")[1] || "";
    const treeKey = [...documentState.nodesByKey.keys()].find((candidateKey) => candidateKey.startsWith(`document:${documentId}:`));
    if (treeKey) {
      return {
        key: treeKey,
        node: documentState.nodesByKey.get(treeKey)
      };
    }
    const documentRecord = documentState.documentsById.get(documentId);
    if (documentRecord) {
      return {
        key,
        node: createTreeNode({
          key,
          kind: "document",
          name: getDocumentTitle(documentRecord),
          record: documentRecord
        })
      };
    }
  }

  return {
    key: "",
    node: null
  };
}

function renderTree() {
  treeEl.textContent = "";
  if (!documentState.tree) {
    const empty = document.createElement("div");
    empty.className = "schema-empty";
    empty.textContent = "No document data loaded.";
    treeEl.append(empty);
    return;
  }

  const filteredTree = filterTreeNode(documentState.tree, filterText.toLowerCase());
  if (!filteredTree) {
    const empty = document.createElement("div");
    empty.className = "schema-empty";
    empty.textContent = "No matching folders or documents.";
    treeEl.append(empty);
    return;
  }

  filteredTree.children.forEach((child) => renderTreeNode(child, treeEl, 0));
}

function createActionLink(label, href) {
  const link = document.createElement("a");
  link.className = "button-link secondary";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = label;
  return link;
}

function createDocumentDownloadButton(documentRecord = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = "Download";
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Downloading…";
    setOperationStatus(`Downloading ${getDocumentTitle(documentRecord)}...`);
    try {
      const blob = await fetchDocumentPreviewBlob(documentRecord);
      downloadBlob(blob, getDocumentZipFileName(documentRecord));
      setOperationStatus(`Downloaded ${getDocumentZipFileName(documentRecord)}.`);
    } catch (error) {
      setOperationStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      button.disabled = false;
      button.textContent = "Download";
    }
  });
  return button;
}

function folderIdForNode(node = {}) {
  return node.record?.Id || (String(node.key || "").startsWith("folder:") ? String(node.key).split(":")[1] : "");
}

async function refreshMutatedFolder(node = {}) {
  const folderId = folderIdForNode(node);
  if (folderId) documentState.loadedFolderIds.delete(folderId);
  await loadDocumentData();
  await loadWorkspaceFolders();
  buildFolderTree();
  renderTree();
}

async function createChildFolder(node = {}) {
  const parentId = folderIdForNode(node);
  const name = window.prompt("New folder name", "New Folder")?.trim();
  if (!parentId || !name) return;
  await confirmOrgMutation({ host: session.host, operation: "Create document folder", target: `${node.name} / ${name}`, count: 1, risk: ORG_RISK.METADATA_MUTATION });
  await salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/sobjects/ContentFolder`, {
    method: "POST",
    body: JSON.stringify({ Name: name, ParentContentFolderId: parentId })
  });
  await recordOperation({ kind: "document-folder-create", status: "success", host: session.host, target: name });
  setOperationStatus(`Created folder ${name}.`);
  await refreshMutatedFolder(node);
}

async function renameFolder(node = {}) {
  const folderId = folderIdForNode(node);
  const name = window.prompt("Rename folder", node.name || "")?.trim();
  if (!folderId || !name || name === node.name) return;
  await confirmOrgMutation({ host: session.host, operation: "Rename document folder", target: `${node.name} → ${name}`, count: 1, risk: ORG_RISK.METADATA_MUTATION });
  await salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/sobjects/ContentFolder/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    body: JSON.stringify({ Name: name })
  });
  await recordOperation({ kind: "document-folder-rename", status: "success", host: session.host, target: name });
  setOperationStatus(`Renamed folder to ${name}.`);
  await refreshMutatedFolder(node);
}

async function uploadFileToFolder(folderId, file, title = file.name) {
  const form = new FormData();
  form.append("json", new Blob([JSON.stringify({ title })], { type: "application/json" }));
  form.append("fileData", file, file.name);
  const response = await fetch(`https://${session.host}/services/data/${SALESFORCE_API_VERSION}/connect/folders/${encodeURIComponent(folderId)}/items?type=File`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.sid}` },
    body: form
  });
  if (!response.ok) throw new Error(await response.text().catch(() => "") || `Upload failed: HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function createContentFolderRecord(parentId, name) {
  const result = await salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/sobjects/ContentFolder`, {
    method: "POST",
    body: JSON.stringify({ Name: name, ParentContentFolderId: parentId })
  });
  const id = result?.id || result?.Id;
  if (!id) throw new Error(`Salesforce did not return an ID for folder ${name}.`);
  return id;
}

async function chooseAndUploadFiles(node = {}, directory = false) {
  const folderId = folderIdForNode(node);
  if (!folderId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (directory) input.webkitdirectory = true;
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    if (!files.length) return;
    try {
      await confirmOrgMutation({ host: session.host, operation: directory ? "Upload document folder" : "Upload document files", target: node.name, count: files.length, risk: ORG_RISK.DATA_MUTATION });
      const failures = [];
      const folderIdsByPath = new Map([["", folderId]]);
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const relativeParts = directory && file.webkitRelativePath ? file.webkitRelativePath.split("/").filter(Boolean) : [];
        const title = file.name;
        setOperationStatus(`Uploading ${index + 1}/${files.length}: ${title}...`);
        try {
          let uploadFolderId = folderId;
          if (relativeParts.length > 1) {
            const folderParts = relativeParts.slice(0, -1);
            let pathKey = "";
            for (const part of folderParts) {
              const nextPathKey = pathKey ? `${pathKey}/${part}` : part;
              if (!folderIdsByPath.has(nextPathKey)) {
                folderIdsByPath.set(nextPathKey, await createContentFolderRecord(folderIdsByPath.get(pathKey) || folderId, part));
              }
              uploadFolderId = folderIdsByPath.get(nextPathKey);
              pathKey = nextPathKey;
            }
          }
          await uploadFileToFolder(uploadFolderId, file, title);
        }
        catch (error) { failures.push(`${title}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      await recordOperation({ kind: "document-folder-upload", status: failures.length ? "partial" : "success", host: session.host, target: node.name, count: files.length - failures.length, failures });
      setOperationStatus(`Uploaded ${files.length - failures.length}/${files.length} files.${failures.length ? ` ${failures[0]}` : ""}`, failures.length > 0);
      await refreshMutatedFolder(node);
    } catch (error) {
      setOperationStatus(error instanceof Error ? error.message : String(error), true);
    }
  }, { once: true });
  input.click();
}

function showDocumentFolderContextMenu(node = {}, x = 0, y = 0) {
  document.querySelector(".document-folder-context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "fs-ws-menu document-folder-context-menu";
  menu.setAttribute("role", "menu");
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10000`;
  const items = node.kind === "document"
    ? [
        ["Open in Salesforce", () => window.open(getDocumentOpenUrl(node.record?.Id), "_blank", "noopener")],
        ["Download", () => createDocumentDownloadButton(node.record).click()]
      ]
    : [
        ["Download", () => downloadFolderItemsAsZip(node, "entire")],
        ["Create Folder", () => createChildFolder(node)],
        ["Rename", () => renameFolder(node)],
        ["Upload Files", () => chooseAndUploadFiles(node, false)],
        ["Upload Folder", () => chooseAndUploadFiles(node, true)]
      ];
  items.forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fs-ws-menu-item";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      menu.remove();
      void Promise.resolve(action()).catch((error) => setOperationStatus(error instanceof Error ? error.message : String(error), true));
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  menu.querySelector("button")?.focus();
  const close = (event) => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", close, true));
}

function appendDetailHeading(title, subtitle = "", kind = "folder", actions = []) {
  const header = document.createElement("div");
  header.className = "schema-detail-head document-detail-heading";
  const icon = document.createElement("span");
  icon.className = `schema-tree-icon ${kind === "document" ? "file" : "folder"}`;
  header.append(icon);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "secondary document-detail-back";
  backButton.textContent = "Back to folders";
  backButton.addEventListener("click", () => documentFoldersWorkbenchEl?.classList.remove("detail-open"));
  header.prepend(backButton);

  const titleWrap = document.createElement("div");
  titleWrap.className = "schema-detail-title";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  titleWrap.append(h2);
  if (subtitle) {
    const p = document.createElement("p");
    p.textContent = subtitle;
    titleWrap.append(p);
  }
  header.append(titleWrap);
  if (actions.length) {
    const actionRow = document.createElement("div");
    actionRow.className = "schema-detail-actions";
    actions.forEach((action) => actionRow.append(action));
    header.append(actionRow);
  } else {
    header.append(document.createElement("div"));
  }
  detailEl.append(header);
}

function appendKv(rows = []) {
  const dl = document.createElement("dl");
  dl.className = "kv document-detail-kv";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value === undefined || value === null || value === "" ? "N/A" : String(value);
    dl.append(dt, dd);
  });
  detailEl.append(dl);
}

async function fetchDocumentPreviewBlob(documentRecord = {}, signal) {
  const response = await fetch(getDocumentDownloadUrl(documentRecord), {
    signal,
    headers: {
      Authorization: `Bearer ${session.sid}`
    }
  });
  if (!response.ok) {
    const reason = response.status === 401 ? "Session expired"
      : response.status === 403 ? "Permission denied"
        : response.status === 404 ? "File version was deleted or is unavailable"
          : `HTTP ${response.status}`;
    throw new Error(`${getDocumentTitle(documentRecord)} preview failed: ${reason}.`);
  }
  return response.blob();
}

function renderUnsupportedPreview(documentRecord = {}, previewBody) {
  previewBody.textContent = "";
  const message = document.createElement("p");
  message.className = "schema-empty";
  message.textContent = "Preview is not available for this file type.";
  previewBody.append(
    message,
    createActionLink("Open", getDocumentOpenUrl(documentRecord.Id)),
    createDocumentDownloadButton(documentRecord)
  );
}

async function loadDocumentPreview(documentRecord = {}, previewBody) {
  const kind = getPreviewKind(documentRecord);
  if (!kind) {
    renderUnsupportedPreview(documentRecord, previewBody);
    return;
  }

  previewBody.textContent = "Loading preview...";
  previewBody.classList.add("loading");
  previewBody.classList.remove("error");
  try {
    const controller = new AbortController();
    activePreviewControllers.add(controller);
    const blob = await fetchDocumentPreviewBlob(documentRecord, controller.signal);
    activePreviewControllers.delete(controller);
    if (!document.body.contains(previewBody)) {
      return;
    }
    previewBody.classList.remove("loading");
    previewBody.textContent = "";

    if (kind === "text") {
      const pre = document.createElement("pre");
      pre.className = "document-text-preview";
      pre.textContent = await blob.text();
      previewBody.append(pre);
      return;
    }

    const url = createTrackedObjectUrl(blob);
    if (kind === "image") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = getDocumentTitle(documentRecord);
      previewBody.append(image);
      return;
    }

    if (kind === "pdf") {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.title = `${getDocumentTitle(documentRecord)} preview`;
      previewBody.append(iframe);
      return;
    }

    if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      previewBody.append(audio);
      return;
    }

    if (kind === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.src = url;
      previewBody.append(video);
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    const message = error instanceof Error ? error.message : String(error);
    previewBody.classList.remove("loading");
    previewBody.textContent = formatUserFacingMessage(message);
    previewBody.classList.add("error");
  }
}

function appendDocumentPreview(documentRecord = {}, options = {}) {
  const panel = document.createElement("section");
  panel.className = "document-preview-panel";

  const head = document.createElement("div");
  head.className = "document-preview-head";
  const title = document.createElement(options.headingLevel === 3 ? "h3" : "h2");
  title.textContent = options.title || "Preview";
  head.append(title);

  const previewBody = document.createElement("div");
  previewBody.className = "document-preview-body";
  panel.append(head, previewBody);

  if (getPreviewKind(documentRecord)) {
    if (Number(documentRecord.ContentSize || 0) > DOCUMENT_PREVIEW_AUTO_LIMIT_BYTES) {
      const message = document.createElement("p");
      message.className = "schema-empty";
      message.textContent = `${formatBytes(documentRecord.ContentSize)} file — load preview on demand.`;
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "secondary";
      loadButton.textContent = "Load preview";
      loadButton.addEventListener("click", () => void loadDocumentPreview(documentRecord, previewBody));
      previewBody.append(message, loadButton);
    } else {
      void loadDocumentPreview(documentRecord, previewBody);
    }
  } else {
    renderUnsupportedPreview(documentRecord, previewBody);
  }

  detailEl.append(panel);
}

function appendFolderFilePreviews(node = {}) {
  const documents = getNodeDocuments(node);
  if (!documents.length) {
    return;
  }

  const section = document.createElement("section");
  section.className = "document-folder-preview-section";
  const title = document.createElement("h3");
  title.textContent = "File Previews";
  section.append(title);

  const grid = document.createElement("div");
  grid.className = "document-folder-preview-grid";
  documents.forEach((documentRecord) => {
    const card = document.createElement("article");
    card.className = "document-folder-preview-card";
    const cardHead = document.createElement("div");
    cardHead.className = "document-folder-preview-card-head";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "document-folder-preview-name";
    name.textContent = getDocumentTitle(documentRecord);
    name.addEventListener("click", () => selectNode(`document:${documentRecord.Id}`));
    const meta = document.createElement("span");
    meta.textContent = [documentRecord.FileType, formatBytes(documentRecord.ContentSize)].filter(Boolean).join(" · ");
    cardHead.append(name, meta);

    const previewBody = document.createElement("div");
    previewBody.className = "document-preview-body compact";
    card.append(cardHead);
    if (getPreviewKind(documentRecord)) {
      void loadDocumentPreview(documentRecord, previewBody);
    } else {
      renderUnsupportedPreview(documentRecord, previewBody);
    }
    card.append(previewBody);
    grid.append(card);
  });

  section.append(grid);
  detailEl.append(section);
}

function getNodeDocuments(node = {}) {
  return (node.children || [])
    .filter((child) => child.kind === "document")
    .map((child) => child.record)
    .filter(Boolean);
}

function getSelectableChildNodes(node = {}) {
  return (node.children || []).filter((child) => child.kind === "folder" || child.kind === "document");
}

function getSelectedDownloadNodes(node = {}) {
  const selectedNodes = [];

  function visit(parentNode = {}) {
    getSelectableChildNodes(parentNode).forEach((child) => {
      if (isDocumentFolderItemSelected(child)) {
        selectedNodes.push(child);
        return;
      }
      visit(child);
    });
  }

  visit(node);
  return selectedNodes;
}

function getDocumentFolderSelectionKey(node = {}) {
  return node.key || "";
}

function isDocumentFolderItemSelected(node = {}) {
  return getDocumentFolderSelectionState(node) === "checked";
}

function hasSelectedDescendant(node = {}) {
  return getDocumentFolderSelectionState(node) === "mixed";
}

function getDocumentFolderSelectionState(node = {}) {
  const key = getDocumentFolderSelectionKey(node);
  if (!key || node.key === "workspace-folders") {
    return "unchecked";
  }
  if (node.kind === "document") {
    return selectedDocumentFolderItems.has(key) ? "checked" : "unchecked";
  }

  const selectableChildren = getSelectableChildNodes(node);
  if (!selectableChildren.length) {
    return selectedDocumentFolderItems.has(key) ? "checked" : "unchecked";
  }
  const childStates = selectableChildren.map(getDocumentFolderSelectionState);
  if (childStates.every((state) => state === "checked")) {
    return "checked";
  }
  if (selectedDocumentFolderItems.has(key) || childStates.some((state) => state !== "unchecked")) {
    return "mixed";
  }
  return "unchecked";
}

function collectSelectableSubtreeKeys(node = {}, keys = []) {
  if ((node.kind === "folder" || node.kind === "document") && node.key !== "workspace-folders") {
    keys.push(getDocumentFolderSelectionKey(node));
  }
  getSelectableChildNodes(node).forEach((child) => collectSelectableSubtreeKeys(child, keys));
  return keys.filter(Boolean);
}

function subtreeContainsKey(node = {}, targetKey = "") {
  return node.key === targetKey || getSelectableChildNodes(node).some((child) => subtreeContainsKey(child, targetKey));
}

function removeSelectedAncestorKeys(node = {}, targetKey = "") {
  getSelectableChildNodes(node).forEach((child) => {
    if (child.kind === "folder" && subtreeContainsKey(child, targetKey)) {
      selectedDocumentFolderItems.delete(getDocumentFolderSelectionKey(child));
      removeSelectedAncestorKeys(child, targetKey);
    }
  });
}

function synchronizeDerivedFolderSelection(node = {}) {
  getSelectableChildNodes(node).forEach((child) => synchronizeDerivedFolderSelection(child));
  if (node.kind !== "folder" || node.key === "workspace-folders") {
    return;
  }
  const children = getSelectableChildNodes(node);
  if (!children.length) {
    return;
  }
  const key = getDocumentFolderSelectionKey(node);
  if (children.every((child) => getDocumentFolderSelectionState(child) === "checked")) {
    selectedDocumentFolderItems.add(key);
  } else {
    selectedDocumentFolderItems.delete(key);
  }
}

async function updateDocumentFolderSelection(nodeKey = "", shouldSelect = false) {
  if (selectionInProgress || zipDownloadInProgress || nodeKey === "workspace-folders") {
    renderTree();
    return;
  }

  const operationId = ++selectionOperationId;
  const previousSelection = new Set(selectedDocumentFolderItems);
  selectionInProgress = true;
  refreshButton.disabled = true;
  renderTree();
  rerenderCurrentDetail();

  try {
    let node = documentState.nodesByKey.get(nodeKey);
    if (!node) {
      throw new Error("The selected folder or file is no longer available. Refresh and try again.");
    }
    setOperationStatus(`${shouldSelect ? "Selecting" : "Clearing"} ${node.name || "item"}...`);
    if (shouldSelect && node.kind === "folder") {
      node = await ensureFolderSubtreeLoaded(node);
    }
    if (operationId !== selectionOperationId) {
      return;
    }

    const keys = collectSelectableSubtreeKeys(node);
    if (shouldSelect) {
      keys.forEach((key) => selectedDocumentFolderItems.add(key));
    } else {
      keys.forEach((key) => selectedDocumentFolderItems.delete(key));
      removeSelectedAncestorKeys(documentState.tree, node.key);
    }
    synchronizeDerivedFolderSelection(documentState.tree);
    setOperationStatus(`${shouldSelect ? "Selected" : "Cleared"} ${node.name || "item"}.`);
  } catch (error) {
    if (operationId === selectionOperationId) {
      selectedDocumentFolderItems.clear();
      previousSelection.forEach((key) => selectedDocumentFolderItems.add(key));
      setOperationStatus(error instanceof Error ? error.message : String(error), true);
    }
  } finally {
    if (operationId === selectionOperationId) {
      selectionInProgress = false;
      refreshButton.disabled = false;
      renderTree();
      rerenderCurrentDetail();
    }
  }
}

function rerenderCurrentDetail() {
  const node = getTreeNodeForSelection(selectedKey).node;
  if (node) {
    renderSelectedNodeDetail(node);
  } else if (selectedDocumentFolderItems.size) {
    renderSelectionDetail();
  }
}

function getSelectedItemNodes() {
  return [...selectedDocumentFolderItems]
    .map((key) => getTreeNodeForSelection(key).node)
    .filter(Boolean);
}

function renderSelectionDetail() {
  clearDetail();
  const nodes = getSelectedItemNodes();
  const documents = nodes.filter((node) => node.kind === "document");
  const folders = nodes.filter((node) => node.kind !== "document");
  const uniqueDocumentCount = new Set(documents.map((node) => node.record?.Id).filter(Boolean)).size;
  const knownBytes = documents.reduce((sum, node) => sum + Number(node.record?.ContentSize || 0), 0);
  const summaryParts = [
    folders.length ? `${folders.length} folder${folders.length === 1 ? "" : "s"}` : "",
    documents.length ? `${documents.length} file${documents.length === 1 ? "" : "s"}` : "",
    documents.length !== uniqueDocumentCount ? `${uniqueDocumentCount} unique document${uniqueDocumentCount === 1 ? "" : "s"}` : "",
    knownBytes ? formatBytes(knownBytes) : ""
  ].filter(Boolean);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "secondary";
  clearButton.textContent = "Clear Selection";
  clearButton.disabled = zipDownloadInProgress || selectionInProgress;
  clearButton.addEventListener("click", () => {
    selectedDocumentFolderItems.clear();
    renderTree();
    rerenderCurrentDetail();
  });

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = zipDownloadInProgress ? "Downloading…" : "Download";
  downloadButton.disabled = zipDownloadInProgress || selectionInProgress || !nodes.length;
  downloadButton.addEventListener("click", () => {
    void downloadFolderItemsAsZip(documentState.tree, "selected");
  });

  appendDetailHeading("Selected Items", summaryParts.join(" · "), "folder", [clearButton, downloadButton]);

  if (zipDownloadInProgress) {
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = "Cancel Download";
    cancelButton.addEventListener("click", () => activeZipController?.abort());
    detailEl.querySelector(".schema-detail-actions")?.append(cancelButton);
  }

  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "schema-empty";
    empty.textContent = "No selected folders or files.";
    detailEl.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "schema-tree schema-tree-full document-folder-selected-list";
  nodes.forEach((node) => {
    const row = document.createElement("div");
    row.className = "schema-tree-row document-folder-selected-row";
    row.dataset.kind = node.kind;

    const icon = document.createElement("span");
    icon.className = `schema-tree-icon ${node.kind === "document" ? "file" : "folder"}`;

    const name = document.createElement("span");
    name.className = "schema-tree-name";
    const primary = document.createElement("span");
    primary.className = "schema-tree-primary";
    primary.textContent = node.name || node.kind || "item";
    name.append(primary);

    const meta = document.createElement("span");
    meta.className = "schema-tree-meta schema-tree-size-meta";
    meta.textContent = node.kind === "document"
      ? [node.record?.FileType, formatBytes(node.record?.ContentSize)].filter(Boolean).join(" · ")
      : "Folder";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "document-folder-selected-remove";
    removeButton.textContent = "×";
    removeButton.title = `Remove ${node.name || "item"} from selection`;
    removeButton.setAttribute("aria-label", removeButton.title);
    removeButton.disabled = zipDownloadInProgress || selectionInProgress;
    removeButton.addEventListener("click", () => void updateDocumentFolderSelection(node.key, false));

    row.append(icon, name, meta, removeButton);
    list.append(row);
  });
  detailEl.append(list);
}

async function ensureFolderSubtreeLoaded(node = {}, visitedFolderIds = new Set()) {
  if (node.key === "workspace-folders") {
    throw new Error("Workspace Folders is a navigation root and cannot be selected.");
  }

  if (node.kind !== "folder") {
    return node;
  }

  const folderId = node.record?.Id || String(node.key || "").split(":")[1] || "";
  if (!folderId || visitedFolderIds.has(folderId)) {
    return documentState.nodesByKey.get(node.key) || node;
  }
  visitedFolderIds.add(folderId);

  const currentNode = documentState.nodesByKey.get(node.key) || node;
  if (currentNode.lazy && !currentNode.loaded) {
    await loadFolderChildren(folderId);
  }

  const loadedNode = documentState.nodesByKey.get(node.key) || currentNode;
  if (!loadedNode.loaded) {
    throw new Error(`Could not load the complete subtree for ${loadedNode.name || folderId}. Selection was not changed.`);
  }
  for (const child of loadedNode.children || []) {
    if (child.kind === "folder") {
      await ensureFolderSubtreeLoaded(child, visitedFolderIds);
    }
  }
  return documentState.nodesByKey.get(node.key) || loadedNode;
}

async function collectDocumentZipCandidates(node = {}, prefix = "", candidates = [], visitedFolderIds = new Set()) {
  if (node.kind === "document") {
    const documentRecord = node.record || documentState.documentsById.get(String(node.key || "").split(":")[1]);
    if (documentRecord?.Id) {
      candidates.push({
        documentRecord,
        path: `${prefix}${getDocumentZipFileName(documentRecord)}`
      });
    }
    return candidates;
  }

  const loadedNode = await ensureFolderSubtreeLoaded(node, visitedFolderIds);
  for (const child of loadedNode.children || []) {
    if (child.kind === "folder") {
      await collectDocumentZipCandidates(
        child,
        `${prefix}${sanitizeZipPathPart(child.name, child.record?.Id || "folder")}/`,
        candidates,
        visitedFolderIds
      );
    } else if (child.kind === "document") {
      await collectDocumentZipCandidates(child, prefix, candidates, visitedFolderIds);
    }
  }
  return candidates;
}

function findTreeNodePath(node = {}, targetKey = "", path = []) {
  const nextPath = [...path, node];
  if (node.key === targetKey) return nextPath;
  for (const child of getSelectableChildNodes(node)) {
    const match = findTreeNodePath(child, targetKey, nextPath);
    if (match.length) return match;
  }
  return [];
}

function getDocumentNodeZipPrefix(contextNode = {}, targetNode = {}) {
  const path = findTreeNodePath(contextNode, targetNode.key);
  return path
    .filter((node) => node.kind === "folder" && node.key !== "workspace-folders")
    .map((node) => `${sanitizeZipPathPart(node.name, node.record?.Id || "folder")}/`)
    .join("");
}

async function collectSelectedDocumentZipCandidates(contextNode = {}) {
  const selectedChildren = getSelectedDownloadNodes(contextNode);
  const candidates = [];
  const visitedFolderIds = new Set();
  for (const child of selectedChildren) {
    const prefix = getDocumentNodeZipPrefix(contextNode, child);
    await collectDocumentZipCandidates(child, prefix, candidates, visitedFolderIds);
  }

  const usedPaths = new Set();
  const uniqueByPath = [];
  candidates.forEach((candidate) => {
    uniqueByPath.push({
      ...candidate,
      path: getUniqueZipPath(candidate.path, usedPaths)
    });
  });
  return uniqueByPath;
}

let zipCrc32Table = null;

function getZipCrc32Table() {
  if (zipCrc32Table) {
    return zipCrc32Table;
  }

  zipCrc32Table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    zipCrc32Table[index] = value >>> 0;
  }
  return zipCrc32Table;
}

function crc32Uint8(data) {
  const table = getZipCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getZipDosDateTime(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZipBlob(entries = []) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.path);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
    if (data.byteLength > 0xffffffff) {
      throw new Error(`${entry.path} is too large for ZIP download.`);
    }
    const crc = crc32Uint8(data);
    const { time, date } = getZipDosDateTime(entry.lastModified);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + data.byteLength;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endHeader], { type: "application/zip" });
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

async function fetchDocumentZipEntry(candidate = {}, signal, contentCache = new Map()) {
  const documentId = candidate.documentRecord?.Id || candidate.path;
  if (!contentCache.has(documentId)) contentCache.set(documentId, (async () => {
    const response = await fetch(getDocumentDownloadUrl(candidate.documentRecord), {
    headers: {
      Authorization: `Bearer ${session.sid}`
    },
    signal
    });
    if (!response.ok) {
      throw new Error(`${getDocumentTitle(candidate.documentRecord)} download failed: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  })());
  return {
    path: candidate.path,
    data: await contentCache.get(documentId),
    lastModified: new Date(candidate.documentRecord.LastModifiedDate || Date.now())
  };
}

function validateDocumentZipCandidates(candidates = []) {
  const totalKnownBytes = candidates.reduce((sum, candidate) => sum + Number(candidate.documentRecord?.ContentSize || 0), 0);
  const hasUnknownSizes = candidates.some((candidate) => !Number(candidate.documentRecord?.ContentSize));
  if (candidates.length > DOCUMENT_ZIP_MAX_FILES) {
    throw new Error(`ZIP download is limited to ${DOCUMENT_ZIP_MAX_FILES} file occurrences. Narrow the selection and try again.`);
  }
  if (totalKnownBytes > DOCUMENT_ZIP_MAX_BYTES) {
    throw new Error(`ZIP download is limited to ${formatBytes(DOCUMENT_ZIP_MAX_BYTES)} of known content. Narrow the selection and try again.`);
  }
  return { totalKnownBytes, hasUnknownSizes };
}

async function downloadFolderItemsAsZip(contextNode = {}, scope = "selected") {
  if (zipDownloadInProgress) {
    return;
  }

  try {
    zipDownloadInProgress = true;
    activeZipController = new AbortController();
    rerenderCurrentDetail();
    setOperationStatus("Preparing ZIP download...");
    const candidates = scope === "entire"
      ? await collectDocumentZipCandidates(contextNode)
      : await collectSelectedDocumentZipCandidates(contextNode);
    if (!candidates.length) {
      setOperationStatus("No selected documents to download.", true);
      return;
    }

    const { totalKnownBytes, hasUnknownSizes } = validateDocumentZipCandidates(candidates);
    if ((hasUnknownSizes || totalKnownBytes > DOCUMENT_ZIP_WARN_BYTES) && !window.confirm(
      `Prepare ZIP with ${candidates.length} files (${hasUnknownSizes ? "size partly unknown" : formatBytes(totalKnownBytes)})?`
    )) return;

    const entries = [];
    const failures = [];
    const contentCache = new Map();
    for (let index = 0; index < candidates.length; index += 1) {
      setOperationStatus(`Downloading ${index + 1}/${candidates.length}: ${getDocumentTitle(candidates[index].documentRecord)}...`);
      try {
        entries.push(await fetchDocumentZipEntry(candidates[index], activeZipController.signal, contentCache));
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!entries.length) throw new Error(failures[0] || "No documents could be downloaded.");

    const zipBlob = createZipBlob(entries);
    const baseName = sanitizeZipPathPart(contextNode.name || "document-folders", "document-folders");
    downloadBlob(zipBlob, `${baseName}.zip`);
    setOperationStatus(`Downloaded ${entries.length} document${entries.length === 1 ? "" : "s"} as ZIP.${failures.length ? ` ${failures.length} failed: ${failures[0]}` : ""}`, failures.length > 0);
    return { entries: entries.length, failures };
  } catch (error) {
    const message = error?.name === "AbortError" ? "ZIP download canceled." : error instanceof Error ? error.message : String(error);
    setOperationStatus(message, true);
    return { entries: 0, failures: [message] };
  } finally {
    activeZipController = null;
    zipDownloadInProgress = false;
    rerenderCurrentDetail();
  }
}

function renderFolderDetail(node) {
  clearDetail();
  appendDetailHeading(node.name, node.secondary || "", node.kind);
  if (node.lazy && !node.loaded) {
    const hint = document.createElement("p");
    hint.className = "schema-empty";
    hint.textContent = "Open this folder to load its folders and files.";
    detailEl.append(hint);
    return;
  }
  appendFolderFilePreviews(node);
}

async function renderDocumentDetail(node) {
  const documentRecord = node.record || documentState.documentsById.get(String(node.key).split(":")[1]);
  if (!documentRecord) {
    return;
  }

  clearDetail();
  appendDetailHeading(getDocumentTitle(documentRecord), [documentRecord.FileType, formatBytes(documentRecord.ContentSize)].filter(Boolean).join(" · "), "document");
  const actions = document.createElement("div");
  actions.className = "button-row document-detail-actions";
  actions.append(
    createActionLink("Open", getDocumentOpenUrl(documentRecord.Id)),
    createDocumentDownloadButton(documentRecord)
  );
  detailEl.append(actions);
  appendKv([
    ["ContentDocument Id", documentRecord.Id],
    ["Latest Version", documentRecord.LatestPublishedVersionId],
    ["Last Modified", normalizeDate(documentRecord.LastModifiedDate)]
  ]);
  appendDocumentPreview(documentRecord);
}

function renderWarnings() {
  if (!documentState.warnings.length) {
    return;
  }
  const warning = document.createElement("p");
  warning.className = "schema-status error document-warning";
  warning.textContent = `Warnings: ${documentState.warnings.slice(0, 3).join(" ")}`;
  detailEl.append(warning);
}

function selectNode(key) {
  const normalizedKey = String(key || "");
  const { key: treeKey, node } = getTreeNodeForSelection(normalizedKey);
  if (!node) {
    return;
  }

  selectedKey = treeKey;
  documentFoldersWorkbenchEl?.classList.add("detail-open");
  renderTree();
  renderSelectedNodeDetail(node);
}

async function loadContentWorkspaces() {
  return queryOptional("SELECT Id, Name, RootContentFolderId FROM ContentWorkspace ORDER BY Name", "ContentWorkspace");
}

async function loadWorkspaceContentFolders(workspaces = []) {
  const rootFolderIds = workspaces
    .map((workspace) => workspace.RootContentFolderId)
    .filter(Boolean);
  const rootFolders = await loadContentFolders(rootFolderIds);
  const loadedRootFolderIds = new Set(rootFolders.map((folder) => folder.Id).filter(Boolean));
  const fallbackWorkspaceIds = workspaces
    .filter((workspace) => !workspace.RootContentFolderId || !loadedRootFolderIds.has(workspace.RootContentFolderId))
    .map((workspace) => workspace.Id)
    .flatMap(getIdLookupKeys);
  const fallbackFolders = await queryByIds(
    "SELECT Id, Name, ParentContentFolderId FROM ContentFolder",
    "Name",
    fallbackWorkspaceIds,
    "ContentFolder by workspace"
  );
  return mergeRecords([], [...rootFolders, ...fallbackFolders], (folder) => folder.Id);
}

async function loadContentFoldersByParent(parentFolderId = "") {
  if (!parentFolderId) {
    return [];
  }
  return queryOptional(
    `SELECT Id, Name, ParentContentFolderId FROM ContentFolder WHERE ParentContentFolderId = '${escapeSoqlString(parentFolderId)}'`,
    "ContentFolder children"
  );
}

async function loadContentFolders(folderIds = []) {
  return queryByIds(
    "SELECT Id, Name, ParentContentFolderId FROM ContentFolder",
    "Id",
    folderIds,
    "ContentFolder"
  );
}

async function loadContentFoldersByName(searchText = "") {
  const text = String(searchText || "").trim();
  if (!text) {
    return [];
  }
  return queryOptional(
    `SELECT Id, Name, ParentContentFolderId FROM ContentFolder WHERE Name LIKE '%${escapeSoqlString(text)}%' ORDER BY Name LIMIT 200`,
    "ContentFolder find"
  );
}

async function loadContentFolderMembersByParent(parentFolderId = "") {
  if (!parentFolderId) {
    return [];
  }
  return queryOptional(
    `SELECT Id, ParentContentFolderId, ChildRecordId FROM ContentFolderMember WHERE ParentContentFolderId = '${escapeSoqlString(parentFolderId)}'`,
    "ContentFolderMember"
  );
}

async function loadContentFolderMembersByChildIds(childRecordIds = []) {
  return queryBySingleIds(
    "SELECT Id, ParentContentFolderId, ChildRecordId FROM ContentFolderMember",
    "ChildRecordId",
    childRecordIds,
    "ContentFolderMember by child"
  );
}

async function loadContentDocuments(documentIds = []) {
  return queryByIds(
    "SELECT Id, Title, FileType, ContentSize, LatestPublishedVersionId, LastModifiedDate FROM ContentDocument",
    "Id",
    documentIds,
    "ContentDocument"
  );
}

async function loadContentDocumentsByTitle(searchText = "") {
  const text = String(searchText || "").trim();
  if (!text) {
    return [];
  }
  return queryOptional(
    `SELECT Id, Title, FileType, ContentSize, LatestPublishedVersionId, LastModifiedDate FROM ContentDocument WHERE Title LIKE '%${escapeSoqlString(text)}%' ORDER BY LastModifiedDate DESC LIMIT 200`,
    "ContentDocument find"
  );
}

async function loadFolderAncestors(folderIds = []) {
  let currentIds = [...new Set(folderIds.filter(Boolean))];
  const visitedIds = new Set();

  for (let depth = 0; currentIds.length && depth < 12; depth += 1) {
    const existingById = new Map(documentState.folders.map((folder) => [folder.Id, folder]));
    const knownFolders = currentIds.map((folderId) => existingById.get(folderId)).filter(Boolean);
    const missingIds = currentIds.filter((folderId) => !existingById.has(folderId) && !visitedIds.has(folderId));
    const fetchedFolders = await loadContentFolders(missingIds);
    const folders = [...knownFolders, ...fetchedFolders];
    fetchedFolders.forEach((folder) => visitedIds.add(folder.Id));
    knownFolders.forEach((folder) => visitedIds.add(folder.Id));
    if (fetchedFolders.length) {
      mergeFolderRecords(fetchedFolders);
    }
    currentIds = folders
      .map((folder) => folder.ParentContentFolderId)
      .filter((folderId) => folderId && !visitedIds.has(folderId));
  }
}

async function loadWorkspaceFolders() {
  if (documentState.workspaceFoldersLoaded) {
    return;
  }
  if (workspaceFoldersLoadPromise) {
    await workspaceFoldersLoadPromise;
    return;
  }

  workspaceFoldersLoadPromise = (async () => {
    documentState.workspaceFoldersLoading = true;
    buildFolderTree();
    renderTree();
    setOperationStatus("Loading workspace folders...");

    try {
      const workspaces = await loadContentWorkspaces();
      const workspacesById = mapWorkspacesByIdForms(workspaces);
      const workspacesByRootFolderId = new Map(workspaces
        .filter((workspace) => workspace.RootContentFolderId)
        .map((workspace) => [workspace.RootContentFolderId, workspace]));
      const workspaceFolders = await loadWorkspaceContentFolders(workspaces);
      const rootFolders = workspaceFolders.map((folder) => {
        const workspace = workspacesByRootFolderId.get(folder.Id) || workspacesById.get(folder.Name);
        return {
          ...folder,
          DisplayName: workspace?.Name || folder.Name,
          WorkspaceId: workspace?.Id || folder.Name,
          WorkspaceName: workspace?.Name || folder.Name,
          IsWorkspaceRoot: true
        };
      });

      documentState.workspaces = workspaces;
      mergeFolderRecords(rootFolders);
      documentState.workspaceFoldersLoaded = true;
      buildFolderTree();
      renderTree();
      setConnectedStatus();
      setOperationStatus(`Loaded ${rootFolders.length} workspace folders.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      documentState.warnings.push(`Workspace folders: ${formatUserFacingMessage(message)}`);
      setConnectedStatus();
      setOperationStatus(message, true);
    } finally {
      documentState.workspaceFoldersLoading = false;
      workspaceFoldersLoadPromise = null;
      buildFolderTree();
      renderTree();
    }
  })();

  await workspaceFoldersLoadPromise;
}

async function loadFolderChildren(folderId = "") {
  if (!folderId || documentState.loadedFolderIds.has(folderId) || documentState.loadingFolderIds.has(folderId)) {
    return;
  }

  const parentFolder = documentState.folders.find((folder) => folder.Id === folderId) || {};
  documentState.loadingFolderIds.add(folderId);
  buildFolderTree();
  renderTree();
  setOperationStatus(`Loading ${parentFolder.DisplayName || parentFolder.Name || folderId}...`);

  try {
    const [childFolders, members] = await Promise.all([
      loadContentFoldersByParent(folderId),
      loadContentFolderMembersByParent(folderId)
    ]);
    const documentIds = members
      .filter(isDocumentMember)
      .map((member) => member.ChildRecordId);
    const documents = await loadContentDocuments(documentIds);
    const normalizedChildFolders = childFolders.map((folder) => ({
      ...folder,
      WorkspaceId: parentFolder.WorkspaceId,
      WorkspaceName: parentFolder.WorkspaceName,
      IsWorkspaceRoot: false
    }));

    mergeFolderRecords(normalizedChildFolders);
    documentState.members = mergeRecords(
      documentState.members,
      members,
      (member) => member.Id || `${member.ParentContentFolderId}:${member.ChildRecordId}`
    );
    documentState.documents = mergeRecords(documentState.documents, documents, (documentRecord) => documentRecord.Id);
    documentState.loadedFolderIds.add(folderId);
    buildFolderTree();
    renderTree();
    setConnectedStatus();
    setOperationStatus(`Loaded ${normalizedChildFolders.length} folders and ${documents.length} files.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    documentState.warnings.push(`${parentFolder.DisplayName || parentFolder.Name || folderId}: ${formatUserFacingMessage(message)}`);
    setConnectedStatus();
    setOperationStatus(message, true);
  } finally {
    documentState.loadingFolderIds.delete(folderId);
    buildFolderTree();
    renderTree();
  }
}

async function ensureNodeLoaded(key = "") {
  if (key === "workspace-folders") {
    await loadWorkspaceFolders();
  } else if (key.startsWith("folder:")) {
    await loadFolderChildren(key.split(":")[1] || "");
  }

  const selected = getTreeNodeForSelection(selectedKey).node;
  if (selected) {
    renderSelectedNodeDetail(selected);
  }
}

async function loadMatchingFolderDocumentRecords(searchText = "") {
  const text = String(searchText || "").trim();
  if (!text) {
    return {
      folderCount: 0,
      documentCount: 0
    };
  }

  await loadWorkspaceFolders();
  const [matchingFolders, matchingDocuments] = await Promise.all([
    loadContentFoldersByName(text),
    loadContentDocumentsByTitle(text)
  ]);
  mergeFolderRecords(matchingFolders);
  documentState.documents = mergeRecords(documentState.documents, matchingDocuments, (documentRecord) => documentRecord.Id);

  const matchingMembers = await loadContentFolderMembersByChildIds(matchingDocuments.map((documentRecord) => documentRecord.Id));
  documentState.members = mergeRecords(
    documentState.members,
    matchingMembers,
    (member) => member.Id || `${member.ParentContentFolderId}:${member.ChildRecordId}`
  );

  await loadFolderAncestors([
    ...matchingFolders.map((folder) => folder.ParentContentFolderId),
    ...matchingMembers.map((member) => member.ParentContentFolderId)
  ]);
  buildFolderTree();
  renderTree();
  return {
    folderCount: matchingFolders.length,
    documentCount: matchingDocuments.length
  };
}

async function loadDocumentData() {
  selectionOperationId += 1;
  selectionInProgress = false;
  activeZipController?.abort();
  documentState = createEmptyDocumentState();
  openDocumentFolderKeys.clear();
  selectedDocumentFolderItems.clear();
  activeFindRequestId += 1;
  workspaceFoldersLoadPromise = null;
  filterText = "";
  if (filterInput) {
    filterInput.value = "";
  }
  buildFolderTree();
}

function renderInitialDetail() {
  const root = documentState.tree;
  if (!root) {
    clearDetail();
    return;
  }
  selectedKey = root.children[0]?.key || root.key;
  selectNode(selectedKey);
}

async function refreshDocumentFolders() {
  if (!session?.host || !session?.sid) {
    setStatus(t("documentFolders.status.sessionNotReady"), true);
    setOperationStatus("");
    return;
  }

  setBusy(true);
  setConnectedStatus();
  setOperationStatus("Loading document folders...");
  treeEl.textContent = "";
  clearDetail();
  try {
    await loadDocumentData();
    renderTree();
    renderInitialDetail();
    const warningText = documentState.warnings.length ? ` Warnings: ${documentState.warnings.length}.` : "";
    setConnectedStatus();
    setOperationStatus(`Open Workspace Folders to load workspace folders.${warningText}`, Boolean(documentState.warnings.length));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setConnectedStatus();
    setOperationStatus(message, true);
    clearDetail();
    detailEl.textContent = formatUserFacingMessage(message);
  } finally {
    setBusy(false);
  }
}

async function loadSession() {
  const host = params.get("host");
  setStatus(host ? `Connecting to ${host}...` : "Finding active Salesforce session...");
  session = host ? await getSessionForHost(host) : await getActiveSession();
  if (session?.host) {
    try {
      window.localStorage.setItem("salesforceMetadataDevOpsLastHost", session.host);
    } catch (_error) {
      // Local storage can be unavailable in restricted extension contexts.
    }
  }
  await salesforceRequest(session.host, session.sid, `/services/data/${SALESFORCE_API_VERSION}/`);
  setConnectedStatus();
  await refreshDocumentFolders();
}

async function runFolderDocumentFind() {
  const requestId = activeFindRequestId + 1;
  activeFindRequestId = requestId;
  filterText = filterInput.value.trim();
  renderTree();

  if (!filterText) {
    setOperationStatus("Find cleared.");
    return;
  }

  setBusy(true);
  setOperationStatus(`Finding folders and documents matching "${filterText}"...`);
  try {
    const result = await loadMatchingFolderDocumentRecords(filterText);
    if (requestId !== activeFindRequestId) {
      return;
    }
    const warningText = documentState.warnings.length ? ` Warnings: ${documentState.warnings.length}.` : "";
    setConnectedStatus();
    setOperationStatus(
      `Find Folder or Document matched ${result.folderCount} folders and ${result.documentCount} documents.${warningText}`,
      Boolean(documentState.warnings.length)
    );
  } catch (error) {
    if (requestId !== activeFindRequestId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setConnectedStatus();
    setOperationStatus(message, true);
  } finally {
    if (requestId === activeFindRequestId) {
      setBusy(false);
    }
  }
}

refreshButton.addEventListener("click", refreshDocumentFolders);
filterButton?.addEventListener("click", () => {
  void runFolderDocumentFind();
  filterInput.focus();
});
initializeSidebarResizer();
loadSession().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(message, true);
  setOperationStatus("");
  clearActivePreviewObjectUrls();
  detailEl.textContent = formatUserFacingMessage(message);
});

export {
  collectSelectableSubtreeKeys,
  getDocumentNodeZipPrefix,
  getDocumentFolderSelectionState,
  getDocumentDownloadUrl,
  getDocumentFileExtension,
  getDocumentZipFileName,
  getPreviewKind,
  getUniqueZipPath,
  sanitizeZipPathPart,
  validateDocumentZipCandidates
};
