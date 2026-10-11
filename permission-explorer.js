import {
  getSObjectDescribe,
  getMetadataItemDetail,
  getSessionForHost,
  loadAllObjectAccessRows,
  loadAssignedPermissionParents,
  loadFieldAccessRows,
  loadObjectAccessRows,
  loadObjectFieldAccessRows,
  loadPermissionSetGroupComponents,
  searchAccessUsers
} from "./api.js";
import {
  buildAccessExport,
  buildFieldAccessMatrix,
  buildObjectAccessMatrix,
  buildPermissionMetadataInventory,
  isFieldGovernedByFls,
  isSafeSalesforceName,
  normalizeAssignments,
  OBJECT_PERMISSION_FIELDS,
  PERMISSION_ACCESS_CATEGORIES,
  FIELD_PERMISSION_FIELDS,
  resolveFieldAccess,
  resolveObjectAccess
} from "./permission-access.js";
import { mountAppLauncher } from "./app-launcher.js";
import { t } from "./i18n.js";
import { formatUserFacingMessage } from "./ui-messages.js";

mountAppLauncher({ translate: t });

const params = new URLSearchParams(location.search);
const sessionStatus = document.getElementById("permission-explorer-session-status");
const userInput = document.getElementById("permission-explorer-user");
const userSuggestions = document.getElementById("permission-explorer-user-suggestions");
const compareUserInput = document.getElementById("permission-explorer-compare-user");
const compareUserSuggestions = document.getElementById("permission-explorer-compare-user-suggestions");
const objectInput = document.getElementById("permission-explorer-object");
const objectSuggestions = document.getElementById("permission-explorer-object-suggestions");
const fieldInput = document.getElementById("permission-explorer-field");
const explainButton = document.getElementById("permission-explorer-explain");
const compareButton = document.getElementById("permission-explorer-compare");
const resetButton = document.getElementById("permission-explorer-reset");
const status = document.getElementById("permission-explorer-status");
const results = document.getElementById("permission-explorer-results");
const stats = document.getElementById("permission-explorer-stats");
const answer = document.getElementById("permission-explorer-answer");
const verdict = document.getElementById("permission-explorer-verdict");
const targetTitle = document.getElementById("permission-explorer-target");
const targetNote = document.getElementById("permission-explorer-target-note");
const permGrid = document.getElementById("permission-explorer-perm-grid");
const deniedPanel = document.getElementById("permission-explorer-denied");
const fieldNote = document.getElementById("permission-explorer-field-note");
const matrixSection = document.getElementById("permission-explorer-matrix-section");
const matrixNote = document.getElementById("permission-explorer-matrix-note");
const matrixTable = document.getElementById("permission-explorer-matrix");
const fieldsSection = document.getElementById("permission-explorer-fields-section");
const fieldsNote = document.getElementById("permission-explorer-fields-note");
const fieldsTable = document.getElementById("permission-explorer-fields");
const evidenceSection = document.getElementById("permission-explorer-evidence-section");
const evidenceList = document.getElementById("permission-explorer-evidence");
const exportJsonButton = document.getElementById("permission-explorer-export-json");
const exportMarkdownButton = document.getElementById("permission-explorer-export-markdown");
const exportCsvButton = document.getElementById("permission-explorer-export-csv");
const compareResults = document.getElementById("permission-explorer-compare-results");
const compareSummary = document.getElementById("permission-explorer-compare-summary");
const compareTable = document.getElementById("permission-explorer-compare-table");
const inventorySection = document.getElementById("permission-explorer-inventory");
const inventorySummary = document.getElementById("permission-explorer-inventory-summary");
const inventorySources = document.getElementById("permission-explorer-inventory-sources");
const inventoryCategories = document.getElementById("permission-explorer-inventory-categories");

let session = null;
let selectedUser = null;
let selectedCompareUser = null;
let assignedParents = [];
let lastAnswer = null;
let lastMatrix = null;
let lastFieldMatrix = null;
let lastComparison = null;
let lastInventory = null;
let objectChoices = [];
let operationId = 0;
let compareOperationId = 0;

