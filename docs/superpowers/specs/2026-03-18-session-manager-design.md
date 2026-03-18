# Session Manager Plugin — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Target issue:** [anthropics/claude-code#16901](https://github.com/anthropics/claude-code/issues/16901) — Add `/list-sessions` and `/delete-session` slash commands

## Problem

Claude Code stores conversation sessions as `.jsonl` files under `~/.claude/projects/` but provides no built-in way to browse, preview, or delete them. Over time sessions accumulate (including subagent artifacts and abandoned sessions), making the `/resume` picker cluttered and hard to navigate. Users must manually find and delete files, with no visibility into session contents before removal.

Related open issues: #15576, #25304, #26904, #29552, #30468, #13514, #13780, #18293.

## Solution

A Claude Code plugin that provides a `/sessions` slash command. The command launches an interactive full-screen terminal UI (TUI) for browsing, previewing, and deleting sessions. The TUI is a single vanilla Node.js script with zero npm dependencies, following official plugin conventions.

## TTY Strategy: Dual-Mode Script

Claude's Bash tool does not provide TTY access to subprocesses (`process.stdin.isTTY` is `undefined`, `setRawMode` throws). The script handles this with a dual-mode approach:

**Interactive mode (primary):** The script attempts to open `/dev/tty` directly for input (the same technique used by `vim`, `less`, and `fzf` when stdin is piped). If `/dev/tty` is available, the full TUI renders in the alternate screen buffer. Output goes to `/dev/tty` as well, bypassing stdout capture.

**CLI mode (fallback):** If `/dev/tty` is unavailable (sandboxed environment), the script accepts subcommands via argv:
- `--list` — print formatted session list as JSON to stdout
- `--preview <session-id>` — print conversation messages as JSON to stdout
- `--delete <session-id>` — delete a session file, print confirmation JSON to stdout

The SKILL.md instructs Claude to:
1. First attempt: run the script without arguments (triggers interactive mode)
2. If the script outputs `{"mode":"cli","reason":"no-tty"}`, switch to mediating: use `--list` to show sessions, then respond to user requests with `--preview` and `--delete` subcommands
3. If interactive mode succeeds, the script prints a JSON summary on exit

This gives users the full beautiful TUI when possible, with a functional fallback when not.

## Plugin Structure

```
~/Desktop/session-manager/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── sessions/
│       ├── SKILL.md
│       └── scripts/
│           └── session-picker.cjs
└── README.md
```

### plugin.json

```json
{
  "name": "session-manager",
  "description": "Interactive terminal UI for browsing, previewing, and deleting Claude Code sessions",
  "version": "1.0.0",
  "author": {
    "name": "moomoo"
  }
}
```

### SKILL.md

```yaml
---
name: sessions
description: Manage, preview, and delete Claude Code sessions
allowed-tools: [Bash, Read]
---
```

The skill instructs Claude to:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs"` via Bash
2. If interactive mode activates: user controls the TUI directly, Claude reads the JSON summary on exit
3. If CLI fallback activates: Claude mediates using `--list`, `--preview <id>`, `--delete <id>` subcommands based on user requests

## Script Architecture

`session-picker.cjs` is a single self-contained Node.js file (~600-800 lines) with five internal modules:

### 1. Scanner

- Walks `~/.claude/projects/` for `*.jsonl` files at depth 2 (project dir → session file)
- Skips files with `agent-` prefix (subagent sessions at the top level)
- For each file, extracts:
  - `sessionId`: filename without `.jsonl` extension
  - `project`: read from the `cwd` field of the first JSONL entry that contains one (scan up to 10 lines, since early entries like `file-history-snapshot` may lack `cwd`). Shorten home dir prefix to `~`. If no `cwd` found within 10 lines, fall back to deriving project from the parent directory name (replace leading `-Users-{username}-` with `~/`, replace remaining `-` with `/`).
  - `modified`: file mtime from `fs.statSync`
  - `size`: file size in bytes from `fs.statSync`
  - `messageCount`: total number of JSONL lines with `"type":"user"` — obtained by scanning the full file (line count is fast even for large files since we only parse enough to check the type field)
  - `firstMessage`: text content of the first `"type":"user"` entry, truncated to 80 chars
- Sorts by `modified` descending
- Reads files line-by-line using `fs.readFileSync` split by `\n`

