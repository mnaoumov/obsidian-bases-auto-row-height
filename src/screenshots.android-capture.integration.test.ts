/**
 * @file
 *
 * Produces the mobile screenshots the README and the community-store listing show, driving the demo vault's sample
 * base in Obsidian Mobile on an Android emulator and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * The mobile counterpart of the desktop capture suite, with the same two frames: the sample table on Auto, then the
 * same table on Short. A phone is where a fixed row height hurts most, because a narrow column wraps or cuts off far
 * more of each value, which is why the mobile set is worth taking rather than reusing the desktop images.
 *
 * It runs on the dedicated `obsidian_screenshots` AVD, built at exactly 900x1600, so the device frame already IS the
 * listing size and needs no crop or rescale. The harness never installs the Obsidian APK on it, so provision it with
 * `provision-obsidian-avd.ps1 -AvdName obsidian_screenshots`, and again whenever its Obsidian falls below the
 * manifest's `minAppVersion`: on 1.13.6 the table view has no `isGroupCollapsed`, the layout throws, and every shot
 * comes out on one fixed height.
 *
 * Named `*.android-capture.` so no standard project collects it. Run it with `npm run capture:screenshots`.
 */

import { Buffer } from 'node:buffer';
import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildDemoVaultPopulate,
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  pollInObsidian,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

interface TableLayout {
  readonly distinctHeightCount: number;
  readonly isAuto: boolean;
  readonly rowCount: number;
}

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * Waited on from Node, one short eval at a time, so a slow vault scan on a freshly booted emulator is not bounded by
 * the transport's ~30s per-closure cap.
 */
const POLL_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;
const SETTLE_DELAY_IN_MILLISECONDS = 1500;

const SAMPLE_BASE_PATH = 'Materials/01 Auto row height/Projects.base';
const SAMPLE_NOTES_FOLDER_PATH = 'Materials/01 Auto row height/Notes';
const SAMPLE_ROW_COUNT = 6;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');
const DEMO_VAULT_PATH = join(process.cwd(), 'demo-vault');

