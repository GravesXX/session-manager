# Session Manager Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that provides `/sessions` — an interactive terminal TUI for browsing, previewing, and deleting Claude Code conversation sessions.

**Architecture:** Single vanilla Node.js script (`session-picker.cjs`) with zero npm dependencies, launched by a SKILL.md slash command. Dual-mode: interactive TUI via `/dev/tty` when available, CLI fallback via argv subcommands when not. Plugin follows official Claude Code plugin conventions.

**Tech Stack:** Node.js (vanilla, CJS), ANSI escape codes, Claude Code plugin system (`.claude-plugin/plugin.json` + `skills/`)

**Spec:** `docs/superpowers/specs/2026-03-18-session-manager-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `.claude-plugin/plugin.json` | Plugin metadata (name, description, version, author) |
| `skills/sessions/SKILL.md` | Slash command definition — instructs Claude how to invoke the script and handle output |
| `skills/sessions/scripts/session-picker.cjs` | The entire TUI + CLI logic (scanner, renderer, input handler, actions) |
| `test/test-scanner.cjs` | Tests for session scanning and metadata extraction |
| `test/test-cli.cjs` | Tests for CLI mode (--list, --preview, --delete) |
| `test/test-utils.cjs` | Tests for pure utility functions (applyFilter, formatSize) |
| `test/fixtures/` | Mock `.jsonl` session files for testing |
| `.gitignore` | Ignore node_modules/, OS artifacts |

---

### Task 1: Plugin Scaffold

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `skills/sessions/SKILL.md`
- Create: `skills/sessions/scripts/session-picker.cjs` (empty entry point)

- [ ] **Step 1: Create plugin.json**

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

- [ ] **Step 2: Create SKILL.md**

Write the skill definition with frontmatter (`name: sessions`, `description`, `allowed-tools: [Bash, Read]`) and the full instruction body that tells Claude:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs"` via Bash
2. If output contains `"mode":"cli"`, switch to CLI mediation: use `--list`, `--preview <id>`, `--delete <id>`
3. If interactive mode ran, parse JSON summary and report results
4. Handle the `{"mode":"cli","reason":"no-tty"}` fallback signal
5. Include output-contract reporting phrases: if `deleted` is empty report "Session browser closed. No changes made.", if `deleted` has entries report "Deleted {n} session(s). {remaining} sessions remaining."

- [ ] **Step 3: Create session-picker.cjs entry point**

Minimal script that:
- Parses `process.argv` for `--list`, `--preview`, `--delete` flags
- Attempts to open `/dev/tty` — if success, log placeholder "interactive mode"; if fail, output `{"mode":"cli","reason":"no-tty"}`
- Has clean `process.exit(0)` path

- [ ] **Step 4: Verify plugin loads**

Run: `node skills/sessions/scripts/session-picker.cjs --list`
Expected: `{"mode":"cli","sessions":[]}`

- [ ] **Step 5: Create .gitignore**

```
node_modules/
.DS_Store
*.swp
```

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ skills/ .gitignore skills/sessions/scripts/session-picker.cjs
git commit -m "feat: scaffold plugin with SKILL.md and entry point"
```

---

### Task 2: Scanner Module

**Files:**
- Create: `test/fixtures/` (mock session files)
- Create: `test/test-scanner.cjs`
- Modify: `skills/sessions/scripts/session-picker.cjs` (add scanner)

- [ ] **Step 1: Create test fixtures**

Create `test/fixtures/projects/` with mock structure:
- `test/fixtures/projects/-Users-testuser-Desktop/sess-001.jsonl` — normal session with 3 user messages, `cwd` on first line
- `test/fixtures/projects/-Users-testuser-Desktop/sess-002.jsonl` — session where first line is `file-history-snapshot` (no `cwd`), `cwd` on line 3
- `test/fixtures/projects/-Users-testuser-Desktop/agent-sub1.jsonl` — subagent file (should be skipped)
- `test/fixtures/projects/-Users-testuser/sess-003.jsonl` — session with `message.content` as string (not array)
- `test/fixtures/projects/-Users-testuser/sess-empty.jsonl` — empty file (should be skipped)

Each `.jsonl` file should contain realistic entries with proper `type`, `message`, `timestamp`, `cwd`, `sessionId` fields matching the real format discovered during exploration.

- [ ] **Step 2: Write scanner tests**

`test/test-scanner.cjs` using Node.js built-in `assert`:

```javascript
const assert = require('assert');
// Import scanSessions from session-picker.cjs (export via module.exports for testing)

// Test 1: Finds correct number of sessions (skips agent- prefix, skips empty)
// Expected: 3 sessions found (sess-001, sess-002, sess-003)

// Test 2: Extracts project from cwd field
// Expected: sess-001 project === "~/Desktop"