**Content extraction for `firstMessage`:** The `message.content` field has two forms:
- **String:** `message.content` is a plain string (common for typed messages) — use directly
- **Array:** `message.content` is an array of content blocks — find the first `{type: "text", text: "..."}` block and use its `text` field
- Skip entries where content is only `tool_result` blocks with no text

**Malformed line handling:** Wrap each `JSON.parse` in try/catch. Skip lines that fail to parse (handles concurrent writes with partial last lines).

### 2. Renderer (Interactive Mode)

Uses ANSI escape sequences for full-screen alternate buffer rendering. All output goes to `/dev/tty` (not stdout) to avoid Claude's output capture.

**Terminal control sequences used:**
- `\x1b[?1049h` / `\x1b[?1049l` — enter/exit alternate screen buffer
- `\x1b[H` — cursor to home position
- `\x1b[2J` — clear entire screen
- `\x1b[K` — clear to end of line
- `\x1b[nB` — cursor down n lines
- `\x1b[1m` / `\x1b[0m` — bold / reset
- `\x1b[2m` — dim
- `\x1b[36m` — cyan (project paths)
- `\x1b[7m` — reverse video (highlighted row)
- `\x1b[?25l` / `\x1b[?25h` — hide/show cursor

**Screen layout:**

```
Line 1:   Header — session count + filter mode or search input
Line 2:   Horizontal divider (─ characters)
Lines 3–(H-2): Scrollable session list (2 lines per session)
Line H-1: Horizontal divider
Line H:   Footer — keybinding hints
```

Each session entry occupies 2 lines:
- **Line A (metadata):** `  03-17  254K  48msg  ~/`  — date, size, message count, project
- **Line B (message):** `  Migrate 4 agents to openclaw`  — first user message, dimmed

The active session has a `►` cursor prefix and bold/reverse styling on line A.

**Scrolling:** The list viewport holds `Math.floor((terminalHeight - 4) / 2)` sessions. When the cursor moves beyond the viewport, the viewport scrolls to keep the cursor visible.

### 3. Input Handler (Interactive Mode)

Opens `/dev/tty` in raw mode for reading keypresses. Maps them to actions:

| Input | Condition | Action |
|-------|-----------|--------|
| `↑` (`\x1b[A`) | Always | Move cursor up |
| `↓` (`\x1b[B`) | Always | Move cursor down |
| `Enter` (`\r`) | Always | Enter preview mode for highlighted session |
| `Backspace` (`\x7f`) | Search text empty | Show delete confirmation for highlighted session |
| `Backspace` (`\x7f`) | Search text non-empty | Erase last character from search |
| `Tab` (`\t`) | Always | Cycle filter mode (All → Project 1 → Project 2 → ... → Small → Old → All) |
| `Esc` (`\x1b` alone) | In preview mode | Return to list |
| `Esc` (`\x1b` alone) | Search text non-empty | Clear search |
| `Esc` (`\x1b` alone) | In list, no search | Exit the program |
| `y` | In delete confirmation | Delete the session and its artifacts |
| `n` or `Esc` | In delete confirmation | Cancel deletion |
| `Ctrl+C` (`\x03`) | Always | Clean exit (restore terminal, print summary) |
| Printable char | In list mode | Append to search text |

**Escape sequence disambiguation:** After receiving `\x1b`, wait up to 50ms for additional bytes. If `[A`, `[B`, etc. follow, it's an arrow key. If nothing follows, it's a standalone Esc press.

**Backspace safety note:** When search text is empty, Backspace triggers the delete confirmation dialog — but the dialog requires an explicit `y` keypress to confirm. Accidental Backspace → immediate `y` is highly unlikely, and the dialog displays the session details so the user knows exactly what they're deleting.

### 4. CLI Mode (Fallback)

When `/dev/tty` is unavailable, the script operates via argv subcommands. All output is JSON to stdout.

**`--list`:**
```json
{
  "mode": "cli",
  "sessions": [
    {
      "id": "48ea4f1c-...",
      "project": "~/",
      "modified": "2026-03-17",
      "size": "254K",
      "messageCount": 48,
      "firstMessage": "Migrate 4 agents to openclaw"
    }
  ]
}
```

**`--preview <session-id>`:**
```json
{
  "mode": "cli",
  "sessionId": "48ea4f1c-...",
  "messages": [
    {"role": "user", "timestamp": "2026-03-17T14:25:00Z", "text": "now on my desktop..."},
    {"role": "assistant", "timestamp": "2026-03-17T14:25:30Z", "text": "I'll help you..."}
  ]
}
```

