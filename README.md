# session-manager

Interactive terminal UI for browsing, previewing, and deleting Claude Code sessions.

Addresses [anthropics/claude-code#13514](https://github.com/anthropics/claude-code/issues/13514).

## Installation

### From the Plugin Marketplace

If available in the official marketplace:

```
/plugin install session-manager
```

### From GitHub

```bash
claude plugin marketplace add https://github.com/GravesXX/session-manager.git
```

Then in Claude Code:

```
/plugin install session-manager@session-manager
```

### Local Install

```bash
git clone https://github.com/GravesXX/session-manager.git
claude plugin marketplace add /path/to/session-manager
```

After installing, restart Claude Code or run `/reload-plugins`.

## Usage

### Inside Claude Code

Type `/sessions` to launch the session manager. Claude will attempt the interactive TUI first. If no terminal is available, Claude mediates with a numbered list — just say "preview #3" or "delete #5".

### Standalone (Full TUI Experience)

For the best visual experience, run directly in your terminal:

```bash
node /path/to/session-manager/skills/sessions/scripts/session-picker.cjs
```

Tip: add an alias to your shell profile:

```bash
alias sessions='node ~/Desktop/session-manager/skills/sessions/scripts/session-picker.cjs'
```

### Quick Cleanup

Delete all auto-generated local-command sessions (`/exit`, `/clear` artifacts) in one shot:

```bash
node /path/to/session-manager/skills/sessions/scripts/session-picker.cjs --clean-auto
```

## Controls

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate the session list |
| `Enter` | Preview conversation messages |
| `Backspace` | Delete session (with confirmation) |
| `Tab` | Cycle filter: All > By Project > Small > Old |
| Type anything | Search by message or project |
| `Esc` | Clear search / go back / quit |
| `Ctrl+C` | Quit immediately |

## Filter Modes

Press `Tab` to cycle through filters:

- **All** — every session
- **By Project** — one project at a time (keep pressing Tab to cycle projects)
- **Small (< 100K)** — likely low-value or abandoned sessions
- **Old (> 30 days)** — sessions older than 30 days

## CLI Mode

When no TTY is available (e.g., inside Claude's Bash tool), the script supports subcommands:

```bash
# List all sessions as JSON
node session-picker.cjs --list

# Preview a session's messages
node session-picker.cjs --preview <session-id>

# Delete a session
node session-picker.cjs --delete <session-id>

# Delete all auto-generated sessions
node session-picker.cjs --clean-auto
```

## How It Works

- Scans `~/.claude/projects/` for `.jsonl` session files across all projects
- Extracts metadata: first user message, date, size, message count, project path
- Renders a full-screen alternate buffer TUI using ANSI escape codes
- Zero npm dependencies — vanilla Node.js only (~1000 lines, single file)
- Follows official Claude Code plugin conventions

## Development

```bash
# Run all tests (32 tests across 3 suites)
node test/test-scanner.cjs && node test/test-cli.cjs && node test/test-utils.cjs

# Test with fixture data
node skills/sessions/scripts/session-picker.cjs --list --projects-dir test/fixtures/projects

# Test with real sessions
node skills/sessions/scripts/session-picker.cjs --list
```

## Contributing

Issues and PRs welcome at https://github.com/GravesXX/session-manager

## License

MIT
