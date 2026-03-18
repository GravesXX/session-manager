'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function getFlag(flag) {
  const idx = argv.indexOf(flag);
  return idx !== -1;
}

function getFlagValue(flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1] !== undefined) {
    return argv[idx + 1];
  }
  return null;
}

const MODE_LIST    = getFlag('--list');
const MODE_PREVIEW = getFlag('--preview');
const MODE_DELETE  = getFlag('--delete');
const PREVIEW_ID   = getFlagValue('--preview');
const DELETE_ID    = getFlagValue('--delete');
const PROJECTS_DIR = getFlagValue('--projects-dir') || path.join(os.homedir(), '.claude', 'projects');

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

/**
 * Format a byte count into a human-readable string.
 * <1024 → "{n}B", <1048576 → "{n}K", >=1048576 → "{n.n}M"
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1048576) {
    return `${Math.floor(bytes / 1024)}K`;
  }
  return `${(bytes / 1048576).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// scanSessions
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable project name from a directory name of the form
 * "-Users-{username}-Some-Path" → "~/Some/Path".
 * Falls back to the raw directory name if the pattern doesn't match.
 *
 * @param {string} dirName
 * @returns {string}
 */
function projectFromDirName(dirName) {
  // Match -Users-<username>-... or -Users-<username> (no trailing path)
  const match = dirName.match(/^-Users-[^-]+(-(.+))?$/);
  if (match) {
    if (match[2]) {
      // Replace remaining dashes with slashes
      return '~/' + match[2].replace(/-/g, '/');
    }
    return '~';
  }
  return dirName;
}

/**
 * Shorten an absolute path by replacing the home directory prefix with "~".
 *
 * @param {string} cwdValue
 * @param {string} [homeDir] - Defaults to os.homedir()
 * @returns {string}
 */
function shortenCwd(cwdValue, homeDir) {
  const home = homeDir || os.homedir();
  if (cwdValue === home) return '~';
  if (cwdValue.startsWith(home + '/')) {
    return '~' + cwdValue.slice(home.length);
  }
  return cwdValue;
}

/**
 * Scan projectsDir for session files and return rich metadata for each.
 *
 * Skips:
 * - Files whose name starts with "agent-"
 * - Empty files (size === 0)
 *
 * @param {string} projectsDir
 * @param {object} [options]
 * @param {string} [options.homeDir] - Override os.homedir() for testing
 * @returns {{
 *   sessionId: string,
 *   project: string,
 *   modified: Date,
 *   size: number,
 *   messageCount: number,
 *   firstMessage: string,
 *   filePath: string
 * }[]}
 */
function scanSessions(projectsDir, options) {
  const homeDir = (options && options.homeDir) || os.homedir();
  const results = [];

  if (!fs.existsSync(projectsDir)) {
    return results;
  }

  const subdirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dirName of subdirs) {
    const dirPath = path.join(projectsDir, dirName);
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.jsonl')) continue;

      const sessionId = entry.name.replace(/\.jsonl$/, '');

      // Skip agent- prefixed files
      if (sessionId.startsWith('agent-')) continue;

      const filePath = path.join(dirPath, entry.name);

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (_) {
        continue;
      }

      // Skip empty files
      if (stat.size === 0) continue;

      const modified = stat.mtime;
      const size = stat.size;

      // Read and parse lines
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (_) {
        continue;
      }

      const lines = raw.split('\n').filter(l => l.trim() !== '');

      // Extract cwd from first entry that has one (scan up to 10 lines)
      let project = null;
      const scanLimit = Math.min(lines.length, 10);
      for (let i = 0; i < scanLimit; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.cwd) {
            project = shortenCwd(parsed.cwd, homeDir);
            break;
          }
        } catch (_) {
          // ignore malformed lines
        }
      }

      // Fall back to deriving project from directory name
      if (!project) {
        project = projectFromDirName(dirName);
      }

      // Count user messages and find first user message text
      let messageCount = 0;
      let firstMessage = '';

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'user' && parsed.message) {
            messageCount++;
            if (!firstMessage) {
              const content = parsed.message.content;
              if (typeof content === 'string') {
                firstMessage = content;
              } else if (Array.isArray(content)) {
                const textBlock = content.find(b => b.type === 'text' && typeof b.text === 'string');
                if (textBlock) {
                  firstMessage = textBlock.text;
                }
              }
              // Truncate to 80 chars
              if (firstMessage.length > 80) {
                firstMessage = firstMessage.slice(0, 80);
              }
            }
          }
        } catch (_) {
          // ignore malformed lines
        }
      }

      results.push({ sessionId, project, modified, size, messageCount, firstMessage, filePath });
    }
  }

  // Sort by modified descending (most recently modified first)
  results.sort((a, b) => b.modified - a.modified);

  return results;
}

