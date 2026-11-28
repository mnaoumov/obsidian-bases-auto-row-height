import type { BasesPropertyId } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  parseCellLines,
  withCellLines
} from './cell-lines.ts';

const SUMMARY: BasesPropertyId = 'note.summary';
const TITLE: BasesPropertyId = 'note.title';

describe('parseCellLines', () => {
  it('reads every whole line count of at least 1', () => {
    expect([...parseCellLines({ [SUMMARY]: 2, [TITLE]: 1 })]).toStrictEqual([[SUMMARY, 2], [TITLE, 1]]);
  });

  it('drops a count that is not a whole number of lines of at least 1', () => {
    expect([...parseCellLines({ fraction: 1.5, kept: 3, negative: -1, none: null, text: '2', zero: 0 })]).toStrictEqual([['kept', 3]]);
  });

  it('reads nothing from a value that is not a map', () => {
    expect(parseCellLines(undefined).size).toBe(0);
    expect(parseCellLines(null).size).toBe(0);
    expect(parseCellLines(2).size).toBe(0);
    expect(parseCellLines([1, 2]).size).toBe(0);
  });
});

describe('withCellLines', () => {
  it('sets and replaces one column, keeping the others', () => {
    expect(withCellLines(undefined, SUMMARY, 2)).toStrictEqual({ [SUMMARY]: 2 });
    expect(withCellLines({ [SUMMARY]: 2, [TITLE]: 1 }, SUMMARY, 3)).toStrictEqual({ [SUMMARY]: 3, [TITLE]: 1 });
  });

  it('removes a column that wraps in full, and the whole option once none is clamped', () => {
    expect(withCellLines({ [SUMMARY]: 2, [TITLE]: 1 }, TITLE, null)).toStrictEqual({ [SUMMARY]: 2 });
    expect(withCellLines({ [SUMMARY]: 2 }, SUMMARY, null)).toBeNull();
    expect(withCellLines(undefined, SUMMARY, null)).toBeNull();
  });
});
