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

// Isolation: `npx vitest run --project integration-tests:desktop src/auto-row-height/auto-row-height.cross-platform.integration.test.ts`,
// Or `--project integration-tests:android`.
//
// Each step is its own short closure, and every wait runs in Node through `pollInObsidian`, because a cold
// Android emulator can take seconds to render a base.

interface ClickResult {
  readonly activeRow: number;
  readonly overlayDelta: number;
}

interface GrowthResult {
  readonly after: number;
  readonly before: number;
}

interface ScrollResult {
  readonly after: number;
  readonly before: number;
  readonly bottom: number;
}

interface TableState {
  readonly clippedCellCount: number;
  readonly containerHeight: number;
  readonly gapCount: number;
  readonly hasAutoClass: boolean;
  readonly heightCount: number;
  readonly lastRowBottom: number;
  readonly overlapCount: number;
  readonly renderedRowCount: number;
  readonly rowHeights: number[];
  readonly rowsWithInlineHeight: number;
}

interface TableViewController {
  readonly view: BasesTableView;
}

interface TableViewHost {
  readonly controller: TableViewController;
}

const FOLDER = 'auto-rows';
const BASE_PATH = `${FOLDER}/Table.base`;
const NOTE_COUNT = 40;
const POLL_TIMEOUT_IN_MILLISECONDS = 20_000;
const PLUGIN_ID = 'bases-auto-row-height';

