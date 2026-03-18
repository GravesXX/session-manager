'use strict';

const assert = require('assert');
const { formatSize, applyFilterStandalone } = require('../skills/sessions/scripts/session-picker.cjs');

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
// Mock session data
// ---------------------------------------------------------------------------

const now = Date.now();
const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000);

const mockSessions = [
  {
    sessionId: 'aaa',
    project: '~/Desktop',
    modified: daysAgo(1),
    size: 500,                // 500B — small
    messageCount: 2,
    firstMessage: 'Build the auth system',
    filePath: '/fake/aaa.jsonl',
  },
  {
    sessionId: 'bbb',
    project: '~/Projects/myapp',
    modified: daysAgo(60),   // old (> 30 days)
    size: 200 * 1024,        // 200K — not small
    messageCount: 5,
    firstMessage: 'Help with Python debugging',
    filePath: '/fake/bbb.jsonl',
  },
  {
    sessionId: 'ccc',
    project: '~/Desktop',
    modified: daysAgo(45),   // old (> 30 days)
    size: 50 * 1024,         // 50K — small
    messageCount: 1,
    firstMessage: 'Explain async/await',
    filePath: '/fake/ccc.jsonl',
  },
  {
    sessionId: 'ddd',
    project: '~/Work',
    modified: daysAgo(10),
    size: 2 * 1024 * 1024,   // 2M — not small
    messageCount: 8,
    firstMessage: 'Review my PR',
    filePath: '/fake/ddd.jsonl',
  },
];

const filterModes = ['all', 'project:~/Desktop', 'project:~/Projects/myapp', 'project:~/Work', 'small', 'old'];

// ---------------------------------------------------------------------------
// applyFilterStandalone tests
// ---------------------------------------------------------------------------

console.log('\napplyFilterStandalone tests\n');

// Test 1: 'all' mode returns all sessions
test("'all' mode returns all sessions", () => {
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 0, '');
  assert.strictEqual(filtered.length, mockSessions.length,
    `expected ${mockSessions.length}, got ${filtered.length}`);
});

// Test 2: project mode filters to matching project only
test('project mode filters to matching project only', () => {
  // filterModes[1] = 'project:~/Desktop' — should match aaa and ccc
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 1, '');
  assert.strictEqual(filtered.length, 2, `expected 2, got ${filtered.length}`);
  assert.ok(filtered.every(s => s.project === '~/Desktop'),
    'all results should have project ~/Desktop');
});

// Test 3: 'small' mode returns only sessions < 100KB
test("'small' mode returns only sessions < 100KB", () => {
  // filterModes[4] = 'small'
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 4, '');
  assert.ok(filtered.length > 0, 'should have at least one small session');
  assert.ok(filtered.every(s => s.size < 100 * 1024),
    'all results should be < 100K');
  // aaa (500B) and ccc (50K) are small
  assert.strictEqual(filtered.length, 2, `expected 2 small sessions, got ${filtered.length}`);
});

// Test 4: 'old' mode returns only sessions > 30 days old
test("'old' mode returns only sessions > 30 days old", () => {
  // filterModes[5] = 'old'
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 5, '');
  assert.ok(filtered.length > 0, 'should have at least one old session');
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  assert.ok(filtered.every(s => s.modified.getTime() < threshold),
    'all results should be older than 30 days');
  // bbb (60 days) and ccc (45 days) are old
  assert.strictEqual(filtered.length, 2, `expected 2 old sessions, got ${filtered.length}`);
});

// Test 5: search filters by firstMessage substring (case-insensitive)
test('search filters by firstMessage substring (case-insensitive)', () => {
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 0, 'auth');
  assert.strictEqual(filtered.length, 1, `expected 1, got ${filtered.length}`);
  assert.strictEqual(filtered[0].sessionId, 'aaa');
});

// Test 6: search filters by project substring
test('search filters by project substring', () => {
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 0, 'work');
  assert.strictEqual(filtered.length, 1, `expected 1, got ${filtered.length}`);
  assert.strictEqual(filtered[0].sessionId, 'ddd');
});

// Test 7: combined search + filter mode works correctly
test('combined search + filter mode works correctly', () => {
  // mode = 'project:~/Desktop', search = 'async'
  // ~/Desktop sessions: aaa ('Build the auth system'), ccc ('Explain async/await')
  // search 'async' should narrow to just ccc
  const { filtered } = applyFilterStandalone(mockSessions, filterModes, 1, 'async');
  assert.strictEqual(filtered.length, 1, `expected 1, got ${filtered.length}`);
  assert.strictEqual(filtered[0].sessionId, 'ccc');
});

// Test 8: filterLabel for 'all' mode = "Sessions (N)"
test("filterLabel for 'all' mode = \"Sessions (N)\"", () => {
  const { filterLabel } = applyFilterStandalone(mockSessions, filterModes, 0, '');
  assert.strictEqual(filterLabel, `Sessions (${mockSessions.length})`);
});

// Test 9: filterLabel for project mode = "Sessions (N) › ~/Desktop"
test('filterLabel for project mode includes project name', () => {
  const { filtered, filterLabel } = applyFilterStandalone(mockSessions, filterModes, 1, '');
  assert.strictEqual(filterLabel, `Sessions (${filtered.length}) \u203a ~/Desktop`);
});

// Test 10: filterLabel for search mode = "Search: query█"
test('filterLabel for search mode = "Search: query█"', () => {
  const { filterLabel } = applyFilterStandalone(mockSessions, filterModes, 0, 'hello');
  assert.strictEqual(filterLabel, 'Search: hello\u2588');
});

// ---------------------------------------------------------------------------
// formatSize boundary tests
// ---------------------------------------------------------------------------

console.log('\nformatSize boundary tests\n');

// Test 11: formatSize(0) → "0B"
test('formatSize(0) → "0B"', () => {
  assert.strictEqual(formatSize(0), '0B');
});

// Test 12: formatSize(1023) → "1023B"
test('formatSize(1023) → "1023B"', () => {
  assert.strictEqual(formatSize(1023), '1023B');
});

// Test 13: formatSize(1024) → "1K"
test('formatSize(1024) → "1K"', () => {
  assert.strictEqual(formatSize(1024), '1K');
});

// Test 14: formatSize(1048575) → "1023K"
test('formatSize(1048575) → "1023K"', () => {
  assert.strictEqual(formatSize(1048575), '1023K');
});

// Test 15: formatSize(1048576) → "1.0M"
test('formatSize(1048576) → "1.0M"', () => {
  assert.strictEqual(formatSize(1048576), '1.0M');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
