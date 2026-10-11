const DEFAULT_CONTEXT_LINES = 2;
const MAX_EDIT_DISTANCE = 2000;

// Diagonals nothing has reached yet. Every read is clamped with Math.max(0, …)
// before use, so this behaves exactly like the -Infinity it replaces while
// still fitting in an Int32Array.
const UNREACHED = -1;

// Backtracking needs one frontier snapshot per edit-distance step. Step d can
// only have reached diagonals [-d, d], so each snapshot stores just that band
// as a typed array: the whole trace stays around MAX_EDIT_DISTANCE^2 * 4 bytes
// (~16MB worst case). Copying the full frontier into a Map per step instead
// retained ~2M Map entries — hundreds of megabytes, enough to exhaust the tab
// before the distance guard below ever fired.
function bandValue(band, distance, diagonal) {
  const index = diagonal + distance;
  return index >= 0 && index < band.length ? band[index] : UNREACHED;
}

function frontierValue(frontier, offset, diagonal) {
  const index = diagonal + offset;
  return index >= 0 && index < frontier.length ? frontier[index] : UNREACHED;
}

function backtrack(trace, sourceLines, changedLines) {
  const operations = [];
  let sourceIndex = sourceLines.length;
  let changedIndex = changedLines.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const band = trace[distance];
    const diagonal = sourceIndex - changedIndex;
    const previousDiagonal = diagonal === -distance || (
      diagonal !== distance
      && bandValue(band, distance, diagonal - 1) < bandValue(band, distance, diagonal + 1)
    )
      ? diagonal + 1
      : diagonal - 1;
    const previousSourceIndex = Math.max(0, bandValue(band, distance, previousDiagonal));
    const previousChangedIndex = previousSourceIndex - previousDiagonal;

    while (sourceIndex > previousSourceIndex && changedIndex > previousChangedIndex) {
      sourceIndex -= 1;
      changedIndex -= 1;
      operations.push({ type: "equal", sourceIndex, changedIndex });
    }
    if (distance === 0) break;
    if (sourceIndex === previousSourceIndex) {
      changedIndex -= 1;
      operations.push({ type: "insert", changedIndex });
    } else {
      sourceIndex -= 1;
      operations.push({ type: "delete", sourceIndex });
    }
  }

  return operations.reverse();
}

function myersOperations(sourceLines, changedLines) {
  // Cap the search up front rather than bailing out mid-loop: the trace is
  // what costs memory, so the ceiling has to bound how much of it we build.
  const maximumDistance = Math.min(sourceLines.length + changedLines.length, MAX_EDIT_DISTANCE);
  const offset = maximumDistance;
  const frontier = new Int32Array(2 * maximumDistance + 1).fill(UNREACHED);
  frontier[1 + offset] = 0;
  const trace = [];

  for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(frontier.slice(offset - distance, offset + distance + 1));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const moveDown = diagonal === -distance || (
        diagonal !== distance
        && frontierValue(frontier, offset, diagonal - 1) < frontierValue(frontier, offset, diagonal + 1)
      );
      let sourceIndex = moveDown
        ? frontierValue(frontier, offset, diagonal + 1)
        : frontierValue(frontier, offset, diagonal - 1) + 1;
      sourceIndex = Math.max(0, sourceIndex);
      let changedIndex = sourceIndex - diagonal;
      while (
        sourceIndex < sourceLines.length
        && changedIndex < changedLines.length
        && sourceLines[sourceIndex] === changedLines[changedIndex]
      ) {
        sourceIndex += 1;
        changedIndex += 1;
      }
      frontier[diagonal + offset] = sourceIndex;
      if (sourceIndex >= sourceLines.length && changedIndex >= changedLines.length) {
        return backtrack(trace, sourceLines, changedLines);
      }
    }
  }
  return null;
}

