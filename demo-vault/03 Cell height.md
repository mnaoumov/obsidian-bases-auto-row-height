# Cell height

In an Auto table every column wraps in full by default, so one long value makes its whole row tall. **Cell height** lets each column choose how much of its value it shows: wrap in full, or stop at 1, 2, 3 or 5 lines with an ellipsis at the cut. A long description column can then stay short while a title or status column keeps one tidy line, and the table stays easy to scan.

The setting belongs to one column of one table view, and only an Auto table uses it.

## Clamp a column

Open the sample table and limit its `summary` column to two lines:

```code-button
---
caption: Show at most 2 lines of each summary
---
await require('/demoSetup.ts').setSummaryLines(app, 2);
```

Every long summary now stops after its second line with an ellipsis, and every row is at most two lines tall. Click into a clamped cell to edit it: while you edit, the cell shows its whole value.

Now let the column wrap in full again:

```code-button
---
caption: Wrap each summary in full
---
await require('/demoSetup.ts').setSummaryLines(app, null);
```

Manual equivalent: open [Projects](<./Materials/01 Auto row height/Projects.base>), right-click the **summary** column header (tap it on mobile), open **Cell height** and pick **2 lines** or **Wrap in full**.

## Where it is stored

The choice is saved in the base file, next to `rowHeight: auto`, as a map from each clamped column to its line count:

```yaml
rowHeight: auto
cellLines:
  note.summary: 2
```

A column the map does not name wraps in full, and **Wrap in full** removes the column from the map. Without the plugin, Obsidian ignores the map, so the base stays valid.
