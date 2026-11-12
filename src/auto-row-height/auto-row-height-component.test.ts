/* eslint-disable unicorn/name-replacements -- The fake table view mirrors the real one's field names, such as `groupIdx`. */
import type {
  BasesPluginInstance,
  BasesTableCellIndex,
  BasesTableRect,
  BasesTableSelection
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App as AppOriginal,
  BasesAllOptions,
  BasesViewConfig
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Events } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AutoRowHeightSettings } from './auto-row-height-component.ts';

import {
  AUTO_ROW_HEIGHT_CLASS,
  AutoRowHeightComponent
} from './auto-row-height-component.ts';

const BASE_ROW_HEIGHT = 30;
const NATIVE_RENDERED_ROWS = 2;

interface FakeBasesCorePlugin {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests turn Bases off and on.
  enabled: boolean;
}

interface FakeBasesPluginInstance {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- A test empties the registrations.
  registrations: Record<string, unknown>;
}

interface FakeCell {
  readonly el: HTMLElement;
}

interface FakeCellPosition {
  readonly groupIdx: number;
  readonly row: number;
}

interface FakeConfig {
  readonly get: (key: string) => unknown;
}

interface FakeData {
  readonly groupedData: FakeGroup[];
}

interface FakeEntry {
  readonly height: number;
  readonly name: string;
  readonly unrendered?: boolean;
}

interface FakeGroup {
  readonly collapsed?: boolean;
  readonly entries: FakeEntry[];
}

interface FakeRegistration {
  readonly factory: (controller: unknown, containerEl: HTMLElement) => FakeTableView;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests replace and remove the options.
  options?: (config: BasesViewConfig) => BasesAllOptions[];
}

interface FakeRow {
  readonly cells: FakeCell[];
  readonly el: HTMLElement;
  readonly entry: FakeEntry;
}

interface FakeScroll {
  readonly left: number;
  readonly top: number;
}

interface FakeTableGroup {
  readonly selfHeight: number;
  readonly tableEl: HTMLElement;
  readonly tbodyEl: HTMLElement;
}

interface Fixture {
  readonly app: AppOriginal;
  readonly basesCorePlugin: FakeBasesCorePlugin;
  readonly basesPluginInstance: BasesPluginInstance;
  readonly component: AutoRowHeightComponent;
  readonly internalPluginEvents: Events;
  readonly registration: FakeRegistration;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests change the row cap.
  settings: AutoRowHeightSettings;
}

class FakeResizeObserver {
  public static instances: FakeResizeObserver[] = [];
  public readonly observed = new Set<Element>();

  public constructor(public readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  public disconnect(): void {
    this.observed.clear();
  }

  public fire(targets: Element[]): void {
    this.callback(targets.map((target) => castTo<ResizeObserverEntry>({ target })), castTo<ResizeObserver>(this));
  }

  public observe(target: Element): void {
    this.observed.add(target);
  }

  public unobserve(target: Element): void {
    this.observed.delete(target);
  }
}

function makeEntries(...heights: number[]): FakeEntry[] {
  return heights.map((height, index) => ({ height, name: `Note ${String(index)}` }));
}

let fixture: Fixture;

// A stand-in for the table view: it renders rows the way the real one does, from one fixed height, and only
// The rows inside its viewport unless its container answers `closest('.print')`.
class FakeTableView {
  public activeCell: BasesTableCellIndex | null = null;
  public readonly activeCellEl = createDiv('bases-table-active-cell');
  public config: FakeConfig | undefined;
  public readonly containerEl: HTMLElement;
  public data: FakeData | undefined;
  public groups: FakeTableGroup[] = [];
  public isInDocument = false;
  public lastScroll: FakeScroll = { left: 0, top: 0 };
  public minHeightDuringUpdate = '';
  public pendingScroll: FakeScroll | null = null;
  public rows: FakeRow[] = [];
  public readonly scrollEl: HTMLElement;
  public selection: BasesTableSelection | null = null;
  public readonly selectionEl = createDiv('bases-table-selection');
  public shown = true;
  public unusedRows: FakeRow[] = [];
  public updateCount = 0;

