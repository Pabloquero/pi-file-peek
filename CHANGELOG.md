# Changelog

## 0.1.0

- Initial public release of `pi-file-peek`.
- Terminal file preview workflow centered around `/peek file`, `/peek past`, and `/peek path`.
- Cross-session file preview sending with `/peek sub`, `/peek con`, and `/peek disconnect`.
- `/peek file` restores files from the real last assistant response and persists them across reloads.
- `/peek past` uses tracked file history with recent-turn priority.
- `/peek settings` toggles local project settings from inside Pi.
- `/peek clear` clears tracked-file history for the current workspace.
- Configurable overlay navigation keys, footer visibility, header visibility, notifications, and stacked close behavior.
- Improved picker UX, including duplicate filename disambiguation and menu behavior fixes.
- Syntax-highlighted previews with plain-text fallback.
- Lightweight terminal-friendly markdown rendering for `.md` files.
- Optional extra language highlighting through runtime `extra/build/` assets.
- Custom tool tracking through `customTools`, including patch parsing for tools such as `apply_patch`.
- Runtime state stored under `~/.pi/agent/extensions/pi-file-peek/runtime/`.
- Merged global and project settings support through `~/.pi/agent/settings.json` and `.pi/settings.json`.
- Package structure and docs prepared for GitHub and npm distribution.

