# session-manager

Interactive terminal UI for browsing, previewing, and deleting Claude Code sessions.

Addresses [anthropics/claude-code#16901](https://github.com/anthropics/claude-code/issues/16901).

## Installation

**Local install:**
```bash
claude plugin add /path/to/session-manager
```

## Usage

Type `/sessions` in Claude Code to launch the session manager.

### Controls

| Key | Action |
|-----|--------|
| ↑↓ | Navigate the session list |
| Enter | Preview conversation messages |
| Backspace | Delete session (with confirmation) |
| Tab | Cycle filter: All → By Project → Small → Old |
| Type | Fuzzy search by message or project |
| Esc | Clear search / go back / quit |
| Ctrl+C | Quit |

### Filter Modes

- **All** — show every session
- **By Project** — filter to one project at a time (Tab cycles through projects)
- **Small (< 100K)** — likely low-value sessions
- **Old (> 30 days)** — sessions older than 30 days

### CLI Fallback

When no TTY is available (e.g., inside Claude's Bash tool), the plugin falls back to CLI mode where Claude mediates using subcommands:

```bash
node session-picker.cjs --list
node session-picker.cjs --preview <session-id>
node session-picker.cjs --delete <session-id>
```

## How It Works

- Scans `~/.claude/projects/` for `.jsonl` session files
- Extracts metadata: first user message, date, size, message count, project
- Renders a full-screen alternate buffer TUI using ANSI escape codes
- Zero npm dependencies — vanilla Node.js only
- Follows official Claude Code plugin conventions

## Development

```bash
# Run tests
node test/test-scanner.cjs && node test/test-cli.cjs && node test/test-utils.cjs
```

## License

MIT
