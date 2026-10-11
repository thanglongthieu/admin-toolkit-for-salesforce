// force-sheet-import-utils.js
// Pure data-parsing helpers extracted from force-sheet.js (no DOM, session,
// or app-state dependencies): Salesforce report-row normalisation, CSV
// parsing, and a dependency-free XLSX (OOXML) reader.
//
// Exported entry points: normalizeReportRows, stripReportExportMetadata,
// parseCsvText, csvMatrixToRows, parseExcelFile, colName. The rest are internal.

// ── Report row normalisation ───────────────────────────────────────────────

function createUniqueColumnName(baseName, usedNames) {
  if (!usedNames.has(baseName)) { usedNames.add(baseName); return baseName; }
  let index = 2;
  let nextName = `${baseName} ${index}`;
  while (usedNames.has(nextName)) { index += 1; nextName = `${baseName} ${index}`; }
  usedNames.add(nextName);
  return nextName;
}

function getReportColumnNames(result = {}) {
  const detailColumns = Array.isArray(result?.reportMetadata?.detailColumns)
    ? result.reportMetadata.detailColumns : [];
  const columnInfo = result?.reportExtendedMetadata?.detailColumnInfo || {};
  const usedNames = new Set();
  return detailColumns.map((column, index) => {
    const info = columnInfo[column] || {};
    return createUniqueColumnName(info.label || info.name || column || `Column ${index + 1}`, usedNames);
  });
}

function getReportCellValue(cell = {}) {
  if (cell === null || typeof cell === "undefined") return "";
  if (typeof cell !== "object") return cell;
  if (Object.prototype.hasOwnProperty.call(cell, "label")) return cell.label;
  if (Object.prototype.hasOwnProperty.call(cell, "value")) return cell.value;
  return JSON.stringify(cell);
}

// Joined ("MULTI_BLOCK") reports have per-block columns + `blockRows` (not the
// flat detailColumns/`rows` that normalizeReportRows expects), so they can't be
// rendered as a single sheet. Detect them so callers can surface a clear
// message instead of a silently-empty grid. (Mirrors data-export.js.)
export function isJoinedReport(reportJson = {}) {
  const md = reportJson?.reportMetadata || {};
  const fmt = String(md.reportFormat || "").toLowerCase().replace(/[\s-]+/g, "_");
  return fmt === "joined" || fmt === "multi_block" || fmt === "multiblock"
    || Array.isArray(md.blocks) || Array.isArray(md.blockInfo);
}

// Joined report → one { label, columns, rows } per block. Each block has its
// own detailColumns (labelled via reportExtendedMetadata.blocks[i]); its detail
// rows are `factMap[key].blockRows[blockIndex]` (an array of {dataCells}),
// spread across grouping keys, so we union them across all keys and dedupe.
export function normalizeJoinedReport(result = {}) {
  const md = result?.reportMetadata || {};
  const blocksMd = Array.isArray(md.blocks) ? md.blocks : [];
  const xblocks = Array.isArray(result?.reportExtendedMetadata?.blocks) ? result.reportExtendedMetadata.blocks : [];
  const factMap = result?.factMap || {};
  return blocksMd.map((blk, b) => {
    const detailCols = Array.isArray(blk.detailColumns) ? blk.detailColumns : [];
    const colInfo = (xblocks[b] && xblocks[b].detailColumnInfo) || {};
    const columns = detailCols.map((c, i) => colInfo[c]?.label || colInfo[c]?.name || c || `Column ${i + 1}`);
    const seen = new Set();
    const rows = [];
    for (const entry of Object.values(factMap)) {
      const bucket = Array.isArray(entry?.blockRows) && Array.isArray(entry.blockRows[b]) ? entry.blockRows[b] : [];
      for (const row of bucket) {
        const cells = Array.isArray(row?.dataCells) ? row.dataCells : [];
        const values = detailCols.map((_, i) => getReportCellValue(cells[i]));
        const sig = values.join("");
        if (seen.has(sig)) continue; // guard against a row appearing at a parent + leaf grouping
        seen.add(sig);
        rows.push(values);
      }
    }
    return { label: blk.blockName || blk.blockId || `Block ${b + 1}`, columns, rows };
  });
}

