// Pure effective-access logic for the Permission & Access Explorer.
// No network, no DOM: every function here takes Salesforce records and returns
// a resolved answer, so the scoping and union rules can be tested directly.

export const OBJECT_PERMISSION_FIELDS = [
  { key: "read", field: "PermissionsRead", labelKey: "permissionExplorer.perm.read", short: "R" },
  { key: "create", field: "PermissionsCreate", labelKey: "permissionExplorer.perm.create", short: "C" },
  { key: "edit", field: "PermissionsEdit", labelKey: "permissionExplorer.perm.edit", short: "E" },
  { key: "delete", field: "PermissionsDelete", labelKey: "permissionExplorer.perm.delete", short: "D" },
  { key: "viewAll", field: "PermissionsViewAllRecords", labelKey: "permissionExplorer.perm.viewAll", short: "VA" },
  { key: "modifyAll", field: "PermissionsModifyAllRecords", labelKey: "permissionExplorer.perm.modifyAll", short: "MA" }
];

export const FIELD_PERMISSION_FIELDS = [
  { key: "read", field: "PermissionsRead", labelKey: "permissionExplorer.perm.read" },
  { key: "edit", field: "PermissionsEdit", labelKey: "permissionExplorer.perm.edit" }
];

const SAFE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15,18}$/;

// Salesforce has no deny row: an unset permission is simply absent. Anything a
// caller passes that is not a real Salesforce ID is rejected rather than
// escaped, because these values are only ever record IDs we just queried.
export function isSalesforceId(value) {
  return typeof value === "string" && SALESFORCE_ID_PATTERN.test(value);
}

export function isSafeSalesforceName(value) {
  return typeof value === "string" && SAFE_NAME_PATTERN.test(value);
}