// Test 3: Falls back to directory name when cwd not in first 10 lines
// Expected: sess-002 project derived from directory name

// Test 4: Handles message.content as string
// Expected: sess-003 firstMessage extracted correctly

// Test 5: Handles message.content as array of content blocks
// Expected: sess-001 firstMessage extracted from first text block

// Test 6: Results sorted by modified descending
// Expected: most recently modified file first

// Test 7: messageCount counts only user-type entries
// Expected: sess-001 messageCount === 3
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node test/test-scanner.cjs`
Expected: FAIL — `scanSessions` not yet implemented

- [ ] **Step 4: Implement scanner**

In `session-picker.cjs`, implement `scanSessions(projectsDir)`:
- `fs.readdirSync` the projects dir for subdirectories
- For each subdir, `fs.readdirSync` for `*.jsonl` files
- Skip files starting with `agent-`
- For each file: `fs.statSync` for size/mtime, `fs.readFileSync` split by `\n`
- Extract `cwd` from first entry with `cwd` field (up to 10 lines), fallback to directory name parsing
- Count `"type":"user"` lines, extract first user message text (string or array content)
- Sort by `modified` descending
- Export via `module.exports.scanSessions` for testing (alongside main entry)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node test/test-scanner.cjs`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add test/ skills/sessions/scripts/session-picker.cjs
git commit -m "feat: implement session scanner with metadata extraction"
```

---

### Task 3: CLI Mode

**Files:**
- Create: `test/test-cli.cjs`
- Modify: `skills/sessions/scripts/session-picker.cjs` (add CLI handlers)

- [ ] **Step 1: Write CLI tests**

`test/test-cli.cjs` — tests that spawn the script as a child process and verify stdout:

```javascript
const { execSync } = require('child_process');
const assert = require('assert');

const SCRIPT = 'skills/sessions/scripts/session-picker.cjs';
const FIXTURES = 'test/fixtures/projects';

// Test 1: --list outputs valid JSON with correct session count
// Run: node session-picker.cjs --list --projects-dir test/fixtures/projects
// Expected: JSON with mode:"cli", sessions array length 3

// Test 2: --preview <id> outputs messages
// Expected: JSON with mode:"cli", messages array with role/timestamp/text

// Test 3: --preview with invalid ID outputs error
// Expected: JSON with mode:"cli", error field

// Test 4: --delete <id> removes file and outputs confirmation
// Create temp copy: fs.cpSync('test/fixtures/projects', tmpDir, { recursive: true })
// using os.tmpdir() + fs.mkdtempSync for isolation
// Expected: JSON with mode:"cli", deleted field, remaining count

// Test 5: --delete with invalid ID outputs error
// Expected: JSON with mode:"cli", error field

// Test 6: No args and no TTY outputs no-tty fallback
// Expected: JSON with mode:"cli", reason:"no-tty"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-cli.cjs`
Expected: FAIL — CLI handlers not yet implemented

- [ ] **Step 3: Implement CLI mode**

In `session-picker.cjs`, add argument parsing and CLI handlers:
- Parse `process.argv` for `--list`, `--preview <id>`, `--delete <id>`, `--projects-dir <path>` (for testing)
- `--projects-dir` defaults to `path.join(os.homedir(), '.claude', 'projects')` (use `os.homedir()` for portable `~` expansion)
- `--list`: call `scanSessions()`, output JSON
- `--preview <id>`: find session file, parse messages (handle string/array content, skip tool_use), output first 20 user/assistant messages as JSON
- `--delete <id>`: validate session ID resolves to a path within the projects directory (prevent path traversal), find session file, `fs.unlinkSync`, remove session subdirectory if exists (`fs.rmSync({ recursive: true, force: true })`), re-scan, output confirmation JSON
- `--preview <id>`: validate session ID the same way (path must resolve within projects dir)
- No args + no TTY: output `{"mode":"cli","reason":"no-tty"}`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-cli.cjs`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/test-cli.cjs skills/sessions/scripts/session-picker.cjs
git commit -m "feat: implement CLI mode with --list, --preview, --delete"
```

---

### Task 4: Interactive TUI — Renderer

**Files:**
- Modify: `skills/sessions/scripts/session-picker.cjs` (add renderer module)

- [ ] **Step 1: Implement terminal control helpers**

Add functions at the top of session-picker.cjs:
- `enterAltScreen(tty)` — writes `\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J` to tty fd
- `exitAltScreen(tty)` — writes `\x1b[?1049l\x1b[?25h` to tty fd
- `moveTo(tty, row, col)` — writes `\x1b[{row};{col}H`
- `clearLine(tty)` — writes `\x1b[K`
- `style(text, codes)` — wraps text in ANSI codes, e.g. `style("hello", "1;36")` → bold cyan
- `truncate(text, maxWidth)` — truncates with ellipsis if too long

