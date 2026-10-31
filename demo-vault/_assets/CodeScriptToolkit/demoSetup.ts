import type { App } from 'obsidian';

import { configureCommunityPlugin } from '@mnaoumov/obsidian-lib/community-plugins';
import { Notice } from 'obsidian';

// Shared code for every `code-button` in this vault, so each note's button stays a one-liner instead of a
// Block copy-pasted across notes.
//
// The plugin id has to match `manifest.json` exactly: commands are keyed by it, and so is `data.json`.
const PLUGIN_ID = 'bases-auto-row-height';

const SAMPLE_BASE_PATH = 'Materials/01 Auto row height/Projects.base';

const DEFAULT_MAX_ROWS = 500;

/**
 * Opens the sample base, whose table view uses the Auto row height.
 *
 * Manual equivalent: open `Materials/01 Auto row height/Projects.base`.
 */
export async function openSampleBase(app: App): Promise<void> {
  const file = app.vault.getFileByPath(SAMPLE_BASE_PATH);
  if (!file) {
    new Notice(`Could not find ${SAMPLE_BASE_PATH}.`);
    return;
  }
  await app.workspace.getLeaf(false).openFile(file);
}

/**
 * Sets the Row height of the sample base's table view, the way the view options menu does: it rewrites the
 * `rowHeight` line of the base file, and the open table follows.
 *
 * Manual equivalent: open the base, click the view name, open **Configure view** and pick a **Row height**.
 *
 * @param rowHeight - `auto`, or `` for Short.
 */
export async function setRowHeight(app: App, rowHeight: '' | 'auto'): Promise<void> {
  const file = app.vault.getFileByPath(SAMPLE_BASE_PATH);
  if (!file) {
    new Notice(`Could not find ${SAMPLE_BASE_PATH}.`);
    return;
  }
  await app.vault.process(file, (content) => content.replace(/^(\s*)rowHeight:.*$/mu, `$1rowHeight: ${rowHeight === '' ? '""' : rowHeight}`));
  await openSampleBase(app);
  new Notice(`Row height is now ${rowHeight === '' ? 'Short' : 'Auto'}.`);
}

/**
 * Sets the most rows a table may have and still fit its rows to their content.
 *
 * `configureCommunityPlugin` routes through the plugin's own settings component while it is loaded, so the
 * change applies live -- no window reload, and no writing `data.json` behind a running plugin's back, which
 * it would overwrite from memory as it unloads.
 *
 * Manual equivalent: change **Maximum rows** in **Settings -> Community plugins -> Bases Auto Row Height**.
 */
export async function setMaxRows(app: App, maxRows: number): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { maxRows } });
  new Notice(`maxRows is now ${String(maxRows)}. It is live -- no reload needed.`);
}

/**
 * Puts `maxRows` back to the value a fresh install starts with, so exploring the settings note leaves the
 * vault as you found it.
 *
 * Manual equivalent: type `500` back into **Maximum rows**.
 */
export async function resetMaxRows(app: App): Promise<void> {
  await setMaxRows(app, DEFAULT_MAX_ROWS);
}
