import { t } from "./i18n.js";
import { mountAppLauncher } from "./app-launcher.js";

export const TOOL_ITEMS = [
  {
    key: "rest",
    categoryKey: "tools.category.developer",
    labelKey: "tools.restExplorer",
    page: "rest-explorer.html",
    descriptionKey: "tools.restExplorer.description"
  },
  {
    key: "data-export",
    categoryKey: "tools.category.administrator",
    labelKey: "tools.dataExport",
    page: "data-export.html",
    descriptionKey: "tools.dataExport.description"
  },
  {
    key: "document-folders",
    categoryKey: "tools.category.administrator",
    labelKey: "tools.documentFolders",
    page: "document-folders.html",
    descriptionKey: "tools.documentFolders.description"
  },
  {
    key: "run-apex",
    categoryKey: "tools.category.developer",
    labelKey: "tools.runApex",
    page: "run-apex.html",
    descriptionKey: "tools.runApex.description"
  },
  {
    key: "setup-audit-trail",
    categoryKey: "tools.category.monitoring",
    labelKey: "monitoring.setupAudit",
    page: "setup-audit-trail.html",
    descriptionKey: "monitoring.setupAudit.description"
  },
  {
    key: "api-usage",
    categoryKey: "tools.category.monitoring",
    labelKey: "monitoring.limitations",
    page: "latest-api-usage.html",
    descriptionKey: "monitoring.limitations.description"
  },
  {
    key: "login-history",
    categoryKey: "tools.category.monitoring",
    labelKey: "monitoring.loginHistory",
    page: "login-history.html",
    descriptionKey: "monitoring.loginHistory.description"
  },
  {
    key: "event-logs",
    categoryKey: "tools.category.monitoring",
    labelKey: "monitoring.eventLogs",
    page: "event-logs.html",
    descriptionKey: "monitoring.eventLogs.description"
  },
  {
    key: "manual",
    categoryKey: "tools.category.administrator",
    labelKey: "tools.manual",
    page: "manual.html",
    descriptionKey: "tools.manual.description"
  }
];

const LAST_HOST_STORAGE_KEY = "salesforceMetadataDevOpsLastHost";
const RECENT_TOOLS_KEY = "adminToolkit.recentTools.v1";
const FAVORITE_TOOLS_KEY = "adminToolkit.favoriteTools.v1";
const RETIRED_TOOL_KEYS = new Set(["object-schema"]);
let toolsNavResizeObserver = null;
let toolsDirectoryRender = null;

async function pruneRetiredToolState() {
  if (!chrome?.storage?.local) return;
  const stored = await chrome.storage.local.get([RECENT_TOOLS_KEY, FAVORITE_TOOLS_KEY]);
  const updates = {};
  [RECENT_TOOLS_KEY, FAVORITE_TOOLS_KEY].forEach((key) => {
    const values = Array.isArray(stored?.[key]) ? stored[key] : [];
    const filtered = values.filter((value) => !RETIRED_TOOL_KEYS.has(value));
    if (filtered.length !== values.length) updates[key] = filtered;
  });
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}