- [ ] **Step 2: Implement renderList(tty, state)**

`state` object contains: `sessions`, `cursor`, `scrollOffset`, `filterMode`, `filterIndex`, `searchText`, `termWidth`, `termHeight`

Renders:
- Line 1: header with session count + filter/search indicator
- Line 2: `─` divider (full width)
- Lines 3 to H-2: session list (2 lines each), with `►` and reverse on active row
- Line H-1: `─` divider
- Line H: `↑↓ Navigate  ⏎ Preview  ⌫ Delete  Tab Filter  Esc Quit`

Each session: metadata line (date MM-DD, size formatted, msg count, project in cyan) + message line (dimmed, truncated)

- [ ] **Step 3: Implement renderPreview(tty, state, messages)**

Full-screen preview mode:
- Line 1: `Preview: {firstMessage}` + `Esc to go back` right-aligned
- Line 2: divider
- Lines 3 to H-2: scrollable view of first 20 user/assistant messages with `You (MM-DD HH:MM):` and `Assistant (MM-DD HH:MM):` labels, text wrapped/truncated
- Line H-1: divider
- Line H: `↑↓ Scroll  Esc Back`

- [ ] **Step 4: Implement renderDeleteConfirm(tty, state, session)**

Centered dialog box overlay:
- Box width: 50 chars, height: 7 lines
- Content: "Delete this session?", first message, metadata, `[Y] Yes  [N] No`
- Rendered at center of screen using `moveTo`

- [ ] **Step 5: Manual test with dummy data**

Temporarily add to main():
```javascript
const tty = fs.openSync('/dev/tty', 'r+');
const ttyStream = new (require('tty').WriteStream)(tty);
enterAltScreen(ttyStream);
renderList(ttyStream, { sessions: scanSessions('test/fixtures/projects'), cursor: 0, ... });
setTimeout(() => { exitAltScreen(ttyStream); process.exit(0); }, 3000);
```

Run: `node skills/sessions/scripts/session-picker.cjs`
Expected: See the TUI for 3 seconds, then exit cleanly

- [ ] **Step 6: Commit**

```bash
git add skills/sessions/scripts/session-picker.cjs
git commit -m "feat: implement TUI renderer with list, preview, and delete dialog"
```

---

### Task 5: Interactive TUI — Input Handler

**Files:**
- Modify: `skills/sessions/scripts/session-picker.cjs` (add input handler + main loop)

- [ ] **Step 1: Implement TTY input reader**

Open `/dev/tty` for reading. Set raw mode. Read bytes and parse:
- Escape sequence disambiguation: on `\x1b`, buffer for 50ms. If `[A`/`[B`/`[C`/`[D` follows → arrow key. If nothing → standalone Esc.
- Map `\r` → Enter, `\x7f` → Backspace, `\t` → Tab, `\x03` → Ctrl+C
- Printable chars: bytes 0x20–0x7E

- [ ] **Step 2: Implement state machine**

App modes: `list`, `preview`, `confirm`

```
list mode:
  ↑↓ → adjust cursor (clamp to 0..sessions.length-1, adjust scrollOffset)
  Enter → parse messages for highlighted session, switch to preview mode
  Backspace (search empty) → switch to confirm mode
  Backspace (search non-empty) → pop last char from searchText, refilter, redraw
  Tab → advance filterMode/filterIndex, refilter, reset cursor to 0, redraw
  Esc (search active) → clear searchText, refilter, redraw
  Esc (no search) → exit
  Printable → append to searchText, refilter, reset cursor to 0, redraw
  Ctrl+C → exit

preview mode:
  ↑↓ → scroll preview
  Esc → switch to list mode, redraw

confirm mode:
  y → delete session, remove from sessions array, switch to list mode, redraw
  n / Esc → switch to list mode, redraw
```

- [ ] **Step 3: Implement filter + search logic**

`applyFilter(sessions, filterMode, filterIndex, searchText)`:
- If searchText non-empty: case-insensitive substring match on `firstMessage` and `project`
- Then apply filter mode: All (no-op), Project (match project), Small (<100KB), Old (>30 days)
- Return filtered array

Build `filterModes` array: `["all", ...uniqueProjects, "small", "old"]`

- [ ] **Step 4: Implement SIGWINCH handler**

```javascript
process.on('SIGWINCH', () => {
  state.termWidth = ttyStream.columns;
  state.termHeight = ttyStream.rows;
  render(ttyStream, state);
});
```

- [ ] **Step 5: Wire up main() for interactive mode**

Main function:
1. Try `fs.openSync('/dev/tty', 'r+')` — if fails, run CLI mode
2. Create ReadStream for input, WriteStream for output from tty fd
3. Try `inputStream.setRawMode(true)` — if fails, close tty, run CLI mode
4. `enterAltScreen(outputStream)`
5. Scan sessions, build initial state, render
6. Start input loop
7. On exit: `exitAltScreen(outputStream)`, close tty, print JSON summary to `process.stdout`:
   ```json
   {"action":"exit","deleted":["48ea4f1c-..."],"remaining":33}
   ```

