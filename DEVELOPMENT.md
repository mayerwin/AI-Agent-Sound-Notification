# Development Guide

Everything you need to build, install, and test the **AI Agent Sound Notification** extension locally.

## Prerequisites

- **Node.js 18+** (Node 20 LTS recommended) — `node --version`
- **npm 9+** — ships with Node
- **VS Code 1.85+** (Google Antigravity is **not** supported — the extension refuses to activate there)
- **Windows**: PowerShell on `PATH` (default). No extra setup.
- **macOS**: `afplay` (preinstalled).
- **Linux**: one of `paplay` (pulseaudio-utils), `aplay` (alsa-utils), or `play` (sox).
- **Claude Code** for testing the Claude integration (writes hooks to `~/.claude/settings.json`).

## Repo Layout

```
src/
  extension.ts           ← activate/deactivate, command registration
  notificationManager.ts ← single-notification lifecycle, timers, completion logic
  audioPlayer.ts         ← cross-platform .wav playback + Focus Assist detection
  config.ts              ← typed wrapper over vscode.workspace.getConfiguration
  statusBar.ts           ← status bar item ("AI Agent: pending…")
  adapters/
    baseAdapter.ts       ← AgentAdapter interface
    claudeCodeAdapter.ts ← HTTP server + ~/.claude/settings.json hook upserter
  utils/
    logger.ts            ← info() / debug() with cached debug-flag lookup
    jsonc.ts             ← JSONC parser + atomic file writer
    intervalParser.ts    ← "10s", "5m", "1h" → ms
scripts/
  claude-hook.js         ← invoked by Claude Code; pings every running extension
  generate-sounds.js     ← regenerates resources/sounds/*.wav from synthesis specs
resources/sounds/        ← 10 built-in .wav files (committed)
out/                     ← TypeScript build output (gitignored, generated)
```

## Build

```bash
npm install
npm run compile      # one-shot TypeScript build → out/
npm run watch        # incremental rebuild on save
npm run lint
```

## Package & Install

The repo ships npm scripts that auto-bump the version before packaging — without this, you'd reinstall the same `.vsix` filename and the host might cache it.

```bash
npm run package          # patch bump (1.0.0 → 1.0.1) + build .vsix
npm run package:minor    # minor bump (1.0.0 → 1.1.0)
npm run package:major    # major bump (1.0.0 → 2.0.0)
npm run package:nobump   # build only, no version change
```

Output: `ai-agent-sound-notification-<version>.vsix` in the repo root.

### Install the .vsix

**VS Code GUI**
Extensions panel → `…` menu → *Install from VSIX…* → pick the file.

**CLI**
```bash
code --install-extension ai-agent-sound-notification-1.0.1.vsix
```

### Make sure the new code actually loaded

VS Code caches extension code aggressively. After installing a new `.vsix`:

1. **Fully quit** the IDE (close all windows, confirm no tray icon).
2. Relaunch.
3. Open the **Output** panel → pick the **AI Agent Sound Notification** channel from the dropdown → look for the two activation lines:
   ```
   AI Agent Sound Notification v1.0.1 activating (Node v20.x.x, win32)...
   AI Agent Sound Notification v1.0.1 activated. Active adapters: Claude Code
   ```
4. If the dropdown doesn't even list **AI Agent Sound Notification**, the extension never activated. Check **Help → Show Logs… → Extension Host** for an activation error, and confirm the extension is enabled in the Extensions panel.
5. If you see the *old* version, check `%USERPROFILE%\.vscode\extensions\` and delete any `erwin.ai-agent-sound-notification-*` folders other than the latest, then relaunch.

## Run via Extension Development Host (no packaging)

Fastest inner loop while iterating on code:

1. Open the repo in VS Code.
2. Press `F5` (or *Run → Start Debugging*).
3. A second VS Code window opens with your extension loaded.
4. Edit code → save → in the host window run *Developer: Reload Window* (`Ctrl+R`).

## Testing — the master prompt

Paste this **once** at the start of a Claude Code session. After that, just send `A` or `B` to trigger each scenario:

```
You are helping me test the "AI Agent Sound Notification" VS Code extension.

I will send you single-letter messages. Interpret them strictly per this protocol —
do NOT chat, do NOT explain, do NOT ask for clarification. Just execute the
matching scenario and stop.

Protocol:

  A → Run this exact PowerShell command via your shell tool, wait for my approval,
      then report the resulting file path in one short line:

        powershell -Command "New-Item -Path $env:TEMP\aians-test-$(Get-Random).txt -ItemType File -Value 'test'"

      (This requires my approval, which is exactly what we are testing — the
      extension should play the ALERT sound while you wait. After I approve,
      reply with one line and stop. Do NOT play the completion sound; that is
      correct behavior because an alert fired this turn.)

  B → Do not call any tools. Reply with exactly: "pong".
      (This turn ends cleanly with no permission events, so the extension
      should play the COMPLETION sound.)

Any other message → resume normal assistant behavior.

