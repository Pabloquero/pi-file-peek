# Technical reference

## Install

```bash
pi install npm:@pabloquero/pi-file-peek
pi install git:git@github.com:Pabloquero/pi-file-peek.git
pi install /absolute/path/to/pi-file-peek
```

Then reload Pi:

```text
/reload
```

## Package structure

| Part | Path |
|---|---|
| Package entry | `pi-file-peek.ts` |
| Runtime orchestration | `src/runtime.ts` |
| Runtime root | `~/.pi/agent/extensions/pi-file-peek/runtime/` |

## Command reference

| Command | Behavior |
|---|---|
| `/peek` | Open the action menu. |
| `/peek file` | Open or send files from the real last assistant response. |
| `/peek diff` | Preview the latest turn with captured edit diffs/patches. |
| `/peek path <file-path>` | Open or send a specific relative or absolute file path. |
| `/peek past` | Open or send tracked files from session history. |
| `/peek sub` | Mark this session as a receiver. |
| `/peek con` | Connect to the first live subscribed peer, otherwise the first live peer. |
| `/peek disconnect` | Clear inbound and outbound connections, unsubscribe the session, and pause auto-connect until `/peek con` or `/reload`. |
| `/peek settings` | Toggle local project settings. |
| `/peek clear` | Clear tracked-file history for the current workspace. |
| `/peek status` | Show current state. |
| `/peek debug` | Toggle and persist debug mode. |

Legacy commands still exist:

- `/peek unsub` remains available for compatibility.
- `/peek discon` remains available for compatibility.

## Settings sources

Peek reads settings from:

- global: `~/.pi/agent/settings.json`
- project: `.pi/settings.json`

Project values override global values per key.

## Settings reference

| Setting | Default | Options | Behavior |
|---|---|---|---|
| `autoSub` | `false` | `true`, `false` | Subscribe this session automatically on startup. |
| `autoCon` | `false` | `true`, `false` | Try to auto-connect to a live peer. |
| `debug` | `false` | `true`, `false` | Enable debug status and debug notifications. |
| `notifications` | `true` | `true`, `false` | Enable Peek notifications. |
| `showHeader` | `true` | `true`, `false` | Show the overlay header. |
| `showFooter` | `true` | `true`, `false` | Show overlay help rows in the footer. Line info stays visible. |
| `closeAll` | `false` | `true`, `false` | Close all stacked overlays at once instead of one by one. |
| `autoDiff` | `false` | `true`, `false` | Automatically open one grouped diff overlay after turns with edits. |
| `keys.scrollUp` | `"up"` | Key name or Array with key names as String | Scroll one line up. |
| `keys.scrollDown` | `"down"` | Key name or Array with key names as String | Scroll one line down. |
| `keys.pageUp` | `"pageUp"` | Key name or Array with key names as String | Scroll one page up. |
| `keys.pageDown` | `"pageDown"` | Key name or Array with key names as String | Scroll one page down. |
| `keys.prevItem` | `"left"` | Key name or Array with key names as String | Move to the previous overlay item. |
| `keys.nextItem` | `"right"` | Key name or Array with key names as String | Move to the next overlay item. |
| `keys.close` | `"esc"` | Key name or Array with key names as String | Close the overlay. |
| `customTools` | `[]` | array | Extra rules for recognizing files touched by custom tools. |
| `extraLanguages` | `[]` | array | Extra extension-to-highlight.js language mappings for runtime extra languages. |

Copy-paste example:

```json
{
  "pi-file-peek": {
    "autoSub": false,
    "autoCon": false,
    "debug": false,
    "notifications": true,
    "showHeader": true,
    "showFooter": true,
    "closeAll": false,
    "autoDiff": false,
    "keys": {
      "scrollUp": "up",
      "scrollDown": "down",
      "pageUp": "pageUp",
      "pageDown": "pageDown",
      "prevItem": "left",
      "nextItem": "right",
      "close": "esc"
    },
    "customTools": [],
    "extraLanguages": [
      {
        ".gd": "gdscript"
      }
    ]
  }
}
```

## Diff preview model

Peek captures successful edit-related `tool_result` events. The built-in `edit` tool is recognized directly, and other tools can be captured when their result details include `patch` or `diff`.

