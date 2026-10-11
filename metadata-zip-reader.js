const ZIP_SIGNATURE = {
  central: 0x02014b50,
  end: 0x06054b50,
  local: 0x04034b50
};

const MAX_ENTRY_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

function assertRange(offset, length, total, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`Invalid ZIP ${label}.`);
  }
}

function findEndOfCentralDirectory(view) {
  const minimumLength = 22;
  const start = Math.max(0, view.byteLength - minimumLength - 0xffff);
  for (let offset = view.byteLength - minimumLength; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_SIGNATURE.end) {
      return offset;
    }
  }
  throw new Error("The Metadata API response is not a valid ZIP archive.");
}

function normalizeEntryPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("The ZIP contains an invalid source path.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new Error(`The ZIP contains an unsafe source path: ${normalized}`);
  }
  return segments.filter(Boolean).join("/");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Compressed Metadata API source is not supported by this browser.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntryBytes(entry, archiveBytes, view) {
  assertRange(entry.localOffset, 30, entry.centralStart, `local header for ${entry.path}`);
  if (view.getUint32(entry.localOffset, true) !== ZIP_SIGNATURE.local) {
    throw new Error(`Invalid ZIP local header for ${entry.path}.`);
  }
  const localMethod = view.getUint16(entry.localOffset + 8, true);
  const localNameLength = view.getUint16(entry.localOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localOffset + 28, true);
  if (localMethod !== entry.method) {
    throw new Error(`Conflicting ZIP compression metadata for ${entry.path}.`);
  }
  const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
  assertRange(dataOffset, entry.compressedSize, entry.centralStart, `source data for ${entry.path}`);
  const compressed = archiveBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  let result;
  if (entry.method === 0) {
    result = compressed;
  } else if (entry.method === 8) {
    result = await inflateRaw(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.path}.`);
  }
  if (result.byteLength !== entry.uncompressedSize) {
    throw new Error(`Invalid ZIP size for ${entry.path}.`);
  }
  return result;
}

function decodeSource(bytes) {
  if (bytes.includes(0)) {
    return { binary: true, content: "" };
  }
  try {
    return {
      binary: false,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    };
  } catch (_error) {
    return { binary: true, content: "" };
  }
}

export async function readMetadataSourceZip(blob) {
  const arrayBuffer = blob instanceof ArrayBuffer ? blob : await blob.arrayBuffer();
  const archiveBytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const endOffset = findEndOfCentralDirectory(view);
  assertRange(endOffset, 22, view.byteLength, "end record");
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount || entryCount === 0xffff) {
    throw new Error("Multi-disk and ZIP64 Metadata API archives are not supported.");
  }
  assertRange(endOffset, 22 + commentLength, archiveBytes.byteLength, "end record");
  assertRange(centralOffset, centralSize, endOffset, "central directory");
  const centralStart = centralOffset;
  const centralEnd = centralStart + centralSize;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(centralOffset, 46, centralEnd, "central directory entry");
    if (view.getUint32(centralOffset, true) !== ZIP_SIGNATURE.central) {
      throw new Error("The Metadata API ZIP central directory is invalid.");
    }
    const flags = view.getUint16(centralOffset + 8, true);
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    assertRange(centralOffset, entryLength, centralEnd, "central directory entry");
    if (flags & 0x0001) {
      throw new Error("Encrypted Metadata API ZIP entries are not supported.");
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP compression method ${method}.`);
    }
    let rawPath;
    try {
      rawPath = decoder.decode(archiveBytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    } catch (_error) {
      throw new Error("The ZIP contains a source path that is not valid UTF-8.");
    }
    const path = normalizeEntryPath(rawPath);
    if (!rawPath.endsWith("/")) {
      if (uncompressedSize > MAX_ENTRY_SIZE) {
        throw new Error(`${path} exceeds the 10 MiB source-file limit.`);
      }
      totalSize += uncompressedSize;
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error("The source archive exceeds the 50 MiB uncompressed limit.");
      }
      entries.push({ path, flags, method, compressedSize, uncompressedSize, localOffset, centralStart });
    }
    centralOffset += entryLength;
  }
  if (centralOffset !== centralEnd) {
    throw new Error("The Metadata API ZIP central directory size is invalid.");
  }

  const packageEntry = entries
    .filter((entry) => entry.path === "package.xml" || entry.path.endsWith("/package.xml"))
    .sort((left, right) => left.path.length - right.path.length)[0];
  if (!packageEntry) {
    throw new Error("The Metadata API source archive does not contain package.xml.");
  }
  const root = packageEntry.path.slice(0, -"package.xml".length);
  const seen = new Set();
  const files = [];
  for (const entry of entries) {
    if (root && !entry.path.startsWith(root)) {
      continue;
    }
    const path = root ? entry.path.slice(root.length) : entry.path;
    if (!path || seen.has(path)) {
      if (seen.has(path)) throw new Error(`The source archive contains duplicate path ${path}.`);
      continue;
    }
    seen.add(path);
    const bytes = await readEntryBytes(entry, archiveBytes, view);
    const decoded = decodeSource(bytes);
    files.push({
      path,
      archivePath: entry.path,
      content: decoded.content,
      binary: decoded.binary,
      size: bytes.byteLength,
      readOnly: true
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const packageFile = files.find((file) => file.path === "package.xml");
  if (!packageFile || packageFile.binary) {
    throw new Error("The Metadata API package.xml is not readable UTF-8 text.");
  }
  return { packageXml: packageFile.content, files };
}
