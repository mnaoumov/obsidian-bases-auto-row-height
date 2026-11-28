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

// Isolation: `npx vitest run --project integration-tests:desktop src/toggle-auto-row-height.desktop.integration.test.ts`.

interface TableViewController {
  readonly view: BasesTableView;
}

interface TableViewHost {
  readonly controller: TableViewController;
}

interface ToggleState {
  readonly fileRowHeightLine: null | string;
  readonly hasAutoClass: boolean;
  readonly isShown: boolean;
}

interface ToggleStateInput {
  readonly basePath: string;
}

const FOLDER = 'toggle-auto-row-height';
const BASE_PATH = `${FOLDER}/Table.base`;
const COMMAND_ID = 'bases-auto-row-height:toggle-auto-row-height';
const POLL_TIMEOUT_IN_MILLISECONDS = 20_000;

describe('toggle Auto row height command', () => {
  it('switches the active table to Auto and back to the height it had, and to Short with none remembered', async () => {
    const vaultPath = getTemporaryVault().path;

    async function toggleAndWait(step: string, isReady: (state: ToggleState) => boolean): Promise<ToggleState> {
      await evalInObsidian({
        callback({ app, commandId }): void {
          if (!app.commands.executeCommandById(commandId)) {
            throw new Error(`${commandId} is not available.`);
          }
        },
        input: { commandId: COMMAND_ID },
        vaultPath
      });
      return pollInObsidian({
        input: { basePath: BASE_PATH },
        poll: readToggleState,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: step,
        until: isReady,
        vaultPath
      });
    }

    await evalInObsidian({
      async callback({ app, basePath, folder }): Promise<void> {
        await app.vault.createFolder(folder);
        await app.vault.create(`${folder}/Note.md`, '---\nsummary: a value\n---\n');
        await app.vault.create(
          basePath,
          ['filters:', '  and:', `    - file.inFolder("${folder}")`, 'views:', '  - type: table', '    name: Table', '    rowHeight: tall', ''].join('\n')
        );
        const file = app.vault.getFileByPath(basePath);
        if (!file) {
          throw new Error(`No ${basePath}.`);
        }
        await app.workspace.getLeaf(false).openFile(file);
      },
      input: { basePath: BASE_PATH, folder: FOLDER },
      vaultPath
    });

    try {
      await pollInObsidian({
        input: { basePath: BASE_PATH },
        poll: readToggleState,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the Tall table',
        until: (state) => state.isShown,
        vaultPath
      });

      const auto = await toggleAndWait('Tall to Auto', (state) => state.hasAutoClass && state.fileRowHeightLine === 'rowHeight: auto');
      expect(auto.fileRowHeightLine).toBe('rowHeight: auto');

      const tall = await toggleAndWait('Auto back to Tall', (state) => !state.hasAutoClass && state.fileRowHeightLine === 'rowHeight: tall');
      expect(tall.fileRowHeightLine).toBe('rowHeight: tall');

      // A view set to Auto some other way, here by editing the base file, has no height remembered, so the command
      // Takes it to Short.
      await evalInObsidian({
        async callback({ app, basePath }): Promise<void> {
          const file = app.vault.getFileByPath(basePath);
          if (!file) {
            throw new Error(`No ${basePath}.`);
          }
          await app.vault.process(file, (content) => content.replace('rowHeight: tall', 'rowHeight: auto'));
        },
        input: { basePath: BASE_PATH },
        vaultPath
      });
      await pollInObsidian({
        input: { basePath: BASE_PATH },
        poll: readToggleState,
        timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'Auto from the edited file',
        until: (state) => state.hasAutoClass,
        vaultPath
      });
      const short = await toggleAndWait('Auto to Short with nothing remembered', (state) => state.isShown && !state.hasAutoClass && state.fileRowHeightLine === null);
      expect(short.fileRowHeightLine).toBeNull();
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

/**
 * Reads the stored row height and whether the table of the most recent leaf is laid out as Auto.
 *
 * @param params - The app and the base path.
 * @returns The state.
 */
async function readToggleState({ app, basePath }: CommonArguments & ToggleStateInput): Promise<ToggleState> {
  // eslint-disable-next-line no-restricted-syntax -- A closure runs inside Obsidian, where no cast helper can be imported, and the leaf's `View` shares no members with the Bases view it holds.
  const view = (app.workspace.getMostRecentLeaf()?.view as unknown as Partial<TableViewHost> | undefined)?.controller?.view;
  const containerEl = view?.containerEl;
  const file = app.vault.getFileByPath(basePath);
  const content = file ? await app.vault.read(file) : '';
  const fileRowHeightLine = content.split('\n').map((line) => line.trim()).find((line) => line.startsWith('rowHeight:')) ?? null;
  return {
    fileRowHeightLine,
    hasAutoClass: containerEl?.hasClass('mod-auto-row-height') ?? false,
    isShown: containerEl?.isShown() ?? false
  };
}
