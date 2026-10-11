const DEFAULT_MAX_NODES = 100;
const MAX_NODES_CEILING = 100;
export const COMMON_STANDARD_OBJECTS = Object.freeze([
  "Account", "Asset", "Campaign", "Case", "Contact", "Contract", "Event", "Lead",
  "Opportunity", "OpportunityLineItem", "Order", "OrderItem", "Pricebook2",
  "PricebookEntry", "Product2", "Quote", "QuoteLineItem", "Task"
]);

const COMMON_STANDARD_OBJECT_SET = new Set(COMMON_STANDARD_OBJECTS);
const HIDDEN_OBJECTS = new Set(["User"]);
const HIDDEN_REFERENCE_FIELDS = new Set(["CreatedById", "LastModifiedById", "OwnerId"]);

function looksCustom(name) {
  return /__(?:c|e|x|b|mdt)$/i.test(String(name || ""));
}

export function isSchemaObjectPickable(name, showAllStandardObjects = false, includeObjectName) {
  if (!name || HIDDEN_OBJECTS.has(name)) return false;
  if (!(looksCustom(name) || showAllStandardObjects || COMMON_STANDARD_OBJECT_SET.has(name))) return false;
  return typeof includeObjectName !== "function" || includeObjectName(name);
}

function includeObject(name, root, showAllStandardObjects, includeObjectName) {
  if (name === root) return true;
  return isSchemaObjectPickable(name, showAllStandardObjects, includeObjectName);
}

function relationshipKind(value) {
  return value?.cascadeDelete ? "Master-Detail" : "Lookup";
}

function nodeSide(existing, candidate) {
  if (existing == null || Math.abs(candidate) < Math.abs(existing)) return candidate;
  return existing;
}

export async function buildSchemaGraph(rootName, options) {
  const describe = options?.describe;
  if (typeof describe !== "function") throw new Error("Schema describe function is required.");
  const parentLevels = Math.min(5, Math.max(0, Number(options?.parentLevels ?? 1)));
  const childLevels = Math.min(5, Math.max(0, Number(options?.childLevels ?? 1)));
  const requestedMaxNodes = Number(options?.maxNodes);
  const maxNodes = Number.isInteger(requestedMaxNodes) && requestedMaxNodes >= 1 && requestedMaxNodes <= MAX_NODES_CEILING
    ? requestedMaxNodes
    : DEFAULT_MAX_NODES;
  const showAllStandardObjects = Boolean(options?.showAllStandardObjects);
  const includeObjectName = options?.includeObjectName;
  const nodes = new Map();
  const edges = new Map();
  const metadataCache = new Map();
  const queue = [{ name: String(rootName || "Account").trim(), side: 0, depth: 0 }];
  const expanded = new Set();
  let truncated = false;

  const addNode = (name, metadata, side) => {
    if (!name) return false;
    if (!nodes.has(name) && nodes.size >= maxNodes) {
      truncated = true;
      return false;
    }
    const current = nodes.get(name) || {};
    nodes.set(name, {
      apiName: name,
      label: metadata?.label || current.label || name,
      custom: metadata?.custom ?? current.custom ?? looksCustom(name),
      side: nodeSide(current.side, side),
      depth: Math.abs(nodeSide(current.side, side) || 0)
    });
    return true;
  };

  while (queue.length) {
    const item = queue.shift();
    const key = `${item.name}:${item.side < 0 ? "p" : item.side > 0 ? "c" : "r"}:${item.depth}`;
    if (expanded.has(key)) continue;
    expanded.add(key);
    if (!metadataCache.has(item.name)) metadataCache.set(item.name, Promise.resolve(describe(item.name)));
    const metadata = await metadataCache.get(item.name);
    addNode(item.name, metadata, item.side);

    if (item.side <= 0 && item.depth < parentLevels) {
      for (const field of [...(metadata?.fields || [])].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))) {
        if (field.type !== "reference") continue;
        if (HIDDEN_REFERENCE_FIELDS.has(field.name)) continue;
        for (const parentName of [...(field.referenceTo || [])].sort()) {
          if (!includeObject(parentName, rootName, showAllStandardObjects, includeObjectName)) continue;
          if (!addNode(parentName, null, -(item.depth + 1))) continue;
          const edgeKey = `${item.name}>${parentName}:${field.name}`;
          edges.set(edgeKey, { from: item.name, to: parentName, field: field.name, kind: relationshipKind(field) });
          queue.push({ name: parentName, side: -(item.depth + 1), depth: item.depth + 1 });
        }
      }
    }

    if (item.side >= 0 && item.depth < childLevels) {
      for (const rel of [...(metadata?.childRelationships || [])].sort((left, right) => `${left.childSObject || ""}:${left.field || ""}`.localeCompare(`${right.childSObject || ""}:${right.field || ""}`))) {
        const childName = rel.childSObject;
        if (HIDDEN_REFERENCE_FIELDS.has(rel.field)) continue;
        if (!includeObject(childName, rootName, showAllStandardObjects, includeObjectName)) continue;
        if (!childName || !addNode(childName, null, item.depth + 1)) continue;
        const edgeKey = `${childName}>${item.name}:${rel.field || rel.relationshipName || "relationship"}`;
        edges.set(edgeKey, { from: childName, to: item.name, field: rel.field || rel.relationshipName || "", kind: relationshipKind(rel) });
        queue.push({ name: childName, side: item.depth + 1, depth: item.depth + 1 });
      }
    }
  }

  return {
    root: String(rootName || "Account").trim(),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
    maxNodes,
    showAllStandardObjects
  };
}

