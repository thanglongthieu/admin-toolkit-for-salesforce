import { getManualFile, getManualFiles, getVersionFile, getVersionFiles } from "./manual-content.js";
import { getLanguage, t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

const params = new URLSearchParams(window.location.search);
const statusEl = document.getElementById("manual-status");
const treeEl = document.getElementById("manual-tree");
const detailEl = document.getElementById("manual-detail");

let selectedPath = params.get("path") || getManualFiles(getLanguage())[0]?.path || "";

function setStatus(message, isError = false) {
  statusEl.textContent = formatUserFacingMessage(message);
  statusEl.className = isError ? "status error" : "status";
}

function createManualBlock(tagName, text = "") {
  const block = document.createElement(tagName);
  block.textContent = text;
  return block;
}

function appendManualListItem(list, text = "") {
  const item = document.createElement("li");
  item.textContent = text;
  list.appendChild(item);
}

function renderManualMarkdown(target, markdown = "") {
  target.innerHTML = "";
  let currentList = null;

  String(markdown || "").split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text) {
      currentList = null;
      return;
    }

    const headingMatch = text.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      currentList = null;
      target.appendChild(createManualBlock(`h${headingMatch[1].length}`, headingMatch[2]));
      return;
    }

    const listMatch = text.match(/^-\s+(.+)$/);
    if (listMatch) {
      if (!currentList) {
        currentList = document.createElement("ul");
        target.appendChild(currentList);
      }
      appendManualListItem(currentList, listMatch[1]);
      return;
    }

    currentList = null;
    target.appendChild(createManualBlock("p", text));
  });
}

function setTreeIndent(element, level = 0) {
  element.style.setProperty("--tree-indent", `${Math.max(level, 0) * 0.9}rem`);
}

function createExplorerName(primaryText = "", secondaryText = "") {
  const wrapper = document.createElement("span");
  wrapper.className = "schema-tree-name";

  const primary = document.createElement("span");
  primary.className = "schema-tree-primary";
  primary.textContent = primaryText;
  wrapper.appendChild(primary);

  if (secondaryText) {
    const secondary = document.createElement("span");
    secondary.className = "schema-tree-secondary";
    secondary.textContent = secondaryText;
    wrapper.appendChild(secondary);
  }

  return wrapper;
}

function selectManualFile(path = "") {
  const lang = getLanguage();
  const isVersionPath = String(path || "").startsWith("versions/");
  const manualFile = isVersionPath
    ? (getVersionFile(path, lang) || getVersionFiles(lang)[0] || null)
    : (getManualFile(path, lang) || getManualFiles(lang)[0] || null);

  if (!manualFile) {
    detailEl.innerHTML = "";
    detailEl.appendChild(createManualBlock("div", t("manual.notFound")));
    setStatus(t("manual.notFound"), true);
    return;
  }

  selectedPath = manualFile.path;
  renderManualTree();
  renderManualFile(manualFile);
  setStatus(`${t("tools.manual")}: ${manualFile.title || manualFile.name}`);
}

function createManualFileRow(manualFile = {}) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "schema-tree-row schema-tree-file-row manual-tree-file-row";
  row.dataset.sourcePath = manualFile.path || "";
  setTreeIndent(row, 1);
  row.addEventListener("click", () => selectManualFile(manualFile.path));

  const spacer = document.createElement("span");
  spacer.className = "schema-tree-indent";
  row.appendChild(spacer);

  const icon = document.createElement("span");
  icon.className = "schema-tree-icon file";
  row.appendChild(icon);

  row.appendChild(createExplorerName(manualFile.name, manualFile.title));

  const type = document.createElement("span");
  type.className = "schema-tree-meta";
  type.textContent = "md";
  row.appendChild(type);

  if (manualFile.path === selectedPath) {
    row.classList.add("selected");
  }

  return row;
}

function createManualFolderSection(labelKey, secondaryLabelKey, files = []) {
  const folder = document.createElement("details");
  folder.className = "schema-tree-folder schema-object manual-tree-folder";
  folder.open = true;

  const summary = document.createElement("summary");
  summary.className = "schema-tree-row schema-tree-folder-row";
  setTreeIndent(summary, 0);

  const caret = document.createElement("span");
  caret.className = "schema-tree-caret";
  summary.appendChild(caret);

  const icon = document.createElement("span");
  icon.className = "schema-tree-icon folder";
  summary.appendChild(icon);

  summary.appendChild(createExplorerName(t(labelKey), t(secondaryLabelKey)));

  const count = document.createElement("span");
  count.className = "schema-tree-meta";
  count.textContent = String(files.length);
  summary.appendChild(count);

  const children = document.createElement("div");
  children.className = "schema-tree-children";
  files.forEach((manualFile) => {
    children.appendChild(createManualFileRow(manualFile));
  });

  folder.append(summary, children);
  return folder;
}

function renderManualTree() {
  treeEl.innerHTML = "";
  const lang = getLanguage();
  treeEl.appendChild(createManualFolderSection("tools.manual", "manual.markdownGuides", getManualFiles(lang)));
  treeEl.appendChild(createManualFolderSection("manual.versions", "manual.releaseNotes", getVersionFiles(lang)));
}

function renderManualFile(manualFile = {}) {
  detailEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "manual-detail-head";

  const title = document.createElement("div");
  title.className = "manual-detail-title";
  title.textContent = manualFile.title || manualFile.name || "Manual";

  const path = document.createElement("div");
  path.className = "manual-detail-path";
  path.textContent = manualFile.path || "";

  header.append(title, path);

  const article = document.createElement("article");
  article.className = "schema-manual-doc manual-doc";
  renderManualMarkdown(article, manualFile.content);

  detailEl.append(header, article);
}

renderManualTree();
selectManualFile(selectedPath);

window.addEventListener("app-language-change", () => {
  selectManualFile(selectedPath);
});
