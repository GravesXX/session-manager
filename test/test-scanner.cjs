'use strict';

const assert = require('assert');
const path = require('path');
const { scanSessions, formatSize } = require('../skills/sessions/scripts/session-picker.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'projects');

// ---------------------------------------------------------------------------
// Helper: run all tests and report
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

console.log('\nScanner tests\n');

// Fixture cwd values use /Users/testuser — pass this as homeDir so ~ shortening works
const FIXTURE_HOME = '/Users/testuser';
const SCAN_OPTS = { homeDir: FIXTURE_HOME };

let sessions;

test('scanSessions returns sessions array', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  assert.ok(Array.isArray(sessions), 'result should be an array');
});

// Test 1: Finds correct number of sessions (skips agent- prefix, skips empty)
test('finds correct number of sessions — skips agent- prefix and empty files', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  assert.strictEqual(sessions.length, 3, `expected 3 sessions, got ${sessions.length}`);
});

// Test 2: Extracts project from cwd field
test('extracts project from cwd field — sess-001 project is ~/Desktop', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s001 = sessions.find(s => s.sessionId === 'sess-001');
  assert.ok(s001, 'sess-001 should be present');
  assert.strictEqual(s001.project, '~/Desktop', `expected ~/Desktop, got ${s001.project}`);
});

// Test 3: Falls back when cwd not in first 10 lines (sess-002 has cwd on line 3 — should still work)
test('falls back gracefully when cwd delayed — sess-002 has reasonable project name', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s002 = sessions.find(s => s.sessionId === 'sess-002');
  assert.ok(s002, 'sess-002 should be present');
  assert.ok(s002.project, `sess-002 project should be a non-empty string, got: ${s002.project}`);
  // cwd is on line 3 (index 2), within first 10 — should resolve to ~/Desktop
  assert.ok(
    s002.project === '~/Desktop' || s002.project.includes('testuser') || s002.project.includes('Desktop'),
    `expected a reasonable project name, got: ${s002.project}`
  );
});

// Test 4: Handles message.content as string
test('handles message.content as plain string — sess-003 firstMessage correct', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s003 = sessions.find(s => s.sessionId === 'sess-003');
  assert.ok(s003, 'sess-003 should be present');
  assert.strictEqual(s003.firstMessage, 'Help me with Python');
});

// Test 5: Handles message.content as array
test('handles message.content as array — sess-001 firstMessage correct', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s001 = sessions.find(s => s.sessionId === 'sess-001');
  assert.ok(s001, 'sess-001 should be present');
  assert.strictEqual(s001.firstMessage, 'Build the authentication system');
});

// Test 6: Results sorted by modified descending
test('results sorted by modified descending', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  for (let i = 0; i < sessions.length - 1; i++) {
    assert.ok(
      sessions[i].modified >= sessions[i + 1].modified,
      `session at index ${i} (${sessions[i].sessionId}, ${sessions[i].modified.toISOString()}) ` +
      `should be >= index ${i + 1} (${sessions[i + 1].sessionId}, ${sessions[i + 1].modified.toISOString()})`
    );
  }
});

// Test 7: messageCount counts only user-type entries
test('messageCount counts only user-type entries — sess-001 has 3', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s001 = sessions.find(s => s.sessionId === 'sess-001');
  assert.ok(s001, 'sess-001 should be present');
  assert.strictEqual(s001.messageCount, 3, `expected messageCount 3, got ${s001.messageCount}`);
});

// Test 8: customTitle extracted from custom-title entries
test('extracts customTitle from /rename — sess-001 has "auth-system"', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s001 = sessions.find(s => s.sessionId === 'sess-001');
  assert.ok(s001, 'sess-001 should be present');
  assert.strictEqual(s001.customTitle, 'auth-system', `expected customTitle "auth-system", got "${s001.customTitle}"`);
});

// Test 9: sessions without custom-title have empty customTitle
test('sessions without /rename have empty customTitle', () => {
  sessions = scanSessions(FIXTURES_DIR, SCAN_OPTS);
  const s003 = sessions.find(s => s.sessionId === 'sess-003');
  assert.ok(s003, 'sess-003 should be present');
  assert.strictEqual(s003.customTitle, '', `expected empty customTitle, got "${s003.customTitle}"`);
});

// ---------------------------------------------------------------------------
// formatSize tests
// ---------------------------------------------------------------------------

console.log('\nformatSize tests\n');

test('formatSize: bytes < 1024 → "NB"', () => {
  assert.strictEqual(formatSize(512), '512B');
  assert.strictEqual(formatSize(0), '0B');
  assert.strictEqual(formatSize(1023), '1023B');
});

test('formatSize: bytes 1024–1048575 → "NK"', () => {
  assert.strictEqual(formatSize(1024), '1K');
  assert.strictEqual(formatSize(2048), '2K');
  assert.strictEqual(formatSize(1048575), '1023K');
});

test('formatSize: bytes >= 1048576 → "N.NM"', () => {
  assert.strictEqual(formatSize(1048576), '1.0M');
  assert.strictEqual(formatSize(1572864), '1.5M');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
