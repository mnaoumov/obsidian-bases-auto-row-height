# Settings

Every setting `Bases Auto Row Height` stores, listed by the **key it is written under in `data.json`** rather than by its display label — that is what you see when you open the file, hit a sync conflict, or read a support thread.

Find them in Obsidian under **Settings → Community plugins → `Bases Auto Row Height`**.

## General

- `maxRows`
  - the most rows a table with the Auto row height may have and still fit its rows to their content, shown in the settings tab as **Maximum rows**. The default is `500`.
  - a table with more rows keeps the fixed Short height, because fitting renders every row at once.

## Try it

Set the cap below the six rows of the sample table. The change applies live — the open tables are laid out again, so there is no reload.

```code-button
---
caption: Set maxRows to 3
---
await require('/demoSetup.ts').setMaxRows(app, 3);
```

Manual equivalent: type `3` into **Maximum rows** in the settings tab.

Open [Projects](<./Materials/01 Auto row height/Projects.base>) now: its rows are all the same height again. When you are done, put the cap back:

```code-button
---
caption: Reset maxRows to its default
---
await require('/demoSetup.ts').resetMaxRows(app);
```

Manual equivalent: type `500` back into the field.
