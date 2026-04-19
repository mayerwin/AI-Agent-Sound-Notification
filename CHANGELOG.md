# Change Log

## 1.0.9 — 2026-04-18

Initial public release.

### Features
- Permission-alert sound when Claude Code requests your approval.
- Completion sound when an agent's turn ends without needing approval (suppressed if an alert fired that turn).
- 26 built-in sounds: 16 Material Design (Google, CC-BY 4.0) + 10 in-house synthesized.
- Configurable initial delay (default 10s) before the first alert sound.
- Optional back-off repeats (default off) with a configurable interval ladder.
- Per-window scoping: editing a file in one VS Code window only dismisses alerts in that window.
- Cross-platform: Windows (PowerShell / `winmm.dll`), macOS (`afplay`), Linux (`paplay` → `aplay` → `play`).
- Windows Focus Assist (DND) awareness — opt-in via `respectDND`.
- Claude Code integration via `PermissionRequest`, `Stop`, `UserPromptSubmit`, and `PostToolUse` hooks in `~/.claude/settings.json`.
- Live-preview QuickPick for browsing built-in sounds.
- Status-bar indicator when a prompt is pending.
- Commands for triggering, dismissing, previewing, choosing, and resetting.