  public constructor(_controller: unknown, scrollEl: HTMLElement) {
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv('bases-table-container');
  }

  public getCellRect(index: FakeCellPosition): BasesTableRect {
    const height = BASE_ROW_HEIGHT * this.getRowHeightMult();
    return { bottom: (index.row + 1) * height, left: 0, right: 100, top: index.row * height };
  }

  public getClosestCellIndexWithinGroup(event_: MouseEvent, groupIndex: number): BasesTableCellIndex {
    return { column: 0, groupIdx: groupIndex, row: Math.floor(event_.clientY / BASE_ROW_HEIGHT) };
  }

  public getRowBaseHeight(): number {
    return BASE_ROW_HEIGHT;
  }

  public getRowHeightMult(): number {
    return this.config?.get('rowHeight') === 'medium' ? 2 : 1;
  }

  public isGroupCollapsed(group: FakeGroup): boolean {
    return group.collapsed === true;
  }

  public onunload(): void {
    this.updateCount = -1;
  }

  public updateVirtualDisplay(): void {
    if (!this.data || !this.config) {
      return;
    }
    this.updateCount++;
    this.minHeightDuringUpdate = this.containerEl.style.minHeight;
    const isPrint = this.containerEl.closest('.print') !== null;
    this.isInDocument = this.containerEl.closest('body') !== null;
    const height = BASE_ROW_HEIGHT * this.getRowHeightMult();
    this.containerEl.empty();
    this.containerEl.toggleClass('mod-multiline', this.getRowHeightMult() > 1);
    const previousRows = [...this.rows, ...this.unusedRows];
    this.rows = [];
    this.groups = this.data.groupedData.map((group) => {
      const tableEl = this.containerEl.createDiv('bases-table');
      const tbodyEl = tableEl.createDiv('bases-tbody');
      const entries = group.collapsed ? [] : group.entries;
      const visible = (isPrint ? entries : entries.slice(0, NATIVE_RENDERED_ROWS)).filter((entry) => !entry.unrendered);
      for (const [index, entry] of visible.entries()) {
        const row = previousRows.find((candidate) => candidate.entry === entry) ?? createRow(entry);
        row.el.style.top = `${String(index * height)}px`;
        tbodyEl.append(row.el);
        this.rows.push(row);
      }
      tbodyEl.style.height = `${String(entries.length * height)}px`;
      if (this.activeCell) {
        tbodyEl.append(this.activeCellEl);
      }
      if (this.selection) {
        tbodyEl.append(this.selectionEl);
      }
      return { selfHeight: 20, tableEl, tbodyEl };
    });
    this.unusedRows = previousRows.filter((row) => !this.rows.includes(row));
    this.containerEl.setCssStyles({ height: 'native' });
    // The native restore works in fractions of its own fixed-height container, and the browser clamps the
    // Offset to that height.
    const nativeHeight = this.data.groupedData.reduce((sum, group) => sum + group.entries.length * height, 0);
    this.scrollEl.scrollTop = Math.min(this.scrollEl.scrollTop, nativeHeight);
    if (this.pendingScroll) {
      this.scrollEl.scrollTop = Math.min(nativeHeight * this.pendingScroll.top, nativeHeight);
      this.lastScroll = this.pendingScroll;
      this.pendingScroll = null;
    } else {
      this.lastScroll = { left: this.lastScroll.left, top: nativeHeight > 0 ? this.scrollEl.scrollTop / nativeHeight : 0 };
    }
  }
}

function createRow(entry: FakeEntry): FakeRow {
  const el = createDiv('bases-tr');
  const cells = [0, 1].map(() => {
    const tdEl = el.createDiv('bases-td');
    const cellEl = tdEl.createDiv('bases-table-cell');
    Object.defineProperties(tdEl, {
      clientHeight: { configurable: true, get: () => Number.parseFloat(el.style.getPropertyValue('--bases-table-row-height')) || 0 },
      offsetHeight: { configurable: true, get: () => el.style.getPropertyValue('--bases-table-row-height') === 'auto' ? entry.height : 0 }
    });
    Object.defineProperty(cellEl, 'offsetHeight', { configurable: true, get: () => Number(cellEl.dataset['height'] ?? entry.height) });
    return { el: tdEl };
  });
  return { cells, el, entry };
}

function createView(groupedData: FakeGroup[], rowHeight = 'auto'): FakeTableView {
  const view = fixture.registration.factory(null, document.body.createDiv());
  view.config = { get: (key: string): unknown => key === 'rowHeight' ? rowHeight : undefined };
  view.data = { groupedData };
  Object.defineProperty(view.containerEl, 'isShown', { configurable: true, value: () => view.shown });
  return view;
}

function rowLayout(view: FakeTableView): string[] {
  return view.rows.map((row) => `${row.entry.name}@${row.el.style.top}:${row.el.style.getPropertyValue('--bases-table-row-height')}`);
}

function setUp(): void {
  const app = App.createConfigured__().asOriginalType__();
  const internalPluginEvents = new Events();
  const basesCorePlugin = { enabled: true };
  const registration: FakeRegistration = {
    factory: (controller, containerEl) => new FakeTableView(controller, containerEl),
    options: () => [
      { displayName: 'Row height', key: 'rowHeight', options: { '': 'Short', 'medium': 'Medium' }, type: 'dropdown' },
      { displayName: 'Other', key: 'other', type: 'toggle' }
    ]
  };
  const basesPluginInstance = castTo<BasesPluginInstance>({ registrations: { table: registration } });
  Object.assign(app, {
    internalPlugins: {
      getEnabledPluginById: (id: string) => id === 'bases' && basesCorePlugin.enabled ? basesPluginInstance : null,
      getPluginById: () => basesCorePlugin,
      off: internalPluginEvents.off.bind(internalPluginEvents),
      offref: internalPluginEvents.offref.bind(internalPluginEvents),
      on: internalPluginEvents.on.bind(internalPluginEvents)
    }
  });
  const settings = { maxRows: 500 };
  fixture = {
    app,
    basesCorePlugin,
    basesPluginInstance,
    component: new AutoRowHeightComponent({ app, getSettings: (): AutoRowHeightSettings => fixture.settings }),
    internalPluginEvents,
    registration,
    settings
  };
}

describe('AutoRowHeightComponent', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    setUp();
  });

  afterEach(() => {
    fixture.component.unload();
    document.body.empty();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adds Auto to the Row height dropdown, once, and leaves the other options alone', () => {
    const original = fixture.registration.options;
    fixture.component.load();
    const config = castTo<BasesViewConfig>({});
    const options = fixture.registration.options?.(config) ?? [];
    expect(options[0]).toMatchObject({ key: 'rowHeight', options: { '': 'Short', 'auto': 'Auto', 'medium': 'Medium' } });
    expect(options[1]).toStrictEqual({ displayName: 'Other', key: 'other', type: 'toggle' });

    const withAuto = { displayName: 'Row height', key: 'rowHeight', options: { auto: 'Mine' }, type: 'dropdown' } as const;
    fixture.component.unload();
    expect(fixture.registration.options).toBe(original);
    fixture.registration.options = (): BasesAllOptions[] => [withAuto];
    fixture.component.load();
    expect(fixture.registration.options(config)).toStrictEqual([withAuto]);
  });

  it('leaves a table registration with no options without options', () => {
    delete fixture.registration.options;
    fixture.component.load();
    expect(fixture.registration.options).toBeUndefined();
  });

  it('renders every row of an Auto table and stacks them by their measured heights', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(10, 70, 45) }, { entries: makeEntries(100) }]);
    view.updateVirtualDisplay();

    expect(view.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(true);
    expect(view.containerEl.hasClass('mod-multiline')).toBe(true);
    // The Short height stays the minimum, so the 10px row keeps 30px.
    expect(rowLayout(view)).toStrictEqual(['Note 0@0px:30px', 'Note 1@30px:70px', 'Note 2@100px:45px', 'Note 0@0px:100px']);
    expect(view.groups.map((group) => [group.tableEl.style.top, group.tbodyEl.style.height])).toStrictEqual([['0px', '145px'], ['175px', '100px']]);
    // 20 + 145 for the first group, the 10px gap, then 20 + 100.
    expect(view.containerEl.style.height).toBe('295px');
    // The `closest` answer is the view's for one call only.
    expect(Object.hasOwn(view.containerEl, 'closest')).toBe(false);
  });

  it('gives a row the view did not render the minimum height', () => {
    fixture.component.load();
    const view = createView([{ entries: [{ height: 80, name: 'Hidden', unrendered: true }, { height: 50, name: 'Shown' }] }]);
    view.updateVirtualDisplay();
    expect(view.isInDocument).toBe(true);
    expect(rowLayout(view)).toStrictEqual(['Shown@30px:50px']);
  });

  it('reads the group gap from the theme', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40) }, { entries: makeEntries(40) }]);
    vi.spyOn(view.containerEl, 'getCssPropertyValue').mockReturnValue('4');
    view.updateVirtualDisplay();
    expect(view.groups[1]?.tableEl.style.top).toBe('64px');
  });

  it('keeps a collapsed group empty', () => {
    fixture.component.load();
    const view = createView([{ collapsed: true, entries: makeEntries(40, 40) }, { entries: makeEntries(50) }]);
    view.updateVirtualDisplay();
    expect(view.groups.map((group) => group.tbodyEl.style.height)).toStrictEqual(['0px', '50px']);
    expect(rowLayout(view)).toStrictEqual(['Note 0@0px:50px']);
  });

  it('places the active cell and the selection over their rows', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 60, 50) }]);
    view.activeCell = { column: 0, groupIdx: 0, row: 1 };
    view.selection = { bottom: 2, end: 1, groupIdx: 0, start: 0, top: 1 };
    view.updateVirtualDisplay();
    expect([view.activeCellEl.style.insetBlockStart, view.activeCellEl.style.height]).toStrictEqual(['40px', '59px']);
    expect([view.selectionEl.style.insetBlockStart, view.selectionEl.style.height]).toStrictEqual(['40px', '110px']);

    view.activeCell = { column: 0, groupIdx: 0, row: 0 };
    view.selection = null;
    view.updateVirtualDisplay();
    expect([view.activeCellEl.style.insetBlockStart, view.activeCellEl.style.height]).toStrictEqual(['1px', '38px']);
  });

  it('leaves the overlays alone when their group has no layout or they are not shown', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40) }]);
    view.activeCell = { column: 0, groupIdx: 3, row: 0 };
    view.selection = { bottom: 0, end: 0, groupIdx: 3, start: 0, top: 0 };
    view.updateVirtualDisplay();
    expect(view.activeCellEl.style.height).toBe('');
    expect(view.selectionEl.style.height).toBe('');
  });

  it('keeps the native layout for other row heights, for a table over the row cap, and before the view has data', () => {
    fixture.component.load();
    const short = createView([{ entries: makeEntries(40, 40, 40) }], '');
    short.updateVirtualDisplay();
    expect(short.rows).toHaveLength(NATIVE_RENDERED_ROWS);
    expect(short.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(false);

    fixture.settings = { maxRows: 2 };
    const capped = createView([{ entries: makeEntries(40, 40, 40) }]);
    capped.updateVirtualDisplay();
    expect(capped.rows).toHaveLength(NATIVE_RENDERED_ROWS);

    const empty = createView([]);
    empty.data = undefined;
    empty.updateVirtualDisplay();
    expect(empty.updateCount).toBe(0);
  });

  it('records and restores the scroll against the laid-out height, not the fixed-height one', () => {
    fixture.component.load();
    // Three 100px rows: 300px laid out, 90px natively.
    const view = createView([{ entries: makeEntries(100, 100, 100) }]);
    view.updateVirtualDisplay();
    expect(view.containerEl.style.height).toBe('320px');

    view.scrollEl.scrollTop = 160;
    view.updateVirtualDisplay();
    expect(view.lastScroll).toStrictEqual({ left: 0, top: 0.5 });

    // A data update: the view restores its last scroll, which natively clamps to 90px.
    view.pendingScroll = view.lastScroll;
    view.updateVirtualDisplay();
    expect(view.scrollEl.scrollTop).toBe(160);
    expect(view.lastScroll).toStrictEqual({ left: 0, top: 0.5 });
    expect(view.pendingScroll).toBeNull();
  });

  it('keeps the container at its laid-out height while the view redraws, so no scroller above it is clamped', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(100, 100, 100) }]);
    view.updateVirtualDisplay();
    // The first layout has no earlier height to keep.
    expect(view.minHeightDuringUpdate).toBe('');
    expect(view.containerEl.style.minHeight).toBe('');

    view.updateVirtualDisplay();
    expect(view.minHeightDuringUpdate).toBe('320px');
    expect(view.containerEl.style.minHeight).toBe('');

    // The minimum goes even when the table is not shown and no layout follows.
    view.shown = false;
    view.updateVirtualDisplay();
    expect(view.minHeightDuringUpdate).toBe('320px');
    expect(view.containerEl.style.minHeight).toBe('');
  });

  it('leaves the scroll of an empty Auto table to the view', () => {
    fixture.component.load();
    const view = createView([]);
    view.pendingScroll = { left: 0, top: 0.5 };
    view.updateVirtualDisplay();
    expect(view.scrollEl.scrollTop).toBe(0);
    expect(view.lastScroll).toStrictEqual({ left: 0, top: 0.5 });
  });

  it('skips the layout of a table that is not shown', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 40, 40) }]);
    view.shown = false;
    view.updateVirtualDisplay();
    expect(view.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(false);
  });

  it('drops the per-row heights when a table leaves Auto', () => {
    fixture.component.load();
    let rowHeight = 'auto';
    const view = createView([{ entries: makeEntries(40, 70, 50) }]);
    view.config = { get: (): unknown => rowHeight };
    view.updateVirtualDisplay();
    rowHeight = 'medium';
    view.updateVirtualDisplay();
    expect(view.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(false);
    expect([...view.rows, ...view.unusedRows].map((row) => row.el.style.getPropertyValue('--bases-table-row-height'))).toStrictEqual(['', '', '']);
    expect(view.getCellRect({ groupIdx: 0, row: 1 })).toStrictEqual({ bottom: 120, left: 0, right: 100, top: 60 });
  });

  it('corrects scroll-into-view and hit-testing from the laid-out rows', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 100, 50) }]);
    view.updateVirtualDisplay();
    expect(view.getCellRect({ groupIdx: 0, row: 1 })).toStrictEqual({ bottom: 140, left: 0, right: 100, top: 40 });

    const tbodyEl = view.groups[0]?.tbodyEl;
    if (!tbodyEl) {
      throw new Error('No group.');
    }
    vi.spyOn(tbodyEl, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 190, width: 100, x: 0, y: 10 }));
    vi.spyOn(view.containerEl, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 190, width: 100, x: 0, y: 0 }));
    Object.defineProperty(view.containerEl, 'offsetWidth', { configurable: true, value: 100 });
    const hit = view.getClosestCellIndexWithinGroup(new MouseEvent('pointermove', { clientY: 160 }), 0);
    expect(hit).toStrictEqual({ column: 0, groupIdx: 0, row: 2 });

    // Without a measurable container the scale falls back to 1, and an unknown group keeps the native answer.
    Object.defineProperty(view.containerEl, 'offsetWidth', { configurable: true, value: 0 });
    expect(view.getClosestCellIndexWithinGroup(new MouseEvent('pointermove', { clientY: 60 }), 0).row).toBe(1);
    expect(view.getClosestCellIndexWithinGroup(new MouseEvent('pointermove', { clientY: 60 }), 5)).toStrictEqual({ column: 0, groupIdx: 5, row: 2 });
    expect(view.getCellRect({ groupIdx: 5, row: 1 })).toStrictEqual({ bottom: 60, left: 0, right: 100, top: 30 });
  });

  it('lays the table out again when a cell\'s content outgrows its row, once per frame', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 40) }]);
    view.updateVirtualDisplay();
    const observer = FakeResizeObserver.instances[0];
    const cellEl = view.rows[1]?.cells[0]?.el.querySelector<HTMLElement>('.bases-table-cell');
    if (!observer || !cellEl) {
      throw new Error('No observer or cell.');
    }
    expect(observer.observed.has(cellEl)).toBe(true);

    const updateCount = view.updateCount;
    observer.fire([cellEl]);
    expect(view.updateCount).toBe(updateCount);

    cellEl.dataset['height'] = '120';
    observer.fire([cellEl]);
    expect(view.updateCount).toBe(updateCount + 1);

    const detachedEl = createDiv();
    observer.fire([detachedEl]);
    expect(view.updateCount).toBe(updateCount + 1);
  });

  it('waits for the frame it already asked for', () => {
    vi.mocked(window.requestAnimationFrame).mockImplementation(() => 7);
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40) }]);
    view.updateVirtualDisplay();
    const observer = FakeResizeObserver.instances[0];
    const cellEl = view.rows[0]?.cells[0]?.el.querySelector<HTMLElement>('.bases-table-cell');
    if (!observer || !cellEl) {
      throw new Error('No observer or cell.');
    }
    cellEl.dataset['height'] = '90';
    observer.fire([cellEl]);
    observer.fire([cellEl]);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    fixture.component.unload();
    expect(cancelSpy).toHaveBeenCalledWith(7);
  });

  it('ignores a resize reported after the view left Auto', () => {
    fixture.component.load();
    let rowHeight = 'auto';
    const view = createView([{ entries: makeEntries(40) }]);
    view.config = { get: (): unknown => rowHeight };
    view.updateVirtualDisplay();
    const observer = FakeResizeObserver.instances[0];
    rowHeight = '';
    view.updateVirtualDisplay();
    const updateCount = view.updateCount;
    observer?.callback([], castTo<ResizeObserver>(observer));
    expect(view.updateCount).toBe(updateCount);
  });

  it('stops observing cells that are gone', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 40) }]);
    view.updateVirtualDisplay();
    const observer = FakeResizeObserver.instances[0];
    const firstCellEl = view.rows[0]?.cells[0]?.el.querySelector<HTMLElement>('.bases-table-cell');
    if (!observer || !firstCellEl) {
      throw new Error('No observer or cell.');
    }
    firstCellEl.remove();
    view.updateVirtualDisplay();
    expect(observer.observed.has(firstCellEl)).toBe(false);
  });

  it('pages by the real row heights', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(100, 100, 100, 100, 100) }, { entries: makeEntries(100, 100) }]);
    view.updateVirtualDisplay();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(250);
    view.activeCell = { column: 0, groupIdx: 0, row: 3 };

    expect(pressPageKey(view, 'PageDown')).toBe(2);
    expect(pressPageKey(view, 'PageUp')).toBe(2);
    // The answer is for that one call: the next one is the view's own again.
    expect(view.getRowHeightMult()).toBe(1);
  });

  it('pages across groups, skipping collapsed ones', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(100) }, { collapsed: true, entries: makeEntries(100) }, { entries: makeEntries(100, 100) }]);
    view.updateVirtualDisplay();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(350);
    view.activeCell = { column: 0, groupIdx: 0, row: 0 };
    expect(pressPageKey(view, 'PageDown')).toBe(3);
    view.activeCell = { column: 0, groupIdx: 2, row: 1 };
    expect(pressPageKey(view, 'PageUp')).toBe(2);
  });

  it('leaves other keys, modified keys, edits and an empty page to the view', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(100, 100) }]);
    view.updateVirtualDisplay();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(250);
    view.activeCell = { column: 0, groupIdx: 0, row: 0 };
    const keys: [string, KeyboardEventInit, EventTarget?][] = [
      ['ArrowDown', {}],
      ['PageDown', { ctrlKey: true }],
      ['PageDown', { metaKey: true }],
      ['PageDown', {}, view.scrollEl.createEl('input')],
      ['PageDown', {}, view.scrollEl.createEl('textarea')],
      ['PageDown', {}, view.scrollEl.createEl('select')]
    ];
    for (const [key, init, target] of keys) {
      dispatchKey(view, key, init, target);
      expect(view.getRowHeightMult()).toBe(1);
    }

    const editableEl = view.scrollEl.createDiv();
    Object.defineProperty(editableEl, 'isContentEditable', { value: true });
    dispatchKey(view, 'PageDown', {}, editableEl);
    expect(view.getRowHeightMult()).toBe(1);

    const prevented = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'PageDown' });
    prevented.preventDefault();
    view.containerEl.dispatchEvent(prevented);
    expect(view.getRowHeightMult()).toBe(1);

    view.activeCell = null;
    dispatchKey(view, 'PageDown', {});
    expect(view.getRowHeightMult()).toBe(1);

    view.activeCell = { column: 0, groupIdx: 0, row: 0 };
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(0);
    dispatchKey(view, 'PageDown', {});
    expect(view.getRowHeightMult()).toBe(1);
  });

  it('pages natively in a table that is not on Auto', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(100, 100) }], '');
    view.updateVirtualDisplay();
    view.activeCell = { column: 0, groupIdx: 0, row: 0 };
    dispatchKey(view, 'PageDown', {});
    expect(view.getRowHeightMult()).toBe(1);
  });

  it('forgets a view when it unloads', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 70) }]);
    view.updateVirtualDisplay();
    const observer = FakeResizeObserver.instances[0];
    view.onunload();
    expect(view.updateCount).toBe(-1);
    expect(observer?.observed.size).toBe(0);
    expect(view.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(false);
  });

  it('lays the open tables out again when it loads, refreshes or unloads', () => {
    const triggerSpy = vi.spyOn(fixture.app.workspace, 'trigger');
    fixture.component.load();
    expect(triggerSpy).toHaveBeenCalledWith('css-change');
    triggerSpy.mockClear();
    fixture.component.refresh();
    expect(triggerSpy).toHaveBeenCalledWith('css-change');

    const view = createView([{ entries: makeEntries(40, 70, 50) }]);
    view.updateVirtualDisplay();
    triggerSpy.mockClear();
    fixture.component.unload();
    expect(triggerSpy).toHaveBeenCalledWith('css-change');
    expect(view.containerEl.hasClass(AUTO_ROW_HEIGHT_CLASS)).toBe(false);
    view.updateVirtualDisplay();
    expect(view.rows).toHaveLength(NATIVE_RENDERED_ROWS);
  });

  it('follows Bases being turned off and on', () => {
    fixture.component.load();
    const view = createView([{ entries: makeEntries(40, 40, 40) }]);
    fixture.basesCorePlugin.enabled = false;
    fixture.internalPluginEvents.trigger('change');
    view.updateVirtualDisplay();
    expect(view.rows).toHaveLength(NATIVE_RENDERED_ROWS);

    fixture.basesCorePlugin.enabled = true;
    fixture.internalPluginEvents.trigger('change');
    view.updateVirtualDisplay();
    expect(view.rows).toHaveLength(3);
  });

  it('does nothing when Bases has no table view', () => {
    castTo<FakeBasesPluginInstance>(fixture.basesPluginInstance).registrations = {};
    const triggerSpy = vi.spyOn(fixture.app.workspace, 'trigger');
    fixture.component.load();
    expect(triggerSpy).not.toHaveBeenCalled();
    fixture.component.unload();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('does nothing when Bases is off at load', () => {
    fixture.basesCorePlugin.enabled = false;
    const triggerSpy = vi.spyOn(fixture.app.workspace, 'trigger');
    fixture.component.load();
    fixture.basesCorePlugin.enabled = true;
    vi.spyOn(fixture.app.internalPlugins, 'getEnabledPluginById').mockReturnValue(null);
    fixture.internalPluginEvents.trigger('change');
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});

function dispatchKey(view: FakeTableView, key: string, init: KeyboardEventInit, target: EventTarget = view.containerEl): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init }));
}

// The view's own PageDown arithmetic, run right after the plugin's keydown listener, as the view's listener is.
function pressPageKey(view: FakeTableView, key: string): number {
  const pageHeight = window.innerHeight;
  let rows = 0;
  view.containerEl.addEventListener('keydown', () => {
    rows = Math.floor(pageHeight / (view.getRowBaseHeight() * view.getRowHeightMult()));
  }, { once: true });
  dispatchKey(view, key, {});
  return rows;
}
/* eslint-enable unicorn/name-replacements -- The fake table view ends here. */
