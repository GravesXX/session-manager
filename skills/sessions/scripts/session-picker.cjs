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
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Return a flat list of session objects found under PROJECTS_DIR.
 * Each session is a *.jsonl file; we expose id (filename sans extension),
 * project (parent directory name), and the full file path.
 *
 * @returns {{ id: string, project: string, filePath: string }[]}
 */
function listSessions() {
  const sessions = [];

  if (!fs.existsSync(PROJECTS_DIR)) {
    return sessions;
  }

  const projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const project of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, project);
    let entries;
    try {
      entries = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        sessions.push({
          id: entry.name.replace(/\.jsonl$/, ''),
          project,
          filePath: path.join(projectPath, entry.name),
        });
      }
    }
  }

  return sessions;
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
  const sessions = listSessions();
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

main();

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  listSessions,
  previewSession,
  deleteSession,
  hasTty,
};
