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
| `script.js`  | Storage, rendering, validation, delete, copy, theme toggle |

Prompts live under the `promptLibrary.prompts.v1` key and the theme preference under `promptLibrary.theme`. It all stays in the browser, so clearing site data clears the library.
