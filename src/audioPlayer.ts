/**
 * Cross-platform audio playback.
 *
 *   Windows : powershell -Command "(New-Object System.Media.SoundPlayer ...).PlaySync()"
 *   macOS   : afplay <file>
 *   Linux   : paplay (PulseAudio) → aplay (ALSA) → play (sox), in that order
 *
 * Windows-only Focus Assist (DND) detection is gated by platform and silently
 * returns false elsewhere.
 */
import { exec, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { info, debug } from './utils/logger';

const PREFIX = '[AudioPlayer]';
const logInfo  = (msg: string) => info(`${PREFIX} ${msg}`);
const logDebug = (msg: string) => debug(`${PREFIX} ${msg}`);

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

let activeProcess: ChildProcess | null = null;

interface PlayerSpec {
    name: string;
    /** Spawn a process that plays the given .wav file and exits when done. */
    spawn(file: string): ChildProcess;
}

let cachedPlayer: PlayerSpec | null | undefined;

function which(bin: string): Promise<boolean> {
    return new Promise((resolve) => {
        const cmd = isWindows ? `where ${bin}` : `command -v ${bin}`;
        exec(cmd, { timeout: 3000 }, (err) => resolve(!err));
    });
}

async function detectPowerShell(): Promise<PlayerSpec | null> {
    const ok = await new Promise<boolean>((resolve) => {
        exec('powershell -NoProfile -NonInteractive -Command "echo 1"', { timeout: 5000 }, (err) => resolve(!err));
    });
    if (!ok) {
        logInfo('PowerShell was not found in PATH. Audio notifications are disabled.');
        return null;
    }
    return {
        name: 'powershell',
        spawn(file) {
            const escaped = file.replace(/'/g, "''");
            // Use winmm.dll PlaySound via P/Invoke. Works in both Windows PowerShell 5.1
            // AND PowerShell 7 (Core) — System.Media.SoundPlayer is unavailable in Core.
            // Flags: SND_FILENAME (0x20000) | SND_SYNC (0x0) → blocks until playback ends,
            // so killing the process actually stops the sound.
            const ps = [
                `$sig = '[DllImport(\"winmm.dll\", SetLastError=true)] public static extern bool PlaySound(string pszSound, IntPtr hmod, uint fdwSound);';`,
                `Add-Type -MemberDefinition $sig -Namespace AIANS -Name Winmm | Out-Null;`,
                `[AIANS.Winmm]::PlaySound('${escaped}', [IntPtr]::Zero, 0x20000) | Out-Null`,
            ].join(' ');
            return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
        },
    };
}

async function detectAfplay(): Promise<PlayerSpec | null> {
    if (!(await which('afplay'))) {
        logInfo('afplay not found. Audio notifications are disabled.');
        return null;
    }
    return {
        name: 'afplay',
        spawn(file) { return spawn('afplay', [file]); },
    };
}

async function detectLinuxPlayer(): Promise<PlayerSpec | null> {
    const candidates: Array<{ bin: string; args: (f: string) => string[] }> = [
        { bin: 'paplay', args: (f) => [f] },
        { bin: 'aplay',  args: (f) => ['-q', f] },
        { bin: 'play',   args: (f) => ['-q', f] }, // sox
    ];
    for (const c of candidates) {
        if (await which(c.bin)) {
            return {
                name: c.bin,
                spawn(file) { return spawn(c.bin, c.args(file)); },
            };
        }
    }
    logInfo('No supported audio player found (paplay / aplay / play). Install pulseaudio-utils, alsa-utils, or sox.');
    return null;
}

async function detectPlayer(): Promise<PlayerSpec | null> {
    if (cachedPlayer !== undefined) return cachedPlayer;
    if (isWindows)      cachedPlayer = await detectPowerShell();
    else if (isMac)     cachedPlayer = await detectAfplay();
    else if (isLinux)   cachedPlayer = await detectLinuxPlayer();
    else {
        logInfo(`Unsupported platform: ${platform}. Audio notifications are disabled.`);
        cachedPlayer = null;
    }
    return cachedPlayer;
}

/**
 * Play a .wav file via the platform's audio player.
 */
export async function playSound(wavFilePath: string): Promise<void> {
    const player = await detectPlayer();
    if (!player) {
        logInfo(`No audio player available — cannot play ${wavFilePath}`);
        return;
    }

    if (!fs.existsSync(wavFilePath)) {
        const err = new Error(`Sound file not found: ${wavFilePath}`);
        logInfo(err.message);
        throw err;
    }

    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(wavFilePath); } catch { /* ignore */ }
    if (stat && stat.size < 64) {
        logInfo(`WARN: ${wavFilePath} is suspiciously small (${stat.size} bytes) — may be empty/corrupt.`);
    }

    return new Promise<void>((resolve, reject) => {
        stopSound();

        let proc: ChildProcess;
        try {
            proc = player.spawn(wavFilePath);
        } catch (err: any) {
            const msg = `Failed to spawn ${player.name}: ${err?.message || err}`;
            logInfo(msg);
            reject(new Error(msg));
            return;
        }

        if (!proc.pid) {
            const msg = `Failed to start ${player.name} for audio playback (no PID)`;
            logInfo(msg);
            reject(new Error(msg));
            return;
        }

        logDebug(`spawned ${player.name} pid=${proc.pid} for ${path.basename(wavFilePath)} (${stat?.size ?? '?'} bytes)`);

        // Capture stderr — PowerShell errors land here even when exit code is 0
        // for some failure modes (e.g. assembly load issues).
        let stderrBuf = '';
        proc.stderr?.on('data', (chunk) => {
            stderrBuf += chunk.toString();
            if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
        });

        // Hard timeout in case a player hangs.
        const watchdog = setTimeout(() => {
            if (activeProcess === proc) {
                logInfo(`watchdog: ${player.name} pid=${proc.pid} did not exit within 35s — killing`);
                try { proc.kill(); } catch { /* ignore */ }
            }
        }, 35_000);

        proc.on('error', (err) => {
            logInfo(`${player.name} error: ${err.message}`);
        });

        proc.on('exit', (code, signal) => {
            clearTimeout(watchdog);
            if (activeProcess === proc) activeProcess = null;
            const trimmedStderr = stderrBuf.trim();
            if (signal === 'SIGTERM' || signal === 'SIGKILL') {
                logDebug(`${player.name} pid=${proc.pid} stopped (signal: ${signal})`);
            } else if (code === 0) {
                logDebug(`${player.name} pid=${proc.pid} finished cleanly${trimmedStderr ? ` (stderr: ${trimmedStderr})` : ''}`);
            } else {
                logInfo(`${player.name} pid=${proc.pid} exited with code ${code}${trimmedStderr ? ` — stderr: ${trimmedStderr}` : ''}`);
            }
        });

        activeProcess = proc;
        resolve();
    });
}

/**
 * Stop any currently playing sound.
 */
export function stopSound(): void {
    const proc = activeProcess;
    if (proc && !proc.killed) {
        try { proc.kill(); } catch { /* ignore */ }
    }
    if (activeProcess === proc) activeProcess = null;
}

/**
 * Check if Windows Focus Assist (Do Not Disturb) is currently active.
 * No-op on non-Windows platforms.
 */
export async function isFocusAssistActive(): Promise<boolean> {
    if (!isWindows) return false;

    return new Promise((resolve) => {
        const cmd = `powershell -NoProfile -NonInteractive -Command "
            $dnd = 0;
            try {
                $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.notifications.quiethourssettings\\windows.data.notifications.quiethourssettings';
                if (Test-Path $key) {
                    $data = (Get-ItemProperty -Path $key -Name 'Data' -ErrorAction SilentlyContinue).Data;
                    if ($data -and $data.Length -gt 15) { $dnd = $data[15] }
                }
                if ($dnd -eq 0) {
                    $toastKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
                    $toastStatus = Get-ItemProperty -Path $toastKey -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -ErrorAction SilentlyContinue;
                    if ($toastStatus -and $toastStatus.NOC_GLOBAL_SETTING_TOASTS_ENABLED -eq 0) { $dnd = 1 }
                }
            } catch {}
            Write-Output $dnd
        "`;
        exec(cmd, { timeout: 5000 }, (error, stdout) => {
            if (error) {
                logDebug(`Focus Assist check failed: ${error.message}`);
                resolve(false);
                return;
            }
            const value = parseInt((stdout || '').trim(), 10);
            resolve(!isNaN(value) && value > 0);
        });
    });
}

/**
 * Built-in sounds, grouped by source. Material Design sounds are listed first
 * because they're professionally produced and generally sound nicer; the
 * synthesized set is kept as alternatives.
 */
export type SoundSource = 'material' | 'synthesized';

export interface BuiltinSound {
    /** Stable identifier — also the .wav filename stem under resources/sounds/. */
    readonly name: string;
    /** Display label for QuickPick / Settings UI. */
    readonly label: string;
    /** Short character description shown alongside the name. */
    readonly description: string;
    readonly source: SoundSource;
}

export const BUILTIN_SOUNDS: readonly BuiltinSound[] = [
    // ── Material Design (Google) — CC-BY 4.0 ──────────────────────────────
    { name: 'md-alert-simple',       label: 'Alert — Simple',                description: 'Clear, simple alert (default)',                  source: 'material' },
    { name: 'md-alert-high',         label: 'Alert — High Intensity',        description: 'Urgent alert tone',                              source: 'material' },
    { name: 'md-alarm-gentle',       label: 'Alarm — Gentle',                description: 'Soft repeating alarm (~6s)',                     source: 'material' },
    { name: 'md-notif-ambient',      label: 'Notification — Ambient',        description: 'Soft, ambient notification',                     source: 'material' },
    { name: 'md-notif-simple-1',     label: 'Notification — Simple 1',       description: 'Clean two-tone ping',                            source: 'material' },
    { name: 'md-notif-simple-2',     label: 'Notification — Simple 2',       description: 'Clean two-tone ping (variant)',                  source: 'material' },
    { name: 'md-notif-decorative-1', label: 'Notification — Decorative 1',   description: 'Pleasant decorative chime',                      source: 'material' },
    { name: 'md-notif-decorative-2', label: 'Notification — Decorative 2',   description: 'Pleasant decorative chime (variant)',            source: 'material' },
    { name: 'md-notif-high',         label: 'Notification — High Intensity', description: 'Strong notification tone',                       source: 'material' },
    { name: 'md-ringtone-minimal',   label: 'Ringtone — Minimal',            description: 'Minimal looping ring',                           source: 'material' },
    { name: 'md-hero-simple-1',      label: 'Hero — Simple Celebration 1',   description: 'Crisp "done!" celebration (completion default)', source: 'material' },
    { name: 'md-hero-simple-2',      label: 'Hero — Simple Celebration 2',   description: 'Crisp "done!" celebration (variant)',            source: 'material' },
    { name: 'md-hero-simple-3',      label: 'Hero — Simple Celebration 3',   description: 'Crisp "done!" celebration (variant)',            source: 'material' },
    { name: 'md-hero-decorative-1',  label: 'Hero — Decorative 1',           description: 'Richer celebratory flourish',                    source: 'material' },
    { name: 'md-hero-decorative-2',  label: 'Hero — Decorative 2',           description: 'Richer celebratory flourish (variant)',          source: 'material' },
    { name: 'md-hero-decorative-3',  label: 'Hero — Decorative 3',           description: 'Richer celebratory flourish (variant)',          source: 'material' },

    // ── Built-in synthesized (kept as alternatives) ───────────────────────
    { name: 'alert',    label: 'Alert',    description: 'Two-tone notification chime',           source: 'synthesized' },
    { name: 'chime',    label: 'Chime',    description: 'Gentle ascending major triad',          source: 'synthesized' },
    { name: 'bell',     label: 'Bell',     description: 'Single rich bell strike with long decay', source: 'synthesized' },
    { name: 'ding',     label: 'Ding',     description: 'Bright, short single ding',             source: 'synthesized' },
    { name: 'harp',     label: 'Harp',     description: 'Quick C-major harp arpeggio',           source: 'synthesized' },
    { name: 'fanfare',  label: 'Fanfare',  description: 'Triumphant brass-style fanfare',        source: 'synthesized' },
    { name: 'success',  label: 'Success',  description: 'Ascending pentatonic "level up" melody', source: 'synthesized' },
    { name: 'gentle',   label: 'Gentle',   description: 'Soft sine pad — slow attack & release', source: 'synthesized' },
    { name: 'zen',      label: 'Zen',      description: 'Meditative singing bowl',               source: 'synthesized' },
    { name: 'arpeggio', label: 'Arpeggio', description: 'Cascading bell arpeggio in D major',    source: 'synthesized' },
];

export const BUILTIN_SOUND_NAMES = BUILTIN_SOUNDS.map((s) => s.name) as readonly string[];

export const DEFAULT_ALERT_SOUND = 'md-alert-simple';
export const DEFAULT_COMPLETION_SOUND = 'md-hero-simple-1';

export function getBuiltinSoundPath(extensionPath: string, name: string): string {
    const safe = BUILTIN_SOUND_NAMES.includes(name) ? name : DEFAULT_ALERT_SOUND;
    return path.join(extensionPath, 'resources', 'sounds', `${safe}.wav`);
}

export function getDefaultSoundPath(extensionPath: string): string {
    return getBuiltinSoundPath(extensionPath, DEFAULT_ALERT_SOUND);
}

export function disposeAudioPlayer(): void {
    stopSound();
    // Output channel is owned by extension.ts.
}