// Lays joined blocks out SIDE BY SIDE in one sheet: each block occupies its own
// column range (row 0 = "── label ──" divider, row 1 = headers, row 2+ = rows),
// separated by a blank gap column. Blocks are top-aligned.
//   ── B1 ──                 ── B2 ──
//   Account | Opportunity |  | Opportunity
//   Acme    | Big Deal    |  | Renewal
export function buildJoinedMatrix(blocks = []) {
  const widths = blocks.map(b => Math.max(1, b.columns.length));
  const offsets = [];
  let off = 0;
  widths.forEach((w, i) => { offsets[i] = off; off += w + 1; }); // +1 gap column
  const totalCols = Math.max(1, off - 1); // drop the trailing gap
  const height = Math.max(0, ...blocks.map(b => 2 + b.rows.length)); // divider + headers + rows
  const matrix = Array.from({ length: height }, () => Array(totalCols).fill(""));
  blocks.forEach((b, i) => {
    const c0 = offsets[i];
    if (height > 0) matrix[0][c0] = `── ${b.label} ──`;
    b.columns.forEach((col, ci) => { matrix[1][c0 + ci] = col; });
    b.rows.forEach((row, ri) => {
      row.forEach((val, ci) => { matrix[2 + ri][c0 + ci] = val; });
    });
  });
  return matrix;
}

export function normalizeReportRows(result = {}) {
  const factMap = result?.factMap;
  if (!factMap || typeof factMap !== "object") return [];
  const columns = getReportColumnNames(result);
  const usedFallback = new Set(columns);
  return Object.values(factMap)
    .flatMap((fact = {}) => Array.isArray(fact.rows) ? fact.rows : [])
    .map((row = {}) => {
      const output = {};
      const cells = Array.isArray(row.dataCells) ? row.dataCells : [];
      cells.forEach((cell, i) => {
        const col = columns[i] || createUniqueColumnName(`Column ${i + 1}`, usedFallback);
        output[col] = getReportCellValue(cell);
      });
      return output;
    });
}

function normalizeReportExportLabel(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function getReportExportHeaderLabels(result = {}) {
  const labels = new Set();
  let columnCount = 0;
  const addColumn = (column, info = {}) => {
    columnCount += 1;
    [column, info.label, info.name].forEach((value) => {
      const normalized = normalizeReportExportLabel(value);
      if (normalized) labels.add(normalized);
    });
  };

  const md = result?.reportMetadata || {};
  const detailInfo = result?.reportExtendedMetadata?.detailColumnInfo || {};
  for (const column of Array.isArray(md.detailColumns) ? md.detailColumns : []) {
    addColumn(column, detailInfo[column]);
  }

  const blocks = Array.isArray(md.blocks) ? md.blocks : [];
  const extendedBlocks = Array.isArray(result?.reportExtendedMetadata?.blocks)
    ? result.reportExtendedMetadata.blocks : [];
  blocks.forEach((block, index) => {
    const blockInfo = extendedBlocks[index]?.detailColumnInfo || {};
    for (const column of Array.isArray(block?.detailColumns) ? block.detailColumns : []) {
      addColumn(column, blockInfo[column]);
    }
  });
  return { labels, columnCount };
}

// Salesforce's XLSX report export prepends presentation rows such as the
// report name, "Filters", and each filter detail. Univer is a data workspace,
// so keep the real column header and every row below it, while removing those
// export-only decorations. Report metadata supplies the authoritative column
// labels; when no header can be identified, preserve the non-empty matrix.
export function stripReportExportMetadata(matrix = [], result = {}) {
  const rows = (Array.isArray(matrix) ? matrix : [])
    .map((row) => {
      const values = Array.isArray(row) ? [...row] : [];
      while (values.length && !String(values[values.length - 1] ?? "").trim()) values.pop();
      return values;
    })
    .filter((row) => row.some((value) => String(value ?? "").trim()));
  if (!rows.length) return [];

  const { labels: expected, columnCount } = getReportExportHeaderLabels(result);
  if (!expected.size) return rows;
  const requiredMatches = Math.min(2, Math.max(1, columnCount));
  let headerIndex = -1;
  let bestMatches = 0;
  const scanLimit = Math.min(rows.length, 100);
  for (let index = 0; index < scanLimit; index += 1) {
    const matches = rows[index].reduce((count, value) => (
      expected.has(normalizeReportExportLabel(value)) ? count + 1 : count
    ), 0);
    if (matches >= requiredMatches && matches > bestMatches) {
      headerIndex = index;
      bestMatches = matches;
    }
  }
  if (headerIndex < 0) return rows;
  const dataRows = rows.slice(headerIndex);
  const leadingColumns = dataRows[0].findIndex((value) => String(value ?? "").trim());
  return leadingColumns > 0 ? dataRows.map((row) => row.slice(leadingColumns)) : dataRows;
}

// Salesforce's Reports REST API returns at most 2,000 detail rows and exposes
// no pagination for them, so a larger report silently arrives short. The
// response flags this two ways, and the grand-total fact ("T!T") still carries
// the report's real row count — report both so the sheet never passes off a
// truncated report as the whole thing. Returns null when nothing was dropped.
export function getReportTruncation(result = {}) {
  const truncated = result?.allData === false || result?.hasExceededTabularRowLimit === true;
  if (!truncated) return null;
  return { total: getReportRowCount(result) };
}

// The grand-total fact's aggregates line up positionally with
// reportMetadata.aggregates, so the row count has to be looked up by key rather
// than taken from position 0 — on a joined report position 0 is a block's
// currency sum, not a count. Joined reports also scope the key per block
// ("B0#RowCount"), so the report's total is the sum of its blocks. Returns null
// when no count is present.
function getReportRowCount(result = {}) {
  const keys = result?.reportMetadata?.aggregates;
  const values = result?.factMap?.["T!T"]?.aggregates;
  if (!Array.isArray(keys) || !Array.isArray(values)) return null;
  let total = null;
  keys.forEach((key, i) => {
    if (!/(^|#)RowCount$/.test(String(key))) return;
    const value = values[i]?.value;
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  });
  return total;
}

// ── CSV parser ─────────────────────────────────────────────────────────────

export function parseCsvText(text) {
  const lines = text.split(/\r?\n/);
  const matrix = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    matrix.push(cells);
  }
  return matrix;
}

export function csvMatrixToRows(matrix) {
  if (matrix.length < 2) return { columns: [], rows: [] };
  const columns = matrix[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = matrix.slice(1).map(cells => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = cells[i] ?? ""; });
    return obj;
  });
  return { columns, rows };
}