function lineDiffOperations(sourceLines, changedLines) {
  let prefixLength = 0;
  while (
    prefixLength < sourceLines.length
    && prefixLength < changedLines.length
    && sourceLines[prefixLength] === changedLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < sourceLines.length - prefixLength
    && suffixLength < changedLines.length - prefixLength
    && sourceLines[sourceLines.length - suffixLength - 1] === changedLines[changedLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const prefix = Array.from({ length: prefixLength }, (_value, index) => ({
    type: "equal",
    sourceIndex: index,
    changedIndex: index
  }));
  const sourceMiddle = sourceLines.slice(prefixLength, sourceLines.length - suffixLength);
  const changedMiddle = changedLines.slice(prefixLength, changedLines.length - suffixLength);
  let middle = myersOperations(sourceMiddle, changedMiddle);
  if (!middle) {
    middle = [
      ...sourceMiddle.map((_line, sourceIndex) => ({ type: "delete", sourceIndex })),
      ...changedMiddle.map((_line, changedIndex) => ({ type: "insert", changedIndex }))
    ];
  }
  middle = middle.map((operation) => ({
    ...operation,
    sourceIndex: Number.isInteger(operation.sourceIndex) ? operation.sourceIndex + prefixLength : undefined,
    changedIndex: Number.isInteger(operation.changedIndex) ? operation.changedIndex + prefixLength : undefined
  }));
  const suffix = Array.from({ length: suffixLength }, (_value, index) => ({
    type: "equal",
    sourceIndex: sourceLines.length - suffixLength + index,
    changedIndex: changedLines.length - suffixLength + index
  }));
  return [...prefix, ...middle, ...suffix];
}

function alignRows(sourceLines, changedLines, operations) {
  const sourceRows = [];
  const changedRows = [];
  let operationIndex = 0;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation.type === "equal") {
      sourceRows.push({ line: sourceLines[operation.sourceIndex], lineNumber: operation.sourceIndex + 1, state: "normal" });
      changedRows.push({ line: changedLines[operation.changedIndex], lineNumber: operation.changedIndex + 1, state: "normal" });
      operationIndex += 1;
      continue;
    }

    const deleted = [];
    const inserted = [];
    while (operationIndex < operations.length && operations[operationIndex].type !== "equal") {
      const changedOperation = operations[operationIndex];
      if (changedOperation.type === "delete") deleted.push(changedOperation.sourceIndex);
      else inserted.push(changedOperation.changedIndex);
      operationIndex += 1;
    }
    const rowCount = Math.max(deleted.length, inserted.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const deletedIndex = deleted[rowIndex];
      const insertedIndex = inserted[rowIndex];
      const hasDeleted = Number.isInteger(deletedIndex);
      const hasInserted = Number.isInteger(insertedIndex);
      const sourceLine = hasDeleted ? sourceLines[deletedIndex] : "";
      const changedLine = hasInserted ? changedLines[insertedIndex] : "";
      sourceRows.push({
        line: sourceLine,
        lineNumber: hasDeleted ? deletedIndex + 1 : "",
        state: hasDeleted ? (hasInserted ? "changed" : "removed") : "placeholder",
        compareLine: changedLine
      });
      changedRows.push({
        line: changedLine,
        lineNumber: hasInserted ? insertedIndex + 1 : "",
        state: hasInserted ? (hasDeleted ? "changed" : "added") : "placeholder",
        compareLine: sourceLine
      });
    }
  }
  return { sourceRows, changedRows };
}

function compactRows(sourceRows, changedRows, contextLines) {
  const visibleIndexes = new Set();
  sourceRows.forEach((sourceRow, index) => {
    if (sourceRow.state === "normal" && changedRows[index]?.state === "normal") return;
    const first = Math.max(0, index - contextLines);
    const last = Math.min(sourceRows.length - 1, index + contextLines);
    for (let contextIndex = first; contextIndex <= last; contextIndex += 1) {
      visibleIndexes.add(contextIndex);
    }
  });

  const compactSourceRows = [];
  const compactChangedRows = [];
  let previousIndex = -1;
  [...visibleIndexes].sort((left, right) => left - right).forEach((index) => {
    if (previousIndex >= 0 && index > previousIndex + 1) {
      compactSourceRows.push({ line: "⋯", lineNumber: "", state: "omitted" });
      compactChangedRows.push({ line: "⋯", lineNumber: "", state: "omitted" });
    }
    compactSourceRows.push(sourceRows[index]);
    compactChangedRows.push(changedRows[index]);
    previousIndex = index;
  });
  return { sourceRows: compactSourceRows, changedRows: compactChangedRows };
}

export function getChangedFileSideBySideRows(sourceContent = "", changedContent = "", contextLines = DEFAULT_CONTEXT_LINES) {
  const sourceLines = sourceContent === "" ? [] : String(sourceContent).split("\n");
  const changedLines = changedContent === "" ? [] : String(changedContent).split("\n");
  const operations = lineDiffOperations(sourceLines, changedLines);
  const alignedRows = alignRows(sourceLines, changedLines, operations);
  return compactRows(alignedRows.sourceRows, alignedRows.changedRows, contextLines);
}
