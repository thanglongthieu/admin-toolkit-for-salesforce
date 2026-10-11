let bundlePromise = null;

function loadBundle() {
  if (window.QDBSheet) return Promise.resolve();
  if (bundlePromise) return bundlePromise;
  bundlePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "force-sheet-univer.bundle.js";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load the spreadsheet engine.")), { once: true });
    document.body.appendChild(script);
  });
  return bundlePromise;
}

function post(type, detail = {}) {
  window.parent.postMessage({ type, ...detail }, location.origin);
}

async function init() {
  try {
    await loadBundle();
    window.QDBSheet.init("object-schema-fields-grid");
    post("object-schema-sheet-ready");
  } catch (error) {
    post("object-schema-sheet-error", { message: error instanceof Error ? error.message : String(error) });
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type !== "object-schema-sheet-render" || !window.QDBSheet) return;
  const sheetId = window.QDBSheet.getActiveSheetId();
  if (sheetId) {
    window.QDBSheet.renderMatrix(sheetId, event.data.matrix || []);
    const matrix = Array.isArray(event.data.matrix) ? event.data.matrix : [];
    const filterReady = window.QDBSheet.setHeaderFilter?.(sheetId, matrix.length, matrix[0]?.length || 0) === true;
    document.body.dataset.headerFilter = String(filterReady);
    const highlightCells = Array.isArray(event.data.highlightCells) ? event.data.highlightCells : [];
    window.QDBSheet.setCellBackgroundCells?.(sheetId, highlightCells, "#fff2ac");
    document.body.dataset.highlightCount = String(highlightCells.length);
  }
});

void init();