export function escapeSoqlLiteral(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function buildIdListLiteral(ids = []) {
  const safe = ids.filter(isSalesforceId);
  if (!safe.length) return "";
  return safe.map((id) => `'${id}'`).join(", ");
}

// A user's assigned records are the profile-owned permission set, ordinary
// permission sets, and the aggregate permission set of any assigned group.
// Salesforce resolves group membership and muting into that aggregate, so the
// aggregate is the grant and the group's members only explain it (F3).
export function classifyPermissionParent(permissionSet = {}) {
  if (permissionSet.IsOwnedByProfile === true || permissionSet.Type === "Profile") return "profile";
  if (permissionSet.Type === "Group" || permissionSet.PermissionSetGroupId) return "group";
  return "permissionSet";
}

export function normalizeAssignment(record = {}) {
  const permissionSet = record.PermissionSet || {};
  const kind = classifyPermissionParent(permissionSet);
  return {
    id: record.PermissionSetId,
    kind,
    label: pickParentLabel(permissionSet, kind, record),
    apiName: permissionSet.Name || "",
    groupId: permissionSet.PermissionSetGroupId || record.PermissionSetGroupId || null,
    groupStatus: permissionSet.PermissionSetGroup?.Status || null
  };
}

function pickParentLabel(permissionSet, kind, record) {
  if (kind === "profile") {
    // A profile-owned permission set labels itself with an internal token such
    // as "00ex00000018ozh_128_09_04", so the profile's own name is the only
    // label worth showing a user.
    return record.Assignee?.Profile?.Name || permissionSet.Profile?.Name || permissionSet.Label || "";
  }
  return permissionSet.Label || permissionSet.Name || "";
}

export function normalizeAssignments(records = [], { profileName = "" } = {}) {
  const seen = new Map();
  records.forEach((record) => {
    const parent = normalizeAssignment(record);
    if (!isSalesforceId(parent.id) || seen.has(parent.id)) return;
    if (parent.kind === "profile" && profileName) parent.label = profileName;
    seen.set(parent.id, parent);
  });
  return Array.from(seen.values());
}

function emptyEffective(fields) {
  return fields.reduce((acc, entry) => {
    acc[entry.key] = false;
    return acc;
  }, {});
}

// The core scoping rule (F1). ObjectPermissions.ParentId is polymorphic in
// practice: it also returns PermissionSetLicense (0PL) and UserLicense (100)
// rows whose Parent does not resolve to a PermissionSet. Those rows are real
// Salesforce data but say nothing about this user, so they are discarded here
// rather than rendered as evidence.
function partitionRows(rows, assignedParents) {
  const byId = new Map(assignedParents.map((parent) => [parent.id, parent]));
  const attributable = [];
  const discarded = [];
  rows.forEach((row) => {
    const parent = byId.get(row.ParentId);
    if (parent) attributable.push({ row, parent });
    else discarded.push(row);
  });
  return { attributable, discarded };
}

function grantsFrom(row, fields) {
  return fields.filter((entry) => row[entry.field] === true).map((entry) => entry.key);
}

function resolveAccess(rows, assignedParents, fields) {
  const { attributable, discarded } = partitionRows(rows, assignedParents);
  const effective = emptyEffective(fields);
  const evidence = [];

  attributable.forEach(({ row, parent }) => {
    const grants = grantsFrom(row, fields);
    grants.forEach((key) => {
      effective[key] = true;
    });
    if (!grants.length) return;
    evidence.push({
      parentId: parent.id,
      label: parent.label,
      kind: parent.kind,
      groupId: parent.groupId,
      groupStatus: parent.groupStatus,
      grants
    });
  });

  return {
    effective,
    evidence,
    discardedCount: discarded.length,
    hasAnyAccess: fields.some((entry) => effective[entry.key] === true)
  };
}

export function resolveObjectAccess(rows = [], assignedParents = []) {
  return resolveAccess(rows, assignedParents, OBJECT_PERMISSION_FIELDS);
}

export function resolveFieldAccess(rows = [], assignedParents = []) {
  return resolveAccess(rows, assignedParents, FIELD_PERMISSION_FIELDS);
}

// One row per object, union across every assigned record that grants it.
// `sources` and `parentCount` exist so the caller can show that revoking one
// record may not remove access, which a single-object view hides.
export function buildObjectAccessMatrix(rows = [], assignedParents = []) {
  const { attributable, discarded } = partitionRows(rows, assignedParents);
  const byObject = new Map();

  attributable.forEach(({ row, parent }) => {
    const objectName = row.SobjectType;
    if (!objectName) return;
    const grants = grantsFrom(row, OBJECT_PERMISSION_FIELDS);
    if (!grants.length) return;

    let entry = byObject.get(objectName);
    if (!entry) {
      entry = {
        object: objectName,
        effective: emptyEffective(OBJECT_PERMISSION_FIELDS),
        sources: [],
        parentIds: []
      };
      byObject.set(objectName, entry);
    }
    grants.forEach((key) => {
      entry.effective[key] = true;
    });
    if (!entry.parentIds.includes(parent.id)) entry.parentIds.push(parent.id);
    if (!entry.sources.includes(parent.kind)) entry.sources.push(parent.kind);
  });

  const objects = Array.from(byObject.values())
    .map((entry) => ({ ...entry, parentCount: entry.parentIds.length }))
    .sort((a, b) => a.object.localeCompare(b.object));

  return {
    objects,
    discardedCount: discarded.length,
    overlapCount: objects.filter((entry) => entry.parentCount > 1).length,
    grantingParentCount: new Set(objects.flatMap((entry) => entry.parentIds)).size
  };
}

export const PERMISSION_ACCESS_CATEGORIES = [
  { key: "assignedApps", metadataKeys: ["applicationVisibilities"] },
  { key: "assignedConnectedApps", metadataKeys: ["connectedAppAccesses"] },
  { key: "objectSettings", metadataKeys: ["objectPermissions", "fieldPermissions", "tabSettings", "recordTypeVisibilities"] },
  { key: "appPermissions", metadataKeys: ["applicationPermissions"] },
  { key: "apexClassAccess", metadataKeys: ["classAccesses"] },
  { key: "visualforcePageAccess", metadataKeys: ["pageAccesses"] },
  { key: "externalDataSourceAccess", metadataKeys: ["externalDataSourceAccesses"] },
  { key: "flowAccess", metadataKeys: ["flowAccesses"] },
  { key: "namedCredentialAccess", metadataKeys: ["namedCredentialAccesses"] },
  { key: "externalCredentialPrincipalAccess", metadataKeys: ["externalCredentialPrincipalAccesses"] },
  { key: "dataCategoryVisibility", metadataKeys: ["dataCategoryGroupVisibilities"] },
  { key: "servicePresenceStatusesAccess", metadataKeys: ["servicePresenceStatusAccesses"] },
  { key: "customPermissions", metadataKeys: ["customPermissions"] },
  { key: "customMetadataTypes", metadataKeys: ["customMetadataTypeAccesses"] },
  { key: "customSettingDefinitions", metadataKeys: ["customSettingAccesses"] },
  { key: "orgWideEmailAddressAccess", metadataKeys: ["orgWideEmailAddressAccesses"] },
  { key: "standardInvocableActionAccess", metadataKeys: ["standardInvocableActionAccesses"] },
  { key: "emailToCaseRoutingAddressAccess", metadataKeys: ["emailToCaseRoutingAddressAccesses", "emailRoutingAddressAccesses"] },
  { key: "systemPermissions", metadataKeys: ["userPermissions"] },
  { key: "serviceProviders", metadataKeys: ["serviceProviderAccesses"] },
  { key: "other", metadataKeys: [] }
];

const CATEGORY_BY_METADATA_KEY = new Map(
  PERMISSION_ACCESS_CATEGORIES.flatMap((category) => category.metadataKeys.map((metadataKey) => [metadataKey, category.key]))
);
const METADATA_SCALAR_KEYS = new Set(["fullName", "label", "description", "license", "hasActivationRequired"]);

function arrayValue(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function metadataBoolean(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function readablePermissionName(value = "") {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addInventoryEntry(categoryMap, categoryKey, entry, parent) {
  if (!entry?.id || !entry?.label) return;
  const category = categoryMap.get(categoryKey);
  if (!category) return;
  let existing = category.entriesById.get(entry.id);
  if (!existing) {
    existing = { ...entry, categoryKey, sources: [] };
    category.entriesById.set(entry.id, existing);
  }
  if (parent && !existing.sources.some((source) => source.id === parent.id)) {
    existing.sources.push({ id: parent.id, label: parent.label, kind: parent.kind });
  }
}

function addObjectPermissionEntries(categoryMap, item, parent) {
  const objectName = String(item?.object || "").trim();
  if (!objectName) return;
  [
    ["allowRead", "read"],
    ["allowCreate", "create"],
    ["allowEdit", "edit"],
    ["allowDelete", "delete"],
    ["viewAllRecords", "viewAll"],
    ["modifyAllRecords", "modifyAll"]
  ].forEach(([metadataField, permission]) => {
    if (!metadataBoolean(item?.[metadataField])) return;
    addInventoryEntry(categoryMap, "objectSettings", {
      id: `object:${objectName}:${permission}`,
      label: objectName,
      detailKey: OBJECT_PERMISSION_FIELDS.find((field) => field.key === permission)?.labelKey || "",
      metadataKey: "objectPermissions"
    }, parent);
  });
}

function addFieldPermissionEntries(categoryMap, item, parent) {
  const fieldName = String(item?.field || "").trim();
  if (!fieldName) return;
  [["readable", "read"], ["editable", "edit"]].forEach(([metadataField, permission]) => {
    if (!metadataBoolean(item?.[metadataField])) return;
    addInventoryEntry(categoryMap, "objectSettings", {
      id: `field:${fieldName}:${permission}`,
      label: fieldName,
      detailKey: FIELD_PERMISSION_FIELDS.find((field) => field.key === permission)?.labelKey || "",
      metadataKey: "fieldPermissions"
    }, parent);
  });
}

function metadataEntryName(item, metadataKey) {
  if (typeof item === "string") return item;
  const candidates = [
    "name", "application", "connectedApp", "apexClass", "apexPage", "externalDataSource", "flow",
    "namedCredential", "externalCredentialPrincipal", "dataCategoryGroup", "servicePresenceStatus",
    "customMetadataType", "customSetting", "orgWideEmailAddress", "standardInvocableAction",
    "emailRoutingAddress", "serviceProvider", "recordType", "tab"
  ];
  for (const key of candidates) {
    const value = String(item?.[key] || "").trim();
    if (value) return value;
  }
  return metadataKey;
}

function shouldIncludeMetadataEntry(item) {
  if (!item || typeof item !== "object") return Boolean(item);
  if (Object.hasOwn(item, "enabled") && !metadataBoolean(item.enabled)) return false;
  if (Object.hasOwn(item, "visible") && !metadataBoolean(item.visible)) return false;
  if (["hidden", "none"].includes(String(item.visibility || "").toLowerCase())) return false;
  return true;
}

export function buildPermissionMetadataInventory(metadataRecords = [], assignedParents = []) {
  const parentById = new Map(assignedParents.map((parent) => [parent.id, parent]));
  const categoryMap = new Map(PERMISSION_ACCESS_CATEGORIES.map((definition) => [definition.key, {
    key: definition.key,
    entriesById: new Map(),
    observed: false
  }]));
  const warnings = [];

  metadataRecords.forEach((record) => {
    const parent = parentById.get(record?.parentId) || record?.parent || null;
    if (record?.error) {
      warnings.push({ parent, message: String(record.error) });
      return;
    }
    const metadata = record?.metadata && typeof record.metadata === "object" ? record.metadata : {};
    Object.entries(metadata).forEach(([metadataKey, rawValue]) => {
      if (METADATA_SCALAR_KEYS.has(metadataKey)) return;
      const categoryKey = CATEGORY_BY_METADATA_KEY.get(metadataKey) || "other";
      const category = categoryMap.get(categoryKey);
      category.observed = true;
      arrayValue(rawValue).forEach((item) => {
        if (!shouldIncludeMetadataEntry(item)) return;
        if (metadataKey === "objectPermissions") {
          addObjectPermissionEntries(categoryMap, item, parent);
          return;
        }
        if (metadataKey === "fieldPermissions") {
          addFieldPermissionEntries(categoryMap, item, parent);
          return;
        }
        const name = metadataEntryName(item, metadataKey);
        const detail = typeof item === "object"
          ? String(item.visibility || item.default || item.accessLevel || "").trim()
          : "";
        addInventoryEntry(categoryMap, categoryKey, {
          id: `${metadataKey}:${name}:${detail}`,
          label: name,
          detail: detail || readablePermissionName(metadataKey),
          metadataKey
        }, parent);
      });
    });
  });

  return {
    categories: PERMISSION_ACCESS_CATEGORIES.map((definition) => {
      const category = categoryMap.get(definition.key);
      return {
        key: definition.key,
        observed: category.observed,
        entries: [...category.entriesById.values()].sort((left, right) => left.label.localeCompare(right.label))
      };
    }),
    warnings
  };
}

// A field with no FieldPermissions row is not denied: required, master-detail,
// system, and some formula fields are simply not governed by field-level
// security. Reporting those as "no access" would be the most damaging wrong
// answer this feature could give, so the two cases stay distinct.
export function isFieldGovernedByFls(rows = [], assignedParents = []) {
  return partitionRows(rows, assignedParents).attributable.length > 0;
}

// One row per field of a single object. `describeFields` comes from the object
// describe so fields that FLS does not govern still appear, marked `governed:
// false`, instead of silently vanishing from the list.
export function buildFieldAccessMatrix(rows = [], assignedParents = [], describeFields = []) {
  const { attributable, discarded } = partitionRows(rows, assignedParents);
  const byField = new Map();

  attributable.forEach(({ row, parent }) => {
    const name = String(row.Field || "").split(".")[1];
    if (!name) return;
    let entry = byField.get(name);
    if (!entry) {
      entry = { field: name, governed: true, effective: emptyEffective(FIELD_PERMISSION_FIELDS), sources: [], parentIds: [] };
      byField.set(name, entry);
    }
    grantsFrom(row, FIELD_PERMISSION_FIELDS).forEach((key) => {
      entry.effective[key] = true;
    });
    if (!entry.parentIds.includes(parent.id)) entry.parentIds.push(parent.id);
    if (!entry.sources.includes(parent.kind)) entry.sources.push(parent.kind);
  });

  describeFields.forEach((describeField) => {
    const name = describeField?.name;
    if (!name || byField.has(name)) return;
    byField.set(name, {
      field: name,
      label: describeField.label || "",
      governed: false,
      effective: emptyEffective(FIELD_PERMISSION_FIELDS),
      sources: [],
      parentIds: []
    });
  });

  const labels = new Map(describeFields.filter((entry) => entry?.name).map((entry) => [entry.name, entry.label || ""]));
  const fields = Array.from(byField.values())
    .map((entry) => ({ ...entry, label: entry.label || labels.get(entry.field) || "", parentCount: entry.parentIds.length }))
    .sort((a, b) => a.field.localeCompare(b.field));

  return {
    fields,
    discardedCount: discarded.length,
    governedCount: fields.filter((entry) => entry.governed).length,
    readableCount: fields.filter((entry) => entry.effective.read).length
  };
}

export function buildAccessExport({ user, object, field, effective, evidence, scopeNote } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    user: user ? { name: user.Name, username: user.Username, profile: user.Profile?.Name || null } : null,
    target: { object: object || null, field: field || null },
    effective: effective || null,
    evidence: (evidence || []).map((entry) => ({
      grantedBy: entry.label,
      kind: entry.kind,
      permissions: entry.grants
    })),
    scope: scopeNote || ""
  };
}
