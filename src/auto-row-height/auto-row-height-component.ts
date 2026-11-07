import type {
  BasesTableCellIndex,
  BasesTableRect,
  BasesTableRow,
  BasesTableView,
  BasesTableViewRegistration
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  BasesAllOptions,
  BasesViewConfig,
  QueryController
} from 'obsidian';

import { CorePluginToggleComponent } from '@mnaoumov/obsidian-lib/components/core-plugin-toggle-component';
import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';
import { Component } from 'obsidian';

import type { GroupRowTops } from './row-layout.ts';

import {
  adjustCellRect,
  computeRowTops,
  countRowsForPage,
  findRowAtOffset
} from './row-layout.ts';
import { getVisibleHeight } from './visible-height.ts';

/**
 * What the component reads from the plugin's settings.
 */
export interface AutoRowHeightSettings {
  /**
   * The most rows a table may have and still be laid out by content. A larger table keeps the native
   * fixed-height rows, because every row of an auto table is rendered.
   */
  readonly maxRows: number;
}

interface AutoRowHeightComponentConstructorParams {
  readonly app: App;
  readonly getSettings: () => AutoRowHeightSettings;
}

interface ViewState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The pending frame is set and cleared as resizes come in.
  frame: number;
  readonly keydownHandler: (event_: KeyboardEvent) => void;
  readonly observedCells: Set<HTMLElement>;
  readonly resizeObserver: ResizeObserver;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Every layout replaces the row offsets.
  tops: GroupRowTops[];
}

/**
 * The `rowHeight` value that turns the layout on.
 */
export const AUTO_ROW_HEIGHT = 'auto';

/**
 * The class an auto table's container carries.
 */
export const AUTO_ROW_HEIGHT_CLASS = 'mod-auto-row-height';

const AUTO_ROW_HEIGHT_LABEL = 'Auto';
const CELL_SELECTOR = ':scope > .bases-table-cell';
const DEFAULT_GROUP_GAP_IN_PIXELS = 10;
const MULTILINE_CLASS = 'mod-multiline';
const PRINT_SELECTOR = '.print';
const ROW_HEIGHT_KEY = 'rowHeight';
const ROW_HEIGHT_VARIABLE = '--bases-table-row-height';
const SIZE_TOLERANCE_IN_PIXELS = 0.5;
// Half a row past the wanted count keeps Math.floor on the right side of a whole number.
const FLOOR_MARGIN_IN_ROWS = 0.5;
const TABLE_VIEW_TYPE = 'table';

/**
 * A scroll position as fractions of the table container's height and width.
 */
interface TableViewScrollFraction {
  readonly left: number;
  readonly top: number;
}

/**
 * The scroll members of the table view, which `obsidian-typings` does not declare yet.
 */
interface TableViewScrollState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The plugin rewrites the view's own record of its last scroll.
  lastScroll: TableViewScrollFraction;
  readonly pendingScroll: null | TableViewScrollFraction;
}

/**
 * Adds `Auto` to the Row height of every Bases table view and lays such a table out by its content.
 *
 * The table view is virtualized: it gives every row an absolute `top` of `index × H`, sizes each group by
 * `rows × H` and renders only the rows inside the viewport, all from one fixed row height `H`. So the layout
 * here has two parts:
 *
 * 1. Every row is rendered. The view culls rows through a viewport helper that answers "everything" when the
 * container sits inside `.print`, so for the length of one `updateVirtualDisplay` call the container answers
 * `closest('.print')` with itself.
 * 2. Every row is laid out by its measured height: each row is sized to its content, read, then written back
 * as its own row height, and the rows, groups and container are restacked. The view's own row arithmetic
 * (scroll-into-view, hit-testing, the active-cell and selection overlays, PageUp and PageDown) is corrected
 * from those offsets.
 *
 * The fixed height of the Short option stays the minimum. A table with more rows than the setting allows
 * keeps the native layout. A base file that says `rowHeight: auto` still opens without the plugin: the view
 * reads any unknown value as Short.
 */
