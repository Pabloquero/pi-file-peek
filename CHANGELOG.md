# Changelog

## 0.1.3

- Added `/peek diff` to preview the latest turn with captured edit diffs or patches.
- Added `autoDiff` setting, disabled by default, to open one grouped diff preview after turns with edits.
- Added diff capture from Pi `tool_result` events using `details.diff` and `details.patch`.
- Added session-history fallback for `/peek diff` using the latest turn with `edit` tool results.
- Added multi-item overlay navigation with left/right item switching and item counters.
- Updated diff previews to send across connected Peek sessions like file previews.

## 0.1.1

- Improved overlay sizing and positioning so previews are shorter, better centered, and leave more bottom command space.
- Added configurable `extraLanguages` mappings for runtime extra highlight.js languages such as `.gd` -> `gdscript`.
- Improved extra highlight.js fallback handling and docs for custom language loading.
- Kept `/peek settings` open in place while toggling settings instead of reopening the list.
- Improved disconnect handling so either side ending a connection clears the pair and pauses auto-reconnect for the rest of the session.

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