function getStoredHost() {
  try {
    return window.localStorage.getItem(LAST_HOST_STORAGE_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function rememberCurrentHost() {
  const host = new URLSearchParams(window.location.search).get("host") || "";
  if (!host) {
    return;
  }

  try {
    window.localStorage.setItem(LAST_HOST_STORAGE_KEY, host);
  } catch (_error) {
    // Local storage can be unavailable in restricted extension contexts.
  }
}

function getCurrentPageName() {
  return window.location.pathname.split("/").pop() || "tools.html";
}

function getActiveTool() {
  const pageName = getCurrentPageName();
  const directMatch = TOOL_ITEMS.find((item) => item.page === pageName);
  if (directMatch) {
    return directMatch;
  }

  const requestedTool = new URLSearchParams(window.location.search).get("tool") || "";
  return TOOL_ITEMS.find((item) => item.key === requestedTool) || null;
}

function createToolUrl(item) {
  const url = new URL(item.page, window.location.href);
  const currentParams = new URLSearchParams(window.location.search);
  currentParams.delete("tool");
  if (!currentParams.get("host")) {
    const storedHost = getStoredHost();
    if (storedHost) {
      currentParams.set("host", storedHost);
    }
  }
  url.search = currentParams.toString();
  return url;
}

function ensureHeroMetaRow(hero, eyebrow) {
  let row = Array.from(hero.children).find((child) => child.classList.contains("hero-eyebrow-row"));
  if (!row) {
    row = document.createElement("div");
    row.className = "hero-eyebrow-row";
    hero.prepend(row);
  }

  const titleCluster = row.querySelector(".app-launcher-title-cluster");
  const eyebrowParent = titleCluster || row;
  if (eyebrow.parentElement !== eyebrowParent) {
    eyebrowParent.appendChild(eyebrow);
  }

  const status = hero.querySelector(".status");
  const languagePicker = row.querySelector(".app-language-picker");
  if (status && status.parentElement !== row) {
    if (languagePicker) {
      row.insertBefore(status, languagePicker);
    } else {
      row.appendChild(status);
    }
  }

  return row;
}

function ensureHeroTitle(hero, activeTool) {
  const eyebrow = hero.querySelector(".eyebrow") || document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = t("app.title");
  if (!eyebrow.parentNode) {
    hero.prepend(eyebrow);
  }
  const metaRow = ensureHeroMetaRow(hero, eyebrow);

  let title = hero.querySelector(".title");
  if (title) {
    title.remove();
  }
  hero.querySelectorAll(".hero-head-title").forEach((titleWrap) => {
    if (!titleWrap.textContent.trim() && titleWrap.children.length === 0) {
      titleWrap.remove();
    }
  });

  let head = hero.querySelector(".tools-page-head") || hero.querySelector(".hero-head");
  if (!head) {
    head = document.createElement("div");
    head.className = "hero-head tools-page-head";
  }
  head.classList.add("hero-head", "tools-page-head");

  if (!head.parentElement) {
    metaRow.after(head);
  }

  head.querySelector(".tools-page-separator")?.remove();

  const subtitle = hero.querySelector(".subtitle");
  if (subtitle && activeTool?.descriptionKey) {
    subtitle.textContent = t(activeTool.descriptionKey);
  }

  return head;
}

function navigateToTool(item, activeTool) {
  if (item === activeTool) {
    return;
  }
  window.location.replace(createToolUrl(item).href);
}

function createToolButton(item, activeTool) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = item === activeTool
    ? "slds-button slds-button_neutral tab-button tools-page-nav-button active"
    : "slds-button slds-button_neutral tab-button tools-page-nav-button";
  button.textContent = t(item.labelKey);
  button.title = `${t(item.categoryKey)} - ${t(item.labelKey)}`;
  button.dataset.toolKey = item.key;
  button.setAttribute("aria-current", item === activeTool ? "page" : "false");
  button.addEventListener("click", () => navigateToTool(item, activeTool));
  return button;
}

function createOverflowMenuItem(item, activeTool) {
  const menuItem = document.createElement("li");
  menuItem.className = item === activeTool
    ? "slds-dropdown__item tools-page-overflow-item active"
    : "slds-dropdown__item tools-page-overflow-item";
  menuItem.role = "presentation";
  menuItem.dataset.toolKey = item.key;

  const link = document.createElement("a");
  link.href = createToolUrl(item).href;
  link.role = "menuitem";
  link.tabIndex = -1;
  link.setAttribute("aria-current", item === activeTool ? "page" : "false");
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigateToTool(item, activeTool);
  });

  const label = document.createElement("span");
  label.title = t(item.labelKey);
  label.textContent = t(item.labelKey);
  link.appendChild(label);
  menuItem.appendChild(link);
  return menuItem;
}

function setOverflowOpen(overflow, isOpen) {
  overflow.classList.toggle("slds-is-open", isOpen);
  overflow.querySelector("button")?.setAttribute("aria-expanded", String(isOpen));
  const firstItem = overflow.querySelector(".tools-page-overflow-item:not([hidden]) a");
  overflow.querySelectorAll(".tools-page-overflow-item a").forEach((link) => {
    link.tabIndex = isOpen && link === firstItem ? 0 : -1;
  });
}