beforeAll(async () => {
  const vault = getTemporaryVault();

  // Only the `Materials/` fixtures: the sample base and the six notes it lists.
  const demoVaultFiles = buildDemoVaultPopulate({ demoVaultPath: DEMO_VAULT_PATH });
  // Every fixture is text (a base and notes), decoded here because the populate map may hold the file's bytes.
  const fixtures = Object.fromEntries(
    Object.entries(demoVaultFiles)
      .filter(([path]) => path.startsWith('Materials/'))
      .map(([path, content]) => [path, typeof content === 'string' ? content : Buffer.from(content as Uint8Array).toString('utf-8')])
  );

  /*
   * Written through the vault API rather than pushed with `vault.syncToDevice()`. A pushed set reaches the device's
   * disk, but Obsidian Mobile (1.13.6, 2026-11-07) noticed only some of it: not all six notes within a minute, so the
   * table was shot with one row. A file the vault itself creates is indexed at once.
   */
  await evalInObsidian({
    async callback({ app, files }): Promise<void> {
      for (const [path, content] of Object.entries(files)) {
        try {
          const folderPath = path.slice(0, path.lastIndexOf('/'));
          if (folderPath && !app.vault.getFolderByPath(folderPath) && !await app.vault.adapter.exists(folderPath)) {
            await app.vault.createFolder(folderPath);
          }
          const existingFile = app.vault.getFileByPath(path);
          if (existingFile) {
            await app.vault.modify(existingFile, content);
          } else {
            await app.vault.create(path, content);
          }
        } catch (error) {
          throw new Error(`Could not write ${path}: ${String(error)} (${typeof content})`, { cause: error });
        }
      }
    },
    input: { files: fixtures },
    vaultPath: vault.path
  });

  // The base AND every note it lists, indexed, so the table is opened with all six rows to show.
  await pollInObsidian({
    input: { basePath: SAMPLE_BASE_PATH, notesFolderPath: SAMPLE_NOTES_FOLDER_PATH, rowCount: SAMPLE_ROW_COUNT },
    poll({ app, basePath, notesFolderPath, rowCount }): boolean {
      const noteFiles = app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${notesFolderPath}/`));
      return Boolean(app.vault.getFileByPath(basePath))
        && noteFiles.length === rowCount
        && noteFiles.every((file) => Boolean(app.metadataCache.getFileCache(file)));
    },
    timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the sample base and its notes never all appeared in the vault',
    until: (hasArrived: boolean): boolean => hasArrived,
    vaultPath: vaultPath()
  });

  await evalInObsidian({
    callback({ app }): void {
      // The default dark theme, as on desktop, so the sets read as one series.
      app.changeTheme('obsidian');
      // On a phone both sidebars are drawers over the note; keep them shut so the table has the whole screen.
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('mobile store screenshots', () => {
  it('1 - the sample table on Auto', async () => {
    await setRowHeight('auto');
    const layout = await waitForTable('the sample table on Auto', (state) => state.isAuto && state.distinctHeightCount > 1);
    expect(layout.rowCount).toBe(SAMPLE_ROW_COUNT);
    await shoot(1, 'Auto: every row is as tall as its content');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('2 - the same table on Short, for contrast', async () => {
    await setRowHeight('');
    const layout = await waitForTable('the sample table on Short', (state) => !state.isAuto && state.distinctHeightCount === 1);
    expect(layout.rowCount).toBe(SAMPLE_ROW_COUNT);
    await shoot(2, 'Without Auto: one fixed height cuts long text off');
    await setRowHeight('auto');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Rewrites the `rowHeight` line of the sample base, the way the view options menu does, and (re)opens it.
 *
 * @param rowHeight - `auto`, or `` for Short.
 */
async function setRowHeight(rowHeight: '' | 'auto'): Promise<void> {
  await evalInObsidian({
    async callback({ app, basePath, rowHeight: value }): Promise<void> {
      const file = app.vault.getFileByPath(basePath);
      if (!file) {
        throw new Error(`No ${basePath}.`);
      }
      const rowHeightLine = `rowHeight: ${value === '' ? '""' : value}`;
      await app.vault.process(file, (content) => content.replace(/^(?<indent>\s*)rowHeight:.*$/mu, (_match, indent: string) => `${indent}${rowHeightLine}`));
      await app.workspace.getLeaf(false).openFile(file);
    },
    input: { basePath: SAMPLE_BASE_PATH, rowHeight },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the device screen, captions it and writes it as `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * The capture is the device's own framebuffer, so its size is asserted before captioning: run against any AVD but
 * the 900x1600 one and this fails loudly instead of shipping an off-spec image.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption burned into the shot.
 */
async function shoot(index: number, caption: string): Promise<void> {
  // Re-opening the base plays a short transition on mobile; a frame taken inside it shows the table squashed
  // Vertically, so let it finish first.
  await sleep(SETTLE_DELAY_IN_MILLISECONDS);
  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });
  const labeled = await labelScreenshot(captured, { text: caption });
  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Polls the open table until it is in the state a shot needs. On a timeout the error carries the last state seen, so
 * a table that never laid out (one row, one height) reads as such rather than as a bare timeout.
 *
 * @param step - What is being waited for, named in the error.
 * @param isReady - Whether a state is the one wanted.
 * @returns The state that satisfied `isReady`.
 */
async function waitForTable(step: string, isReady: (state: TableLayout) => boolean): Promise<TableLayout> {
  let lastState: TableLayout | undefined;
  try {
    return await pollInObsidian({
      poll({ app }): TableLayout {
        const containerEl = app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector<HTMLElement>('.bases-table-container');
        const rowEls = [...(containerEl?.querySelectorAll<HTMLElement>(':scope .bases-tbody .bases-tr') ?? [])];
        return {
          distinctHeightCount: new Set(rowEls.map((rowEl) => Math.round(rowEl.getBoundingClientRect().height))).size,
          isAuto: containerEl?.classList.contains('mod-auto-row-height') ?? false,
          rowCount: rowEls.length
        };
      },
      timeoutInMilliseconds: POLL_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: step,
      until: (state) => {
        lastState = state;
        return isReady(state);
      },
      vaultPath: vaultPath()
    });
  } catch (error) {
    throw new Error(`${step}: last state ${JSON.stringify(lastState)}`, { cause: error });
  }
}