export function limitSchemaGraph(graph, visibleLevels = 2) {
  const levels = Math.max(0, Number(visibleLevels));
  const nodes = (graph?.nodes || []).filter((node) => Math.abs(Number(node.side || 0)) <= levels);
  const visibleNames = new Set(nodes.map((node) => node.apiName));
  const edges = (graph?.edges || []).filter((edge) => visibleNames.has(edge.from) && visibleNames.has(edge.to));
  return {
    ...graph,
    nodes,
    edges,
    visibleLevels: levels,
    hiddenNodeCount: Math.max(0, (graph?.nodes?.length || 0) - nodes.length)
  };
}

export function filterSchemaGraph(graph, visibleNames) {
  if (!visibleNames) return graph;
  const included = new Set(visibleNames);
  if (graph?.root) included.add(graph.root);
  const nodes = (graph?.nodes || []).filter((node) => included.has(node.apiName));
  const nodeNames = new Set(nodes.map((node) => node.apiName));
  const edges = (graph?.edges || []).filter((edge) => nodeNames.has(edge.from) && nodeNames.has(edge.to));
  return { ...graph, nodes, edges, unfilteredNodeCount: graph?.nodes?.length || 0 };
}

export function findSchemaPath(graph, startName, targetName) {
  if (!startName || !targetName) return [];
  if (startName === targetName) return [startName];
  const adjacency = new Map();
  for (const edge of graph?.edges || []) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const queue = [startName];
  const previous = new Map([[startName, null]]);
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === targetName) {
        const path = [targetName];
        let step = current;
        while (step) {
          path.push(step);
          step = previous.get(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderSchemaMapSvg(graph, options = {}) {
  const layoutMode = options.layoutMode === "vertical" ? "vertical" : "horizontal";
  const labels = {
    mapTitle: `Salesforce object schema map for ${graph.root}`,
    mapDescription: layoutMode === "vertical"
      ? "Parent objects are above the selected object and child objects are below it."
      : "Parent objects are left of the selected object and child objects are right of it.",
    custom: "CUSTOM",
    standard: "STANDARD",
    inspect: "Inspect {object} relationships",
    ...(options.labels || {})
  };
  const columns = new Map();
  for (const node of graph.nodes || []) {
    const side = Number(node.side || 0);
    if (!columns.has(side)) columns.set(side, []);
    columns.get(side).push(node);
  }
  const sides = [...columns.keys()].sort((a, b) => a - b);
  const nodeWidth = 190;
  const nodeHeight = 58;
  const columnGap = 90;
  const levelGap = 72;
  const rowGap = 24;
  const padding = 40;
  const widestColumn = Math.max(1, ...[...columns.values()].map((items) => items.length));
  const width = layoutMode === "vertical"
    ? Math.max(720, padding * 2 + widestColumn * nodeWidth + Math.max(0, widestColumn - 1) * rowGap)
    : Math.max(720, padding * 2 + sides.length * nodeWidth + Math.max(0, sides.length - 1) * columnGap);
  const height = layoutMode === "vertical"
    ? Math.max(360, padding * 2 + sides.length * nodeHeight + Math.max(0, sides.length - 1) * levelGap)
    : Math.max(360, padding * 2 + widestColumn * nodeHeight + Math.max(0, widestColumn - 1) * rowGap);
  const positions = new Map();
  sides.forEach((side, columnIndex) => {
    const items = columns.get(side).sort((a, b) => a.apiName.localeCompare(b.apiName));
    if (layoutMode === "vertical") {
      const usedWidth = items.length * nodeWidth + Math.max(0, items.length - 1) * rowGap;
      const left = Math.max(padding, (width - usedWidth) / 2);
      items.forEach((node, rowIndex) => positions.set(node.apiName, {
        x: left + rowIndex * (nodeWidth + rowGap),
        y: padding + columnIndex * (nodeHeight + levelGap)
      }));
    } else {
      const usedHeight = items.length * nodeHeight + Math.max(0, items.length - 1) * rowGap;
      const top = Math.max(padding, (height - usedHeight) / 2);
      items.forEach((node, rowIndex) => positions.set(node.apiName, {
        x: padding + columnIndex * (nodeWidth + columnGap),
        y: top + rowIndex * (nodeHeight + rowGap)
      }));
    }
  });

  const edgeSvg = (graph.edges || []).map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    let x1;
    let y1;
    let x2;
    let y2;
    let path;
    let labelX;
    let labelY;
    if (layoutMode === "vertical") {
      const topToBottom = from.y < to.y;
      x1 = from.x + nodeWidth / 2;
      y1 = topToBottom ? from.y + nodeHeight : from.y;
      x2 = to.x + nodeWidth / 2;
      y2 = topToBottom ? to.y : to.y + nodeHeight;
      const mid = (y1 + y2) / 2;
      path = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = mid - 4;
    } else {
      const leftToRight = from.x < to.x;
      x1 = leftToRight ? from.x + nodeWidth : from.x;
      y1 = from.y + nodeHeight / 2;
      x2 = leftToRight ? to.x : to.x + nodeWidth;
      y2 = to.y + nodeHeight / 2;
      const mid = (x1 + x2) / 2;
      path = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
      labelX = mid;
      labelY = (y1 + y2) / 2 - 4;
    }
    const className = edge.kind === "Master-Detail" ? "schema-map-edge-master" : "schema-map-edge-lookup";
    const edgeData = `data-edge-from="${escapeXml(edge.from)}" data-edge-to="${escapeXml(edge.to)}"`;
    return `<path class="schema-map-edge ${className}" ${edgeData} d="${path}"/><text class="schema-map-edge-label" ${edgeData} x="${labelX}" y="${labelY}">${escapeXml(edge.field)}</text>`;
  }).join("");
  const nodeSvg = (graph.nodes || []).map((node) => {
    const pos = positions.get(node.apiName);
    const root = node.apiName === graph.root;
    const typeClass = node.custom ? " schema-map-node-custom" : " schema-map-node-standard";
    const badge = node.custom ? labels.custom : labels.standard;
    const inspectLabel = String(labels.inspect).replaceAll("{object}", node.apiName);
    return `<g class="schema-map-node${root ? " schema-map-node-root" : ""}${typeClass}" data-object-api-name="${escapeXml(node.apiName)}" tabindex="0" role="button" aria-label="${escapeXml(inspectLabel)}"><rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8"/><text class="schema-map-node-label" x="${pos.x + 12}" y="${pos.y + 21}">${escapeXml(node.label)}</text><text class="schema-map-node-api" x="${pos.x + 12}" y="${pos.y + 41}">${escapeXml(node.apiName)}</text><text class="schema-map-node-badge" x="${pos.x + nodeWidth - 8}" y="${pos.y + 14}">${escapeXml(badge)}</text></g>`;
  }).join("");
  return `<svg class="schema-map-svg" data-layout="${layoutMode}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="schema-map-title schema-map-desc"><title id="schema-map-title">${escapeXml(labels.mapTitle)}</title><desc id="schema-map-desc">${escapeXml(labels.mapDescription)}</desc><defs><marker id="schema-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edgeSvg}${nodeSvg}</svg>`;
}