function mountPermissionExplorerHeader() {
  const row = document.querySelector(".permission-explorer-shell .hero-eyebrow-row");
  if (!row || sessionStatus.parentElement === row) return;
  row.insertBefore(sessionStatus, row.querySelector(".app-language-picker"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountPermissionExplorerHeader, { once: true });
} else {
  mountPermissionExplorerHeader();
}

function setStatus(element, message, error = false) {
  element.textContent = formatUserFacingMessage(message);
  element.classList.toggle("error", error);
}

function kindLabel(kind) {
  if (kind === "profile") return t("permissionExplorer.kind.profile");
  if (kind === "group") return t("permissionExplorer.kind.group");
  return t("permissionExplorer.kind.permissionSet");
}

function setupUrl(kind, parentId, groupId) {
  const base = `https://${session.host}/lightning/setup`;
  if (kind === "profile") return `${base}/EnhancedProfiles/page?address=%2F${encodeURIComponent(parentId)}`;
  if (kind === "group" && groupId) return `${base}/PermSetGroups/page?address=%2F${encodeURIComponent(groupId)}`;
  return `${base}/PermSets/page?address=%2F${encodeURIComponent(parentId)}`;
}

function renderSuggestions(container, input, items, onPick) {
  container.replaceChildren();
  if (!items.length) {
    container.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  items.forEach((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "permission-explorer-suggestion";
    option.setAttribute("role", "option");
    option.textContent = item.primary;
    if (item.secondary) {
      const small = document.createElement("small");
      small.textContent = item.secondary;
      option.appendChild(small);
    }
    option.addEventListener("click", () => {
      onPick(item);
      container.hidden = true;
      input.setAttribute("aria-expanded", "false");
    });
    container.appendChild(option);
  });
  container.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function attachUserSearch(input, suggestions, onClear, onPick) {
  let searchTimer = null;
  input?.addEventListener("input", () => {
    onClear();
    globalThis.clearTimeout(searchTimer);
    const term = input.value.trim();
    if (term.length < 2 || !session) {
      renderSuggestions(suggestions, input, [], () => {});
      return;
    }
    searchTimer = globalThis.setTimeout(async () => {
      try {
        const users = await searchAccessUsers(session.host, session.sid, term);
        renderSuggestions(
          suggestions,
          input,
          users.map((user) => ({
            primary: user.Name,
            secondary: `${user.Username}${user.Profile?.Name ? ` · ${user.Profile.Name}` : ""}`,
            user
          })),
          (item) => {
            onPick(item.user);
            input.value = item.user.Name;
          }
        );
      } catch (error) {
        setStatus(status, error, true);
      }
    }, 250);
  });
}

attachUserSearch(
  userInput,
  userSuggestions,
  () => {
    operationId += 1;
    compareOperationId += 1;
    selectedUser = null;
    assignedParents = [];
    lastComparison = null;
    lastInventory = null;
    inventorySection.hidden = true;
    compareResults.hidden = true;
    results.hidden = true;
  },
  (user) => { selectedUser = user; }
);
attachUserSearch(
  compareUserInput,
  compareUserSuggestions,
  () => {
    compareOperationId += 1;
    selectedCompareUser = null;
    lastComparison = null;
    compareResults.hidden = true;
  },
  (user) => { selectedCompareUser = user; }
);

objectInput.addEventListener("input", () => {
  const term = objectInput.value.trim().toLowerCase();
  const matches = objectChoices.filter((name) => name.toLowerCase().includes(term)).slice(0, 12);
  renderSuggestions(
    objectSuggestions,
    objectInput,
    matches.map((name) => ({ primary: name })),
    (item) => {
      objectInput.value = item.primary;
    }
  );
});

document.addEventListener("click", (event) => {
  if (!userSuggestions.contains(event.target) && event.target !== userInput) userSuggestions.hidden = true;
  if (compareUserSuggestions && !compareUserSuggestions.contains(event.target) && event.target !== compareUserInput) compareUserSuggestions.hidden = true;
  if (!objectSuggestions.contains(event.target) && event.target !== objectInput) objectSuggestions.hidden = true;
});

async function ensureAssignedParents(currentOperation) {
  if (assignedParents.length) return assignedParents;
  const records = await loadAssignedPermissionParents(session.host, session.sid, selectedUser.Id);
  if (currentOperation !== operationId) return [];
  assignedParents = normalizeAssignments(records, { profileName: selectedUser.Profile?.Name || "" });
  return assignedParents;
}

async function loadParentsForUser(user, currentOperation) {
  const records = await loadAssignedPermissionParents(session.host, session.sid, user.Id);
  if (currentOperation !== compareOperationId) return [];
  return normalizeAssignments(records, { profileName: user.Profile?.Name || "" });
}

async function loadMetadataInventory(parents) {
  const records = new Array(parents.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, parents.length) }, async () => {
    while (next < parents.length) {
      const index = next;
      next += 1;
      const parent = parents[index];
      const metadataType = parent.kind === "profile" ? "profiles" : "permissionsets";
      const metadataApiType = parent.kind === "profile" ? "Profile" : "PermissionSet";
      const fullName = parent.kind === "profile" ? parent.label : parent.apiName || parent.label;
      try {
        const detail = await getMetadataItemDetail(session.host, session.sid, metadataType, fullName, {
          record: { fullName, metadataApiType },
          timeoutMs: 30_000
        });
        records[index] = { parentId: parent.id, parent, metadata: detail.metadata || {} };
      } catch (error) {
        records[index] = { parentId: parent.id, parent, error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  await Promise.all(workers);
  return buildPermissionMetadataInventory(records, parents);
}

function appendInventorySummary(label, value) {
  const chip = document.createElement("span");
  const number = document.createElement("strong");
  number.textContent = String(value);
  chip.append(number, document.createTextNode(` ${label}`));
  inventorySummary.appendChild(chip);
}

function renderInventory(inventory, parents) {
  if (!inventorySection) return;
  inventorySummary.replaceChildren();
  inventorySources.replaceChildren();
  inventoryCategories.replaceChildren();
  const grantCount = inventory.categories.reduce((total, category) => total + category.entries.length, 0);
  appendInventorySummary(t("permissionExplorer.inventory.sources"), parents.length);
  appendInventorySummary(t("permissionExplorer.inventory.categories"), inventory.categories.filter((category) => category.entries.length).length);
  appendInventorySummary(t("permissionExplorer.inventory.grants"), grantCount);
  appendInventorySummary(t("permissionExplorer.compare.unknown"), inventory.warnings.length);

  parents.forEach((parent) => {
    const chip = document.createElement("span");
    chip.className = "permission-explorer-inventory-source";
    const kind = document.createElement("b");
    kind.textContent = kindLabel(parent.kind);
    chip.append(kind, document.createTextNode(parent.label));
    inventorySources.appendChild(chip);
  });

  inventory.categories.forEach((category, index) => {
    const details = document.createElement("details");
    details.className = "permission-explorer-inventory-category";
    details.dataset.category = category.key;
    details.open = category.entries.length > 0 && index < 3;
    const heading = document.createElement("summary");
    heading.append(document.createTextNode(t(`permissionExplorer.inventory.category.${category.key}`)));
    const count = document.createElement("span");
    count.textContent = String(category.entries.length);
    heading.appendChild(count);
    details.appendChild(heading);
    const body = document.createElement("div");
    body.className = "permission-explorer-inventory-category-body";
    const description = document.createElement("p");
    description.textContent = t(`permissionExplorer.inventory.category.${category.key}.description`);
    body.appendChild(description);
    if (category.entries.length) {
      const list = document.createElement("ul");
      list.className = "permission-explorer-inventory-list";
      category.entries.forEach((entry) => {
        const item = document.createElement("li");
        item.className = "permission-explorer-inventory-item";
        const resource = document.createElement("span");
        const label = document.createElement("strong");
        label.textContent = entry.label;
        resource.appendChild(label);
        if (entry.detail || entry.detailKey) {
          const detail = document.createElement("small");
          detail.textContent = entry.detailKey ? t(entry.detailKey) : entry.detail;
          resource.appendChild(detail);
        }
        const sources = document.createElement("span");
        sources.className = "permission-explorer-inventory-item-sources";
        sources.textContent = entry.sources.map((source) => `${kindLabel(source.kind)}: ${source.label}`).join(" · ");
        item.append(resource, sources);
        list.appendChild(item);
      });
      body.appendChild(list);
    } else {
      const empty = document.createElement("div");
      empty.className = "permission-explorer-inventory-empty";
      empty.textContent = category.observed
        ? t("permissionExplorer.inventory.empty")
        : t("permissionExplorer.inventory.notReturned");
      body.appendChild(empty);
    }
    details.appendChild(body);
    inventoryCategories.appendChild(details);
  });

  if (inventory.warnings.length) {
    const warning = document.createElement("p");
    warning.className = "permission-explorer-inventory-warning";
    warning.textContent = t("permissionExplorer.inventory.warnings", { count: inventory.warnings.length });
    inventoryCategories.appendChild(warning);
  }
  inventorySection.hidden = false;
}

function appendCompareCell(row, value, changed = false, sources = []) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `permission-explorer-compare-access${changed ? " changed" : ""}`;
  badge.textContent = value ? t("permissionExplorer.yes") : t("permissionExplorer.no");
  cell.appendChild(badge);
  if (value && sources.length) {
    const source = document.createElement("small");
    source.className = "permission-explorer-compare-source-note";
    source.textContent = sources.map((entry) => entry.label).join(", ");
    cell.appendChild(source);
  }
  row.appendChild(cell);
}

function emptyObjectAccess() {
  return Object.fromEntries(OBJECT_PERMISSION_FIELDS.map((field) => [field.key, false]));
}

function buildComparisonRows(objectNames, effectiveByObjectA, effectiveByObjectB) {
  const rows = [];
  let sameCount = 0;
  objectNames.forEach((objectName) => {
    const effectiveA = effectiveByObjectA.get(objectName) || emptyObjectAccess();
    const effectiveB = effectiveByObjectB.get(objectName) || emptyObjectAccess();
    OBJECT_PERMISSION_FIELDS.forEach((field) => {
      const valueA = effectiveA[field.key] === true;
      const valueB = effectiveB[field.key] === true;
      if (valueA === valueB) {
        sameCount += 1;
        return;
      }
      rows.push({
        id: `objectSettings:object:${objectName}:${field.key}`,
        categoryKey: "objectSettings",
        label: objectName,
        detailKey: field.labelKey,
        valueA,
        valueB,
        sourcesA: [],
        sourcesB: []
      });
    });
  });
  return { rows, sameCount };
}

function buildInventoryComparisonRows(inventoryA, inventoryB, existingRows = []) {
  const rowsById = new Map(existingRows.map((row) => [row.id, row]));
  const entriesA = new Map();
  const entriesB = new Map();
  inventoryA.categories.forEach((category) => category.entries.forEach((entry) => entriesA.set(`${category.key}:${entry.id}`, entry)));
  inventoryB.categories.forEach((category) => category.entries.forEach((entry) => entriesB.set(`${category.key}:${entry.id}`, entry)));
  [...new Set([...entriesA.keys(), ...entriesB.keys()])].forEach((id) => {
    const entryA = entriesA.get(id);
    const entryB = entriesB.get(id);
    if (Boolean(entryA) === Boolean(entryB)) return;
    const entry = entryA || entryB;
    const existing = rowsById.get(id);
    if (existing) {
      existing.sourcesA = entryA?.sources || [];
      existing.sourcesB = entryB?.sources || [];
      return;
    }
    rowsById.set(id, {
      id,
      categoryKey: entry.categoryKey,
      label: entry.label,
      detail: entry.detail,
      detailKey: entry.detailKey,
      valueA: Boolean(entryA),
      valueB: Boolean(entryB),
      sourcesA: entryA?.sources || [],
      sourcesB: entryB?.sources || []
    });
  });
  return [...rowsById.values()].sort((left, right) => {
    const category = left.categoryKey.localeCompare(right.categoryKey);
    return category || left.label.localeCompare(right.label);
  });
}

function renderComparison(comparison) {
  const { userA, userB, rows, unknownCount } = comparison;
  compareSummary.replaceChildren();
  const differentCount = rows.length;
  [[t(comparison.scopeMetricKey), comparison.scopeMetricCount], [t("permissionExplorer.compare.differences"), differentCount], [t("permissionExplorer.compare.unknown"), unknownCount]].forEach(([label, value]) => {
    const chip = document.createElement("span");
    const number = document.createElement("strong");
    number.textContent = String(value);
    chip.append(number, document.createTextNode(` ${label}`));
    compareSummary.appendChild(chip);
  });

  compareTable.replaceChildren();
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  [t("permissionExplorer.compare.resource"), `${t("permissionExplorer.compare.userA")}: ${userA.Name}`, `${t("permissionExplorer.compare.userB")}: ${userB.Name}`, t("permissionExplorer.compare.reason")].forEach((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.appendChild(cell);
  });
  head.appendChild(headRow);
  compareTable.appendChild(head);

  const body = document.createElement("tbody");
  rows.forEach((difference) => {
    const row = document.createElement("tr");
    const resource = document.createElement("td");
    resource.className = "permission-explorer-compare-resource";
    const objectName = document.createElement("strong");
    objectName.textContent = `${t(`permissionExplorer.inventory.category.${difference.categoryKey}`)} · ${difference.label}`;
    const permission = document.createElement("small");
    permission.textContent = difference.detailKey ? t(difference.detailKey) : difference.detail || "";
    resource.append(objectName, permission);
    row.appendChild(resource);
    appendCompareCell(row, difference.valueA, true, difference.sourcesA);
    appendCompareCell(row, difference.valueB, true, difference.sourcesB);
    const evidence = document.createElement("td");
    evidence.className = "permission-explorer-difference";
    evidence.textContent = t("permissionExplorer.compare.changedValue");
    row.appendChild(evidence);
    body.appendChild(row);
  });
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "permission-explorer-compare-empty";
    cell.textContent = t("permissionExplorer.compare.noDifferences");
    row.appendChild(cell);
    body.appendChild(row);
  }
  compareTable.appendChild(body);
  compareResults.hidden = false;
}

async function compareUsers() {
  if (!selectedUser || !selectedCompareUser) {
    setStatus(status, t("permissionExplorer.compare.status.pickUsers"), true);
    return;
  }
  const objectName = objectInput.value.trim();
  if (objectName && !isSafeSalesforceName(objectName)) {
    setStatus(status, t("permissionExplorer.compare.status.badObject"), true);
    return;
  }

  const currentOperation = ++compareOperationId;
  compareButton.disabled = true;
  compareResults.hidden = true;
  inventorySection.hidden = true;
  answer.hidden = true;
  matrixSection.hidden = true;
  fieldsSection.hidden = true;
  evidenceSection.hidden = true;
  stats.hidden = true;
  exportCsvButton.hidden = true;
  setStatus(status, t("permissionExplorer.status.resolving"));
  try {
    const [parentsA, parentsB] = await Promise.all([
      loadParentsForUser(selectedUser, currentOperation),
      loadParentsForUser(selectedCompareUser, currentOperation)
    ]);
    if (currentOperation !== compareOperationId) return;
    if (!parentsA.length || !parentsB.length) {
      throw new Error(t("permissionExplorer.compare.status.noAssignments"));
    }
    const loadRows = objectName ? loadObjectAccessRows : loadAllObjectAccessRows;
    const [rowsA, rowsB, inventoryA, inventoryB] = await Promise.all([
      loadRows(session.host, session.sid, parentsA.map((parent) => parent.id), objectName),
      loadRows(session.host, session.sid, parentsB.map((parent) => parent.id), objectName),
      objectName ? Promise.resolve(null) : loadMetadataInventory(parentsA),
      objectName ? Promise.resolve(null) : loadMetadataInventory(parentsB)
    ]);
    if (currentOperation !== compareOperationId) return;
    const matrixA = buildObjectAccessMatrix(rowsA, parentsA);
    const matrixB = buildObjectAccessMatrix(rowsB, parentsB);
    const effectiveByObjectA = new Map(matrixA.objects.map((entry) => [entry.object, entry.effective]));
    const effectiveByObjectB = new Map(matrixB.objects.map((entry) => [entry.object, entry.effective]));
    const objectNames = objectName
      ? [objectName]
      : [...new Set([...effectiveByObjectA.keys(), ...effectiveByObjectB.keys()])].sort((left, right) => left.localeCompare(right));
    const differenceSet = buildComparisonRows(objectNames, effectiveByObjectA, effectiveByObjectB);
    const comparisonRows = objectName
      ? differenceSet.rows
      : buildInventoryComparisonRows(inventoryA, inventoryB, differenceSet.rows);
    const comparison = {
      userA: selectedUser,
      userB: selectedCompareUser,
      object: objectName,
      objectNames,
      rows: comparisonRows,
      sameCount: differenceSet.sameCount,
      unknownCount: Number(matrixA.discardedCount || 0) + Number(matrixB.discardedCount || 0)
        + Number(inventoryA?.warnings.length || 0) + Number(inventoryB?.warnings.length || 0),
      scopeMetricKey: objectName ? "permissionExplorer.compare.objects" : "permissionExplorer.compare.areas",
      scopeMetricCount: objectName ? 1 : PERMISSION_ACCESS_CATEGORIES.length
    };
    lastComparison = comparison;
    renderComparison(comparison);
    results.hidden = false;
    setStatus(status, t("permissionExplorer.compare.status.complete", {
      userA: selectedUser.Name,
      userB: selectedCompareUser.Name,
      object: objectName || t("permissionExplorer.compare.allAccess")
    }));
  } catch (error) {
    if (currentOperation === compareOperationId) setStatus(status, error, true);
  } finally {
    if (currentOperation === compareOperationId) compareButton.disabled = false;
  }
}

function renderPermGrid(effective, fields) {
  permGrid.replaceChildren();
  fields.forEach((entry) => {
    const cell = document.createElement("div");
    cell.className = `permission-explorer-perm ${effective[entry.key] ? "granted" : "denied"}`;
    cell.dataset.perm = entry.key;
    const label = document.createElement("strong");
    label.textContent = t(entry.labelKey);
    const state = document.createElement("span");
    state.className = "permission-explorer-perm-state";
    state.textContent = effective[entry.key] ? t("permissionExplorer.yes") : t("permissionExplorer.no");
    cell.append(label, state);
    permGrid.appendChild(cell);
  });
}

function renderEvidence(evidence) {
  evidenceList.replaceChildren();
  evidence.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "permission-explorer-grant";
    card.dataset.kind = entry.kind;

    const head = document.createElement("div");
    head.className = "permission-explorer-grant-head";

    const kind = document.createElement("span");
    kind.className = `permission-explorer-kind ${entry.kind}`;
    kind.textContent = kindLabel(entry.kind);

    const name = document.createElement("span");
    name.className = "permission-explorer-grant-name";
    name.textContent = entry.label;

    const link = document.createElement("a");
    link.className = "permission-explorer-setup-link";
    link.href = setupUrl(entry.kind, entry.parentId, entry.groupId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("permissionExplorer.openSetup");

    head.append(kind, name, link);
    card.appendChild(head);

    const tags = document.createElement("div");
    tags.className = "permission-explorer-grant-perms";
    entry.grants.forEach((key) => {
      const field = [...OBJECT_PERMISSION_FIELDS, ...FIELD_PERMISSION_FIELDS].find((item) => item.key === key);
      const tag = document.createElement("span");
      tag.className = "permission-explorer-tag";
      tag.textContent = field ? t(field.labelKey) : key;
      tags.appendChild(tag);
    });
    card.appendChild(tags);

    if (entry.groupStatus && entry.groupStatus !== "Updated") {
      const pill = document.createElement("span");
      pill.className = "permission-explorer-status-pill";
      pill.textContent = t("permissionExplorer.group.recalculating");
      head.appendChild(pill);
    }

    if (entry.kind === "group" && entry.groupId) {
      const details = document.createElement("details");
      details.className = "permission-explorer-composition";
      const summary = document.createElement("summary");
      summary.textContent = t("permissionExplorer.group.composition");
      details.appendChild(summary);
      const body = document.createElement("div");
      body.className = "permission-explorer-members";
      const note = document.createElement("p");
      note.className = "permission-explorer-member-note";
      note.textContent = t("permissionExplorer.group.note");
      body.appendChild(note);
      details.appendChild(body);
      details.addEventListener(
        "toggle",
        async () => {
          if (!details.open || details.dataset.loaded === "true") return;
          details.dataset.loaded = "true";
          try {
            const components = await loadPermissionSetGroupComponents(session.host, session.sid, entry.groupId);
            components.forEach((component) => {
              const member = document.createElement("div");
              member.className = "permission-explorer-member";
              member.textContent = component.PermissionSet?.Label || component.PermissionSet?.Name || "";
              body.appendChild(member);
            });
            if (!components.length) {
              const empty = document.createElement("div");
              empty.className = "permission-explorer-member";
              empty.textContent = t("permissionExplorer.group.empty");
              body.appendChild(empty);
            }
          } catch (error) {
            const failed = document.createElement("div");
            failed.className = "permission-explorer-member error";
            failed.textContent = formatUserFacingMessage(error);
            body.appendChild(failed);
          }
        },
        { once: false }
      );
      card.appendChild(details);
    }

    evidenceList.appendChild(card);
  });
}

function renderStats(matrix) {
  stats.replaceChildren();
  const entries = [
    { value: matrix.objects.length, label: t("permissionExplorer.stats.objects") },
    { value: matrix.grantingParentCount, label: t("permissionExplorer.stats.records", { total: assignedParents.length }) },
    { value: matrix.overlapCount, label: t("permissionExplorer.stats.overlap"), flag: true }
  ];
  entries.forEach((entry) => {
    const card = document.createElement("div");
    card.className = `permission-explorer-stat${entry.flag ? " flag" : ""}`;
    const value = document.createElement("b");
    value.textContent = String(entry.value);
    const label = document.createElement("span");
    label.textContent = entry.label;
    card.append(value, label);
    stats.appendChild(card);
  });
  stats.hidden = false;
}

function renderMatrix(matrix) {
  matrixTable.replaceChildren();
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const objectHead = document.createElement("th");
  objectHead.scope = "col";
  objectHead.textContent = t("permissionExplorer.object");
  headRow.appendChild(objectHead);
  OBJECT_PERMISSION_FIELDS.forEach((entry) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = t(entry.labelKey);
    headRow.appendChild(cell);
  });
  const sourceHead = document.createElement("th");
  sourceHead.scope = "col";
  sourceHead.textContent = t("permissionExplorer.matrix.grantedBy");
  headRow.appendChild(sourceHead);
  const actionHead = document.createElement("th");
  actionHead.scope = "col";
  actionHead.textContent = t("permissionExplorer.matrix.action");
  headRow.appendChild(actionHead);
  head.appendChild(headRow);
  matrixTable.appendChild(head);

  const body = document.createElement("tbody");
  matrix.objects.forEach((entry) => {
    const row = document.createElement("tr");
    row.dataset.object = entry.object;
    const name = document.createElement("td");
    name.className = "permission-explorer-matrix-object";
    name.textContent = entry.object;
    row.appendChild(name);
    OBJECT_PERMISSION_FIELDS.forEach((field) => {
      const cell = document.createElement("td");
      cell.className = "permission-explorer-matrix-cell";
      cell.dataset.perm = field.key;
      cell.dataset.granted = String(entry.effective[field.key] === true);
      cell.textContent = entry.effective[field.key] ? "✓" : "—";
      row.appendChild(cell);
    });
    const sources = document.createElement("td");
    sources.className = "permission-explorer-matrix-sources";
    entry.sources.forEach((kind) => {
      const chip = document.createElement("i");
      chip.className = `permission-explorer-source ${kind}`;
      chip.title = kindLabel(kind);
      chip.textContent = kindLabel(kind).slice(0, 1);
      sources.appendChild(chip);
    });
    if (entry.parentCount > 1) {
      const overlap = document.createElement("span");
      overlap.className = "permission-explorer-overlap";
      overlap.textContent = t("permissionExplorer.matrix.records", { count: entry.parentCount });
      sources.appendChild(overlap);
    }
    row.appendChild(sources);
    const action = document.createElement("td");
    const drill = document.createElement("button");
    drill.type = "button";
    drill.className = "permission-explorer-drill";
    drill.textContent = t("permissionExplorer.matrix.explain");
    drill.addEventListener("click", () => {
      objectInput.value = entry.object;
      fieldInput.value = "";
      void explain();
    });
    action.appendChild(drill);
    row.appendChild(action);
    body.appendChild(row);
  });
  matrixTable.appendChild(body);
  matrixNote.textContent = t("permissionExplorer.matrix.note", { count: matrix.objects.length });
  matrixSection.hidden = false;
}

function renderFields(matrix, objectName) {
  fieldsTable.replaceChildren();
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  [t("permissionExplorer.fields.field"), t("permissionExplorer.fields.label"), ...FIELD_PERMISSION_FIELDS.map((entry) => t(entry.labelKey)), t("permissionExplorer.matrix.grantedBy")]
    .forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.appendChild(cell);
    });
  head.appendChild(headRow);
  fieldsTable.appendChild(head);

  const body = document.createElement("tbody");
  matrix.fields.forEach((entry) => {
    const row = document.createElement("tr");
    row.dataset.field = entry.field;
    row.dataset.governed = String(entry.governed);

    const name = document.createElement("td");
    name.className = "permission-explorer-matrix-object";
    name.textContent = entry.field;
    row.appendChild(name);

    const label = document.createElement("td");
    label.textContent = entry.label || "";
    row.appendChild(label);

    FIELD_PERMISSION_FIELDS.forEach((field) => {
      const cell = document.createElement("td");
      cell.className = "permission-explorer-matrix-cell";
      cell.dataset.perm = field.key;
      if (!entry.governed) {
        // Not governed by FLS is not the same as denied, so it must not render
        // with the same dash the denied cells use.
        cell.dataset.granted = "n/a";
        cell.textContent = "—";
        cell.title = t("permissionExplorer.fields.notGoverned");
      } else {
        cell.dataset.granted = String(entry.effective[field.key] === true);
        cell.textContent = entry.effective[field.key] ? "✓" : "—";
      }
      row.appendChild(cell);
    });

    const sources = document.createElement("td");
    sources.className = "permission-explorer-matrix-sources";
    if (entry.governed) {
      entry.sources.forEach((kind) => {
        const chip = document.createElement("i");
        chip.className = `permission-explorer-source ${kind}`;
        chip.title = kindLabel(kind);
        chip.textContent = kindLabel(kind).slice(0, 1);
        sources.appendChild(chip);
      });
      if (entry.parentCount > 1) {
        const overlap = document.createElement("span");
        overlap.className = "permission-explorer-overlap";
        overlap.textContent = t("permissionExplorer.matrix.records", { count: entry.parentCount });
        sources.appendChild(overlap);
      }
    } else {
      const note = document.createElement("span");
      note.className = "permission-explorer-not-governed";
      note.textContent = t("permissionExplorer.fields.notGoverned");
      sources.appendChild(note);
    }
    row.appendChild(sources);
    body.appendChild(row);
  });
  fieldsTable.appendChild(body);

  fieldsNote.textContent = t("permissionExplorer.fields.note", {
    object: objectName,
    readable: matrix.readableCount,
    total: matrix.fields.length,
    exempt: matrix.fields.length - matrix.governedCount
  });
  fieldsSection.hidden = false;
}

