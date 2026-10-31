import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

// The search splits the remaining rows in two.
const HALVES = 2;

/**
 * Parameters for {@link adjustCellRect}.
 */
export interface AdjustCellRectParams {
  /**
   * The fixed row height the table view assumes when it computes the rectangle.
   */
  readonly fixedRowHeight: number;

  /**
   * The rectangle the table view computed from the fixed row height.
   */
  readonly rect: CellRect;

  /**
   * The row of the cell.
   */
  readonly row: number;

  /**
   * The row tops of the cell's group.
   */
  readonly tops: GroupRowTops;
}

/**
 * A rectangle in the coordinates the table view works in.
 */
export interface CellRect {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/**
 * Parameters for {@link countRowsForPage}.
 */
export interface CountRowsForPageParams {
  /**
   * The rows a page step walks over, in the order it walks them, starting with the row it leaves.
   */
  readonly heights: readonly number[];

  /**
   * The height of one page: the visible height of the table.
   */
  readonly pageHeight: number;
}

/**
 * The vertical layout of one table group: the top of every row, followed by the bottom of the last one, so
 * row `i` spans `tops[i]` to `tops[i + 1]`.
 */
export type GroupRowTops = readonly number[];

/**
 * Moves a rectangle the table view computed for fixed-height rows onto the row's real position and height.
 *
 * @param params - The rectangle, the row and its group's layout.
 * @returns The rectangle of the cell as it is laid out.
 */
export function adjustCellRect(params: AdjustCellRectParams): CellRect {
  const { fixedRowHeight, rect, row, tops } = params;
  const top = tops[row];
  const bottom = tops[row + 1];
  if (top === undefined || bottom === undefined) {
    return rect;
  }
  const shift = top - row * fixedRowHeight;
  const extra = bottom - top - fixedRowHeight;
  return {
    ...rect,
    bottom: rect.bottom + shift + extra,
    top: rect.top + shift
  };
}

/**
 * Lays one group's rows out one under another.
 *
 * @param heights - The height of every row of the group, in order.
 * @returns The top of every row, followed by the bottom of the last one.
 */
export function computeRowTops(heights: readonly number[]): number[] {
  const tops = [0];
  let top = 0;
  for (const height of heights) {
    top += height;
    tops.push(top);
  }
  return tops;
}

/**
 * Counts how many rows one PageUp or PageDown step moves over, so the move covers one page of real row
 * heights instead of one page of fixed ones.
 *
 * @param params - The heights walked over and the page height.
 * @returns The number of rows, at least 1.
 */
export function countRowsForPage(params: CountRowsForPageParams): number {
  const { heights, pageHeight } = params;
  let count = 0;
  let total = 0;
  for (const height of heights) {
    if (total + height > pageHeight) {
      break;
    }
    total += height;
    count++;
  }
  return Math.max(count, 1);
}

/**
 * Finds the row of a group under a vertical offset into the group's rows.
 *
 * @param tops - The row tops of the group.
 * @param offset - The offset from the top of the group's first row.
 * @returns The row index, clamped to the group's rows.
 */
export function findRowAtOffset(tops: GroupRowTops, offset: number): number {
  const rowCount = tops.length - 1;
  if (rowCount <= 0) {
    return 0;
  }
  let low = 0;
  let high = rowCount - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / HALVES);
    if (ensureNonNullable(tops[middle]) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}
