import type { BasesPropertyId } from 'obsidian';

/**
 * The view option that holds the per-column line counts, as a map from a property id to the most lines a cell
 * of that column shows. A column the map does not name wraps in full.
 */
export const CELL_LINES_KEY = 'cellLines';

/**
 * The line counts the column menu offers, besides wrapping in full.
 */
// eslint-disable-next-line no-magic-numbers -- The line counts are the menu's own entries, named nowhere else.
export const CELL_LINE_CHOICES: readonly number[] = [1, 2, 3, 5];

/**
 * The class a body cell of a clamped column carries.
 */
export const LINE_CLAMP_CLASS = 'mod-line-clamp';

/**
 * The CSS variable that tells a clamped cell how many lines it shows.
 */
export const CELL_LINES_VARIABLE = '--bases-auto-row-height-cell-lines';

/**
 * The per-column line counts of one view.
 */
export type CellLines = ReadonlyMap<string, number>;

/**
 * Reads the per-column line counts from the stored view option, dropping anything that is not a whole number
 * of lines of at least 1.
 *
 * @param value - The stored value of the {@link CELL_LINES_KEY} option.
 * @returns The line count of every clamped column.
 */
export function parseCellLines(value: unknown): CellLines {
  const cellLines = new Map<string, number>();
  if (!isRecord(value)) {
    return cellLines;
  }
  for (const [property, lines] of Object.entries(value)) {
    if (isLineCount(lines)) {
      cellLines.set(property, lines);
    }
  }
  return cellLines;
}

/**
 * Builds the value to store after one column's line count changed.
 *
 * @param value - The stored value of the {@link CELL_LINES_KEY} option.
 * @param property - The column that changed.
 * @param lines - Its new line count, or `null` to wrap it in full.
 * @returns The value to store, or `null` when no column is clamped any more, which removes the option.
 */
export function withCellLines(value: unknown, property: BasesPropertyId, lines: null | number): null | Record<string, number> {
  const cellLines = new Map(parseCellLines(value));
  if (lines === null) {
    cellLines.delete(property);
  } else {
    cellLines.set(property, lines);
  }
  return cellLines.size === 0 ? null : Object.fromEntries(cellLines);
}

function isLineCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
