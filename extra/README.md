# extra

Optional custom highlight assets for `pi-file-peek`.

Default highlighting uses Pi's built-in `highlightCode` support.

If you want extra languages not covered by Pi's built-in highlighter, place a custom highlight.js `build` folder here.

Peek checks highlighting in this order:

1. Pi built-in highlighting
2. Extra languages found in `extra/build/lib/languages/`
3. Plain text fallback

- `extra/build/lib/core.js`
- `extra/build/lib/languages/...`

Practical rule:

- copy the generated `build` folder from highlight.js into `extra/`

Each `languages/*.js` file is loaded automatically at runtime.

Extension matching first tries Pi's built-in language map. If Pi does not support the file extension, Peek then tries the extra language set.

For extensions that do not directly match a highlight.js language name or alias, add an `extraLanguages` setting under `pi-file-peek`:

```json
{
  "pi-file-peek": {
    "extraLanguages": [
      { ".gd": "gdscript" }
    ]
  }
}
```

- key: file extension
- value: highlight.js language name or alias from your extra build

Peek checks highlighting in this order:

1. Pi built-in highlighting
2. Extra highlight.js language from `extraLanguages` mapping, then direct language/alias match
3. Plain text fallback

At runtime these assets are copied under:

- `~/.pi/agent/extensions/pi-file-peek/runtime/extra/build/`

Docs:

- https://highlightjs.readthedocs.io/en/latest/building-testing.html
- https://highlightjs.readthedocs.io/en/latest/language-guide.html

Example:

- `.gd` -> `gdscript`
