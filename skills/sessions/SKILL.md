---
name: sessions
description: Manage, preview, and delete Claude Code sessions
allowed-tools: [Bash, Read]
---

# Session Manager

Use this skill to browse, preview, and delete Claude Code sessions stored on the local machine.

## How to Invoke the Script

Run the session picker script using Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs"
```

## Interactive Mode vs CLI Fallback Mode

After running the script, check its output:

### Interactive Mode

If the script exits without printing `{"mode":"cli",...}` JSON to stdout, it ran in interactive mode — the user interacted with the TUI directly. Parse the final JSON summary line from stdout to determine what happened.

### CLI Mediation Mode

If the output contains `"mode":"cli"`, the script could not open a TTY and requires Claude to mediate. Switch to CLI mediation:

1. **List sessions:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --list
   ```
   Returns a JSON array of session objects.

2. **Preview a session:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --preview <id>
   ```
   Returns the session transcript or metadata for the given session ID.

3. **Delete a session:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --delete <id>
   ```
   Deletes the session with the given ID and confirms deletion.

### Handling the no-tty Fallback Signal

If the script outputs exactly `{"mode":"cli","reason":"no-tty"}`, it means no interactive terminal was available. Proceed with CLI mediation: list sessions, present them to the user, ask which to preview or delete, and execute the appropriate subcommand(s).

## Output Contract

After all operations are complete, report results to the user using the following phrases:

- If **no sessions were deleted**: "Session browser closed. No changes made."
- If **one or more sessions were deleted**: "Deleted {n} session(s). {remaining} sessions remaining."

Where `{n}` is the count of deleted sessions and `{remaining}` is the count of sessions still present after deletion.

## Notes

- Session data is stored under `~/.claude/projects/`
- Each session is a JSONL file containing the conversation turns
- Always confirm with the user before deleting a session