// ── Excel (XLSX / OOXML) parser ─────────────────────────────────────────────

function readZipText(bytes, offset, length) {
  return new TextDecoder("utf-8").decode(bytes.subarray(offset, offset + length));
}

async function inflateZipBytes(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("Excel preview not supported by this browser.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findZipEnd(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("Excel file is not a valid ZIP archive.");
}

async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const endOff = findZipEnd(view);
  const count = view.getUint16(endOff + 10, true);
  let centralOff = view.getUint32(endOff + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(centralOff, true) !== 0x02014b50) throw new Error("Excel ZIP central directory invalid.");
    const method = view.getUint16(centralOff + 10, true);
    const compSize = view.getUint32(centralOff + 20, true);
    const fnLen = view.getUint16(centralOff + 28, true);
    const extraLen = view.getUint16(centralOff + 30, true);
    const commentLen = view.getUint16(centralOff + 32, true);
    const localOff = view.getUint32(centralOff + 42, true);
    const fileName = readZipText(bytes, centralOff + 46, fnLen).replaceAll("\\", "/");
    if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error(`Excel ZIP local header invalid for ${fileName}.`);
    const localFnLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + localFnLen + localExtraLen;
    entries.set(fileName, { method, bytes: bytes.subarray(dataOff, dataOff + compSize) });
    centralOff += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipEntry(entries, path) {
  const e = entries.get(path);
  if (!e) return null;
  if (e.method === 0) return e.bytes;
  if (e.method === 8) return inflateZipBytes(e.bytes);
  throw new Error(`Unsupported ZIP compression method ${e.method}.`);
}

async function readZipEntryText(entries, path) {
  const b = await readZipEntry(entries, path);
  return b ? new TextDecoder("utf-8").decode(b) : "";
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`Could not parse Excel ${label}.`);
  return doc;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return Array.from(parseXml(xml, "shared strings").getElementsByTagName("si"))
    .map(si => Array.from(si.getElementsByTagName("t")).map(t => t.textContent || "").join(""));
}