export class AutoRowHeightComponent extends Component {
  private readonly app: App;
  private readonly getSettings: () => AutoRowHeightSettings;
  private patchComponent: MonkeyAroundComponent | null = null;
  private readonly viewStates = new Map<BasesTableView, ViewState>();

  public constructor(params: AutoRowHeightComponentConstructorParams) {
    super();
    this.app = params.app;
    this.getSettings = params.getSettings;
  }

  public override onload(): void {
    this.addChild(
      new CorePluginToggleComponent({
        app: this.app,
        corePluginId: InternalPluginName.Bases,
        onDisable: (): void => {
          this.unpatch();
        },
        onEnable: (): void => {
          this.patch();
        },
        shouldCallOnDisableOnUnload: true
      })
    );
  }

  /**
   * Lays every open table out again, after a setting changed.
   */
  public refresh(): void {
    this.app.workspace.trigger('css-change');
  }

  private collectPageHeights(view: BasesTableView, state: ViewState, activeCell: BasesTableCellIndex, isDown: boolean): number[] {
    const heights: number[] = [];
    const { groupedData } = view.data;
    const step = isDown ? 1 : -1;
    for (let groupIndex = activeCell.groupIdx; groupIndex >= 0 && groupIndex < groupedData.length; groupIndex += step) {
      const group = groupedData[groupIndex];
      const tops = state.tops[groupIndex];
      if (!group || !tops || (groupIndex !== activeCell.groupIdx && view.isGroupCollapsed(group))) {
        continue;
      }
      const rowHeights = tops.slice(1).map((bottom, index) => bottom - ensureNonNullable(tops[index]));
      if (isDown) {
        heights.push(...rowHeights.slice(groupIndex === activeCell.groupIdx ? activeCell.row : 0));
      } else {
        heights.push(...rowHeights.slice(0, groupIndex === activeCell.groupIdx ? activeCell.row : rowHeights.length).reverse());
      }
    }
    return heights;
  }

  private detachView(view: BasesTableView): void {
    const state = this.viewStates.get(view);
    if (!state) {
      return;
    }
    this.viewStates.delete(view);
    state.resizeObserver.disconnect();
    if (state.frame) {
      view.containerEl.win.cancelAnimationFrame(state.frame);
    }
    view.scrollEl.removeEventListener('keydown', state.keydownHandler, { capture: true });
    view.containerEl.removeClass(AUTO_ROW_HEIGHT_CLASS);
    for (const row of [...view.rows, ...view.unusedRows]) {
      row.el.style.removeProperty(ROW_HEIGHT_VARIABLE);
    }
  }

  private getState(view: BasesTableView): ViewState {
    let state = this.viewStates.get(view);
    if (!state) {
      const keydownHandler = (event_: KeyboardEvent): void => {
        this.handleKeydown(view, event_);
      };
      view.scrollEl.addEventListener('keydown', keydownHandler, { capture: true });
      state = {
        frame: 0,
        keydownHandler,
        observedCells: new Set(),
        resizeObserver: new ResizeObserver((entries) => {
          this.handleCellResize(view, entries);
        }),
        tops: []
      };
      this.viewStates.set(view, state);
    }
    return state;
  }

  private handleCellResize(view: BasesTableView, entries: readonly ResizeObserverEntry[]): void {
    const state = this.viewStates.get(view);
    if (!state || state.frame) {
      return;
    }
    // A cell grows past its row when its content renders after the layout: markdown, an image, an embed.
    const isOverflowing = entries.some(({ target }) => {
      const tdEl = target.parentElement;
      return tdEl !== null && (target as HTMLElement).offsetHeight > tdEl.clientHeight + SIZE_TOLERANCE_IN_PIXELS;
    });
    if (!isOverflowing) {
      return;
    }
    state.frame = view.containerEl.win.requestAnimationFrame(() => {
      state.frame = 0;
      view.updateVirtualDisplay();
    });
  }

