import type { BasesTableView } from '@obsidian-typings/obsidian-public-latest';
import type { CommonArguments } from 'obsidian-integration-testing';

import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Isolation: `npx vitest run --project integration-tests:desktop src/auto-row-height/cell-lines.desktop.integration.test.ts`.

interface CellLinesState {
  readonly cellLines: unknown;
  readonly cutTextCount: number;
  readonly hasAutoClass: boolean;
  readonly maxSummaryLines: number;
  readonly maxTitleLines: number;
  readonly overlapCount: number;
  readonly renderedRowCount: number;
}

interface TableViewController {
  readonly view: BasesTableView;
}

interface TableViewHost {
  readonly controller: TableViewController;
}

const FOLDER = 'cell-lines';
const BASE_PATH = `${FOLDER}/Table.base`;
const NOTE_COUNT = 6;
const POLL_TIMEOUT_IN_MILLISECONDS = 20_000;

describe('cell lines', () => {
  it('clamps a column to its line count, wraps the others in full, and changes the count from the column menu', async () => {
    const vaultPath = getTemporaryVault().path;

    async function waitForTable(step: string, isReady: (state: CellLinesState) => boolean): Promise<CellLinesState> {
      return pollInObsidian({
        poll: readCellLinesState,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: step,
        until: isReady,
        vaultPath
      });
    }

    await evalInObsidian({
      async callback({ app, basePath, folder, noteCount }): Promise<void> {
        const WORD_COUNT = 60;
        await app.vault.createFolder(folder);
        const words = Array.from({ length: WORD_COUNT }, (_, index) => `word${String(index)}`).join(' ');
        for (let index = 0; index < noteCount; index++) {
          await app.vault.create(`${folder}/Note ${String(index)}.md`, `---\nsummary: ${words}\ntitle: ${words}\n---\n`);
        }
        await app.vault.create(
          basePath,
          [
            'filters:',
            '  and:',
            `    - file.inFolder("${folder}")`,
            '    - file.ext == "md"',
            'views:',
            '  - type: table',
            '    name: Table',
            '    order:',
            '      - file.name',
            '      - title',
            '      - summary',
            '    columnSize:',
            '      note.title: 200',
            '      note.summary: 200',
            '    rowHeight: auto',
            '    cellLines:',
            '      note.summary: 2',
            ''
          ].join('\n')
        );
        const file = app.vault.getFileByPath(basePath);
        if (!file) {
          throw new Error(`No ${basePath}.`);
        }
        await app.workspace.getLeaf(false).openFile(file);
      },
      input: { basePath: BASE_PATH, folder: FOLDER, noteCount: NOTE_COUNT },
      vaultPath
    });

    try {
      const clamped = await waitForTable('the Auto table with the summary clamped', (state) => state.hasAutoClass && state.renderedRowCount === NOTE_COUNT);
      // The title wraps in full over many lines; the summary stops at two.
      expect(clamped.maxTitleLines).toBeGreaterThan(2);
      expect(clamped.maxSummaryLines).toBe(2);
      expect(clamped.cutTextCount).toBe(0);
      expect(clamped.overlapCount).toBe(0);

      // The column menu of the title header offers the line counts; one line clamps the title too.
      await chooseCellHeight(vaultPath, 'note.title', '1 line');
      const oneLine = await waitForTable('the title clamped to one line', (state) => state.maxTitleLines === 1);
      expect(oneLine.cellLines).toStrictEqual({ 'note.summary': 2, 'note.title': 1 });
      expect(oneLine.maxSummaryLines).toBe(2);
      expect(oneLine.cutTextCount).toBe(0);
      expect(oneLine.overlapCount).toBe(0);

      // Wrap in full removes the column from the map, and the last one removes the option.
      await chooseCellHeight(vaultPath, 'note.title', 'Wrap in full');
      await chooseCellHeight(vaultPath, 'note.summary', 'Wrap in full');
      const wrapped = await waitForTable('every column wrapped in full', (state) => state.maxSummaryLines > 2 && state.maxTitleLines > 2);
      expect(wrapped.cellLines).toBeUndefined();
      expect(wrapped.overlapCount).toBe(0);
    } finally {
      await evalInObsidian({
        async callback({ app, folder }): Promise<void> {
          app.workspace.getMostRecentLeaf()?.detach();
          const folderFile = app.vault.getFolderByPath(folder);
          if (folderFile) {
            await app.fileManager.trashFile(folderFile);
          }
        },
        input: { folder: FOLDER },
        vaultPath
      });
    }
  });
});

