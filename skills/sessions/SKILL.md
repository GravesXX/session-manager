---
name: sessions
description: Manage, preview, and delete Claude Code sessions
allowed-tools: [Bash, Read]
---

# Session Manager

Browse, preview, and delete Claude Code sessions stored on this machine.

## Step 1: Try Interactive Mode

Run the session picker script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs"
```

## Step 2: Check the Output

**If the output is `{"mode":"cli","reason":"no-tty"}`**, the interactive TUI could not launch. Tell the user:

> For the full interactive TUI, run this in your terminal:
> ```
> node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs"
> ```
> Or I can manage sessions for you here. What would you like to do?

Then proceed with CLI mediation (Step 3).

**If the output is JSON with `"action":"exit"`**, the user used the interactive TUI directly. Parse the result:
- If `deleted` array is empty: "Session browser closed. No changes made."
- If `deleted` has entries: "Deleted {n} session(s). {remaining} sessions remaining."

## Step 3: CLI Mediation

When mediating for the user, use these subcommands:

**List sessions:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --list
```
Present the sessions as a numbered list with date, size, message count, project, and first message.

**Preview a session:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --preview <session-id>
```
Show the conversation messages to the user.

**Delete a session:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --delete <session-id>
```
Always confirm with the user before running this.

**Clean up auto-generated sessions:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/sessions/scripts/session-picker.cjs" --clean-auto
```
Deletes all local-command sessions (/exit, /clear artifacts) in one shot. Run this when the user asks to clean up junk sessions or auto-generated sessions.

## Output Contract

After operations complete, report:
- No deletions: "Session browser closed. No changes made."
- Deletions: "Deleted {n} session(s). {remaining} sessions remaining."
- Clean-auto: report the `message` field from the JSON output directly.

## Notes

- Session data lives in `~/.claude/projects/` — every project the user has ever run Claude from
- Each session is a JSONL file containing conversation turns
- Always confirm before deleting