function createOverflowTrigger() {
  const overflow = document.createElement("div");
  overflow.className = "slds-dropdown-trigger slds-dropdown-trigger_click slds-button_last tools-page-overflow";
  overflow.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "slds-button slds-button_icon slds-button_icon-border-filled";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.title = t("tools.showMore");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setOverflowOpen(overflow, !overflow.classList.contains("slds-is-open"));
  });

  const icon = document.createElement("span");
  icon.className = "slds-button__icon tools-page-overflow-icon";
  icon.setAttribute("aria-hidden", "true");

  const assistiveText = document.createElement("span");
  assistiveText.className = "slds-assistive-text";
  assistiveText.textContent = t("tools.showMore");
  button.append(icon, assistiveText);

  const dropdown = document.createElement("div");
  dropdown.className = "slds-dropdown slds-dropdown_right slds-dropdown_actions";
  const list = document.createElement("ul");
  list.className = "slds-dropdown__list";
  list.role = "menu";
  dropdown.appendChild(list);
  overflow.append(button, dropdown);

  overflow.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOverflowOpen(overflow, false);
      button.focus();
    }
  });

  return overflow;
}

function updateButtonGroupEdges(buttons, hasOverflow) {
  buttons.forEach((button) => {
    button.classList.remove("tools-page-nav-button_last");
  });
  if (hasOverflow) {
    return;
  }
  [...buttons].reverse().find((button) => !button.hidden)?.classList.add("tools-page-nav-button_last");
}

function updateToolsNavOverflow(nav) {
  const group = nav.querySelector(".tools-page-nav-group");
  const overflow = nav.querySelector(".tools-page-overflow");
  const overflowList = nav.querySelector(".slds-dropdown__list");
  const buttons = [...nav.querySelectorAll(".tools-page-nav-button")];
  const menuItems = [...nav.querySelectorAll(".tools-page-overflow-item")];
  if (!group || !overflow || !overflowList || buttons.length === 0) {
    return;
  }

  buttons.forEach((button) => {
    button.hidden = false;
  });
  menuItems.forEach((item) => {
    item.hidden = true;
  });
  overflow.hidden = true;
  setOverflowOpen(overflow, false);
  updateButtonGroupEdges(buttons, false);

  const availableWidth = Math.floor(nav.clientWidth);
  if (!availableWidth || group.scrollWidth <= availableWidth) {
    return;
  }

  overflow.hidden = false;
  updateButtonGroupEdges(buttons, true);
  const overflowWidth = overflow.offsetWidth;
  let usedWidth = overflowWidth;
  const hiddenKeys = new Set();

  buttons.forEach((button) => {
    const buttonWidth = button.offsetWidth;
    if (usedWidth + buttonWidth <= availableWidth) {
      usedWidth += buttonWidth;
      return;
    }
    button.hidden = true;
    hiddenKeys.add(button.dataset.toolKey);
  });

  menuItems.forEach((item) => {
    item.hidden = !hiddenKeys.has(item.dataset.toolKey);
  });

  if (hiddenKeys.size === 0) {
    overflow.hidden = true;
    updateButtonGroupEdges(buttons, false);
  }
}