async function chooseCellHeight(vaultPath: string, property: string, title: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, lib: { clickElement, waitUntil }, property: columnProperty, title: itemTitle }): Promise<void> {
      const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
      // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
      const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
      // A header cell carries no `data-property`; the view's header row knows each cell's property.
      const headerEl = view.header.cells.find((cell) => cell.prop === columnProperty)?.el.querySelector<HTMLElement>(':scope .bases-table-header-label');
      if (!headerEl) {
        throw new Error(`No header cell for ${columnProperty}.`);
      }
      await clickElement({ button: 'right', element: headerEl });

      function findItem(text: string): HTMLElement | null {
        return [...activeDocument.querySelectorAll<HTMLElement>(':scope .menu .menu-item')].find((el) => el.querySelector(':scope .menu-item-title')?.textContent === text) ?? null;
      }
      await waitUntil({ predicate: () => findItem('Cell height') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
      findItem('Cell height')?.click();
      await waitUntil({ predicate: () => findItem(itemTitle) !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
      findItem(itemTitle)?.click();
      await waitUntil({ predicate: () => activeDocument.querySelector('.menu') === null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
    },
    input: { property, title },
    vaultPath
  });
}

/**
 * Reads how many lines the title and summary cells show in the table of the most recent leaf.
 *
 * @param params - The app.
 * @returns The state.
 */
function readCellLinesState({ app }: CommonArguments): CellLinesState {
  const TOLERANCE_IN_PIXELS = 0.5;
  // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
  const view = (app.workspace.getMostRecentLeaf()?.view as unknown as Partial<TableViewHost> | undefined)?.controller?.view;
  const containerEl = view?.containerEl;
  if (!view || !containerEl?.isConnected) {
    return { cellLines: undefined, cutTextCount: 0, hasAutoClass: false, maxSummaryLines: 0, maxTitleLines: 0, overlapCount: 0, renderedRowCount: 0 };
  }

  let cutTextCount = 0;
  function countLines(property: string): number {
    let max = 0;
    for (const textEl of containerEl?.querySelectorAll<HTMLElement>(`:scope .bases-tbody .bases-td[data-property="${CSS.escape(property)}"] .metadata-input-longtext`) ?? []) {
      const lineHeight = Number.parseFloat(getComputedStyle(textEl).lineHeight);
      if (lineHeight > 0) {
        max = Math.max(max, Math.round(textEl.clientHeight / lineHeight));
      }
      // The lines the text shows must fit the cell, so the cap on the cell never cuts the last one.
      const cellEl = textEl.closest('.bases-table-cell');
      if (cellEl && textEl.getBoundingClientRect().bottom > cellEl.getBoundingClientRect().bottom + TOLERANCE_IN_PIXELS) {
        cutTextCount++;
      }
    }
    return max;
  }

  const rows = [...containerEl.querySelectorAll<HTMLElement>(':scope .bases-tbody .bases-tr')]
    .map((el) => ({ height: el.getBoundingClientRect().height, top: Number.parseFloat(el.style.top) }))
    .sort((a, b) => a.top - b.top);
  let overlapCount = 0;
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous && current && current.top - (previous.top + previous.height) < -TOLERANCE_IN_PIXELS) {
      overlapCount++;
    }
  }
  const maxSummaryLines = countLines('note.summary');
  const maxTitleLines = countLines('note.title');
  return {
    cellLines: view.config.get('cellLines') ?? undefined,
    cutTextCount,
    hasAutoClass: containerEl.hasClass('mod-auto-row-height'),
    maxSummaryLines,
    maxTitleLines,
    overlapCount,
    renderedRowCount: rows.length
  };
}
