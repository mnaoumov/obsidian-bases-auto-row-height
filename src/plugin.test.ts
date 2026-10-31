import type {
  App as AppOriginal,
  PluginManifest
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  Events,
  Plugin as ObsidianPlugin
} from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AutoRowHeightSettings } from './auto-row-height/auto-row-height-component.ts';

import { AutoRowHeightComponent } from './auto-row-height/auto-row-height-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { Plugin } from './plugin.ts';

interface AppGlobal {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests replace the global app before constructing the plugin.
  app: AppOriginal;
}

interface AutoRowHeightComponentInternals {
  readonly getSettings: () => AutoRowHeightSettings;
}

interface InternalPluginState {
  readonly enabled: boolean;
}

interface PluginWithSettings {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

const manifest = castTo<PluginManifest>({
  author: 'test',
  description: 'test',
  id: 'bases-auto-row-height',
  minAppVersion: '1.0.0',
  name: 'Bases Auto Row Height',
  version: '1.0.0'
});

let app: AppOriginal;

function getSettingsComponent(plugin: Plugin): PluginSettingsComponent {
  return castTo<PluginWithSettings>(plugin).pluginSettingsComponent;
}

describe('Plugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    app = App.createConfigured__().asOriginalType__();
    // Bases is off here: the plugin's wiring is under test, and the table layout has its own tests.
    const internalPluginEvents = new Events();
    Object.assign(app, {
      internalPlugins: {
        getPluginById: (): InternalPluginState => ({ enabled: false }),
        offref: internalPluginEvents.offref.bind(internalPluginEvents),
        on: internalPluginEvents.on.bind(internalPluginEvents)
      }
    });
    // Expose the app as the global instance so library helpers that resolve the app without an explicit argument read this one.
    castTo<AppGlobal>(window).app = app;
  });

  it('extends the Obsidian Plugin class', () => {
    expect(Plugin.prototype).toBeInstanceOf(ObsidianPlugin);
  });

  it('registers the report bug command and the open demo vault command', async () => {
    const plugin = new Plugin(app, manifest);
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    await plugin.onload();
    const ids = addCommandSpy.mock.calls.map(([command]) => command.id);
    expect(ids.slice(ids.indexOf('report-bug'))).toStrictEqual(['report-bug', 'open-demo-vault']);
  });

  it('lays tables out with the current row cap', async () => {
    const plugin = new Plugin(app, manifest);
    const addChildSpy = vi.spyOn(plugin, 'addChild');
    await plugin.onload();
    const component = addChildSpy.mock.results.map((result) => result.value as unknown).find((child) => child instanceof AutoRowHeightComponent);
    const settingsComponent = getSettingsComponent(plugin);
    await settingsComponent.editAndSave((settings) => {
      settings.maxRows = 42;
    });
    expect(castTo<AutoRowHeightComponentInternals>(component).getSettings()).toMatchObject({ maxRows: 42 });
  });

  it('lays the tables out again whenever the settings are loaded or saved, until it unloads', async () => {
    const refreshSpy = vi.spyOn(AutoRowHeightComponent.prototype, 'refresh');
    const onSpy = vi.spyOn(PluginSettingsComponent.prototype, 'on');
    const offrefSpy = vi.spyOn(PluginSettingsComponent.prototype, 'offref');
    const componentOnloadSpy = vi.spyOn(AutoRowHeightComponent.prototype, 'onload');
    const plugin = new Plugin(app, manifest);
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    plugin.load();
    await vi.waitFor(() => {
      expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-demo-vault' }));
    });
    const settingsComponent = getSettingsComponent(plugin);

    refreshSpy.mockClear();
    await settingsComponent.editAndSave((settings) => {
      settings.maxRows = 42;
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    refreshSpy.mockClear();
    await settingsComponent.loadFromFile(false);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // The settings component's own listeners, added when it loads, before the row height component exists, are its
    // Own business.
    const componentLoadOrder = ensureNonNullable(componentOnloadSpy.mock.invocationCallOrder[0]);
    const listenerIndices = onSpy.mock.invocationCallOrder.map((order, index) => order > componentLoadOrder ? index : -1).filter((index) => index >= 0);
    expect(listenerIndices.map((index) => onSpy.mock.calls[index]?.[0])).toStrictEqual(['loadSettings', 'saveSettings']);
    const settingsEventRefs = listenerIndices.map((index): unknown => onSpy.mock.results[index]?.value);
    expect(offrefSpy).not.toHaveBeenCalled();
    plugin.unload();
    const removedEventRefs = offrefSpy.mock.calls.map(([eventRef]) => eventRef);
    expect(removedEventRefs).toHaveLength(settingsEventRefs.length);
    expect(removedEventRefs).toEqual(expect.arrayContaining(settingsEventRefs));
  });
});