Acknowledge with exactly "ready." and stop.
```

### What each test verifies

| Input | Expected sound | What it proves |
|---|---|---|
| `A` | **Alert** plays after `initialDelay` (default 10s); repeats fire if `repeat.enabled` is on; sound stops when you approve, switch terminals, or edit a file. | `triggerNotification` path, hook wiring, Focus Assist gating, dismissal listeners. |
| `B` | **Completion** sound plays once, immediately. | `Stop` hook → `triggerCompletion`, the per-turn `alertedThisTurn` flag was correctly cleared by the prior `UserPromptSubmit`. |
| `A`, then `B` back-to-back | Alert on `A`. After approval, **no** completion sound on the `A` turn (suppressed because an alert fired). Then completion sound on `B`. | `alertedThisTurn` correctly suppresses completion within an alerting turn and resets on the next user prompt. |

If the alert sound never plays on `A`, or `B` plays the alert sound instead of completion, see *Troubleshooting* below.

## Manual / out-of-band tests

Useful when you don't want to bother the agent:

| Command Palette entry | What it does |
|---|---|
| `AI Agent Sound: Trigger Alert` | Fires `triggerNotification` directly — full pipeline, including delay & repeats. |
| `AI Agent Sound: Play Test Sound` | One-shot playback, no timers. Confirms audio layer works. |
| `AI Agent Sound: Preview Alert Sound` | Plays the currently-configured alert sound. |
| `AI Agent Sound: Preview Completion Sound` | Plays the currently-configured completion sound. |
| `AI Agent Sound: Choose Built-In Sound...` | Live-preview QuickPick across all 10 built-ins. |
| `AI Agent Sound: Dismiss Active Alert` | Cancels timers and stops the active sound. |
| `AI Agent Sound: Remove Claude Settings Hooks` | Cleans hook entries from `~/.claude/settings.json`. Run this before uninstalling. |

## Debugging

Enable `aiAgentSoundNotification.debug` in settings — the **AI Agent Sound Notification** Output channel then logs:

- Adapter init / hook registration / SDK load attempts
- Every notification trigger, dismissal, repeat-schedule, and completion decision (with reason)
- Audio spawn details: player binary, PID, file size, exit code/signal, captured stderr
- Focus Assist evaluation results
- Config-change events that affect active timers

Activation messages and errors log unconditionally; debug just adds the verbose stream.

## Troubleshooting

**Logs say "Playing alert sound: …wav" but I hear nothing**
Open the channel, look for the `[AudioPlayer]` lines. With `debug` on you'll see `spawned powershell pid=…` and `finished cleanly` (or an error). If powershell exited cleanly but you heard nothing, run this in a regular terminal — it isolates whether the issue is the extension or the system audio path:
```powershell
powershell -NoProfile -Command "Add-Type -AssemblyName System.Media; (New-Object System.Media.SoundPlayer('C:\Users\you\.vscode\extensions\erwin.ai-agent-sound-notification-1.0.1\resources\sounds\alert.wav')).PlaySync()"
```
If *that* is silent too: check Windows volume mixer for a muted PowerShell session, or that the IDE process isn't routed to a different audio device.

**`A` is auto-approved without prompting**
Some agent configs whitelist `New-Item`. Swap the command in the master prompt for something more clearly sensitive, e.g. `Remove-Item -WhatIf C:\Temp\x.txt` or a `curl` to an external host.

**Hooks aren't installed in `~/.claude/settings.json`**
Check the channel for `[ClaudeAdapter]` lines. If `~/.claude` doesn't exist, the adapter no-ops by design. The hook script path it writes is absolute — if you move the extension folder, run *Remove Claude Settings Hooks* and reactivate to refresh the path.

**Stale `.vsix` keeps loading**
See [*Make sure the new code actually loaded*](#make-sure-the-new-code-actually-loaded) above.

## Built-in sounds

[resources/sounds/](resources/sounds/) contains two sets of `.wav` files:

- **Material Design (Google), CC-BY 4.0** — files prefixed `md-`. Mirrored locally from the [Internet Archive snapshot of Material Design Sound Resources](https://archive.org/details/material-design-sound-resources). Do **not** regenerate or modify — keep them as shipped so we honor the upstream license.
- **In-house synthesized** — short names (`alert`, `chime`, `bell`, …). Generated by `scripts/generate-sounds.js`:

  ```bash
  node scripts/generate-sounds.js
  ```

When adding/removing a sound (either set), update **all three** lists so they stay in sync:

- [src/audioPlayer.ts](src/audioPlayer.ts) — `BUILTIN_SOUNDS` array (single source of truth: name, label, description, source)
- [package.json](package.json) — `soundName` and `completionSound.name` properties (both `enum` and `enumDescriptions`)
- [README.md](README.md) — the *Built-in sounds* tables

The README "Credits" section also needs updating if a third sound source is added.

## Releasing

1. `npm run package` (or `:minor` / `:major`)
2. Smoke-test the new `.vsix` with the master prompt — both `A` and `B`.
3. Commit the version bump in `package.json` if you're tracking releases in git.
4. Publish: `npx @vscode/vsce publish` (requires a publisher PAT) or attach the `.vsix` to a GitHub release.
