# AI Agent Sound Notification

A VS Code extension that plays a distinct sound when **Claude Code** requires your authorization — so you never miss a prompt, even when multitasking.

> **Not compatible with Google Antigravity** — see [Why no Antigravity?](#why-no-antigravity) below.

## Features

- **🔔 Distinct alert sound** when agents need your approval (commands, file edits, etc.)
- **✅ Completion sound** when an agent finishes a turn that *didn't* need approval (so you know it's done)
- **🎵 26 built-in sounds** — 16 Material Design (Google, CC-BY 4.0) + 10 in-house synthesized (chime, bell, harp, fanfare, zen bowl, and more)
- **⏱️ Initial delay** — gives you time to react before the sound plays (configurable, default 10s)
- **🔁 Configurable repeat with back-off** — escalating intervals so you don't forget (off by default)
- **🖥️ Per-window scope** — activity in one VS Code window only snoozes alerts for *that* window
- **🌍 Cross-platform** — Windows (PowerShell), macOS (`afplay`), Linux (`paplay`/`aplay`/`play`)
- **🌙 Windows Focus Assist aware** — optional DND mode respect (silently no-op on macOS/Linux)
- **📊 Status bar indicator** — visual cue when a prompt is pending

## Supported Agents

| Agent | Integration Method | Status |
|---|---|---|
| **Claude Code** (VS Code) | `PermissionRequest` / `Stop` / `UserPromptSubmit` / `PostToolUse` hooks in `~/.claude/settings.json` | ✅ |
| **Google Antigravity** | — | ❌ Not supported ([why?](#why-no-antigravity)) |

## Installation

### From a released `.vsix`

Download the latest `.vsix` from the [Releases page](https://github.com/mayerwin/AI-Agent-Sound-Notification/releases) and install it:

- **VS Code GUI**: Extensions panel → `…` menu → *Install from VSIX…* → pick the file.
- **CLI**: `code --install-extension ai-agent-sound-notification-<version>.vsix`

### From source
```bash
git clone https://github.com/mayerwin/AI-Agent-Sound-Notification.git
cd AI-Agent-Sound-Notification
npm install
npm run package        # auto-bumps version + builds .vsix
```

Then install the resulting `ai-agent-sound-notification-<version>.vsix` from the Extensions panel.

For the full developer workflow — Extension Development Host, the master test prompt, debugging, and troubleshooting — see [DEVELOPMENT.md](DEVELOPMENT.md).

## Configuration

All settings are under `aiAgentSoundNotification.*` in VS Code Settings:

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch |
| `initialDelay` | `"10s"` | Delay before first sound. Format: `"10s"`, `"30s"`, `"1m"` |
| `soundName` | `"md-alert-simple"` | Built-in sound for permission alerts — see [Built-in sounds](#built-in-sounds) for the full list |
| `soundFile` | `""` | Optional path to a custom `.wav` — overrides `soundName` when set |
| `completionSound.enabled` | `true` | Play a sound when the agent finishes a turn that didn't need approval |
| `completionSound.name` | `"md-hero-simple-1"` | Built-in sound for completion (same options as `soundName`) |
| `completionSound.file` | `""` | Optional custom `.wav` for completion — overrides `completionSound.name` |
| `repeat.enabled` | `false` | Repeat sound periodically |
| `repeat.intervals` | `["1m","5m","10m","30m","1h","3h"]` | Back-off intervals. Stops after the last one. |
| `respectDND` | `false` | Suppress sounds when Windows Focus Assist is active |
| `integrations.claudeCode` | `true` | Enable Claude Code integration |

### Built-in sounds

Use the **AI Agent Sound: Choose Built-In Sound...** command for a live-preview picker, or set `soundName` directly.

There are **two sets** of built-in sounds:

- **Material Design (Google)** — names start with `md-`. Professionally produced UI sounds from [Google's Material Design Sound Resources](https://m2.material.io/design/sound/sound-resources.html) (CC-BY 4.0). These are the defaults and generally sound nicer.
- **Synthesized (in-house)** — short names. Generated programmatically; kept as alternatives for users who prefer them or want a more distinctive tone.

#### Material Design (Google)

| Name | Character |
|---|---|
| `md-alert-simple` | Clear, simple alert — **default for permission alerts** |
| `md-alert-high` | Urgent high-intensity alert |
| `md-alarm-gentle` | Soft repeating alarm (~6s) |
| `md-notif-ambient` | Soft, ambient notification |
| `md-notif-simple-1` | Clean two-tone ping |
| `md-notif-simple-2` | Clean two-tone ping (variant) |
| `md-notif-decorative-1` | Pleasant decorative chime |
| `md-notif-decorative-2` | Pleasant decorative chime (variant) |
| `md-notif-high` | Strong notification tone |
| `md-ringtone-minimal` | Minimal looping ringtone |
| `md-hero-simple-1` | Crisp "done!" celebration — **default for completion** |
| `md-hero-simple-2` | Crisp "done!" celebration (variant) |
| `md-hero-simple-3` | Crisp "done!" celebration (variant) |
| `md-hero-decorative-1` | Richer celebratory flourish |
| `md-hero-decorative-2` | Richer celebratory flourish (variant) |
| `md-hero-decorative-3` | Richer celebratory flourish (variant) |

#### Synthesized (in-house)

| Name | Character |
|---|---|
| `alert` | Two-tone notification chime — clear and attention-grabbing |
| `chime` | Gentle ascending major triad (C–E–G) |
| `bell` | Single rich bell strike with a long, lush decay |
| `ding` | Bright, short, single ding |
| `harp` | Quick C-major harp arpeggio |
| `fanfare` | Triumphant brass-style fanfare (G–C–E–G) |
| `success` | Ascending pentatonic "level-up" melody with sparkle |
| `gentle` | Soft sine pad — slow attack, calm release |
| `zen` | Meditative singing-bowl tone (~3.5s) |
| `arpeggio` | Cascading bell arpeggio in D major |

### Custom Back-off Presets

The `repeat.intervals` array lets you define any back-off pattern:

```json
// Aggressive (for critical workflows)
"aiAgentSoundNotification.repeat.intervals": ["30s", "1m", "2m"]

// Exponential-like (recommended)
"aiAgentSoundNotification.repeat.intervals": ["1m", "5m", "10m", "30m", "1h", "3h"]

// Gentle nudge
"aiAgentSoundNotification.repeat.intervals": ["5m", "15m", "1h"]
```

## How It Works

### Claude Code
1. On activation, the extension starts a tiny HTTP server on `localhost`
2. It registers hooks in `~/.claude/settings.json` for `PermissionRequest`, `Stop`, `UserPromptSubmit`, and `PostToolUse` events
3. When Claude requests permission, the hook script pings our server
4. The notification manager plays the sound after the configured delay
5. When you approve and the tool runs (`PostToolUse`), or Claude finishes a turn (`Stop`), or you submit a new prompt (`UserPromptSubmit`), the alert is dismissed

### Workspace Scoping
- The extension registers listeners for file edits within the current workspace
- Editing a file in Window A only dismisses alerts in Window A
- Agent prompts pending in Window B continue to alert independently

## Commands

| Command | Description |
|---|---|
| `AI Agent Sound: Trigger Alert` | Manually trigger an alert (useful for testing) |
| `AI Agent Sound: Dismiss Active Alert` | Dismiss the current alert and cancel all pending repeats |
| `AI Agent Sound: Play Test Sound` | Play the configured sound once (no timers) |
| `AI Agent Sound: Choose Built-In Sound...` | Live-preview picker across all built-in sounds |
| `AI Agent Sound: Preview Alert Sound` | Play the currently-configured alert sound |
| `AI Agent Sound: Preview Completion Sound` | Play the currently-configured completion sound |
| `AI Agent Sound: Remove Claude Settings Hooks` | Remove the hook entries this extension wrote to `~/.claude/settings.json` |
| `AI Agent Sound: Reset Settings to Defaults` | Restore every extension setting (alert sound, delays, repeats, completion sound, etc.) to its built-in default |

## Custom Sound

Replace the built-in sound with any `.wav` file:

```json
"aiAgentSoundNotification.soundFile": "C:/Users/you/sounds/my-alert.wav"
```

## Platform Support

| Platform | Player |
|---|---|
| Windows | PowerShell + `System.Media.SoundPlayer` |
| macOS | `afplay` (built-in) |
| Linux | `paplay` (PulseAudio) → `aplay` (ALSA) → `play` (sox), in that order |

Focus Assist (DND) detection is Windows-only — `respectDND` is silently ignored on other platforms.

## Completion Sound — Semantics

The completion sound (default `md-hero-simple-1`) plays when an agent's turn ends *and no permission alert was shown during that turn*. If you got an alert and approved it, you won't hear the completion ding right after — only the alert had to interrupt you.

The "did an alert fire this turn?" flag resets when the next user prompt is submitted.

## Why no Antigravity?

Earlier versions of this extension shipped Antigravity support via the community [`antigravity-sdk`](https://github.com/Kanezal/antigravity-sdk), which reverse-engineers Antigravity's internal SQLite state DB. It was dropped in v1.0.7 because there is no signal an extension can read that reliably means *"the agent is waiting for your approval"* or *"the turn ended cleanly."*

What's actually exposed to third-party extensions:

- **No public approval/permission API.** The Cascade approval UI lives inside an internal webview, not the VS Code command registry, so there's no `onDidRequestPermission` or equivalent.
- **USS reads are unreliable.** In some installs the SDK can't read `state.vscdb` at all — every key returns 0 bytes. Even when it works, the rich per-step status (`StepStatus.WaitingForUser`) exists in the protobuf but is never surfaced through any consumer-facing channel.
- **No turn-boundary signal.** `getDiagnostics` exposes `agentStateDebug` and `rpcDebug`, but they're empty unless an internal Google debug toggle is on.
- **The only field that actually moves is `lastStepIndex`.** A step-count delta tells you *something happened* — but not whether it was an approval prompt, an auto-approved tool, or a status tick. Firing the alert on every delta produces too many false positives to be useful.

By contrast, **Claude Code** ships a clean, documented hook API (`PermissionRequest`, `Stop`, `UserPromptSubmit`, `PostToolUse`) — exactly the four events this extension needs. Wiring it up was about thirty lines of JSON.

**Dear Google Antigravity team**: please consider exposing a public extension API along the lines of Claude Code's hooks — at minimum an event for *"approval pending"* and *"turn ended."* That would let third-party productivity tooling (sound notifications, status mirrors, mobile push, etc.) work reliably without reverse-engineering your internal state. Until then, this extension can't responsibly support Antigravity.

## Credits

- **Material Design built-in sounds** (files prefixed `md-` under [resources/sounds/](resources/sounds/)) are from [Google's Material Design Sound Resources](https://m2.material.io/design/sound/sound-resources.html), licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). Files mirrored locally from the [Internet Archive snapshot](https://archive.org/details/material-design-sound-resources).

## License

[MIT](LICENSE) — applies to the extension code and the in-house synthesized sounds. Material Design sounds retain their original CC-BY 4.0 license (see *Credits*).
