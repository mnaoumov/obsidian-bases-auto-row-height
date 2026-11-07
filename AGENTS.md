# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Overview

`Bases Auto Row Height` adds **Auto** to the Row height option of the core Bases table view. With it, every row is as tall as its tallest cell and long values wrap, the way a row of a Markdown table does. The option is stored per view in the base file as `rowHeight: auto`; Obsidian reads an unknown row height as Short, so a base stays valid without the plugin.

What already exists, so the plugin does not rebuild it:

- **`Bases Wrap Text`** (`bases-wrap-text`) toggles wrapping with the fixed Medium, Tall or Extra tall height. Every row still has the same height.
- **`Bases Style Enhancer`** (`bases-style-enhancer`) changes the font size.
- **`Extended Base`** (`extended-base`, a fork of GoodBases) ships its own Notion-style replacement views with per-column wrapping. It does not change the core table view, its editing or its keyboard model.

None of them gives a core table row the height of its content. That is this plugin's whole scope.

## Current state

The repo was generated on 2026-10-31 with `create-obsidian-plugin` (preset `all-in-one`, desktop and mobile, the unofficial API subset, no editor extensions). Its answers are in `.create-obsidian-plugin.json`.

**Built:** `src/auto-row-height/auto-row-height-component.ts` (the patches), `row-layout.ts` (pure row arithmetic), `visible-height.ts` (the page height), the `maxRows` setting, and a demo vault around one sample base.

**Tests:** unit tests at 100% coverage. `auto-row-height.cross-platform.integration.test.ts` checks the layout (no overlaps, gaps or clipped cells), the Auto option, click hit-testing, late content, the way back to Short and the row cap. `page-keys.desktop.integration.test.ts` checks PageUp and PageDown. Both pass on desktop against Obsidian 1.15.0.

**Not yet:** the Android run (the local test emulator now carries Obsidian 1.15.0, but on 2026-11-06 the emulator did not finish booting within its 10-minute budget under machine load, so no Android test has run yet), the README, the release and the directory listing.

## Design

### Why CSS cannot do it

The table view is virtualized from one fixed row height `H = --bases-table-row-height × getRowHeightMult()`. `updateVirtualDisplay` gives every row an absolute `top` of `index × H`, sets each group's `tbody` to `rows × H`, renders only the rows inside the viewport (culled with `H` too), and positions every cell absolutely with that height. A CSS auto height therefore cannot move the rows below a tall one: they overlap, or keep their fixed slots.

### How the plugin does it

1. **The view class.** It is not exported. The `Bases` core plugin instance keeps its view registrations (`app.internalPlugins.getEnabledPluginById('bases').registrations.table`); the plugin wraps that registration's `options` to add `auto` to the `rowHeight` dropdown, and calls its `factory` once with a stand-in controller to get an instance, never loaded, whose prototype it patches. Everything is re-applied when Bases is turned off and on (`CorePluginToggleComponent`), and every open table is laid out again through `workspace.trigger('css-change')`, which each table view listens to.
2. **Every row is rendered.** The viewport helper the view culls with returns an infinite viewport when the container sits inside `.print` (the print path). For the length of one `updateVirtualDisplay` call the container's own `closest` answers `.print` with itself.
3. **Every row is laid out by its height.** After the original call: write `--bases-table-row-height: auto` on each row, read each row's tallest cell, then write each row's height into the variable, restack the row tops, the `tbody` heights, the group tops and the container height. One write pass, one read pass, one write pass, so the browser lays out once. The Short height stays the minimum (`getRowHeightMult()` returns 1 for `auto`). The container also gets `mod-multiline`, so the core multiline styles apply, and `mod-auto-row-height` for the plugin's wrapping CSS.
4. **The view's row arithmetic is corrected** from the stored per-group row tops: `getCellRect` (scroll-into-view), `getClosestCellIndexWithinGroup` (click and drag hit-testing), and the active-cell and selection overlays.
5. **PageUp and PageDown.** The view pages by `Math.floor(pageHeight / H)` rows inside its own keydown listener. A capture listener on the view's `scrollEl` counts how many real rows fit one page and, for the view's next single `getRowHeightMult` call (a `once` patch on the instance), returns the multiplier that makes that floor come out at the count. The page height follows the view's own viewport helper (`visible-height.ts`).
6. **Late content.** One `ResizeObserver` per table watches every `.bases-table-cell`. The plugin's CSS lets a cell grow past its row (`height: auto; min-height: 100%; align-self: flex-start`), so a cell whose content renders after the layout (markdown, an image) outgrows its row, and the table is laid out again on the next animation frame. A shrinking cell is caught by the data update that follows the edit.
7. **The row cap.** A table with more rows than `maxRows` (default 500) keeps the native layout, because an Auto table renders every row on every `updateVirtualDisplay`, including the ones the view runs on scroll.

### Internals and typings

The table view, its rows, groups and registrations are typed in `obsidian-typings` (`BasesTableView`, `BasesTableViewRegistration`, `BasesPluginInstance`), including `isGroupCollapsed`, which takes the `BasesEntryGroup` entries of `data.groupedData`.

Verified against `app.js` of Obsidian 1.14.5 and catalyst 1.15.0.

### Settings

- `maxRows`: the most rows a table may have and still be laid out by content, a number of at least 1.
