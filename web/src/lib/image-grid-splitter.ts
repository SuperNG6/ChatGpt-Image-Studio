export type SplitAxis = "x" | "y";

export type SplitLine = {
  id: string;
  axis: SplitAxis;
  position: number;
};

export type GridSpec = {
  columns: number;
  rows: number;
};

export type GridCell = {
  row: number;
  column: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

const MIN_GRID_SIZE = 1;
const MAX_GRID_SIZE = 12;
const MIN_LINE_DISTANCE = 0.005;

export function clampSplitPosition(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0.01, Math.min(0.99, value));
}

export function parseGridSpec(value: string): GridSpec | null {
  const normalized = value.trim().replace(/[×xX]/g, "*");
  const match = normalized.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const columns = Number(match[1]);
  const rows = Number(match[2]);
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < MIN_GRID_SIZE ||
    rows < MIN_GRID_SIZE ||
    columns > MAX_GRID_SIZE ||
    rows > MAX_GRID_SIZE
  ) {
    return null;
  }
  return { columns, rows };
}

export function createGridLines(spec: GridSpec): SplitLine[] {
  const lines: SplitLine[] = [];
  for (let column = 1; column < spec.columns; column += 1) {
    lines.push({
      id: `x-${column}-${spec.columns}`,
      axis: "x",
      position: column / spec.columns,
    });
  }
  for (let row = 1; row < spec.rows; row += 1) {
    lines.push({
      id: `y-${row}-${spec.rows}`,
      axis: "y",
      position: row / spec.rows,
    });
  }
  return lines;
}

export function normalizeSplitLines(lines: SplitLine[]) {
  const result: SplitLine[] = [];
  for (const line of [...lines].sort((a, b) => {
    if (a.axis === b.axis) {
      return a.position - b.position;
    }
    return a.axis.localeCompare(b.axis);
  })) {
    const position = clampSplitPosition(line.position);
    const duplicate = result.some(
      (item) =>
        item.axis === line.axis &&
        Math.abs(item.position - position) < MIN_LINE_DISTANCE,
    );
    if (!duplicate) {
      result.push({ ...line, position });
    }
  }
  return result;
}

export function splitBounds(lines: SplitLine[], axis: SplitAxis) {
  return [
    0,
    ...normalizeSplitLines(lines)
      .filter((line) => line.axis === axis)
      .map((line) => line.position),
    1,
  ];
}

export function computeGridCells(
  lines: SplitLine[],
  width: number,
  height: number,
): GridCell[] {
  if (width <= 0 || height <= 0) {
    return [];
  }

  const xBounds = splitBounds(lines, "x");
  const yBounds = splitBounds(lines, "y");
  const cells: GridCell[] = [];

  for (let row = 0; row < yBounds.length - 1; row += 1) {
    for (let column = 0; column < xBounds.length - 1; column += 1) {
      const sx = Math.round(xBounds[column] * width);
      const sy = Math.round(yBounds[row] * height);
      const right = Math.round(xBounds[column + 1] * width);
      const bottom = Math.round(yBounds[row + 1] * height);
      cells.push({
        row,
        column,
        sx,
        sy,
        sw: Math.max(1, right - sx),
        sh: Math.max(1, bottom - sy),
      });
    }
  }

  return cells;
}

export function sanitizeFileBaseName(value: string) {
  return (
    value
      .trim()
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-") || "image"
  );
}

export function formatGridCellFileName(baseName: string, cell: GridCell, index: number, total: number) {
  const sequenceWidth = Math.max(3, String(Math.max(total, 1)).length);
  const sequence = String(index + 1).padStart(sequenceWidth, "0");
  const row = String(cell.row + 1).padStart(2, "0");
  const column = String(cell.column + 1).padStart(2, "0");
  return `${baseName}-${sequence}-r${row}-c${column}.png`;
}
