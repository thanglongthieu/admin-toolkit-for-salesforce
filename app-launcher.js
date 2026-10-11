const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";

const APP_ITEMS = [
  {
    page: "schema-viewer.html",
    labelKey: "tools.metadataFolder",
    label: "DataDock for Salesforce",
    descriptionKey: "tools.metadataFolder.description",
    description: "Browse, compare, and package metadata across orgs.",
    path: "M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm11 0h-2v2h2v2h-2v2h2v-2h2v2h2v-2h-2v-2h2v-2h-2v2h-2v-2z"
  },
  {
    page: "org-differences.html",
    labelKey: "tools.orgDifferences",
    label: "Org Differences",
    descriptionKey: "tools.orgDifferences.description",
    description: "Compare metadata between orgs and outbound change sets.",
    path: "M7 3h10v3h3v15h-8v-3h5V9h-3v3H4V3h3Zm0 3v3h4V6H7Zm10 6h3l-4 4-4-4h3V8h2v4ZM4 15h6v6H4v-6Zm3 2H6v2h1v-2Z"
  },
  {
    page: "force-sheet.html",
    labelKey: "tools.forceSheet",
    label: "SheetD",
    descriptionKey: "tools.forceSheet.description",
    description: "Run SOQL queries and view results in a spreadsheet grid.",
    path: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v2h14V5H5Zm0 4v10h14V9H5Zm2 2h10v1.5H7V11Zm0 3h7v1.5H7V14Zm0 3h4v1.5H7V17Z"
  },
  {
    page: "object-schema.html",
    labelKey: "tools.objectSchema",
    label: "Object Schema",
    descriptionKey: "tools.objectSchema.description",
    description: "Explore focused parent and child object relationships.",
    path: "M10 3h4v4h-4V3Zm1 4h2v4h-2V7ZM5 11h14v2H5v-2Zm0 2h2v4H5v-4Zm12 0h2v4h-2v-4ZM4 17h4v4H4v-4Zm12 0h4v4h-4v-4Z"
  },
  {
    page: "permission-explorer.html",
    labelKey: "tools.permissionExplorer",
    label: "Permission Explorer",
    descriptionKey: "tools.permissionExplorer.description",
    description: "Explain why a user can access an object or field.",
    path: "M12 1 4 4.5v6c0 4.7 3.4 9.1 8 10.5 4.6-1.4 8-5.8 8-10.5v-6L12 1Zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 11c-1.9-.6-3.6-2-4.6-3.8.5-1.3 2.5-2 4.6-2s4.1.7 4.6 2c-1 1.8-2.7 3.2-4.6 3.8Z"
  }
];

const TOOL_ITEMS = [
  ["rest-explorer.html", "tools.restExplorer", "REST API"],
  ["run-apex.html", "tools.runApex", "Run Apex Code"],
  ["data-export.html", "tools.dataExport", "Data Export"],
  ["document-folders.html", "tools.documentFolders", "Document Folders"],
  ["setup-audit-trail.html", "monitoring.setupAudit", "View Setup Audit Trail"],
  ["latest-api-usage.html", "monitoring.limitations", "Limits"],
  ["login-history.html", "monitoring.loginHistory", "Login History"],
  ["event-logs.html", "monitoring.eventLogs", "Event Log Files"],
  ["manual.html", "tools.manual", "Manual"]
].map(([page, labelKey, label]) => ({ page, labelKey, label }));

function translated(translate, key, fallback) {
  if (typeof translate !== "function") return fallback;
  const value = translate(key);
  return value && value !== key ? value : fallback;
}

function currentPageName() {
  return window.location.pathname.split("/").pop() || "";
}

