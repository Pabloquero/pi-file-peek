# extra

Optional custom assets for `pi-file-peek`.

Default highlighting uses Pi's built-in `highlightCode` support.

If you want extra languages not covered by Pi's built-in highlighter, place a custom highlight.js `build` folder here.

- `extra/build/lib/core.js`
- `extra/build/lib/languages/...`

Practical rule:

- copy the generated `build` folder from highlight.js into `extra/`

At runtime these assets are copied under:

- `~/.pi/agent/extensions/pi-file-peek/runtime/extra/build/`

Docs:

- https://highlightjs.readthedocs.io/en/latest/building-testing.html
- https://highlightjs.readthedocs.io/en/latest/language-guide.html

Current extension fallback example target:

- `gdscript`
