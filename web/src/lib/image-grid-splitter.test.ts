import { describe, expect, it } from "vitest";

import {
  computeGridCells,
  createGridLines,
  formatGridCellFileName,
  parseGridSpec,
} from "./image-grid-splitter";

describe("image-grid-splitter", () => {
  it("parses common grid specs", () => {
    expect(parseGridSpec("2*3")).toEqual({ columns: 2, rows: 3 });
    expect(parseGridSpec("2x3")).toEqual({ columns: 2, rows: 3 });
    expect(parseGridSpec("2×3")).toEqual({ columns: 2, rows: 3 });
  });

  it("rejects invalid grid specs", () => {
    expect(parseGridSpec("0*3")).toBeNull();
    expect(parseGridSpec("13*1")).toBeNull();
    expect(parseGridSpec("2 by 3")).toBeNull();
  });

  it("creates expected cells for a 2 by 3 grid", () => {
    const lines = createGridLines({ columns: 2, rows: 3 });
    const cells = computeGridCells(lines, 1000, 900);

    expect(cells).toHaveLength(6);
    expect(cells[0]).toMatchObject({ row: 0, column: 0, sx: 0, sy: 0, sw: 500, sh: 300 });
    expect(cells[5]).toMatchObject({ row: 2, column: 1, sx: 500, sy: 600, sw: 500, sh: 300 });
  });

  it("formats ordered slice filenames for zip export", () => {
    const lines = createGridLines({ columns: 2, rows: 3 });
    const cells = computeGridCells(lines, 1000, 900);

    expect(formatGridCellFileName("sample", cells[0], 0, cells.length)).toBe(
      "sample-001-r01-c01.png",
    );
    expect(formatGridCellFileName("sample", cells[5], 5, cells.length)).toBe(
      "sample-006-r03-c02.png",
    );
  });
});
