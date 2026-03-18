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
  const result = previewSession(id);
  if (!result.ok) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: result.error }) + '\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ mode: 'cli', id, content: result.content }) + '\n');
  process.exit(0);
}

function handleDelete(id) {
  const result = deleteSession(id);
  if (!result.ok) {
    process.stdout.write(JSON.stringify({ mode: 'cli', error: result.error }) + '\n');
    process.exit(1);
  }
  const remaining = listSessions().length;
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
};