  private handleKeydown(view: BasesTableView, event_: KeyboardEvent): void {
    const isDown = event_.key === 'PageDown';
    if ((!isDown && event_.key !== 'PageUp') || event_.defaultPrevented || event_.isComposing || event_.metaKey || event_.ctrlKey) {
      return;
    }
    const state = this.viewStates.get(view);
    const { activeCell } = view;
    if (!state || !activeCell || isEditableTarget(event_.target)) {
      return;
    }
    const pageHeight = getVisibleHeight(view.containerEl);
    const baseHeight = view.getRowBaseHeight();
    if (pageHeight <= 0 || baseHeight <= 0) {
      return;
    }
    const rowCount = countRowsForPage({ heights: this.collectPageHeights(view, state, activeCell, isDown), pageHeight });

    // The view pages by `Math.floor(pageHeight / (baseHeight × getRowHeightMult()))` rows. Its keydown handler
    // Runs right after this one, and its first `getRowHeightMult` call is that one, so for that single call the
    // Multiplier is the one that makes the floor come out at `rowCount`.
    const multiplier = pageHeight / (baseHeight * (rowCount + FLOOR_MARGIN_IN_ROWS));
    const oneShotComponent = this.addChild(new MonkeyAroundComponent());
    oneShotComponent.registerMethodPatch({
      $object: view,
      methodName: 'getRowHeightMult',
      once: true,
      patchHandler: () => multiplier
    });
    view.containerEl.win.setTimeout(() => {
      this.removeChild(oneShotComponent);
    });
  }

  private isAutoView(view: BasesTableView): boolean {
    const config = castTo<BasesViewConfig | undefined>(view.config);
    const data = castTo<BasesTableView['data'] | undefined>(view.data);
    if (!config || !data || config.get(ROW_HEIGHT_KEY) !== AUTO_ROW_HEIGHT) {
      return false;
    }
    const rowCount = data.groupedData.reduce((sum, group) => sum + group.entries.length, 0);
    return rowCount <= this.getSettings().maxRows;
  }

  private layOut(view: BasesTableView, state: ViewState): number {
    const { containerEl } = view;
    const minRowHeight = view.getRowBaseHeight() * view.getRowHeightMult();
    const groupGap = Number.parseFloat(containerEl.getCssPropertyValue('--bases-table-group-gap')) || DEFAULT_GROUP_GAP_IN_PIXELS;
    const { groupedData } = view.data;
    const rowsByEntry = new Map(view.rows.map((row) => [row.entry, row]));
    const groupRows = groupedData.map((group) => view.isGroupCollapsed(group) ? [] : group.entries.map((entry) => rowsByEntry.get(entry)));

    // Write every row's auto height, then read every height, then write the layout, so the browser lays out once.
    for (const rows of groupRows) {
      for (const row of rows) {
        row?.el.setCssProps({ [ROW_HEIGHT_VARIABLE]: 'auto' });
      }
    }
    const measuredGroups = groupRows.map((rows) => rows.map((row) => ({ height: row ? measureRow(row, minRowHeight) : minRowHeight, row })));

    const tops = measuredGroups.map((measuredRows) => computeRowTops(measuredRows.map(({ height }) => height)));
    let containerHeight = 0;
    for (const [groupIndex, measuredRows] of measuredGroups.entries()) {
      // The view keeps one rendered group per entry of `data.groupedData`, in the same order.
      const group = ensureNonNullable(view.groups[groupIndex]);
      const groupTops = ensureNonNullable(tops[groupIndex]);
      for (const [rowIndex, { height, row }] of measuredRows.entries()) {
        row?.el.style.setProperty(ROW_HEIGHT_VARIABLE, `${String(height)}px`);
        row?.el.style.setProperty('top', `${String(ensureNonNullable(groupTops[rowIndex]))}px`);
      }
      const groupHeight = ensureNonNullable(groupTops.at(-1));
      group.tableEl.style.top = `${String(containerHeight)}px`;
      group.tbodyEl.style.height = `${String(groupHeight)}px`;
      containerHeight += group.selfHeight + groupHeight + (groupIndex < measuredGroups.length - 1 ? groupGap : 0);
    }
    state.tops = tops;
    containerEl.style.height = `${String(containerHeight)}px`;

    placeOverlays(view, tops);
    observeCells(view, state);
    return containerHeight;
  }

