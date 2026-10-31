import type { BasesTableView } from '@obsidian-typings/obsidian-public-latest';

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

// Isolation: `npx vitest run --project integration-tests:desktop src/auto-row-height/page-keys.desktop.integration.test.ts`.
// Desktop only: a phone has no PageUp or PageDown key.

interface PageMove {
  readonly fromRow: number;
  readonly heightsPassed: number;
  readonly pageHeight: number;
  readonly toRow: number;
}

interface TableViewController {
  readonly view: BasesTableView;
}

interface TableViewHost {
  readonly controller: TableViewController;
}

const FOLDER = 'auto-rows-page';
const BASE_PATH = `${FOLDER}/Table.base`;
const NOTE_COUNT = 60;
const POLL_TIMEOUT_IN_MILLISECONDS = 20_000;

describe('page keys in an auto table', () => {
  it('moves PageDown and PageUp by one page of real row heights', async () => {
    const vaultPath = getTemporaryVault().path;

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
      await pollInObsidian({
        poll: ({ app }) => app.workspace.getMostRecentLeaf()?.view.containerEl.querySelectorAll(':scope .mod-auto-row-height .bases-tbody .bases-tr').length ?? 0,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the Auto table',
        until: (count) => count === NOTE_COUNT,
        vaultPath
      });

      // The first row becomes the active cell and the table takes the focus, through the view's own
      // Ephemeral state, which is how Obsidian restores both when a base is reopened.
      await evalInObsidian({
        async callback({ app, lib: { waitUntil } }): Promise<void> {
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
          const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
          // eslint-disable-next-line unicorn/name-replacements -- `groupIdx` is the table view's own field name.
          view.setEphemeralState({ activeCell: { column: 1, groupIdx: 0, row: 0 }, scroll: { left: 0, top: 0 } });
          await waitUntil({ predicate: () => view.activeCell !== null && view.containerEl.isActiveElement(), timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
        },
        vaultPath
      });
      const down = await pressPageKey(vaultPath, 'PageDown');
      expect(down.fromRow).toBe(0);
      expect(down.toRow).toBeGreaterThan(down.fromRow);
      expect(down.heightsPassed).toBeLessThanOrEqual(down.pageHeight);
      expect(down.heightsPassed).toBeGreaterThan(down.pageHeight / 2);

      const up = await pressPageKey(vaultPath, 'PageUp');
      expect(up.toRow).toBeLessThan(up.fromRow);
      expect(up.heightsPassed).toBeLessThanOrEqual(up.pageHeight);
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

async function pressPageKey(vaultPath: string, key: string): Promise<PageMove> {
  return evalInObsidian({
    async callback({ app, key: keyName, lib: { pressKey, waitUntil } }): Promise<PageMove> {
      const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
      // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
      const view = (app.workspace.getMostRecentLeaf()?.view as unknown as TableViewHost).controller.view;
      const fromRow = view.activeCell?.row ?? -1;
      await pressKey({ key: keyName });
      await waitUntil({ predicate: () => (view.activeCell?.row ?? -1) !== fromRow, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
      const toRow = view.activeCell?.row ?? -1;
      const entries = view.data.groupedData[0]?.entries ?? [];
      let heightsPassed = 0;
      for (let row = Math.min(fromRow, toRow); row < Math.max(fromRow, toRow); row++) {
        const rowEl = view.rows.find((candidate) => candidate.entry === entries[row])?.el;
        heightsPassed += rowEl?.getBoundingClientRect().height ?? 0;
      }
      let scrollerEl = view.containerEl.parentElement;
      while (scrollerEl && scrollerEl.scrollHeight <= scrollerEl.clientHeight) {
        scrollerEl = scrollerEl.parentElement;
      }
      return { fromRow, heightsPassed, pageHeight: scrollerEl?.clientHeight ?? window.innerHeight, toRow };
    },
    input: { key },
    vaultPath
  });
}