function getFirstWorksheetPath(entries, wbXml, relXml) {
  if (wbXml && relXml) {
    const wb = parseXml(wbXml, "workbook");
    const rels = parseXml(relXml, "workbook relationships");
    const sheet = wb.getElementsByTagName("sheet")[0];
    const rid = sheet?.getAttribute("r:id");
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find(r => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) {
      const t = target.replace(/^\/+/, "");
      return t.startsWith("xl/") ? t : `xl/${t}`;
    }
  }
  return Array.from(entries.keys())
    .filter(p => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] || "";
}

// Report exports are far too big for the DOMParser path parseExcelFile uses:
// a 21k-row export builds a DOM of roughly a million nodes, which costs GBs and
// over a minute. This scans the worksheet XML as text instead and returns the
// raw sheet as a row-major matrix — no DOM. Report callers then remove the
// export's title/filter decoration with stripReportExportMetadata().
export async function parseExcelSheetMatrix(arrayBuffer) {
  const entries = await readZipEntries(arrayBuffer);
  const [ssText, wbText, relText] = await Promise.all([
    readZipEntryText(entries, "xl/sharedStrings.xml"),
    readZipEntryText(entries, "xl/workbook.xml"),
    readZipEntryText(entries, "xl/_rels/workbook.xml.rels"),
  ]);
  const sheetPath = getFirstWorksheetPath(entries, wbText, relText);
  if (!sheetPath) throw new Error("Excel workbook has no worksheet.");
  const sheetText = await readZipEntryText(entries, sheetPath);
  if (!sheetText) throw new Error(`Excel worksheet ${sheetPath} not found.`);

  const shared = scanSharedStrings(ssText);
  const matrix = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetText)) !== null) {
    const values = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const [, attrs, body = ""] = cellMatch;
      values[getColIndex(/\br="([A-Za-z]+)/.exec(attrs)?.[1] || "")] =
        readSheetCell(/\bt="([^"]+)"/.exec(attrs)?.[1] || "", body, shared);
    }
    matrix.push(Array.from(values, v => v ?? ""));
  }
  return matrix;
}

function encodeXmlText(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineWorksheetSharedStrings(sheetXml, shared) {
  return sheetXml.replace(/<c\b([^>]*\bt="s"[^>]*)>([\s\S]*?)<\/c>/g, (whole, attrs, body) => {
    const index = Number(decodeXmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] || ""));
    if (!Number.isInteger(index) || typeof shared[index] === "undefined") return whole;
    const cleanAttrs = attrs.replace(/\s+t="s"/, "");
    return `<c${cleanAttrs} t="inlineStr"><is><t xml:space="preserve">${encodeXmlText(shared[index])}</t></is></c>`;
  });
}

function worksheetRowText(rowXml, shared) {
  const values = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cell;
  while ((cell = cellRe.exec(rowXml)) !== null) {
    values.push(readSheetCell(/\bt="([^"]+)"/.exec(cell[1])?.[1] || "", cell[2] || "", shared));
  }
  return values.join(" ").replace(/\s+/g, " ").trim();
}

// Preserve Salesforce's original worksheet formatting while removing its
// trailing legal footer. The notice immediately before the Salesforce
// copyright is removed by position, so it works in every Salesforce language.
function removeSalesforceReportFooterRows(sheetXml, shared) {
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)];
  const remove = new Set();
  rows.forEach((match, index) => {
    const text = worksheetRowText(match[0], shared);
    if (!/copyright\b[\s\S]*salesforce\.com[\s\S]*all rights reserved/i.test(text)) return;
    remove.add(index);
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (!worksheetRowText(rows[previous][0], shared)) continue;
      remove.add(previous);
      break;
    }
  });
  if (!remove.size) return sheetXml;
  let rowIndex = 0;
  return sheetXml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, row => (remove.has(rowIndex++) ? "" : row));
}

// Extract the first worksheet as self-contained OOXML for Favorites workbook
// composition. Shared strings become inline strings so sheets from multiple
// Salesforce exports cannot collide in the combined workbook.
export async function extractFormattedExcelSheet(arrayBuffer) {
  const entries = await readZipEntries(arrayBuffer);
  const [ssText, wbText, relText, stylesXml, themeXml] = await Promise.all([
    readZipEntryText(entries, "xl/sharedStrings.xml"),
    readZipEntryText(entries, "xl/workbook.xml"),
    readZipEntryText(entries, "xl/_rels/workbook.xml.rels"),
    readZipEntryText(entries, "xl/styles.xml"),
    readZipEntryText(entries, "xl/theme/theme1.xml"),
  ]);
  const sheetPath = getFirstWorksheetPath(entries, wbText, relText);
  if (!sheetPath) return null;
  let sheetXml = await readZipEntryText(entries, sheetPath);
  if (!sheetXml) return null;
  const shared = scanSharedStrings(ssText);
  sheetXml = removeSalesforceReportFooterRows(sheetXml, shared);
  sheetXml = inlineWorksheetSharedStrings(sheetXml, shared)
    .replace(/<drawing\b[^>]*(?:\/>|>[\s\S]*?<\/drawing>)/g, "")
    .replace(/<legacyDrawing\b[^>]*\/>/g, "");
  return { sheetXml, stylesXml, themeXml };
}