  private patch(): void {
    const basesPluginInstance = this.app.internalPlugins.getEnabledPluginById(InternalPluginName.Bases);
    if (!basesPluginInstance || !Object.hasOwn(basesPluginInstance.registrations, TABLE_VIEW_TYPE)) {
      return;
    }
    const registration: BasesTableViewRegistration = basesPluginInstance.registrations.table;
    const patchComponent = this.addChild(new MonkeyAroundComponent());
    this.patchComponent = patchComponent;

    if (registration.options) {
      patchComponent.registerFunctionPatch({
        $object: registration,
        functionName: 'options',
        patchHandler: (originalOptions) => (config: BasesViewConfig): BasesAllOptions[] => addAutoOption(ensureNonNullable(originalOptions)(config))
      });
    }

    // The table view class is not exported, so its prototype is taken from an instance. This one is never
    // Loaded: its constructor only builds detached elements.
    const sampleView = registration.factory(castTo<QueryController>({ app: this.app }), createDiv());
    const tableViewPrototype = castTo<BasesTableView>(Object.getPrototypeOf(sampleView));

    patchComponent.registerMethodPatch({
      $object: tableViewPrototype,
      methodName: 'updateVirtualDisplay',
      patchHandler: ({ fallback, originalThis }) => {
        this.updateVirtualDisplay(originalThis, fallback);
      }
    });
    patchComponent.registerMethodPatch({
      $object: tableViewPrototype,
      methodName: 'getCellRect',
      patchHandler: ({ fallback, originalArguments: [cellIndex], originalThis }): BasesTableRect => {
        const rect = fallback();
        const tops = this.viewStates.get(originalThis)?.tops[cellIndex.groupIdx];
        if (!tops) {
          return rect;
        }
        return adjustCellRect({
          fixedRowHeight: originalThis.getRowBaseHeight() * originalThis.getRowHeightMult(),
          rect,
          row: cellIndex.row,
          tops
        });
      }
    });
    patchComponent.registerMethodPatch({
      $object: tableViewPrototype,
      methodName: 'getClosestCellIndexWithinGroup',
      patchHandler: ({ fallback, originalArguments: [event_, groupIndex], originalThis }): BasesTableCellIndex => {
        const cellIndex = fallback();
        const tops = this.viewStates.get(originalThis)?.tops[groupIndex];
        const group = originalThis.groups[groupIndex];
        if (!tops || !group) {
          return cellIndex;
        }
        const { containerEl } = originalThis;
        const { offsetWidth } = containerEl;
        const scale = offsetWidth > 0 ? containerEl.getBoundingClientRect().width / offsetWidth : 1;
        const offset = (event_.clientY - group.tbodyEl.getBoundingClientRect().top) / scale;
        return { ...cellIndex, row: findRowAtOffset(tops, offset) };
      }
    });
    patchComponent.registerMethodPatch({
      $object: tableViewPrototype,
      methodName: 'onunload',
      patchHandler: ({ fallback, originalThis }) => {
        fallback();
        this.detachView(originalThis);
      }
    });

    this.refresh();
  }

  private unpatch(): void {
    if (!this.patchComponent) {
      return;
    }
    this.removeChild(this.patchComponent);
    this.patchComponent = null;
    // Deleting the entry being visited is safe while iterating a Map.
    for (const view of this.viewStates.keys()) {
      this.detachView(view);
    }
    this.refresh();
  }

