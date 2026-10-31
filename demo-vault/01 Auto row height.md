# Auto row height

A Bases table view offers four row heights: **Short**, **Medium**, **Tall** and **Extra tall**. Each one is a single fixed height for every row, so a long value is cut off at Short, and a short value wastes space at Tall. `Bases Auto Row Height` adds a fifth, **Auto**: every row is as tall as its tallest cell, and long text wraps instead of being cut off.

The sample table lists six notes, each with a `summary` property of a different length:

- [Bridge inspection](<./Materials/01 Auto row height/Notes/Bridge inspection.md>)
- [Garden plan](<./Materials/01 Auto row height/Notes/Garden plan.md>)
- [Kitchen renovation](<./Materials/01 Auto row height/Notes/Kitchen renovation.md>)
- [Library card](<./Materials/01 Auto row height/Notes/Library card.md>)
- [Reading list](<./Materials/01 Auto row height/Notes/Reading list.md>)
- [Tax return](<./Materials/01 Auto row height/Notes/Tax return.md>)

## Turn it on

Auto is a per-view option, saved in the base file as `rowHeight: auto`. Switch the sample table back to Short first, to see the difference:

```code-button
---
caption: Set the sample table to Short
---
await require('/demoSetup.ts').setRowHeight(app, '');
```

Every row is now the same height, and the long summaries end in the middle of a sentence. Now switch it to Auto:

```code-button
---
caption: Set the sample table to Auto
---
await require('/demoSetup.ts').setRowHeight(app, 'auto');
```

Manual equivalent: open [Projects](<./Materials/01 Auto row height/Projects.base>), click the view name at the top left, choose **Configure view**, and pick **Auto** under **Row height**.

## What stays the same

- **Short is the minimum.** A one-line row is exactly as tall as it is on Short.
- **The table still works like a table.** Clicking a cell, selecting a range, and moving with the arrow keys land on the row you see. PageUp and PageDown move by one screen of real rows.
- **Late content is followed.** When something in a cell finishes rendering after the table, such as an image, its row grows to fit it.
- **The base file stays valid without the plugin.** Obsidian reads an unknown row height as Short, so a vault without the plugin shows the same table with Short rows.

## Large tables

To fit rows to their content, the plugin renders every row of the table at once, where Obsidian normally renders only the rows on screen. That is quick for a few hundred rows. A table with more rows than the **Maximum rows** setting keeps the fixed Short height; see [02 Settings](<./02 Settings.md>).
