import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from '@mnaoumov/obsidian-lib/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

/**
 * The settings tab is declarative: return one definition per row from `getSettingDefinitionItems()` and
 * Obsidian renders them. `bind` wires a component to a settings property in both directions, so there is
 * no read/write plumbing to maintain.
 */
export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: 'The most rows a table with the Auto row height may have and still fit its rows to their content. A table with more rows keeps fixed-height rows, because fitting renders every row at once.',
        name: 'Maximum rows',
        render: (setting) => {
          setting.addNumber(($number) => {
            $number.setMin(1);
            this.bind({ propertyName: 'maxRows', valueComponent: $number });
          });
        }
      })
    ];
  }
}