// ---------------------------------------------------------------------------
// Legacy helper kept for backward compatibility with previewSession/deleteSession
// ---------------------------------------------------------------------------

/**
 * Return a flat list of session objects found under PROJECTS_DIR.
 * Wraps scanSessions for backward compat.
 *
 * @returns {{ id: string, project: string, filePath: string }[]}
 */
function listSessions() {
  return scanSessions(PROJECTS_DIR).map(s => ({
    id: s.sessionId,
    project: s.project,
    filePath: s.filePath,
  }));
}

/**
 * Return the raw content of a session file by id.
 *
 * @param {string} id
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
function previewSession(id) {
  const sessions = listSessions();
  const session = sessions.find(s => s.id === id);
  if (!session) {
    return { ok: false, error: `Session not found: ${id}` };
  }
  try {
    const content = fs.readFileSync(session.filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Delete a session file by id.
 *
 * @param {string} id
 * @returns {{ ok: true, filePath: string } | { ok: false, error: string }}
 */
function deleteSession(id) {
  const sessions = listSessions();
  const session = sessions.find(s => s.id === id);
  if (!session) {
    return { ok: false, error: `Session not found: ${id}` };
  }
  try {
    fs.unlinkSync(session.filePath);
    return { ok: true, filePath: session.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// TTY detection
// ---------------------------------------------------------------------------

/**
 * Attempt to open /dev/tty. Returns true if a TTY is available.
 *
 * @returns {boolean}
 */
function hasTty() {
  try {
    const fd = fs.openSync('/dev/tty', 'r+');
    fs.closeSync(fd);
    return true;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// parseMessages — CLI message parser (also exported for TUI preview)
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL session file and return the first 20 user/assistant messages
 * as structured objects with role, timestamp, and text fields.
 *
 * - type:"user"      → extract text from message.content (string or array)
 * - type:"assistant" → extract text blocks from message.content array,
 *                      skipping tool_use blocks
 * Uses the entry-level timestamp for both roles.
 *
 * @param {string} filePath
 * @returns {{ role: string, timestamp: string, text: string }[]}
 */
function parseMessages(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return [];
  }

  const lines = raw.split('\n').filter(l => l.trim() !== '');
  const messages = [];

  for (const line of lines) {
    if (messages.length >= 20) break;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        const block = content.find(b => b.type === 'text' && typeof b.text === 'string');
        if (block) text = block.text;
      }
      if (text) {
        messages.push({ role: 'user', timestamp: entry.timestamp || '', text });
      }
    } else if (entry.type === 'assistant' && entry.message) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter(b => b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text);
        const text = textParts.join('');
        if (text) {
          messages.push({ role: 'assistant', timestamp: entry.timestamp || '', text });
        }
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// CLI subcommand handlers
// ---------------------------------------------------------------------------

function handleList() {
  const raw = scanSessions(PROJECTS_DIR);
  const sessions = raw.map(s => ({
    id: s.sessionId,
    project: s.project,
    modified: s.modified.toISOString().slice(0, 10),
    size: formatSize(s.size),
    messageCount: s.messageCount,
    firstMessage: s.firstMessage,
  }));
  process.stdout.write(JSON.stringify({ mode: 'cli', sessions }) + '\n');
  process.exit(0);
}

function handlePreview(id) {
  // Validate that the session id resolves to a path within PROJECTS_DIR
  const resolvedProjects = path.resolve(PROJECTS_DIR);

  const sessions = scanSessions(PROJECTS_DIR);
  const session = sessions.find(s => s.sessionId === id);
  if (!session) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: `Session not found: ${id}` }) + '\n');
    process.exit(1);
  }

  const resolvedFile = path.resolve(session.filePath);
  if (!resolvedFile.startsWith(resolvedProjects + path.sep)) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: `Invalid session path: ${id}` }) + '\n');
    process.exit(1);
  }

  const messages = parseMessages(session.filePath);
  process.stdout.write(JSON.stringify({ mode: 'cli', sessionId: id, messages }) + '\n');
  process.exit(0);
}

