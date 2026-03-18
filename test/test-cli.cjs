'use strict';

const { execSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'skills', 'sessions', 'scripts', 'session-picker.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'projects');

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

console.log('\nCLI tests\n');

// Test 1: --list outputs valid JSON with correct session count
test('--list outputs valid JSON with mode:cli and 3 sessions', () => {
  const stdout = execSync(
    `node "${SCRIPT}" --list --projects-dir "${FIXTURES}"`,
    { encoding: 'utf8' }
  );
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.ok(Array.isArray(result.sessions), 'sessions should be an array');
  assert.strictEqual(result.sessions.length, 3, `expected 3 sessions, got ${result.sessions.length}`);
});

// Test 2: --preview <id> outputs parsed messages for sess-001
test('--preview sess-001 outputs mode:cli with structured messages', () => {
  const stdout = execSync(
    `node "${SCRIPT}" --preview sess-001 --projects-dir "${FIXTURES}"`,
    { encoding: 'utf8' }
  );
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.ok(Array.isArray(result.messages), 'messages should be an array');
  assert.ok(result.messages.length > 0, 'messages should be non-empty');
  // Each message must have role, timestamp, text
  for (const msg of result.messages) {
    assert.ok(typeof msg.role === 'string', 'message.role should be a string');
    assert.ok(typeof msg.timestamp === 'string', 'message.timestamp should be a string');
    assert.ok(typeof msg.text === 'string', 'message.text should be a string');
  }
  // Verify first user message text
  const firstUser = result.messages.find(m => m.role === 'user');
  assert.ok(firstUser, 'should have at least one user message');
  assert.strictEqual(firstUser.text, 'Build the authentication system');
  // At most 20 messages
  assert.ok(result.messages.length <= 20, 'should return at most 20 messages');
});

// Test 3: --preview with invalid ID outputs error
test('--preview with invalid ID outputs mode:cli with error field', () => {
  let stdout;
  try {
    stdout = execSync(
      `node "${SCRIPT}" --preview nonexistent-id --projects-dir "${FIXTURES}"`,
      { encoding: 'utf8' }
    );
  } catch (e) {
    // execSync throws when exit code != 0; stdout is still on e.stdout
    stdout = e.stdout;
  }
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.ok(typeof result.error === 'string', 'should have an error field');
});

// Test 4: --delete <id> removes file and outputs confirmation
test('--delete removes session file and outputs mode:cli with deleted and remaining', () => {
  // Create a temp copy of the fixtures so we do not mutate the originals
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
  fs.cpSync(FIXTURES, tmpDir, { recursive: true });

  const stdout = execSync(
    `node "${SCRIPT}" --delete sess-001 --projects-dir "${tmpDir}"`,
    { encoding: 'utf8' }
  );
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.ok(typeof result.deleted === 'string', 'should have deleted field');
  assert.strictEqual(result.deleted, 'sess-001');
  assert.ok(typeof result.remaining === 'number', 'should have remaining count');
  assert.strictEqual(result.remaining, 2, `expected 2 remaining, got ${result.remaining}`);

  // Verify the file is actually gone
  const deletedFile = path.join(tmpDir, '-Users-testuser-Desktop', 'sess-001.jsonl');
  assert.ok(!fs.existsSync(deletedFile), 'sess-001.jsonl should have been deleted');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 5: --delete with invalid ID outputs error
test('--delete with invalid ID outputs mode:cli with error field', () => {
  let stdout;
  try {
    stdout = execSync(
      `node "${SCRIPT}" --delete nonexistent-id --projects-dir "${FIXTURES}"`,
      { encoding: 'utf8' }
    );
  } catch (e) {
    stdout = e.stdout;
  }
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.ok(typeof result.error === 'string', 'should have an error field');
});

// Test 6: No args and no TTY outputs no-tty fallback
test('no args with no TTY outputs mode:cli with reason:no-tty', () => {
  // Pipe stdin from /dev/null so there is no TTY
  const stdout = execSync(
    `node "${SCRIPT}" --projects-dir "${FIXTURES}" < /dev/null`,
    { encoding: 'utf8', shell: true }
  );
  const result = JSON.parse(stdout.trim());
  assert.strictEqual(result.mode, 'cli', `expected mode "cli", got "${result.mode}"`);
  assert.strictEqual(result.reason, 'no-tty', `expected reason "no-tty", got "${result.reason}"`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