function renderDenied(objectName) {
  deniedPanel.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = t("permissionExplorer.denied.title", { user: selectedUser.Name, object: objectName });
  const body = document.createElement("p");
  body.textContent = t("permissionExplorer.denied.body", { count: assignedParents.length });
  const list = document.createElement("ul");
  list.className = "permission-explorer-checked-list";
  assignedParents.forEach((parent) => {
    const item = document.createElement("li");
    item.textContent = `${kindLabel(parent.kind)}: ${parent.label}`;
    list.appendChild(item);
  });
  deniedPanel.append(title, body, list);
  deniedPanel.hidden = false;
}

async function explain() {
  if (!session) return;
  if (!selectedUser) {
    setStatus(status, t("permissionExplorer.status.pickUser"), true);
    return;
  }
  const objectName = objectInput.value.trim();
  const fieldName = fieldInput.value.trim();
  if (objectName && !isSafeSalesforceName(objectName)) {
    setStatus(status, t("permissionExplorer.status.badObject", { object: objectName }), true);
    return;
  }
  if (fieldName && !objectName) {
    setStatus(status, t("permissionExplorer.status.fieldNeedsObject"), true);
    return;
  }
  if (fieldName && !isSafeSalesforceName(fieldName)) {
    setStatus(status, t("permissionExplorer.status.badField", { field: fieldName }), true);
    return;
  }

  const currentOperation = ++operationId;
  explainButton.disabled = true;
  lastComparison = null;
  compareResults.hidden = true;
  setStatus(status, t("permissionExplorer.status.resolving"));
  answer.hidden = true;
  deniedPanel.hidden = true;
  fieldNote.hidden = true;
  matrixSection.hidden = true;
  fieldsSection.hidden = true;
  evidenceSection.hidden = true;
  stats.hidden = true;
  inventorySection.hidden = true;

  try {
    const parents = await ensureAssignedParents(currentOperation);
    if (currentOperation !== operationId) return;
    if (!parents.length) {
      setStatus(status, t("permissionExplorer.status.noAssignments", { user: selectedUser.Name }), true);
      return;
    }
    const parentIds = parents.map((parent) => parent.id);

    if (!objectName) {
      const [rows, inventory] = await Promise.all([
        loadAllObjectAccessRows(session.host, session.sid, parentIds),
        loadMetadataInventory(parents)
      ]);
      if (currentOperation !== operationId) return;
      const matrix = buildObjectAccessMatrix(rows, parents);
      lastMatrix = matrix;
      lastAnswer = null;
      lastInventory = { inventory, parents };
      renderStats(matrix);
      renderMatrix(matrix);
      renderInventory(inventory, parents);
      results.hidden = false;
      exportCsvButton.hidden = false;
      setStatus(status, t("permissionExplorer.status.inventoryReady", {
        objects: matrix.objects.length,
        grants: inventory.categories.reduce((total, category) => total + category.entries.length, 0),
        user: selectedUser.Name
      }));
      return;
    }

    lastInventory = null;

    const objectRows = await loadObjectAccessRows(session.host, session.sid, parentIds, objectName);
    if (currentOperation !== operationId) return;
    const objectAnswer = resolveObjectAccess(objectRows, parents);

    if (!fieldName) {
      lastAnswer = { object: objectName, field: "", ...objectAnswer };
      targetTitle.textContent = objectName;
      targetNote.textContent = t("permissionExplorer.target.note", { count: parents.length });
      verdict.textContent = objectAnswer.hasAnyAccess ? t("permissionExplorer.verdict.yes") : t("permissionExplorer.verdict.no");
      verdict.className = `permission-explorer-verdict ${objectAnswer.hasAnyAccess ? "yes" : "no"}`;
      renderPermGrid(objectAnswer.effective, OBJECT_PERMISSION_FIELDS);
      if (!objectAnswer.hasAnyAccess) renderDenied(objectName);
      renderEvidence(objectAnswer.evidence);
      evidenceSection.hidden = !objectAnswer.evidence.length;
      answer.hidden = false;
      results.hidden = false;
      exportCsvButton.hidden = true;
      setStatus(status, "");

      // Fields for one object are cheap once scoped to the user's assigned
      // records, so the object answer always carries its field list. A failure
      // here must not discard the object answer already on screen.
      try {
        const [fieldRows, describe] = await Promise.all([
          loadObjectFieldAccessRows(session.host, session.sid, parentIds, objectName),
          getSObjectDescribe(session.host, session.sid, objectName).catch(() => null)
        ]);
        if (currentOperation !== operationId) return;
        const fieldMatrix = buildFieldAccessMatrix(fieldRows, parents, describe?.fields || []);
        lastFieldMatrix = { object: objectName, ...fieldMatrix };
        renderFields(fieldMatrix, objectName);
      } catch (error) {
        if (currentOperation !== operationId) return;
        fieldsSection.hidden = true;
        setStatus(status, error, true);
      }
      return;
    }

    const fieldRows = await loadFieldAccessRows(session.host, session.sid, parentIds, objectName, fieldName);
    if (currentOperation !== operationId) return;
    const fieldAnswer = resolveFieldAccess(fieldRows, parents);
    const governed = isFieldGovernedByFls(fieldRows, parents);
    lastAnswer = { object: objectName, field: fieldName, ...fieldAnswer };

    targetTitle.textContent = `${objectName}.${fieldName}`;
    targetNote.textContent = objectAnswer.effective.read
      ? t("permissionExplorer.target.fieldApplies")
      : t("permissionExplorer.target.fieldMoot", { object: objectName });
    verdict.textContent = fieldAnswer.hasAnyAccess ? t("permissionExplorer.verdict.yes") : t("permissionExplorer.verdict.no");
    verdict.className = `permission-explorer-verdict ${fieldAnswer.hasAnyAccess ? "yes" : "no"}`;
    renderPermGrid(fieldAnswer.effective, FIELD_PERMISSION_FIELDS);
    renderEvidence(fieldAnswer.evidence);
    evidenceSection.hidden = !fieldAnswer.evidence.length;

    if (!governed) {
      fieldNote.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = t("permissionExplorer.field.notGoverned.title", { object: objectName, field: fieldName });
      const body = document.createElement("p");
      body.textContent = t("permissionExplorer.field.notGoverned.body");
      fieldNote.append(strong, body);
      fieldNote.hidden = false;
      verdict.textContent = t("permissionExplorer.verdict.notGoverned");
      verdict.className = "permission-explorer-verdict neutral";
    }

    answer.hidden = false;
    results.hidden = false;
    exportCsvButton.hidden = true;
    setStatus(status, "");
  } catch (error) {
    if (currentOperation !== operationId) return;
    setStatus(status, error, true);
  } finally {
    if (currentOperation === operationId) explainButton.disabled = false;
  }
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function scopeNoteText() {
  return `${t("permissionExplorer.scope.title")} ${t("permissionExplorer.scope.body")}`;
}

exportJsonButton.addEventListener("click", () => {
  const payload = lastComparison
    ? {
      generatedAt: new Date().toISOString(),
      comparison: {
        scope: lastComparison.object || "all-assigned-access",
        users: [lastComparison.userA, lastComparison.userB].map((user) => ({ name: user.Name, username: user.Username, profile: user.Profile?.Name || null })),
        differences: lastComparison.rows.map((difference) => ({
          category: difference.categoryKey,
          resource: difference.label,
          permission: difference.detailKey || difference.detail || "",
          userA: difference.valueA,
          userB: difference.valueB,
          sourcesA: difference.sourcesA.map((source) => source.label),
          sourcesB: difference.sourcesB.map((source) => source.label)
        }))
      },
      scope: scopeNoteText()
    }
    : lastAnswer
    ? buildAccessExport({
      user: selectedUser,
      object: lastAnswer.object,
      field: lastAnswer.field,
      effective: lastAnswer.effective,
      evidence: lastAnswer.evidence,
      scopeNote: scopeNoteText()
    })
    : {
      generatedAt: new Date().toISOString(),
      user: selectedUser ? { name: selectedUser.Name, username: selectedUser.Username } : null,
      objects: lastMatrix?.objects || [],
      accessInventory: lastInventory?.inventory.categories.map((category) => ({
        category: category.key,
        observed: category.observed,
        entries: category.entries.map((entry) => ({
          resource: entry.label,
          detail: entry.detailKey || entry.detail,
          sources: entry.sources.map((source) => source.label)
        }))
      })) || [],
      scope: scopeNoteText()
    };
  downloadFile("permission-access.json", JSON.stringify(payload, null, 2), "application/json");
});

exportMarkdownButton.addEventListener("click", () => {
  const lines = [`# Permission access — ${selectedUser?.Name || ""}`, ""];
  if (lastComparison) {
    lines.push(`**Comparison:** ${lastComparison.userA.Name} vs ${lastComparison.userB.Name}`, `**Scope:** ${lastComparison.object || t("permissionExplorer.compare.allAccess")}`, "");
    lines.push("| Access area | Resource | Permission | User A | User B |", "| --- | --- | --- | --- | --- |");
    lastComparison.rows.forEach((difference) => {
      lines.push(`| ${t(`permissionExplorer.inventory.category.${difference.categoryKey}`)} | ${difference.label} | ${difference.detailKey ? t(difference.detailKey) : difference.detail || ""} | ${difference.valueA ? "Yes" : "No"} | ${difference.valueB ? "Yes" : "No"} |`);
    });
    if (!lastComparison.rows.length) lines.push(`| ${lastComparison.object || t("permissionExplorer.compare.allAccess")} | ${t("permissionExplorer.compare.noDifferences")} | — | — | — |`);
  } else if (lastAnswer) {
    lines.push(`**Target:** ${lastAnswer.object}${lastAnswer.field ? `.${lastAnswer.field}` : ""}`, "");
    lines.push("| Permission | Effective |", "| --- | --- |");
    Object.entries(lastAnswer.effective).forEach(([key, value]) => {
      lines.push(`| ${key} | ${value ? "Yes" : "No"} |`);
    });
    lines.push("", "## Evidence", "");
    lastAnswer.evidence.forEach((entry) => {
      lines.push(`- **${entry.label}** (${entry.kind}) — ${entry.grants.join(", ")}`);
    });
  } else if (lastMatrix) {
    lines.push(`**Objects:** ${lastMatrix.objects.length}`, "");
    lines.push("| Object | Read | Create | Edit | Delete | View All | Modify All | Records |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    lastMatrix.objects.forEach((entry) => {
      const cells = OBJECT_PERMISSION_FIELDS.map((field) => (entry.effective[field.key] ? "Yes" : "No"));
      lines.push(`| ${entry.object} | ${cells.join(" | ")} | ${entry.parentCount} |`);
    });
    if (lastInventory) {
      lastInventory.inventory.categories.filter((category) => category.entries.length).forEach((category) => {
        lines.push("", `## ${t(`permissionExplorer.inventory.category.${category.key}`)}`, "");
        category.entries.forEach((entry) => {
          const detail = entry.detailKey ? t(entry.detailKey) : entry.detail;
          lines.push(`- **${entry.label}**${detail ? ` — ${detail}` : ""} (${entry.sources.map((source) => source.label).join(", ")})`);
        });
      });
    }
  }
  lines.push("", `> ${scopeNoteText()}`);
  downloadFile("permission-access.md", lines.join("\n"), "text/markdown");
});

