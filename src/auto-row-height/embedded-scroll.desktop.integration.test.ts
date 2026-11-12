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

// Isolation: `npx vitest run --project integration-tests:desktop src/auto-row-height/embedded-scroll.desktop.integration.test.ts`.

interface BottomState {
  readonly lastRowHit: boolean;
  readonly lastRowOnScreen: boolean;
  readonly maxScroll: number;
  readonly scrollTop: number;
}

interface EmbedState {
  readonly hasAutoClass: boolean;
  readonly renderedRowCount: number;
}

const FOLDER = 'auto-rows-embed';
const NOTE_PATH = `${FOLDER}/Embed.md`;
const NOTE_COUNT = 60;
const POLL_TIMEOUT_IN_MILLISECONDS = 30_000;

describe('an Auto table embedded in a note', () => {
  it('scrolls to its last row in Live Preview', async () => {
    const vaultPath = getTemporaryVault().path;

    await evalInObsidian({
      async callback({ app, folder, noteCount, notePath }): Promise<void> {
        await app.vault.createFolder(folder);
        for (let index = 0; index < noteCount; index++) {
          const words = Array.from({ length: 1 + (index % 4) * 24 }, (_, index_) => `word${String(index_)}`).join(' ');
          await app.vault.create(`${folder}/Row ${String(index).padStart(2, '0')}.md`, `---\nsummary: ${words}\n---\n`);
        }
        await app.vault.create(
          notePath,
          [
            '# Embedded table',
            '',
            '```base',
            'filters:',
            '  and:',
            `    - file.inFolder("${folder}")`,
            '    - file.name != "Embed"',
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
            '```',
            '',
            'After the table.',
            ''
          ].join('\n')
        );
        const file = app.vault.getFileByPath(notePath);
        if (!file) {
          throw new Error(`No ${notePath}.`);
        }
        await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
      },
      input: { folder: FOLDER, noteCount: NOTE_COUNT, notePath: NOTE_PATH },
      vaultPath
    });

    try {
      await pollInObsidian({
        poll({ app }): EmbedState {
          const containerEl = app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector<HTMLElement>(':scope .markdown-source-view .bases-table-container');
          return {
            hasAutoClass: containerEl?.hasClass('mod-auto-row-height') ?? false,
            renderedRowCount: containerEl?.querySelectorAll(':scope .bases-tbody .bases-tr').length ?? 0
          };
        },
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the embedded Auto table laid out by content',
        until: (state) => state.hasAutoClass && state.renderedRowCount === NOTE_COUNT,
        vaultPath
      });

      const bottom = await evalInObsidian({
        async callback({ app, lib: { waitUntil } }): Promise<BottomState> {
          const SETTLE_DELAY_IN_MILLISECONDS = 500;
          const SCROLL_ATTEMPTS = 5;
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          const rootEl = app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector<HTMLElement>('.markdown-source-view');
          const scrollerEl = rootEl?.querySelector<HTMLElement>('.cm-scroller');
          const containerEl = rootEl?.querySelector<HTMLElement>('.bases-table-container');
          if (!scrollerEl || !containerEl) {
            throw new Error('No editor scroller or embedded table.');
          }
          // Each scroll redraws the table, and the editor measures the embed again, so the bottom is taken several
          // Times. Each redraw used to clamp the editor's scroll to the fixed-height table.
          for (let attempt = 0; attempt < SCROLL_ATTEMPTS; attempt++) {
            scrollerEl.scrollTop = scrollerEl.scrollHeight;
            await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          }
          const scrollTop = scrollerEl.scrollTop;
          const maxScroll = scrollerEl.scrollHeight - scrollerEl.clientHeight;

          const lastRowEl = [...containerEl.querySelectorAll<HTMLElement>(':scope .bases-tbody .bases-tr')]
            .sort((a, b) => Number.parseFloat(b.style.top) - Number.parseFloat(a.style.top))[0];
          if (!lastRowEl) {
            throw new Error('No rows.');
          }
          lastRowEl.scrollIntoView({ block: 'center' });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          function isOnScreen(): boolean {
            if (!lastRowEl || !scrollerEl) {
              return false;
            }
            const rowRect = lastRowEl.getBoundingClientRect();
            const scrollerRect = scrollerEl.getBoundingClientRect();
            return rowRect.top >= scrollerRect.top && rowRect.bottom <= scrollerRect.bottom;
          }
          try {
            await waitUntil({ predicate: isOnScreen, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          } catch {
            // Reported below.
          }
          const rowRect = lastRowEl.getBoundingClientRect();
          const hit = lastRowEl.doc.elementFromPoint(rowRect.left + rowRect.width / 2, rowRect.top + rowRect.height / 2);
          return {
            lastRowHit: hit !== null && lastRowEl.contains(hit),
            lastRowOnScreen: isOnScreen(),
            maxScroll,
            scrollTop
          };
        },
        vaultPath
      });
      expect(Math.abs(bottom.scrollTop - bottom.maxScroll)).toBeLessThanOrEqual(1);
      expect(bottom.lastRowOnScreen).toBe(true);
      expect(bottom.lastRowHit).toBe(true);
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
