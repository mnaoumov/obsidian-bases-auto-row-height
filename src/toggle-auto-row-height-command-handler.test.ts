import type {
  App,
  Command
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import { ToggleAutoRowHeightCommandHandler } from './toggle-auto-row-height-command-handler.ts';

interface FakeApp {
  readonly app: App;
  readonly setActive: (view: unknown) => void;
}

interface FakeController {
  readonly sourcePath: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- A test swaps the active view.
  view: unknown;
}

interface FakeLeafView {
  readonly controller: FakeController;
  readonly getViewType: () => string;
}

interface FakeTable {
  readonly data: Record<string, unknown>;
  readonly host: FakeLeafView;
}

interface FakeTableParams {
  readonly name?: string;
  readonly rowHeight?: string;
  readonly sourcePath?: string;
  readonly type?: string;
}

function createApp(): FakeApp {
  let active: unknown = null;
  const app = castTo<App>({
    workspace: {
      getMostRecentLeaf: (): unknown => active === null ? null : { view: active }
    }
  });
  return {
    app,
    setActive: (view: unknown): void => {
      active = view;
    }
  };
}

function createTable({ name = 'Table', rowHeight, sourcePath = 'Projects.base', type = 'table' }: FakeTableParams): FakeTable {
  const data: Record<string, unknown> = rowHeight === undefined ? {} : { rowHeight };
  const view = {
    config: {
      get: (key: string): unknown => data[key],
      name,
      set: (key: string, value: unknown): void => {
        if (value === null) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- The fake config mirrors Obsidian's, which deletes the key.
          delete data[key];
        } else {
          data[key] = value;
        }
      }
    },
    type
  };
  return {
    data,
    host: {
      controller: { sourcePath, view },
      getViewType: (): string => 'bases'
    }
  };
}

function getCommand(app: App): Command {
  return new ToggleAutoRowHeightCommandHandler({ app }).buildCommand();
}

function run(command: Command): void {
  expect(ensureNonNullable(command.checkCallback)(false)).not.toBe(false);
}

describe('ToggleAutoRowHeightCommandHandler', () => {
  it('is named and identified for the command palette', () => {
    const command = getCommand(createApp().app);
    expect(command.id).toBe('toggle-auto-row-height');
    expect(command.name).toBe('Toggle Auto row height');
  });

  it('is unavailable without a leaf, outside a base, and on a view that is not a table', () => {
    const { app, setActive } = createApp();
    const command = getCommand(app);
    const check = ensureNonNullable(command.checkCallback);
    expect(check(true)).toBe(false);

    setActive({ getViewType: (): string => 'markdown' });
    expect(check(true)).toBe(false);

    const cards = createTable({ type: 'cards' });
    setActive(cards.host);
    expect(check(true)).toBe(false);

    const empty = createTable({});
    empty.host.controller.view = null;
    setActive(empty.host);
    expect(check(true)).toBe(false);

    setActive(createTable({}).host);
    expect(check(true)).toBe(true);
  });

  it('switches Short to Auto and back to Short, removing the key', () => {
    const { app, setActive } = createApp();
    const command = getCommand(app);
    const table = createTable({});
    setActive(table.host);

    run(command);
    expect(table.data).toStrictEqual({ rowHeight: 'auto' });
    run(command);
    expect(table.data).toStrictEqual({});
  });

  it('goes back to the height the view had before Auto', () => {
    const { app, setActive } = createApp();
    const command = getCommand(app);
    const table = createTable({ rowHeight: 'tall' });
    setActive(table.host);

    run(command);
    expect(table.data).toStrictEqual({ rowHeight: 'auto' });
    run(command);
    expect(table.data).toStrictEqual({ rowHeight: 'tall' });
  });

  it('remembers the height across rebuilt views of the same base and view, and keeps views apart', () => {
    const { app, setActive } = createApp();
    const command = getCommand(app);
    const first = createTable({ rowHeight: 'medium' });
    setActive(first.host);
    run(command);

    const other = createTable({ name: 'Other', rowHeight: 'extra' });
    setActive(other.host);
    run(command);

    // A save rebuilds the view objects; the same base file and view name still find the remembered height.
    const rebuilt = createTable({ rowHeight: 'auto' });
    setActive(rebuilt.host);
    run(command);
    expect(rebuilt.data).toStrictEqual({ rowHeight: 'medium' });

    setActive(other.host);
    run(command);
    expect(other.data).toStrictEqual({ rowHeight: 'extra' });
  });

  it('falls back to Short when a view was already Auto, and stores an empty height as Short', () => {
    const { app, setActive } = createApp();
    const command = getCommand(app);
    const table = createTable({ rowHeight: 'auto' });
    setActive(table.host);
    run(command);
    expect(table.data).toStrictEqual({});

    const blank = createTable({ rowHeight: '', sourcePath: 'Blank.base' });
    setActive(blank.host);
    run(command);
    run(command);
    expect(blank.data).toStrictEqual({});
  });
});
