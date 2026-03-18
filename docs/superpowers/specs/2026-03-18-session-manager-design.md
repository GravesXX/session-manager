# Session Manager Plugin — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Target issue:** [anthropics/claude-code#16901](https://github.com/anthropics/claude-code/issues/16901) — Add `/list-sessions` and `/delete-session` slash commands

## Problem

Claude Code stores conversation sessions as `.jsonl` files under `~/.claude/projects/` but provides no built-in way to browse, preview, or delete them. Over time sessions accumulate (including subagent artifacts and abandoned sessions), making the `/resume` picker cluttered and hard to navigate. Users must manually find and delete files, with no visibility into session contents before removal.

Related open issues: #15576, #25304, #26904, #29552, #30468, #13514, #13780, #18293.

## Solution

A Claude Code plugin that provides a `/sessions` slash command. The command launches an interactive full-screen terminal UI (TUI) for browsing, previewing, and deleting sessions. The TUI is a single vanilla Node.js script with zero npm dependencies, following official plugin conventions.

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
2. The user interacts with the TUI directly (raw mode stdin)
3. On exit, the script prints a JSON summary to stdout
4. Claude reads the summary and reports the result

## Script Architecture

`session-picker.cjs` is a single self-contained Node.js file (~500-700 lines) with four internal modules:

### 1. Scanner

- Walks `~/.claude/projects/` recursively for `*.jsonl` files
- Skips files with `agent-` prefix (subagent sessions)
- For each file, extracts:
  - `sessionId`: filename without `.jsonl` extension
  - `project`: parent directory name, cleaned for display (e.g. `-Users-moomoo-Desktop` → `~/Desktop`)
  - `modified`: file mtime
  - `size`: file size in bytes
  - `messageCount`: count of `"type":"user"` entries
  - `firstMessage`: text content of the first `"type":"user"` entry, truncated to 80 chars
- Sorts by `modified` descending
- Reads files line-by-line; stops scanning a file once first user message is found and count is obtained (does not load entire file into memory)

### 2. Renderer

Uses ANSI escape sequences for full-screen alternate buffer rendering.

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

**Scrolling:** The list viewport is `(terminalHeight - 4) / 2` sessions. When the cursor moves beyond the viewport, the viewport scrolls to keep the cursor visible. Standard scroll-follow behavior.

### 3. Input Handler

Sets `process.stdin` to raw mode. Listens for keypress events and maps them to actions:

| Input | Condition | Action |
|-------|-----------|--------|
| `↑` (escape sequence `\x1b[A`) | Always | Move cursor up |
| `↓` (escape sequence `\x1b[B`) | Always | Move cursor down |
| `Enter` (`\r`) | Always | Enter preview mode for highlighted session |
| `Backspace` (`\x7f`) | Search text empty | Show delete confirmation for highlighted session |
| `Backspace` (`\x7f`) | Search text non-empty | Erase last character from search |
| `Tab` (`\t`) | Always | Cycle filter mode |
| `Esc` (`\x1b` alone) | In preview mode | Return to list |
| `Esc` (`\x1b` alone) | Search text non-empty | Clear search |
| `Esc` (`\x1b` alone) | In list, no search | Exit the program |
| `y` | In delete confirmation | Delete the session file |
| `n` or `Esc` | In delete confirmation | Cancel deletion |
| Printable char | In list mode | Append to search text |

**Escape sequence disambiguation:** After receiving `\x1b`, wait up to 50ms for additional bytes. If `[A`, `[B`, etc. follow, it's an arrow key. If nothing follows, it's a standalone Esc press.

### 4. Actions

**Delete:**
1. Show centered confirmation dialog overlay
2. Display session first message, date, size, message count
3. On `y`: remove the `.jsonl` file using `fs.unlinkSync`, add session ID to `deleted` array, remove from list, redraw
4. On `n` or `Esc`: dismiss dialog, redraw list

**Preview:**
1. Switch to preview screen layout
2. Parse the session `.jsonl` file for `user` and `assistant` entries
3. For `user` entries: extract text content from `message.content` array
4. For `assistant` entries: extract text blocks from `message.content` array (skip tool_use blocks)
5. Display first 20 messages with role label and timestamp
6. Scrollable with ↑↓
7. Esc returns to list view

**Exit:**
1. Restore terminal: exit alternate buffer, show cursor, disable raw mode
2. Print JSON summary to stdout:
   ```json
   {
     "action": "exit",
     "deleted": ["48ea4f1c-..."],
     "remaining": 33
   }
   ```

## Filter Modes

Tab cycles through 4 modes. The active mode is shown in the header.

| Mode | Header | Behavior |
|------|--------|----------|
| All | `Sessions (35)` | Show all sessions |
| By Project | `Sessions (35) › ~/Desktop` | Show sessions from one project; Tab again cycles to next project |
| Small | `Sessions (35) › < 100K` | Show sessions under 100KB |
| Old | `Sessions (35) › > 30 days` | Show sessions older than 30 days |

## Search

- Typing any printable character enters search mode
- Header changes to `Search: {query}█`
- Fuzzy match against first user message and project path (case-insensitive substring)
- List filters live as the user types
- Backspace erases the last search character
- Esc clears search and returns to the previous filter mode

## Edge Cases

- **No sessions found:** Display centered message "No sessions found" with Esc to quit
- **Empty search results:** Display "No matches" in list area, keep search active
- **Terminal resize:** Listen for `SIGWINCH`, recalculate layout, redraw
- **Very long first messages:** Truncate to terminal width minus padding
- **Permission errors on delete:** Catch and display inline error message, do not crash
- **Non-UTF8 content in JSONL:** Skip malformed lines gracefully
- **Subagent files:** Filtered out by scanner (files starting with `agent-`)

## Output Contract

The script communicates with Claude via stdout JSON on exit. SKILL.md instructs Claude to parse this and report:

- If `deleted` is empty: "Session browser closed. No changes made."
- If `deleted` has entries: "Deleted {n} session(s). {remaining} sessions remaining."

## Dependencies

- **Runtime:** Node.js (assumed present — Claude Code requires it)
- **Node.js APIs used:** `fs`, `path`, `readline`, `process` (stdin/stdout/stderr)
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