**`--delete <session-id>`:**
```json
{
  "mode": "cli",
  "deleted": "48ea4f1c-...",
  "remaining": 34
}
```

### 5. Actions

**Delete:**
1. In interactive mode: show centered confirmation dialog overlay
2. Display session first message, date, size, message count
3. On `y`: remove the `.jsonl` file using `fs.unlinkSync`. Also remove the session subdirectory (`{sessionId}/`) if it exists (contains `subagents/` and `tool-results/` artifacts). Add session ID to `deleted` array, remove from list, redraw.
4. On `n` or `Esc`: dismiss dialog, redraw list

**Preview:**
1. Switch to preview screen layout
2. Parse the session `.jsonl` file for `user` and `assistant` entries
3. For `user` entries: extract text content (handle both string and array `message.content`)
4. For `assistant` entries: extract text blocks from `message.content` array (skip `tool_use` blocks)
5. Display first 20 messages with role label and entry-level `timestamp` field (ISO 8601, formatted as `MM-DD HH:MM`)
6. Scrollable with ↑↓
7. Esc returns to list view

**Exit:**
1. Restore terminal: exit alternate buffer, show cursor, close `/dev/tty` fd
2. Print JSON summary to stdout (so Claude can read it):
   ```json
   {
     "action": "exit",
     "deleted": ["48ea4f1c-..."],
     "remaining": 33
   }
   ```

## Filter Modes

Tab cycles through filter modes in a flat sequence. The active mode is shown in the header.

**Cycle order:** All → Project₁ → Project₂ → ... → Projectₙ → Small → Old → All

| Mode | Header | Behavior |
|------|--------|----------|
| All | `Sessions (35)` | Show all sessions |
| Project (one per unique project) | `Sessions (12) › ~/Desktop` | Show sessions from that project only |
| Small | `Sessions (8) › < 100K` | Show sessions under 100KB |
| Old | `Sessions (5) › > 30 days` | Show sessions older than 30 days |

This is a single flat cycle — no nested modes, no ambiguity. Tab always advances to the next filter in the sequence.

## Search

- Typing any printable character enters search mode
- Header changes to `Search: {query}█`
- Case-insensitive substring match against first user message and project path
- List filters live as the user types
- Backspace erases the last search character
- Esc clears search and returns to the previous filter mode

## Edge Cases

- **No sessions found:** Display centered message "No sessions found" with Esc to quit
- **Empty search results:** Display "No matches" in list area, keep search active
- **Terminal resize:** Listen for `SIGWINCH`, recalculate layout, redraw
- **Very long first messages:** Truncate to terminal width minus padding
- **Permission errors on delete:** Catch and display inline error message, do not crash
- **Non-UTF8 / malformed JSONL lines:** Skip gracefully via try/catch on JSON.parse
- **Concurrent writes:** Skip incomplete last lines (no trailing newline = skip)
- **Subagent files:** Defensive filter on `agent-` prefix. Subagent files normally live inside session subdirectories (`{sessionId}/subagents/`) and are not reached by the depth-2 walk, but the filter guards against future layout changes.
- **Orphaned session directories:** Delete removes both `.jsonl` and session subdirectory
- **Ctrl+C:** Handled as clean exit in raw mode (byte `0x03`)
- **/dev/tty opens but setRawMode fails:** Fall back to CLI mode gracefully

## Output Contract

The script communicates with Claude via stdout JSON on exit. SKILL.md instructs Claude to parse this and report:

- If `deleted` is empty: "Session browser closed. No changes made."
- If `deleted` has entries: "Deleted {n} session(s). {remaining} sessions remaining."

## Dependencies

- **Runtime:** Node.js (assumed present — Claude Code requires it)
- **Node.js APIs used:** `fs`, `path`, `process` (stdin/stdout/stderr), `os` (homedir)
- **npm packages:** None
- **External tools:** None

## Security Considerations

- Only reads/deletes files under `~/.claude/projects/` — no path traversal
- Delete requires explicit `y` confirmation
- No network access
- No data leaves the local machine

## Out of Scope (v1)

- Export to Markdown
- Session archiving (soft delete)
- Bulk multi-select
- Integration with `claude --resume`
- Session renaming
- Token usage analytics