describe('auto row height', () => {
  it('fits every row of an Auto table to its content, keeps clicks on the right row, follows late content, and gives way to Short and to the row cap', async () => {
    const vaultPath = getTemporaryVault().path;

    async function waitForTable(step: string, isReady: (state: TableState) => boolean): Promise<TableState> {
      return pollInObsidian({
        poll: readTableState,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: step,
        until: isReady,
        vaultPath
      });
    }

    await evalInObsidian({
      async callback({ app, basePath, folder, noteCount }): Promise<void> {
        await app.vault.createFolder(folder);
        for (let index = 0; index < noteCount; index++) {
          const words = Array.from({ length: 1 + (index % 4) * 12 }, (_, index_) => `word${String(index_)}`).join(' ');
          await app.vault.create(`${folder}/Note ${String(index).padStart(2, '0')}.md`, `---\nsummary: ${words}\n---\n`);
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
            '      - summary',
            '    sort:',
            '      - property: file.name',
            '        direction: ASC',
            '    columnSize:',
            '      note.summary: 220',
            '    rowHeight: auto',
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
      const auto = await waitForTable('the Auto table laid out by content', (state) => state.hasAutoClass && state.renderedRowCount === NOTE_COUNT && state.heightCount > 1);
      expect(auto.overlapCount).toBe(0);
      expect(auto.gapCount).toBe(0);
      expect(auto.clippedCellCount).toBe(0);
      expect(auto.lastRowBottom).toBe(auto.containerHeight);
      expect(Math.min(...auto.rowHeights)).toBeGreaterThan(0);

      const options = await evalInObsidian({
        callback({ app }): Record<string, string> {
          // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
          const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
          const registration = app.internalPlugins.getEnabledPluginById('bases')?.registrations.table;
          const rowHeightOption = registration?.options?.(view.config).find((option) => option.type === 'dropdown' && option.key === 'rowHeight');
          return rowHeightOption?.type === 'dropdown' ? rowHeightOption.options : {};
        },
        vaultPath
      });
      expect(options).toMatchObject({ auto: 'Auto' });

      // A row deep in the table: clicking it must select that row, which the view finds from fixed heights
      // Unless the plugin corrects it.
      const clicked = await evalInObsidian({
        async callback({ app, lib: { clickElement, waitUntil } }): Promise<ClickResult> {
          const TARGET_ROW = 30;
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
          const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
          const entry = view.data.groupedData[0]?.entries[TARGET_ROW];
          const row = view.rows.find((candidate) => candidate.entry === entry);
          const cellEl = row?.el.querySelector<HTMLElement>('.bases-td[data-property="note.summary"]');
          if (!row || !cellEl) {
            throw new Error('No cell in the target row.');
          }
          cellEl.scrollIntoView({ block: 'center' });
          // The cell is on screen once the point at its center hit-tests to it; `top >= 0` alone already holds for a cell below
          // The viewport, before any scroll, which on a phone's short viewport left the tap pointing at nothing.
          await waitUntil({
            predicate: () => {
              const rect = cellEl.getBoundingClientRect();
              const hit = cellEl.doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return hit !== null && cellEl.contains(hit);
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await clickElement({ element: cellEl });
          await waitUntil({ predicate: () => view.activeCell?.row === TARGET_ROW, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          return {
            activeRow: view.activeCell?.row ?? -1,
            overlayDelta: Math.round(view.activeCellEl.getBoundingClientRect().top - row.el.getBoundingClientRect().top)
          };
        },
        vaultPath
      });
      expect(clicked.activeRow).toBe(30);
      expect(Math.abs(clicked.overlayDelta)).toBeLessThanOrEqual(1);

      // A scroll past the bottom of the fixed-height table must hold, through the redraw the scroll itself
      // Causes and through a data update, which restores the view's last scroll. Both were clamped to the
      // Fixed height, so the table jumped back.
      const scrollAfterUpdate = await evalInObsidian({
        async callback({ app }): Promise<ScrollResult> {
          const SETTLE_DELAY_IN_MILLISECONDS = 500;
          // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
          const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
          // The bottom of the laid-out table is past the bottom of the fixed-height one.
          view.scrollEl.scrollTop = view.scrollEl.scrollHeight;
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const before = view.scrollEl.scrollTop;
          const bottom = view.scrollEl.scrollHeight - view.scrollEl.clientHeight;
          view.onDataUpdated();
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          return { after: view.scrollEl.scrollTop, before, bottom };
        },
        vaultPath
      });
      // The scroll stays at the bottom: through the update the scroll itself causes, then through a data update.
      expect(Math.abs(scrollAfterUpdate.before - scrollAfterUpdate.bottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(scrollAfterUpdate.after - scrollAfterUpdate.before)).toBeLessThanOrEqual(1);

      // Content that renders after the layout, such as an image, grows its cell; the row follows it.
      const grown = await evalInObsidian({
        async callback({ app, lib: { waitUntil } }): Promise<GrowthResult> {
          const LATE_CONTENT_HEIGHT_IN_PIXELS = 300;
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
          const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
          const entry = view.data.groupedData[0]?.entries[1];
          const row = view.rows.find((candidate) => candidate.entry === entry);
          const contentEl = row?.el.querySelector<HTMLElement>(':scope .bases-td[data-property="note.summary"] .bases-table-cell');
          if (!row || !contentEl) {
            throw new Error('No cell content in row 1.');
          }
          const before = row.el.getBoundingClientRect().height;
          const lateEl = contentEl.createDiv({ cls: 'auto-rows-late-content' });
          lateEl.setCssStyles({ height: `${String(LATE_CONTENT_HEIGHT_IN_PIXELS)}px` });
          await waitUntil({ predicate: () => row.el.getBoundingClientRect().height >= LATE_CONTENT_HEIGHT_IN_PIXELS, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          return { after: row.el.getBoundingClientRect().height, before };
        },
        vaultPath
      });
      expect(grown.before).toBeLessThan(300);
      expect(grown.after).toBeGreaterThanOrEqual(300);
      const afterGrowth = await readTableStateOnce(vaultPath);
      expect(afterGrowth.overlapCount).toBe(0);
      expect(afterGrowth.gapCount).toBe(0);

      await setRowHeight(vaultPath, '');
      const short = await waitForTable('the table back on Short', (state) => !state.hasAutoClass && state.renderedRowCount < NOTE_COUNT);
      expect(short.rowsWithInlineHeight).toBe(0);

      await setRowHeight(vaultPath, 'auto');
      await waitForTable('the table on Auto again', (state) => state.hasAutoClass && state.renderedRowCount === NOTE_COUNT);

      await setMaxRows(vaultPath, 10);
      const capped = await waitForTable('the table over the row cap', (state) => !state.hasAutoClass && state.renderedRowCount < NOTE_COUNT);
      expect(capped.rowsWithInlineHeight).toBe(0);
    } finally {
      await setMaxRows(vaultPath, 500);
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

/**
 * Reads the layout of the table in the most recent leaf.
 *
 * @param params - The app.
 * @returns The state.
 */
function readTableState({ app }: CommonArguments): TableState {
  const TOLERANCE_IN_PIXELS = 0.5;
  const containerEl = app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector<HTMLElement>('.bases-table-container');
  if (!containerEl) {
    return {
      clippedCellCount: 0,
      containerHeight: 0,
      gapCount: 0,
      hasAutoClass: false,
      heightCount: 0,
      lastRowBottom: 0,
      overlapCount: 0,
      renderedRowCount: 0,
      rowHeights: [],
      rowsWithInlineHeight: 0
    };
  }
  const rowEls = [...containerEl.querySelectorAll<HTMLElement>(':scope .bases-tbody .bases-tr')];
  const rows = rowEls.map((el) => ({ el, height: el.getBoundingClientRect().height, top: Number.parseFloat(el.style.top) })).sort((a, b) => a.top - b.top);
  let overlapCount = 0;
  let gapCount = 0;
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!previous || !current) {
      continue;
    }
    const delta = current.top - (previous.top + previous.height);
    if (delta < -TOLERANCE_IN_PIXELS) {
      overlapCount++;
    } else if (delta > TOLERANCE_IN_PIXELS) {
      gapCount++;
    }
  }
  let clippedCellCount = 0;
  for (const cellEl of containerEl.querySelectorAll<HTMLElement>(':scope .bases-tbody .bases-td')) {
    if (cellEl.scrollHeight > cellEl.clientHeight + 1) {
      clippedCellCount++;
    }
  }
  const lastRow = rows.at(-1);
  const tableEl = containerEl.querySelector<HTMLElement>('.bases-table');
  const tbodyEl = containerEl.querySelector<HTMLElement>('.bases-tbody');
  const tbodyOffset = tbodyEl && tableEl ? tbodyEl.getBoundingClientRect().top - containerEl.getBoundingClientRect().top : 0;
  return {
    clippedCellCount,
    containerHeight: Math.round(Number.parseFloat(containerEl.style.height)),
    gapCount,
    hasAutoClass: containerEl.hasClass('mod-auto-row-height'),
    heightCount: new Set(rows.map((row) => Math.round(row.height))).size,
    lastRowBottom: lastRow ? Math.round(tbodyOffset + lastRow.top + lastRow.height) : 0,
    overlapCount,
    renderedRowCount: rows.length,
    rowHeights: rows.map((row) => Math.round(row.height)),
    rowsWithInlineHeight: rowEls.filter((el) => el.style.getPropertyValue('--bases-table-row-height') !== '').length
  };
}

async function readTableStateOnce(vaultPath: string): Promise<TableState> {
  return evalInObsidian({ callback: readTableState, vaultPath });
}

async function setMaxRows(vaultPath: string, maxRows: number): Promise<void> {
  await evalInObsidian({
    async callback({ app, lib: { waitUntil }, maxRows: value, pluginId }): Promise<void> {
      const SETTING_NAME = 'Maximum rows';
      app.setting.open();
      app.setting.openTabById(pluginId);
      function findInput(): HTMLInputElement | null {
        const item = [...app.setting.containerEl.querySelectorAll('.setting-item')]
          .find((el) => el.querySelector('.setting-item-name')?.textContent === SETTING_NAME);
        return item?.querySelector('input') ?? null;
      }
      await waitUntil({ predicate: () => findInput() !== null, timeoutInMilliseconds: 5000 });
      const inputEl = findInput();
      if (!inputEl) {
        throw new Error(`No ${SETTING_NAME} input.`);
      }
      // The value is the point of the step, not the typing: typing would go through the soft keyboard on
      // Android, so the field is filled the way it fills itself and fires the `input` it would fire.
      inputEl.value = String(value);
      inputEl.dispatchEvent(new Event('input'));
      app.setting.close();
    },
    input: { maxRows, pluginId: PLUGIN_ID },
    vaultPath
  });
}

async function setRowHeight(vaultPath: string, rowHeight: string): Promise<void> {
  await evalInObsidian({
    callback({ app, rowHeight: value }): void {
      // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
      const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
      // The view-options menu writes the same key the same way.
      view.config.set('rowHeight', value);
    },
    input: { rowHeight },
    vaultPath
  });
}
