/**
 * @file
 *
 * Produces the desktop screenshots the README and the community-store listing show, driving the demo vault's sample
 * base in a real Obsidian and writing `images/screenshots/screenshot-desktop-N.png`.
 *
 * A capture script rather than an assertion suite: it runs in a desktop project because that is where a real,
 * plugin-enabled Obsidian already exists, and it is named `*.desktop-capture.` so no standard project collects it.
 * Run it with `npm run capture:screenshots`.
 *
 * Each shot is captioned by `labelScreenshot` after capture. The caption is what makes shot 2, the same table on
 * Short, safe to include: a listing carousel shows one shot at a time, so an unlabelled before-shot reads as a
 * picture of what the plugin does rather than of what it fixes.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  applyObsidianTheme,
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

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;
const POLL_TIMEOUT_IN_MILLISECONDS = 30_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

const SAMPLE_BASE_PATH = 'Materials/01 Auto row height/Projects.base';
const SAMPLE_ROW_COUNT = 6;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');
const DEMO_VAULT_PATH = join(process.cwd(), 'demo-vault');

beforeAll(async () => {
  const vault = getTemporaryVault();

  // Only the `Materials/` fixtures: the sample base and the six notes it lists.
  const demoVaultFiles = buildDemoVaultPopulate({ demoVaultPath: DEMO_VAULT_PATH });
  vault.populate(Object.fromEntries(Object.entries(demoVaultFiles).filter(([path]) => path.startsWith('Materials/'))));
  await vault.syncToDevice();

  // The author's plugins are all shot in the default dark theme, so the sets read as one series.
  await applyObsidianTheme({ theme: 'dark', vaultPath: vaultPath() });

  await evalInObsidian({
    async callback({ app, basePath, lib: { waitUntil } }): Promise<void> {
      const WAIT_TIMEOUT_IN_MILLISECONDS = 12_000;
      await waitUntil({
        message: 'the sample base to appear in the vault',
        predicate: () => Boolean(app.vault.getFileByPath(basePath)),
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      // The table is the subject, so it gets the whole window.
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    },
    input: { basePath: SAMPLE_BASE_PATH },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('desktop store screenshots', () => {
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
 * Captures the current Obsidian window, captions it and writes it as
 * `images/screenshots/screenshot-desktop-<index>.png`, failing if it does not come back at the listing size.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption burned into the shot.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });
  const labeled = await labelScreenshot(bytes, { text: caption });
  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });
  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}

async function waitForTable(step: string, isReady: (state: TableLayout) => boolean): Promise<TableLayout> {
  return pollInObsidian({
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
    until: isReady,
    vaultPath: vaultPath()
  });
}