Consumed fields:

- `event.toolName`
- `event.isError`
- `event.details.patch`
- `event.details.diff`

`/peek diff` opens or sends the most recent turn that contains captured diffs. It first uses in-memory state, then falls back to session history by scanning `ctx.sessionManager.getBranch()` for the latest user/assistant turn containing `edit` tool results. No custom session entries are persisted for diffs.

If `autoDiff` is enabled, Peek opens or sends one grouped diff overlay at the end of an agent turn that produced diffs. Multiple diffs in that turn are shown as overlay items with left/right navigation. If both fields exist, string `details.diff` is preferred; otherwise the unified patch string is used. Diff previews use Peek's own line coloring for added, removed, and context lines.

## Tracking model

Tracked files are derived from tool activity.

### Built-in sources

- `read` is tracked.
- `edit` is tracked.
- `write` is tracked.
- `grep` is tracked.
- `find` is tracked.
- `bash` is tracked.
- `exec_command` is tracked.

### Last-response behavior

- `/peek file` uses files from the real last assistant response.
- After reload, the extension restores that last-response file list from session history.
- If no files exist in the last assistant response, `/peek file` falls back to `/peek past`.

### Historical behavior

- `/peek past` uses tracked file history.
- Files seen in recent turns are prioritized over older history.

### Custom tool tracking

Supported modes:

- `path` mode is supported.
- `text` mode is supported.
- `patch` mode is supported.

Example:

```json
{
  "pi-file-peek": {
    "customTools": [
      {
        "tool": "apply_patch",
        "from": "input",
        "field": "input",
        "mode": "patch",
        "actions": ["add", "update"]
      }
    ]
  }
}
```

## Overlay behavior

- It opens locally when no peer is connected.
- It sends to the connected peer when one exists.
- It uses Pi built-in highlighting by default.
- It renders markdown files with a terminal-friendly markdown view.
- It falls back to plain text when highlighting is unsupported.
- It can use optional extra highlight assets from the runtime `extra/build/` folder.
- It always shows line position info.
- It respects `showHeader`, `showFooter`, `closeAll`, `autoDiff`, and custom keys.
- When an overlay contains multiple items, `keys.prevItem` and `keys.nextItem` switch between them and the subtitle shows an item counter.
- Page scrolling uses the wrapped rendered view, including markdown previews.

## Connection behavior

Runtime connection state is stored under `connections/`.

Manual `/peek disconnect` suppresses auto-connect for the current session until `/peek con` or `/reload`.

Connection labels:

- Normal mode prefers the session name or workspace name.
- Debug mode includes endpoint ids.

## Runtime layout

| Folder | Purpose |
|---|---|
| `presence/` | Live session records. |
| `connections/` | Directional connection files. |
| `inbox/` | Pending preview envelopes. |
| `processed/` | Debug-only processed envelopes. |
| `tmp/` | Temporary files. |
| `tracked-files/` | Per-workspace tracked file history. |
| `reconnects/` | Reconnect hints across reloads. |
| `extra/` | Optional extra highlight assets. |

## Highlighting and markdown

Default highlighting uses Pi built-in highlighting.

Highlight fallback order is:

1. Pi built-in highlighting.
2. Extra languages loaded from runtime `extra/build/lib/languages/`, using `extraLanguages` extension mappings first, then direct language/alias matches.
3. Plain text fallback.

Markdown files use a terminal-friendly markdown renderer.

Common mappings include:

- `.md` maps to markdown.
- `.json` maps to json.
- `.js` maps to javascript.
- `.ts` maps to typescript.
- `.py` maps to python.
- `.sh` and `.bash` map to bash.
- `.html` and `.xml` are supported.
- `.yaml` and `.yml` are supported.
- `.css` is supported.
- `.diff` is supported.

Optional mapping example:

- `.gd` can map to `gdscript` through `extraLanguages`.

## Runtime extra assets

Optional extra highlight assets are loaded from:

```text
~/.pi/agent/extensions/pi-file-peek/runtime/extra/build/
```

Local development assets can live in:

```text
extra/build/
```

See [../extra/README.md](../extra/README.md).

## Development checks

```bash
npm run typecheck
npm run pack:dry
```
