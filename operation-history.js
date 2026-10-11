const STORAGE_KEY = "adminToolkit.operationHistory.v1";
const MAX_ENTRIES = 100;

function sanitize(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(/(Bearer\s+)[A-Za-z0-9!._-]+/gi, "$1[REDACTED]").slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(sid|accessToken|token|authorization)$/i.test(key))
      .map(([key, child]) => [key, sanitize(child)]));
  }
  return value;
}

export async function recordOperation(entry = {}) {
  const safe = sanitize({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    ...entry
  });
  const existing = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || [];
  const history = [safe, ...existing].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [STORAGE_KEY]: history });
  return safe;
}

export async function getOperationHistory() {
  return (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] || [];
}

export function downloadOperationReceipt(entry, fileName = "admin-toolkit-operation-receipt.json") {
  const blob = new Blob([JSON.stringify(sanitize(entry), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
