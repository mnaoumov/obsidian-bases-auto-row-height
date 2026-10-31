import {
  describe,
  expect,
  it
} from 'vitest';

import {
  adjustCellRect,
  computeRowTops,
  countRowsForPage,
  findRowAtOffset
} from './row-layout.ts';

describe('computeRowTops', () => {
  it('stacks the rows one under another and ends with the bottom of the last one', () => {
    expect(computeRowTops([30, 60, 45])).toStrictEqual([0, 30, 90, 135]);
  });

  it('gives an empty group a single zero', () => {
    expect(computeRowTops([])).toStrictEqual([0]);
  });
});

describe('adjustCellRect', () => {
  const rect = { bottom: 90, left: 5, right: 50, top: 30 };

  it('moves the rectangle onto the row and stretches it by the row\'s extra height', () => {
    // Row 2 of fixed 30px rows starts at 60 and the view computed 30..90 for it; it really starts at 100
    // And is 70px high.
    expect(adjustCellRect({ fixedRowHeight: 30, rect, row: 2, tops: [0, 40, 100, 170] })).toStrictEqual({
      bottom: 170,
      left: 5,
      right: 50,
      top: 70
    });
  });

  it('leaves the rectangle alone for a row the layout does not know', () => {
    expect(adjustCellRect({ fixedRowHeight: 30, rect, row: 5, tops: [0, 40] })).toBe(rect);
  });
});

describe('countRowsForPage', () => {
  it('counts the rows whose heights fit in one page', () => {
    expect(countRowsForPage({ heights: [100, 200, 150, 100], pageHeight: 400 })).toBe(2);
  });

  it('counts every row when they all fit', () => {
    expect(countRowsForPage({ heights: [100, 100], pageHeight: 400 })).toBe(2);
  });

  it('moves at least one row, even when that row is taller than the page', () => {
    expect(countRowsForPage({ heights: [900], pageHeight: 400 })).toBe(1);
    expect(countRowsForPage({ heights: [], pageHeight: 400 })).toBe(1);
  });
});

describe('findRowAtOffset', () => {
  const tops = [0, 30, 90, 135];

  it('finds the row the offset falls in', () => {
    expect(findRowAtOffset(tops, 0)).toBe(0);
    expect(findRowAtOffset(tops, 29.5)).toBe(0);
    expect(findRowAtOffset(tops, 30)).toBe(1);
    expect(findRowAtOffset(tops, 100)).toBe(2);
  });

  it('clamps an offset outside the rows to the first or the last row', () => {
    expect(findRowAtOffset(tops, -10)).toBe(0);
    expect(findRowAtOffset(tops, 500)).toBe(2);
  });

  it('answers row 0 for a group with no rows', () => {
    expect(findRowAtOffset([0], 10)).toBe(0);
    expect(findRowAtOffset([], 10)).toBe(0);
  });
});