function currentHost() {
  const queryHost = new URLSearchParams(window.location.search).get("host") || "";
  if (queryHost) return queryHost;
  try {
    return window.localStorage.getItem(LAST_HOST_STORAGE_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function pageUrl(page) {
  const url = new URL(page, window.location.href);
  url.search = "";
  const host = currentHost();
  if (host) url.searchParams.set("host", host);
  return url.href;
}

function createIcon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("fill", "currentColor");
  shape.setAttribute("d", path);
  svg.appendChild(shape);
  return svg;
}

function createAppLink(item, translate) {
  const link = document.createElement("a");
  link.className = "app-launcher-app-link";
  link.dataset.appPage = item.page;
  link.href = pageUrl(item.page);
  link.appendChild(createIcon(item.path));

  const copy = document.createElement("span");
  const label = document.createElement("strong");
  label.dataset.launcherLabel = item.labelKey;
  label.dataset.launcherFallback = item.label;
  label.textContent = translated(translate, item.labelKey, item.label);
  const description = document.createElement("small");
  description.dataset.launcherLabel = item.descriptionKey;
  description.dataset.launcherFallback = item.description;
  description.textContent = translated(translate, item.descriptionKey, item.description);
  copy.append(label, description);
  link.appendChild(copy);
  return link;
}

function createToolLink(item, translate) {
  const link = document.createElement("a");
  link.className = "app-launcher-tool-link";
  link.dataset.appPage = item.page;
  link.href = pageUrl(item.page);
  const label = document.createElement("strong");
  label.dataset.launcherLabel = item.labelKey;
  label.dataset.launcherFallback = item.label;
  label.textContent = translated(translate, item.labelKey, item.label);
  link.appendChild(label);
  return link;
}

function syncLinks(root) {
  const pageName = currentPageName();
  root.querySelectorAll("[data-app-page]").forEach((link) => {
    const isCurrent = link.dataset.appPage === pageName;
    link.href = pageUrl(link.dataset.appPage);
    link.classList.toggle("active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function applyLabels(root, translate) {
  root.querySelectorAll("[data-launcher-label]").forEach((element) => {
    element.textContent = translated(
      translate,
      element.dataset.launcherLabel,
      element.dataset.launcherFallback || ""
    );
  });
  const title = translated(translate, "nav.appsTools", "Apps & Tools");
  const close = translated(translate, "common.close", "Close");
  const apps = translated(translate, "nav.apps", "Apps");
  const tools = translated(translate, "nav.tools", "Tools");
  root.querySelector(".app-launcher-button")?.setAttribute("title", title);
  root.querySelector(".app-launcher-button")?.setAttribute("aria-label", title);
  root.querySelector(".app-launcher-title").textContent = title;
  root.querySelector(".app-launcher-close").setAttribute("title", close);
  root.querySelector(".app-launcher-close").setAttribute("aria-label", close);
  root.querySelector(".app-launcher-app-list").setAttribute("aria-label", apps);
  root.querySelector(".app-launcher-tools-title").textContent = tools;
  root.querySelector(".app-launcher-tool-list").setAttribute("aria-label", tools);
}

function createLauncher(translate) {
  const root = document.createElement("div");
  root.className = "app-launcher";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-launcher-button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "app-launcher-menu");
  const dots = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  dots.setAttribute("viewBox", "0 0 24 24");
  dots.setAttribute("aria-hidden", "true");
  [[5, 5], [12, 5], [19, 5], [5, 12], [12, 12], [19, 12], [5, 19], [12, 19], [19, 19]].forEach(([cx, cy]) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "1.7");
    dots.appendChild(dot);
  });
  button.appendChild(dots);

  const menu = document.createElement("section");
  menu.id = "app-launcher-menu";
  menu.className = "app-launcher-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-labelledby", "app-launcher-title");
  menu.hidden = true;

  const head = document.createElement("header");
  head.className = "app-launcher-head";
  const title = document.createElement("h2");
  title.id = "app-launcher-title";
  title.className = "app-launcher-title";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "app-launcher-close";
  close.textContent = "×";
  head.append(title, close);

  const apps = document.createElement("nav");
  apps.className = "app-launcher-app-list";
  APP_ITEMS.forEach((item) => apps.appendChild(createAppLink(item, translate)));

  const tools = document.createElement("section");
  tools.className = "app-launcher-tools";
  const toolsTitle = document.createElement("h3");
  toolsTitle.className = "app-launcher-tools-title";
  const toolList = document.createElement("nav");
  toolList.className = "app-launcher-tool-list";
  TOOL_ITEMS.forEach((item) => toolList.appendChild(createToolLink(item, translate)));
  tools.append(toolsTitle, toolList);
  menu.append(head, apps, tools);
  root.append(button, menu);
  applyLabels(root, translate);
  syncLinks(root);
  return root;
}

function defaultTarget() {
  return document.querySelector(".hero-eyebrow-row") ||
    document.querySelector(".app-session-header") ||
    document.querySelector(".hero") ||
    document.querySelector(".fs-header-left");
}

export function mountAppLauncher({ target = defaultTarget(), translate } = {}) {
  if (!target || document.querySelector(".app-launcher, .org-diff-app-launcher")) return null;

  const launcher = createLauncher(translate);
  target.appendChild(launcher);

  const button = launcher.querySelector(".app-launcher-button");
  const menu = launcher.querySelector(".app-launcher-menu");
  const close = launcher.querySelector(".app-launcher-close");
  const links = [...launcher.querySelectorAll("[data-app-page]")];
  const setOpen = (open, restoreFocus = false) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(() => links[0]?.focus());
    else if (restoreFocus) button.focus();
  };

  button.addEventListener("click", () => setOpen(menu.hidden));
  close.addEventListener("click", () => setOpen(false, true));
  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("aria-current") === "page") event.preventDefault();
      setOpen(false);
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !launcher.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  window.addEventListener("app-language-change", () => applyLabels(launcher, translate));
  return launcher;
}
