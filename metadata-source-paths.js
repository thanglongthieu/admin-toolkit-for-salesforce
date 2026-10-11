export const SOURCE_PROJECT_ROOT = "force-app";
export const SOURCE_PROJECT_PREFIX = `${SOURCE_PROJECT_ROOT}/`;
export const SOURCE_DEFAULT_ROOT = `${SOURCE_PROJECT_ROOT}/main/default`;
export const SOURCE_DEFAULT_PREFIX = `${SOURCE_DEFAULT_ROOT}/`;

const LEGACY_SOURCE_ROOTS = new Set([SOURCE_PROJECT_ROOT, `${SOURCE_PROJECT_ROOT}/main`, SOURCE_DEFAULT_ROOT]);

export function normalizeSourcePath(path = "") {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[/]+|[/]+$/g, "");
}

export function isLegacySourceRootPath(path = "") {
  return LEGACY_SOURCE_ROOTS.has(normalizeSourcePath(path));
}

export function isDefaultSourcePath(path = "") {
  const sourcePath = normalizeSourcePath(path);
  return sourcePath === SOURCE_DEFAULT_ROOT || sourcePath.startsWith(SOURCE_DEFAULT_PREFIX);
}

export function stripDefaultSourcePrefix(path = "") {
  const sourcePath = normalizeSourcePath(path);
  return sourcePath.startsWith(SOURCE_DEFAULT_PREFIX)
    ? sourcePath.slice(SOURCE_DEFAULT_PREFIX.length)
    : sourcePath;
}

export function toDefaultSourcePath(path = "") {
  const sourcePath = normalizeSourcePath(path);
  if (!sourcePath) {
    return SOURCE_DEFAULT_ROOT;
  }

  return sourcePath.startsWith(SOURCE_PROJECT_PREFIX)
    ? sourcePath
    : `${SOURCE_DEFAULT_PREFIX}${sourcePath}`;
}