function renderToolsNav() {
  const hero = document.querySelector(".hero");
  if (!hero) {
    return;
  }

  rememberCurrentHost();
  const activeTool = getActiveTool();
  document.title = activeTool ? `${t("nav.tools")} - ${t(activeTool.labelKey)}` : t("nav.tools");
  const head = ensureHeroTitle(hero, activeTool);

  toolsNavResizeObserver?.disconnect();

  const existingNav = head.querySelector(".tools-page-nav");
  if (existingNav) {
    existingNav.remove();
  }

  const nav = document.createElement("nav");
  nav.className = "tools-page-nav";
  nav.setAttribute("aria-label", t("tools.pages"));

  const group = document.createElement("div");
  group.className = "slds-button-group tools-page-nav-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("nav.tools"));

  TOOL_ITEMS.forEach((item) => {
    group.appendChild(createToolButton(item, activeTool));
  });

  const overflow = createOverflowTrigger();
  const overflowList = overflow.querySelector(".slds-dropdown__list");
  TOOL_ITEMS.forEach((item) => {
    overflowList.appendChild(createOverflowMenuItem(item, activeTool));
  });
  group.appendChild(overflow);
  nav.appendChild(group);

  const actions = head.querySelector(".hero-head-actions");
  if (actions) {
    head.insertBefore(nav, actions);
  } else {
    head.appendChild(nav);
  }

  requestAnimationFrame(() => updateToolsNavOverflow(nav));
  if ("ResizeObserver" in window) {
    toolsNavResizeObserver = new ResizeObserver(() => updateToolsNavOverflow(nav));
    toolsNavResizeObserver.observe(nav);
  } else {
    window.addEventListener("resize", () => updateToolsNavOverflow(nav));
  }
}

async function rememberRecentTool(activeTool) {
  if (!activeTool || !chrome?.storage?.local) return;
  const stored = (await chrome.storage.local.get(RECENT_TOOLS_KEY))?.[RECENT_TOOLS_KEY] || [];
  await chrome.storage.local.set({ [RECENT_TOOLS_KEY]: [activeTool.key, ...stored.filter((key) => key !== activeTool.key)].slice(0, 6) });
}

async function renderToolsDirectory() {
  const directory = document.getElementById("tools-directory");
  const search = document.getElementById("tools-directory-search");
  if (!directory) return;
  const stored = await chrome.storage.local.get(FAVORITE_TOOLS_KEY);
  const favorites = new Set(stored?.[FAVORITE_TOOLS_KEY] || []);

  const render = () => {
    const needle = (search?.value || "").trim().toLowerCase();
    directory.textContent = "";
    const items = [...TOOL_ITEMS].sort((left, right) => Number(favorites.has(right.key)) - Number(favorites.has(left.key)));
    items.filter((item) => [t(item.labelKey), t(item.categoryKey), t(item.descriptionKey)].join(" ").toLowerCase().includes(needle)).forEach((item) => {
      const row = document.createElement("article");
      row.className = "tools-directory-item";
      row.dataset.toolKey = item.key;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "tools-directory-open";
      const label = document.createElement("strong");
      label.className = "tools-directory-label";
      label.textContent = t(item.labelKey);
      const category = document.createElement("span");
      category.className = "tools-directory-category";
      category.textContent = t(item.categoryKey);
      const description = document.createElement("span");
      description.className = "tools-directory-description";
      description.textContent = t(item.descriptionKey);
      open.append(label, category, description);
      open.addEventListener("click", () => location.assign(createToolUrl(item).href));

      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "tools-directory-favorite";
      favorite.textContent = favorites.has(item.key) ? "★" : "☆";
      favorite.title = t(favorites.has(item.key) ? "tools.favorite.remove" : "tools.favorite.add");
      favorite.setAttribute("aria-label", `${favorite.title}: ${t(item.labelKey)}`);
      favorite.addEventListener("click", async () => {
        if (favorites.has(item.key)) favorites.delete(item.key); else favorites.add(item.key);
        await chrome.storage.local.set({ [FAVORITE_TOOLS_KEY]: [...favorites] });
        render();
      });
      row.append(open, favorite);
      directory.appendChild(row);
    });
  };

  if (search && !search.dataset.toolsDirectoryBound) {
    search.dataset.toolsDirectoryBound = "true";
    search.addEventListener("input", () => toolsDirectoryRender?.());
  }
  toolsDirectoryRender = render;
  render();
}

void pruneRetiredToolState();
renderToolsNav();
mountAppLauncher({ translate: t });
void rememberRecentTool(getActiveTool());
void renderToolsDirectory();
window.addEventListener("app-language-change", () => {
  renderToolsNav();
  toolsDirectoryRender?.();
});
document.addEventListener("click", () => {
  document.querySelectorAll(".tools-page-overflow.slds-is-open").forEach((overflow) => {
    setOverflowOpen(overflow, false);
  });
});