exportCsvButton.addEventListener("click", () => {
  if (!lastMatrix) return;
  const header = ["Object", ...OBJECT_PERMISSION_FIELDS.map((field) => field.key), "GrantingRecords"];
  const rows = lastMatrix.objects.map((entry) => [
    entry.object,
    ...OBJECT_PERMISSION_FIELDS.map((field) => (entry.effective[field.key] ? "Yes" : "No")),
    String(entry.parentCount)
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("permission-access.csv", csv, "text/csv");
});

explainButton.addEventListener("click", () => void explain());
compareButton.addEventListener("click", () => void compareUsers());
resetButton.addEventListener("click", () => {
  operationId += 1;
  compareOperationId += 1;
  selectedUser = null;
  selectedCompareUser = null;
  assignedParents = [];
  lastAnswer = null;
  lastMatrix = null;
  lastFieldMatrix = null;
  lastComparison = null;
  lastInventory = null;
  userInput.value = "";
  if (compareUserInput) compareUserInput.value = "";
  objectInput.value = "";
  fieldInput.value = "";
  results.hidden = true;
  answer.hidden = true;
  matrixSection.hidden = true;
  fieldsSection.hidden = true;
  evidenceSection.hidden = true;
  stats.hidden = true;
  inventorySection.hidden = true;
  if (compareResults) compareResults.hidden = true;
  setStatus(status, "");
});

async function loadObjectChoices() {
  try {
    const response = await fetch(`https://${session.host}/services/data/v67.0/sobjects/`, {
      headers: { Authorization: `Bearer ${session.sid}`, Accept: "application/json" }
    });
    const data = await response.json();
    objectChoices = (data?.sobjects || []).filter((entry) => entry.queryable).map((entry) => entry.name).sort();
  } catch (_error) {
    objectChoices = [];
  }
}

async function init() {
  explainButton.disabled = true;
  compareButton.disabled = true;
  try {
    const host = params.get("host");
    if (!host) throw new Error("Missing host parameter. Open Permission Explorer from the popup Apps tab while connected to Salesforce.");
    session = await getSessionForHost(host);
    setStatus(sessionStatus, t("permissionExplorer.status.connected", { host: session.host }));
    explainButton.disabled = false;
    compareButton.disabled = false;
    await loadObjectChoices();
  } catch (error) {
    setStatus(sessionStatus, error instanceof Error ? error.message : String(error), true);
  }
}

void init();

window.addEventListener("app-language-change", () => {
  mountPermissionExplorerHeader();
  if (session?.host) {
    setStatus(sessionStatus, t("permissionExplorer.status.connected", { host: session.host }));
  }
  if (lastMatrix) {
    renderStats(lastMatrix);
    renderMatrix(lastMatrix);
  }
  if (lastInventory) renderInventory(lastInventory.inventory, lastInventory.parents);
  if (lastAnswer) void explain();
  if (lastComparison) renderComparison(lastComparison);
});