function handleDelete(id) {
  // Validate that the session id resolves to a path within PROJECTS_DIR
  const resolvedProjects = path.resolve(PROJECTS_DIR);

  const sessions = scanSessions(PROJECTS_DIR);
  const session = sessions.find(s => s.sessionId === id);
  if (!session) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: `Session not found: ${id}` }) + '\n');
    process.exit(1);
  }

  const resolvedFile = path.resolve(session.filePath);
  if (!resolvedFile.startsWith(resolvedProjects + path.sep)) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: `Invalid session path: ${id}` }) + '\n');
    process.exit(1);
  }

  try {
    fs.unlinkSync(session.filePath);
  } catch (err) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: err.message }) + '\n');
    process.exit(1);
  }

  // Also remove the session subdirectory if it exists
  const projectDir = path.dirname(session.filePath);
  const subdirPath = path.join(projectDir, id);
  if (fs.existsSync(subdirPath)) {
    fs.rmSync(subdirPath, { recursive: true, force: true });
  }

  const remaining = scanSessions(PROJECTS_DIR).length;
  process.stdout.write(JSON.stringify({ mode: 'cli', deleted: id, remaining }) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Interactive mode (placeholder — TUI implementation comes in a later task)
// ---------------------------------------------------------------------------

function runInteractive() {
  // Placeholder: future tasks will implement the full blessed/ink TUI here.
  // For now we emit a no-op summary so callers can parse a valid JSON line.
  process.stdout.write(JSON.stringify({ mode: 'interactive', deleted: [], remaining: listSessions().length }) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main() {
  // CLI subcommand routing
  if (MODE_LIST) {
    return handleList();
  }

  if (MODE_PREVIEW) {
    if (!PREVIEW_ID) {
      process.stderr.write('Error: --preview requires a session id\n');
      process.exit(1);
    }
    return handlePreview(PREVIEW_ID);
  }

  if (MODE_DELETE) {
    if (!DELETE_ID) {
      process.stderr.write('Error: --delete requires a session id\n');
      process.exit(1);
    }
    return handleDelete(DELETE_ID);
  }

  // No subcommand — attempt interactive mode
  if (hasTty()) {
    return runInteractive();
  }

  // No TTY available — signal CLI fallback to the caller (Claude)
  process.stdout.write(JSON.stringify({ mode: 'cli', reason: 'no-tty' }) + '\n');
  process.exit(0);
}

// Only run main() when executed directly, not when required as a module
if (require.main === module) {
  main();
}

// ===========================================================================
// TUI RENDERER — Task 4
// All functions below are NEW. No existing functions were modified.
// ===========================================================================

// ---------------------------------------------------------------------------
// Terminal control helpers
// ---------------------------------------------------------------------------

/**
 * Switch to the alternate screen buffer and hide the cursor.
 * @param {import('tty').WriteStream} tty
 */
function enterAltScreen(tty) {
  tty.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
}

/**
 * Restore the primary screen buffer and show the cursor.
 * @param {import('tty').WriteStream} tty
 */
function exitAltScreen(tty) {
  tty.write('\x1b[?1049l\x1b[?25h');
}

/**
 * Move the cursor to the given 1-based row and column.
 * @param {import('tty').WriteStream} tty
 * @param {number} row
 * @param {number} col
 */
function moveTo(tty, row, col) {
  tty.write(`\x1b[${row};${col}H`);
}

/**
 * Erase from the cursor to the end of the current line.
 * @param {import('tty').WriteStream} tty
 */
function clearLine(tty) {
  tty.write('\x1b[K');
}

/**
 * Wrap text in ANSI SGR codes and reset afterwards.
 * @param {string} text
 * @param {string} codes  e.g. "1;7" for bold+reverse
 * @returns {string}
 */
function style(text, codes) {
  return `\x1b[${codes}m${text}\x1b[0m`;
}

/**
 * Truncate text to maxWidth characters, appending '…' if truncated.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
function truncate(text, maxWidth) {
  if (text.length > maxWidth) {
    return text.slice(0, maxWidth - 1) + '\u2026';
  }
  return text;
}

// ---------------------------------------------------------------------------
// renderList
// ---------------------------------------------------------------------------

/**
 * Render the full-screen session list.
 *
 * @param {import('tty').WriteStream} tty
 * @param {{
 *   sessions: object[],
 *   filtered: object[],
 *   cursor: number,
 *   scrollOffset: number,
 *   filterLabel: string,
 *   termWidth: number,
 *   termHeight: number
 * }} state
 */
function renderList(tty, state) {
  const { filtered, cursor, scrollOffset, filterLabel, termWidth, termHeight } = state;

  // Clear screen
  tty.write('\x1b[H\x1b[2J');

  const W = termWidth;
  const H = termHeight;

  // Line 1 — header
  const inSearch = filterLabel.includes('Search:');
  const rightHint = inSearch ? '' : 'Type to search...';
  const leftPart = truncate(filterLabel, W);
  moveTo(tty, 1, 1);
  clearLine(tty);
  if (rightHint) {
    const padding = Math.max(0, W - leftPart.length - rightHint.length);
    tty.write(leftPart + ' '.repeat(padding) + style(rightHint, '2'));
  } else {
    tty.write(leftPart);
  }

  // Line 2 — top divider
  moveTo(tty, 2, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // List area: lines 3 to H-2
  const viewportSize = Math.floor((H - 4) / 2);
  const visibleSessions = filtered.slice(scrollOffset, scrollOffset + viewportSize);

  for (let i = 0; i < viewportSize; i++) {
    const session = visibleSessions[i];
    const metaRow = 3 + i * 2;
    const msgRow  = 3 + i * 2 + 1;

    moveTo(tty, metaRow, 1);
    clearLine(tty);
    moveTo(tty, msgRow, 1);
    clearLine(tty);

    if (!session) continue;

    const isActive = (scrollOffset + i) === cursor;

    // Format date as MM-DD
    const d = session.modified instanceof Date ? session.modified : new Date(session.modified);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${mm}-${dd}`;

    const sizeStr = formatSize(session.size);
    const msgCountStr = `${session.messageCount}msg`;

    // Metadata line: prefix + date + size + count + project(cyan)
    const prefix = isActive ? '\u25ba ' : '  ';
    const metaBase = `${prefix}${dateStr}  ${sizeStr}  ${msgCountStr}  `;
    const projectAvail = Math.max(1, W - metaBase.length);
    const projectTrunc = truncate(session.project, projectAvail);
    const metaLine = `${metaBase}${style(projectTrunc, '36')}`;

    moveTo(tty, metaRow, 1);
    clearLine(tty);
    if (isActive) {
      tty.write(style(metaLine, '1;7'));
    } else {
      tty.write(metaLine);
    }

    // Message line
    const msgText = truncate('  ' + (session.firstMessage || ''), W);
    moveTo(tty, msgRow, 1);
    clearLine(tty);
    tty.write(style(msgText, '2'));
  }

  // Line H-1 — bottom divider
  moveTo(tty, H - 1, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // Line H — footer
  moveTo(tty, H, 1);
  clearLine(tty);
  tty.write('\u2191\u2193 Navigate  \u23ce Preview  \u232b Delete  Tab Filter  Esc Quit');
}

// ---------------------------------------------------------------------------
// renderPreview
// ---------------------------------------------------------------------------

/**
 * Render the full-screen message preview for a session.
 *
 * @param {import('tty').WriteStream} tty
 * @param {{
 *   filtered: object[],
 *   cursor: number,
 *   previewScroll: number,
 *   termWidth: number,
 *   termHeight: number
 * }} state
 * @param {{ role: string, timestamp: string, text: string }[]} messages
 */
function renderPreview(tty, state, messages) {
  const { filtered, cursor, previewScroll, termWidth, termHeight } = state;
  const W = termWidth;
  const H = termHeight;

  const session = filtered[cursor] || {};
  const firstMsg = session.firstMessage || '';

  tty.write('\x1b[H\x1b[2J');

  // Line 1 — header
  const rightHint = 'Esc to go back';
  const leftLabel = truncate('Preview: ' + firstMsg, W - rightHint.length - 1);
  const padding = Math.max(0, W - leftLabel.length - rightHint.length);
  moveTo(tty, 1, 1);
  clearLine(tty);
  tty.write(leftLabel + ' '.repeat(padding) + rightHint);

  // Line 2 — divider
  moveTo(tty, 2, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // Build renderable lines from messages
  const renderLines = [];
  for (const msg of messages) {
    // Timestamp: extract MM-DD HH:MM from ISO string
    let ts = '';
    if (msg.timestamp) {
      // e.g. "2024-03-18T14:30:00.000Z" → "03-18 14:30"
      const isoMatch = msg.timestamp.match(/(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (isoMatch) {
        ts = `${isoMatch[1]}-${isoMatch[2]} ${isoMatch[3]}:${isoMatch[4]}`;
      } else {
        ts = msg.timestamp.slice(0, 16);
      }
    }

    if (msg.role === 'user') {
      renderLines.push(style(`You (${ts}):`, '1'));
    } else {
      renderLines.push(style(`Assistant (${ts}):`, '36'));
    }

    // Split text into terminal-width chunks
    const chunkW = W - 4;
    const textLines = msg.text.split('\n');
    for (const tl of textLines) {
      if (tl.length === 0) {
        renderLines.push('');
        continue;
      }
      let remaining = tl;
      while (remaining.length > 0) {
        renderLines.push('  ' + truncate(remaining, chunkW));
        remaining = remaining.slice(chunkW);
      }
    }
    renderLines.push(''); // blank separator between messages
  }

  // List area: lines 3 to H-2
  const listH = H - 4;
  const scroll = previewScroll || 0;

  for (let i = 0; i < listH; i++) {
    const lineIdx = scroll + i;
    const displayRow = 3 + i;
    moveTo(tty, displayRow, 1);
    clearLine(tty);
    if (lineIdx < renderLines.length) {
      tty.write(truncate(renderLines[lineIdx], W));
    }
  }

  // Line H-1 — divider
  moveTo(tty, H - 1, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // Line H — footer
  moveTo(tty, H, 1);
  clearLine(tty);
  tty.write('\u2191\u2193 Scroll  Esc Back');
}

// ---------------------------------------------------------------------------
// renderDeleteConfirm
// ---------------------------------------------------------------------------

/**
 * Render a centered delete-confirmation dialog on top of the current screen.
 *
 * @param {import('tty').WriteStream} tty
 * @param {{ termWidth: number, termHeight: number }} state
 * @param {{ firstMessage: string, modified: Date, size: number, messageCount: number }} session
 */
function renderDeleteConfirm(tty, state, session) {
  const { termWidth, termHeight } = state;
  const BOX_W = 50;
  const BOX_H = 7;
  const startRow = Math.floor((termHeight - BOX_H) / 2);
  const startCol = Math.floor((termWidth - BOX_W) / 2);

  const d = session.modified instanceof Date ? session.modified : new Date(session.modified);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateStr = `${mm}-${dd}`;
  const sizeStr = formatSize(session.size);
  const countStr = `${session.messageCount} messages`;

  // Inner width = BOX_W - 2 (the two │ border chars)
  const innerW = BOX_W - 2;

  /**
   * Center a plain string within innerW, padding with spaces.
   * @param {string} text
   * @returns {string}
   */
  function centerText(text) {
    const len = text.length;
    const leftPad = Math.floor((innerW - len) / 2);
    const rightPad = innerW - len - leftPad;
    return ' '.repeat(Math.max(0, leftPad)) + text + ' '.repeat(Math.max(0, rightPad));
  }

  // 6 content lines (spec: Line 1-6 inside the box)
  const contentLines = [
    style(centerText('Delete this session?'), '1'),
    centerText(''),
    style(centerText(truncate(`"${session.firstMessage}"`, innerW)), '2'),
    centerText(`${dateStr}  ${sizeStr}  ${countStr}`),
    centerText(''),
    centerText('[Y] Yes, delete    [N] No, cancel'),
  ];

  // Top border
  moveTo(tty, startRow, startCol);
  tty.write('\u250c' + '\u2500'.repeat(innerW) + '\u2510');

  // Content rows
  for (let i = 0; i < contentLines.length; i++) {
    moveTo(tty, startRow + 1 + i, startCol);
    tty.write('\u2502' + contentLines[i] + '\u2502');
  }

  // Bottom border
  moveTo(tty, startRow + 1 + contentLines.length, startCol);
  tty.write('\u2514' + '\u2500'.repeat(innerW) + '\u2518');
}

// ---------------------------------------------------------------------------
// renderEmpty
// ---------------------------------------------------------------------------

/**
 * Render a centered "No sessions found" message for an empty session list.
 *
 * @param {import('tty').WriteStream} tty
 * @param {{ termWidth: number, termHeight: number }} state
 */
function renderEmpty(tty, state) {
  const { termWidth, termHeight } = state;

  tty.write('\x1b[H\x1b[2J');

  const msg1 = 'No sessions found';
  const msg2 = 'Esc to quit';

  const row1 = Math.floor(termHeight / 2);
  const row2 = row1 + 1;
  const col1 = Math.floor((termWidth - msg1.length) / 2) + 1;
  const col2 = Math.floor((termWidth - msg2.length) / 2) + 1;

  moveTo(tty, row1, col1);
  clearLine(tty);
  tty.write(msg1);

  moveTo(tty, row2, col2);
  clearLine(tty);
  tty.write(style(msg2, '2'));
}

// ---------------------------------------------------------------------------
// renderNoMatches
// ---------------------------------------------------------------------------

/**
 * Render the normal header/footer but a centered "No matches" in the list area.
 *
 * @param {import('tty').WriteStream} tty
 * @param {{
 *   filterLabel: string,
 *   termWidth: number,
 *   termHeight: number
 * }} state
 */
function renderNoMatches(tty, state) {
  const { filterLabel, termWidth, termHeight } = state;
  const W = termWidth;
  const H = termHeight;

  tty.write('\x1b[H\x1b[2J');

  // Line 1 — header (same logic as renderList)
  const inSearch = filterLabel.includes('Search:');
  const rightHint = inSearch ? '' : 'Type to search...';
  const leftPart = truncate(filterLabel, W);
  moveTo(tty, 1, 1);
  clearLine(tty);
  if (rightHint) {
    const padding = Math.max(0, W - leftPart.length - rightHint.length);
    tty.write(leftPart + ' '.repeat(padding) + style(rightHint, '2'));
  } else {
    tty.write(leftPart);
  }

  // Line 2 — top divider
  moveTo(tty, 2, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // Center "No matches" in list area (lines 3 to H-2)
  const listAreaStart = 3;
  const listAreaEnd = H - 2;
  const listAreaMid = Math.floor((listAreaStart + listAreaEnd) / 2);
  const noMatchText = 'No matches';
  const noMatchCol = Math.floor((W - noMatchText.length) / 2) + 1;

  moveTo(tty, listAreaMid, noMatchCol);
  tty.write(style(noMatchText, '2'));

  // Line H-1 — bottom divider
  moveTo(tty, H - 1, 1);
  clearLine(tty);
  tty.write('\u2500'.repeat(W));

  // Line H — footer
  moveTo(tty, H, 1);
  clearLine(tty);
  tty.write('\u2191\u2193 Navigate  \u23ce Preview  \u232b Delete  Tab Filter  Esc Quit');
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  scanSessions,
  formatSize,
  listSessions,
  previewSession,
  deleteSession,
  hasTty,
  parseMessages,
  // TUI renderer helpers (Task 4)
  enterAltScreen,
  exitAltScreen,
  moveTo,
  clearLine,
  style,
  truncate,
  renderList,
  renderPreview,
  renderDeleteConfirm,
  renderEmpty,
  renderNoMatches,
};
