import type { BasesView as BasesFileView } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  BasesView,
  BasesViewConfig
} from 'obsidian';

import { GlobalCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/global-command-handler';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';

import {
  AUTO_ROW_HEIGHT,
  ROW_HEIGHT_KEY
} from './auto-row-height/auto-row-height-component.ts';

interface ActiveTableView {
  readonly config: BasesViewConfig;
  // The base file and the view name, which outlive the view objects a save rebuilds.
  readonly key: string;
}

interface ToggleAutoRowHeightCommandHandlerConstructorParams {
  readonly app: App;
}

const TABLE_VIEW_TYPE = 'table';

/**
 * Toggles the table view of the active base between Auto and the row height it had before, without opening the
 * view options.
 *
 * The value is written through the view config, as the Row height dropdown of the view options writes it, so the
 * base file gets `rowHeight: auto`, and Short removes the key. The height to go back to is remembered per base
 * file and view name, in memory only, because every save rebuilds the view; with none remembered, it is Short.
 *
 * The idea, a command that toggles the row height of the current base, comes from `Bases Wrap Text` (MIT). No code
 * was copied: that plugin rewrites the text of the base file for every table view.
 */
export class ToggleAutoRowHeightCommandHandler extends GlobalCommandHandler {
  private readonly app: App;
  private readonly previousRowHeights = new Map<string, null | string>();

  public constructor(params: ToggleAutoRowHeightCommandHandlerConstructorParams) {
    super({
      icon: 'lucide-wrap-text',
      id: 'toggle-auto-row-height',
      name: 'Toggle Auto row height'
    });
    this.app = params.app;
  }

  protected override canExecute(): boolean {
    return this.getActiveTableView() !== null;
  }

  protected override execute(): void {
    // The command runs only after `canExecute` found the table view.
    const { config, key } = ensureNonNullable(this.getActiveTableView());
    const current = config.get(ROW_HEIGHT_KEY);
    if (current === AUTO_ROW_HEIGHT) {
      const previous = this.previousRowHeights.get(key) ?? null;
      this.previousRowHeights.delete(key);
      config.set(ROW_HEIGHT_KEY, previous);
      return;
    }
    // The dropdown stores Short as no value at all.
    this.previousRowHeights.set(key, typeof current === 'string' && current !== '' ? current : null);
    config.set(ROW_HEIGHT_KEY, AUTO_ROW_HEIGHT);
  }

  private getActiveTableView(): ActiveTableView | null {
    const leafView = this.app.workspace.getMostRecentLeaf()?.view;
    if (leafView?.getViewType() !== ViewType.Bases) {
      return null;
    }
    const { controller } = castTo<BasesFileView>(leafView);
    const view = castTo<BasesView | null>(controller.view);
    return view?.type === TABLE_VIEW_TYPE ? { config: view.config, key: `${controller.sourcePath}\n${view.config.name}` } : null;
  }
}