function readSheetCell(type, body, shared) {
  if (type === "inlineStr") {
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = tRe.exec(body)) !== null) text += decodeXmlText(m[1]);
    return text;
  }
  const raw = decodeXmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] || "");
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

function scanSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si;
  while ((si = siRe.exec(xml)) !== null) {
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = tRe.exec(si[1])) !== null) text += decodeXmlText(m[1]);
    out.push(text);
  }
  return out;
}

function decodeXmlText(value = "") {
  return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (whole, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name] ?? whole;
    });
}

function getColIndex(ref = "") {
  const letters = String(ref).match(/^[A-Za-z]+/)?.[0] || "";
  let idx = 0;
  for (const ch of letters.toUpperCase()) idx = idx * 26 + ch.charCodeAt(0) - 64;
  return Math.max(idx - 1, 0);
}

function getCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t") || "";
  if (type === "inlineStr") return Array.from(cell.getElementsByTagName("t")).map(n => n.textContent || "").join("");
  const v = Array.from(cell.childNodes).find(n => n.nodeType === Node.ELEMENT_NODE && n.localName === "v")?.textContent || "";
  if (type === "s") return sharedStrings[Number(v)] || "";
  if (type === "b") return v === "1" ? "TRUE" : "FALSE";
  return v;
}

// Spreadsheet column name for a 0-based index (0 → "A", 26 → "AA"). Also used
// by force-sheet.js for the CRUD A1-range display.
export function colName(index) {
  let val = index + 1, name = "";
  while (val > 0) { const r = (val - 1) % 26; name = String.fromCharCode(65 + r) + name; val = Math.floor((val - 1) / 26); }
  return name;
}

function excelMatrixToRows(matrix) {
  const visible = matrix.filter(r => !r.every(v => !String(v ?? "").trim()));
  if (!visible.length) return { columns: [], rows: [] };
  const colCount = Math.max(...visible.map(r => r.length));
  const columns = Array.from({ length: colCount }, (_, i) => colName(i));
  const [headerRow, ...dataRows] = visible;
  // Use first row as headers if all non-empty strings
  const hasHeader = headerRow.every(v => typeof v === "string" && v.trim());
  const finalCols = hasHeader ? headerRow.map((h, i) => (h.trim() || colName(i))) : columns;
  const startRows = hasHeader ? dataRows : visible;
  const rows = startRows.map(r => {
    const obj = {};
    finalCols.forEach((col, i) => { obj[col] = r[i] ?? ""; });
    return obj;
  });
  return { columns: finalCols, rows };
}

export async function parseExcelFile(arrayBuffer) {
  const entries = await readZipEntries(arrayBuffer);
  const [ssText, wbText, relText] = await Promise.all([
    readZipEntryText(entries, "xl/sharedStrings.xml"),
    readZipEntryText(entries, "xl/workbook.xml"),
    readZipEntryText(entries, "xl/_rels/workbook.xml.rels"),
  ]);
  const sheetPath = getFirstWorksheetPath(entries, wbText, relText);
  if (!sheetPath) throw new Error("Excel workbook has no worksheet.");
  const sheetText = await readZipEntryText(entries, sheetPath);
  if (!sheetText) throw new Error(`Excel worksheet ${sheetPath} not found.`);

  const sharedStrings = parseSharedStrings(ssText);
  const sheetDoc = parseXml(sheetText, "worksheet");
  const matrix = Array.from(sheetDoc.getElementsByTagName("row")).map(row => {
    const vals = [];
    Array.from(row.getElementsByTagName("c")).forEach(cell => {
      vals[getColIndex(cell.getAttribute("r"))] = getCellValue(cell, sharedStrings);
    });
    return vals;
  });
  return excelMatrixToRows(matrix);
}