- [ ] **Step 6: Manual integration test**

Run: `node skills/sessions/scripts/session-picker.cjs`
Expected: Full interactive TUI with working navigation, search, filter, preview, delete, and clean exit

- [ ] **Step 7: Commit**

```bash
git add skills/sessions/scripts/session-picker.cjs
git commit -m "feat: implement interactive TUI input handler and main loop"
```

---

### Task 6: Edge Cases & Polish

**Files:**
- Modify: `skills/sessions/scripts/session-picker.cjs`

- [ ] **Step 1: Handle empty states**

- No sessions: render centered "No sessions found" message
- Empty search results: render "No matches" in list area
- Missing `~/.claude/projects/` directory: treat as empty, no error

- [ ] **Step 2: Handle errors gracefully**

- Delete permission error: catch, show inline error in confirm dialog, don't crash
- Malformed JSONL: already handled by try/catch in scanner (verify)
- Session file deleted externally between scan and preview/delete: catch ENOENT, show "Session no longer exists", remove from list

- [ ] **Step 3: Size formatting**

Implement `formatSize(bytes)`:
- `< 1024` → `{n}B`
- `< 1024*1024` → `{n}K`
- `>= 1024*1024` → `{n.n}M`

Export `formatSize` and `applyFilter` via `module.exports` for testing.

- [ ] **Step 4: Write utility tests**

Create `test/test-utils.cjs`:

```javascript
const assert = require('assert');
// Import formatSize, applyFilter from session-picker.cjs

// formatSize tests:
// 512 → "512B", 1024 → "1K", 1023 → "1023B"
// 1536 → "2K", 1048576 → "1.0M", 2621440 → "2.5M"

// applyFilter tests:
// All mode returns all sessions
// Project mode filters to matching project only
// Small mode returns only sessions < 100KB
// Old mode returns only sessions > 30 days old
// Search filters by firstMessage substring (case-insensitive)
// Search filters by project substring
// Combined search + filter mode works correctly
```

Run: `node test/test-utils.cjs`
Expected: All tests PASS

- [ ] **Step 5: Manual test all edge cases**

1. Run with no sessions (empty fixtures dir)
2. Run with a single session
3. Search for something with no matches, clear search
4. Delete last remaining session
5. Resize terminal while TUI is running
6. Press Ctrl+C at various states

- [ ] **Step 6: Commit**

```bash
git add skills/sessions/scripts/session-picker.cjs
git commit -m "feat: add edge case handling and polish"
```

---

### Task 7: README and Final Integration

**Files:**
- Create: `README.md`
- Verify: all files in correct locations

- [ ] **Step 1: Write README.md**

Include:
- Project name and one-line description
- Screenshot placeholder (TODO)
- Installation: `claude plugin add /path/to/session-manager` (local) or marketplace submission link
- Usage: type `/sessions` in Claude Code
- Controls table (5 keys)
- How it works (brief)
- CLI fallback mode documentation
- Contributing section with link to GitHub issues
- License (MIT)
- Reference to target issue [anthropics/claude-code#16901](https://github.com/anthropics/claude-code/issues/16901)

- [ ] **Step 2: Create LICENSE**

MIT license with "moomoo" as copyright holder, year 2026.

- [ ] **Step 3: Verify plugin structure**

```bash
ls -la .claude-plugin/plugin.json
ls -la skills/sessions/SKILL.md
ls -la skills/sessions/scripts/session-picker.cjs
node skills/sessions/scripts/session-picker.cjs --list --projects-dir test/fixtures/projects
```

Expected: All files exist, `--list` outputs valid JSON with test sessions.

- [ ] **Step 4: Run full test suite**

```bash
node test/test-scanner.cjs && node test/test-cli.cjs && node test/test-utils.cjs
```

Expected: All tests pass.

- [ ] **Step 5: Test with real sessions**

```bash
node skills/sessions/scripts/session-picker.cjs --list
```

Expected: Lists actual Claude Code sessions from `~/.claude/projects/`.

- [ ] **Step 6: Commit and push**

```bash
git add README.md LICENSE
git commit -m "docs: add README and LICENSE"
git push origin main
```

---

## Task Dependency Graph

```
Task 1 (Scaffold) → Task 2 (Scanner) → Task 3 (CLI Mode) ──┐
                                      → Task 4 (Renderer) ──┼→ Task 5 (Input Handler) → Task 6 (Polish) → Task 7 (README)
```

Tasks 3 and 4 can run in parallel after Task 2. Task 5 depends on **both** Task 3 and Task 4 (main() handles both interactive and CLI paths).
