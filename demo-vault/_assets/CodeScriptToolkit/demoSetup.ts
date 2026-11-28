import type { App } from 'obsidian';

import { configureCommunityPlugin } from '@mnaoumov/obsidian-lib/community-plugins';
import {
  Notice,
  parseYaml,
  stringifyYaml
} from 'obsidian';

// Shared code for every `code-button` in this vault, so each note's button stays a one-liner instead of a
// Block copy-pasted across notes.
//
// The plugin id has to match `manifest.json` exactly: commands are keyed by it, and so is `data.json`.
const PLUGIN_ID = 'bases-auto-row-height';

interface BaseFile {
  readonly views?: Record<string, unknown>[];
}

const SAMPLE_BASE_PATH = 'Materials/01 Auto row height/Projects.base';

const TOGGLE_COMMAND_ID = `${PLUGIN_ID}:toggle-auto-row-height`;

const DEFAULT_MAX_ROWS = 500;

const ROW_HEIGHT_LINE_REG_EXP = /^(?<indent>\s*)rowHeight:.*$/mu;

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
 * Puts `maxRows` back to the value a fresh install starts with, so exploring the settings note leaves the
 * vault as you found it.
 *
 * Manual equivalent: type `500` back into **Maximum rows**.
 */
export async function resetMaxRows(app: App): Promise<void> {
  await setMaxRows(app, DEFAULT_MAX_ROWS);
}

/**
 * Sets the most rows a table may have and still fit its rows to their content.
 *
 * `configureCommunityPlugin` routes through the plugin's own settings component while it is loaded, so the
 * change applies live -- no window reload, and no writing `data.json` behind a running plugin's back, which
 * it would overwrite from memory as it unloads.
 *
 * Manual equivalent: change **Maximum rows** in **Settings -> Community plugins -> `Bases Auto Row Height`**.
 */
export async function setMaxRows(app: App, maxRows: number): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { maxRows } });
  new Notice(`maxRows is now ${String(maxRows)}. It is live -- no reload needed.`);
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
  const value = rowHeight === '' ? '""' : rowHeight;
  await app.vault.process(file, (content) =>
    content.replace(ROW_HEIGHT_LINE_REG_EXP, (line) => {
      const indent = ROW_HEIGHT_LINE_REG_EXP.exec(line)?.groups?.['indent'] ?? '';
      return `${indent}rowHeight: ${value}`;
    })
  );
  await openSampleBase(app);
  new Notice(`Row height is now ${rowHeight === '' ? 'Short' : 'Auto'}.`);
}

/**
 * Sets how many lines the `summary` column of the sample table shows, the way its column menu does: it writes
 * the `cellLines` map of the table view in the base file, and the open table follows.
 *
 * Manual equivalent: open the base, right-click the **summary** column header (tap it on mobile), open
 * **Cell height** and pick a line count, or **Wrap in full**.
 *
 * @param lines - The most lines a summary cell shows, or `null` to wrap it in full.
 */
export async function setSummaryLines(app: App, lines: null | number): Promise<void> {
  const file = app.vault.getFileByPath(SAMPLE_BASE_PATH);
  if (!file) {
    new Notice(`Could not find ${SAMPLE_BASE_PATH}.`);
    return;
  }
  await app.vault.process(file, (content) => {
    const base = parseYaml(content) as BaseFile;
    const view = base.views?.[0];
    if (!view) {
      return content;
    }
    const cellLines = { ...(view['cellLines'] as Record<string, number> | undefined) };
    if (lines === null) {
      delete cellLines['note.summary'];
    } else {
      cellLines['note.summary'] = lines;
    }
    if (Object.keys(cellLines).length === 0) {
      delete view['cellLines'];
    } else {
      view['cellLines'] = cellLines;
    }
    return stringifyYaml(base);
  });
  await openSampleBase(app);
  new Notice(lines === null ? 'The summary column wraps in full.' : `The summary column shows at most ${String(lines)} line(s).`);
}

/**
 * Opens the sample base and runs the **Toggle Auto row height** command on its table view, which switches it
 * between Auto and the row height it had before.
 *
 * Manual equivalent: open the base, open the command palette and run **`Bases Auto Row Height`: Toggle Auto row
 * height**, or press the hotkey you gave it.
 */
export async function toggleAutoRowHeight(app: App): Promise<void> {
  await openSampleBase(app);
  if (!app.commands.executeCommandById(TOGGLE_COMMAND_ID)) {
    new Notice('The toggle command is not available. Is the plugin enabled?');
  }
}
