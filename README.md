# Prompt Library

A small web app for saving and reusing prompts. No frameworks, no build step, no network calls. Give a prompt a title and a body, save it to `localStorage`, browse what you've saved, copy one back out, delete the ones you don't want. It works in light and dark mode.

## Why this project exists

I built it while investigating AI agents, and the app is what came out of that.

A small, well understood app is a good place to study prompting. You already know what correct looks like, so when the output is wrong you can tell whether the model failed or your request did. The feedback loop is short enough that you can try the same task five ways in an afternoon.

## Running it

Nothing to install.

- VS Code: open the project and hit **Go Live** with the Live Server extension. It serves `index.html` from the project root.
- Any static server works too, I used the `Live Server` extension in VS Code.
- You can also open `index.html` straight from disk, though clipboard copy needs a served page in some browsers.

## Structure

| File         | Contents                                                   |
| ------------ | ---------------------------------------------------------- |
| `index.html` | Markup, inline SVG icons, and the card `<template>`        |
| `styles.css` | Grayscale design tokens with a light and dark theme        |
| `script.js`  | Storage, metadata, export/import, rendering, validation, delete, copy, theme toggle |

Each prompt carries metadata — the model it was written for, created and updated timestamps, and a
token estimate whose confidence is color coded on the card. Prompts saved before metadata existed read
back with it derived from their id, so nothing needs migrating. `window.promptMetadata` exposes
`trackModel`, `updateTimestamps` and `estimateTokens` for use from the console.

## Export and import

**Export** downloads the whole library as `prompt-library-<timestamp>.json`:

```json
{
  "app": "prompt-library",
  "schemaVersion": 1,
  "exportedAt": "2026-08-18T08:05:20.483Z",
  "statistics": { "totalPrompts": 3, "ratedPrompts": 2, "averageRating": 4, "mostUsedModel": "claude-opus-5" },
  "prompts": [ ... ]
}
```

**Import** reads a file back. It validates the envelope, the schema version and every prompt before
touching storage, and an error names the record it came from (`prompts[2].metadata: createdAt must be
an ISO 8601 string...`). Files from a newer `schemaVersion` are refused; older ones are accepted.

When the library already holds prompts you choose what happens: merge keeping your copy of any id that
appears in both, merge taking the imported copy, or replace everything. The library is copied to
`prompts.backup` first, and any failure mid-write rolls the original back, so a failed
import leaves the library exactly as it was.

`window.promptLibrary` exposes `buildExport`, `parseImport`, `statistics` and `mergePrompts`.

Prompts live under the `promptLibrary.prompts.v1` key and the theme preference under `promptLibrary.theme`. It all stays in the browser, so clearing site data clears the library.