  private updateVirtualDisplay(view: BasesTableView, fallback: () => void): void {
    if (!this.isAutoView(view)) {
      this.detachView(view);
      fallback();
      return;
    }

    const { containerEl, scrollEl } = view;
    // While the original runs, the container has its fixed-height size, and the layout the plugin forces then
    // Clamps the scroll offset to it, so the table jumped back on every update. The view also restores a pending
    // Scroll, and records the last one, as fractions of that height. The plugin puts the offset back once the
    // Laid-out height is in place, and redoes the vertical fractions against it.
    const scrollState = castTo<TableViewScrollState>(view);
    const { pendingScroll } = scrollState;
    const { scrollTop } = scrollEl;
    Object.defineProperty(containerEl, 'closest', {
      configurable: true,
      value: (selector: string): Element | null => selector === PRINT_SELECTOR ? containerEl : Element.prototype.closest.call(containerEl, selector)
    });
    try {
      fallback();
    } finally {
      Reflect.deleteProperty(containerEl, 'closest');
    }

    if (!containerEl.isShown()) {
      return;
    }
    containerEl.addClass(AUTO_ROW_HEIGHT_CLASS, MULTILINE_CLASS);
    const containerHeight = this.layOut(view, this.getState(view));
    if (containerHeight <= 0) {
      return;
    }
    if (pendingScroll) {
      scrollEl.scrollTop = containerHeight * pendingScroll.top;
      return;
    }
    if (scrollEl.scrollTop !== scrollTop) {
      scrollEl.scrollTop = scrollTop;
    }
    scrollState.lastScroll = { ...scrollState.lastScroll, top: scrollTop / containerHeight };
  }
}

function addAutoOption(options: BasesAllOptions[]): BasesAllOptions[] {
  return options.map((option) => {
    return option.type !== 'dropdown' || option.key !== ROW_HEIGHT_KEY || Object.hasOwn(option.options, AUTO_ROW_HEIGHT) ? option : { ...option, options: { ...option.options, [AUTO_ROW_HEIGHT]: AUTO_ROW_HEIGHT_LABEL } };
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function measureRow(row: BasesTableRow, minRowHeight: number): number {
  let height = 0;
  for (const cellEl of row.el.children) {
    height = Math.max(height, (cellEl as HTMLElement).offsetHeight);
  }
  return Math.max(minRowHeight, Math.ceil(height));
}

function observeCells(view: BasesTableView, state: ViewState): void {
  for (const cellEl of state.observedCells) {
    if (cellEl.isConnected) {
      continue;
    }

    state.resizeObserver.unobserve(cellEl);
    state.observedCells.delete(cellEl);
  }
  for (const row of view.rows) {
    for (const cell of row.cells) {
      const cellEl = cell.el.querySelector<HTMLElement>(CELL_SELECTOR);
      if (!cellEl || state.observedCells.has(cellEl)) {
        continue;
      }

      state.observedCells.add(cellEl);
      state.resizeObserver.observe(cellEl);
    }
  }
}

function placeActiveCell(view: BasesTableView, tops: readonly GroupRowTops[]): void {
  const { activeCell, activeCellEl } = view;
  const groupTops = activeCell ? tops[activeCell.groupIdx] : undefined;
  if (!activeCell || !groupTops || !activeCellEl.isConnected) {
    return;
  }
  const top = ensureNonNullable(groupTops[activeCell.row]);
  const bottom = ensureNonNullable(groupTops[activeCell.row + 1]);
  // The view insets the overlay by one pixel inside the row's bottom border, and by one more in the first row.
  const firstRowInset = activeCell.row === 0 ? 1 : 0;
  activeCellEl.setCssStyles({
    height: `${String(bottom - top - 1 - firstRowInset)}px`,
    insetBlockStart: `${String(top + firstRowInset)}px`
  });
}

function placeOverlays(view: BasesTableView, tops: readonly GroupRowTops[]): void {
  placeActiveCell(view, tops);
  placeSelection(view, tops);
}

function placeSelection(view: BasesTableView, tops: readonly GroupRowTops[]): void {
  const { selection, selectionEl } = view;
  const groupTops = selection ? tops[selection.groupIdx] : undefined;
  if (!selection || !groupTops || !selectionEl.isConnected) {
    return;
  }
  const top = ensureNonNullable(groupTops[selection.top]);
  const bottom = ensureNonNullable(groupTops[selection.bottom + 1]);
  selectionEl.setCssStyles({
    height: `${String(bottom - top)}px`,
    insetBlockStart: `${String(top)}px`
  });
}
