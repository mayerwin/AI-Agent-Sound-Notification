/**
 * Claude Code Adapter
 *
 * Spawns a tiny localhost HTTP server, writes the port (and an auth token) to a
 * shared file, and registers a hook in ~/.claude/settings.json. The hook script
 * pings every server it finds, so notifications fire in every open VS Code window.
 *
 * Hooks are persisted across extension restarts — only the explicit
 * `cleanupClaudeHooks` command removes them. This avoids breaking another
 * VS Code window when the current one shuts down.
 */
import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AgentAdapter } from './baseAdapter';
import {
    triggerNotification,
    dismissNotification,
    triggerCompletion,
    notifyTurnReset,
    isNotificationActive,
} from '../notificationManager';
import { parseJsonc, atomicWriteJsonFile } from '../utils/jsonc';
import { info, debug } from '../utils/logger';
import { TranscriptWatcher } from './transcriptWatcher';

const ADAPTER_NAME = 'Claude Code';
const PORT_FILE_PREFIX = 'port-';
const LOG_PREFIX = '[ClaudeAdapter]';

interface PortFileContent {
    port: number;
    token: string;
    pid: number;
}

function extractQuery(url: string, key: string): string | null {
    const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
    return m ? decodeURIComponent(m[1]) : null;
}

interface ClaudeSettings {
    hooks?: {
        [event: string]: Array<{
            matcher: string;
            hooks?: Array<{
                type: string;
                command: string;
            }>;
        }>;
    };
}

type HookKind = 'alert' | 'dismiss' | 'completed' | 'tooldone';

const HOOK_EVENTS: Array<{ event: string; kind: HookKind }> = [
    { event: 'PermissionRequest', kind: 'alert' },
    { event: 'Stop',              kind: 'completed' },
    { event: 'UserPromptSubmit',  kind: 'dismiss' },
    // PostToolUse means a tool just finished — i.e. the agent is mid-execution
    // and any pending permission alert is no longer relevant. We dismiss the
    // alert without resetting the turn flag (an alert still happened).
    { event: 'PostToolUse',       kind: 'tooldone' },
];

export class ClaudeCodeAdapter implements AgentAdapter {
    readonly name = ADAPTER_NAME;

    private server: http.Server | null = null;
    private port: number = 0;
    private token: string = '';
    private portFilePath: string = '';
    private transcriptWatcher: TranscriptWatcher | null = null;

    private log(msg: string): void {
        info(`${LOG_PREFIX} ${msg}`);
    }

    private dlog(msg: string): void {
        debug(`${LOG_PREFIX} ${msg}`);
    }

    isAvailable(): boolean {
        return fs.existsSync(path.join(os.homedir(), '.claude'));
    }

    async initialize(context: vscode.ExtensionContext, _outputChannel?: vscode.OutputChannel): Promise<boolean> {
        if (!this.isAvailable()) {
            this.log('Claude Code not detected (no ~/.claude directory). Adapter disabled.');
            return false;
        }

        try {
            this.cleanupStalePortFiles();
            await this.startServer();
            await this.registerHook(context);
            this.log(`Claude Code adapter initialized. Listening on port ${this.port}`);
            return true;
        } catch (err) {
            this.log(`Failed to initialize: ${err}`);
            return false;
        }
    }

    private cleanupStalePortFiles(): void {
        try {
            const portDir = this.getPortDir();
            if (!fs.existsSync(portDir)) return;

            for (const file of fs.readdirSync(portDir)) {
                if (!file.startsWith(PORT_FILE_PREFIX)) continue;

                const pidStr = file.substring(PORT_FILE_PREFIX.length);
                const pid = parseInt(pidStr, 10);
                if (isNaN(pid)) continue;

                let isDead = false;
                try {
                    process.kill(pid, 0);
                } catch (err: any) {
                    // ESRCH → no such process. EPERM → process exists but is
                    // owned by another user (don't touch it on shared hosts).
                    if (err && err.code === 'ESRCH') isDead = true;
                }

                if (!isDead) continue;

                const fullPath = path.join(portDir, file);
                try {
                    fs.unlinkSync(fullPath);
                    this.dlog(`Cleaned up stale port file: ${file}`);
                } catch { /* ignore */ }
            }
        } catch (err) {
            this.log(`Warning during stale port cleanup: ${err}`);
        }
    }

    private startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.token = crypto.randomBytes(16).toString('hex');

            this.server = http.createServer((req, res) => {
                const url = req.url || '';
                const pathname = url.split('?')[0];

                // Require either matching token in query string or header — guards against
                // other localhost processes accidentally (or maliciously) pinging us.
                const headerToken = req.headers['x-aians-token'];
                const queryToken = url.match(/[?&]token=([^&]+)/)?.[1];
                if (headerToken !== this.token && queryToken !== this.token) {
                    res.writeHead(401);
                    res.end();
                    return;
                }

                switch (pathname) {
                    case '/alert': {
                        triggerNotification(ADAPTER_NAME);
                        const transcriptPath = extractQuery(url, 'transcriptPath');
                        if (transcriptPath) {
                            this.startTranscriptWatcher(transcriptPath);
                        }
                        res.writeHead(200); res.end('ok');
                        return;
                    }
                    case '/completed':
                        // Stop hook OR transcript watcher detected turn-end via
                        // denial. If a permission alert was active, treat as
                        // dismissal (no completion sound). Otherwise, play it.
                        this.stopTranscriptWatcher();
                        if (isNotificationActive()) {
                            dismissNotification('Claude Code turn ended');
                        } else {
                            triggerCompletion(ADAPTER_NAME).catch(() => { /* logged inside */ });
                        }
                        res.writeHead(200); res.end('ok');
                        return;
                    case '/dismiss':
                        // UserPromptSubmit: user is interacting; clear pending alert AND reset turn state.
                        this.stopTranscriptWatcher();
                        notifyTurnReset();
                        dismissNotification('Claude Code user prompt submitted');
                        res.writeHead(200); res.end('ok');
                        return;
                    case '/tooldone':
                        // PostToolUse: a tool just completed (i.e. permission was granted and the
                        // tool ran). Dismiss the alert but DO NOT reset the per-turn flag — an
                        // alert was still shown, so completion sound should remain suppressed.
                        this.stopTranscriptWatcher();
                        dismissNotification('Claude Code tool completed');
                        res.writeHead(200); res.end('ok');
                        return;
                    default:
                        res.writeHead(404); res.end();
                }
            });

            this.server.listen(0, '127.0.0.1', () => {
                const address = this.server?.address();
                if (!address || typeof address !== 'object') {
                    this.closeServer();
                    reject(new Error('Server address error during start'));
                    return;
                }
                this.port = address.port;
                try {
                    const portDir = this.getPortDir();
                    if (!fs.existsSync(portDir)) fs.mkdirSync(portDir, { recursive: true });
                    this.portFilePath = path.join(portDir, `${PORT_FILE_PREFIX}${process.pid}`);
                    const payload: PortFileContent = { port: this.port, token: this.token, pid: process.pid };
                    fs.writeFileSync(this.portFilePath, JSON.stringify(payload), 'utf-8');
                    resolve();
                } catch (err) {
                    this.portFilePath = '';
                    this.closeServer();
                    reject(err);
                }
            });

            this.server.on('error', (err) => {
                this.log(`Server error event: ${err.message}`);
                reject(err);
            });
        });
    }

    private startTranscriptWatcher(transcriptPath: string): void {
        this.stopTranscriptWatcher();
        this.transcriptWatcher = new TranscriptWatcher(transcriptPath, (reason) => {
            this.dlog(`transcript watcher fired: ${reason}`);
            // Route through the same path as the Stop hook.
            if (isNotificationActive()) {
                dismissNotification('Claude Code turn ended (denial detected)');
            } else {
                triggerCompletion(ADAPTER_NAME).catch(() => { /* logged inside */ });
            }
        });
        this.transcriptWatcher.start();
    }

    private stopTranscriptWatcher(): void {
        if (this.transcriptWatcher) {
            this.transcriptWatcher.stop();
            this.transcriptWatcher = null;
        }
    }

    private getPortDir(): string {
        const appData = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(os.homedir(), '.config');
        return path.join(appData, 'ai-agent-sound-notification');
    }

    private closeServer(): void {
        if (!this.server) return;
        try { this.server.close(); } catch { /* ignore */ }
        this.server = null;
    }

    private async registerHook(context: vscode.ExtensionContext): Promise<void> {
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        const hookScriptPath = path.join(context.extensionPath, 'scripts', 'claude-hook.js').replace(/\\/g, '/');
        const cmdFor = (kind: HookKind): string => {
            switch (kind) {
                case 'alert':     return `node "${hookScriptPath}"`;
                case 'completed': return `node "${hookScriptPath}" --completed`;
                case 'dismiss':   return `node "${hookScriptPath}" --dismiss`;
                case 'tooldone':  return `node "${hookScriptPath}" --tooldone`;
            }
        };

        let settings: ClaudeSettings;
        try {
            if (fs.existsSync(claudeSettingsPath)) {
                settings = parseJsonc<ClaudeSettings>(fs.readFileSync(claudeSettingsPath, 'utf-8'));
            } else {
                settings = {};
            }
        } catch (err) {
            this.log(`CRITICAL: Could not parse Claude settings. Aborting hook registration to prevent file corruption: ${err}`);
            return;
        }

        if (!settings.hooks) settings.hooks = {};

        const upsertHook = (event: string, desiredCommand: string): boolean => {
            const eventHooks = settings.hooks![event] ?? (settings.hooks![event] = []);

            // Find any existing entry that points at our hook script (any path).
            for (const entry of eventHooks) {
                if (!entry.hooks) continue;
                for (const h of entry.hooks) {
                    if (h.command && h.command.includes('claude-hook.js')) {
                        if (h.command === desiredCommand) return false; // already correct
                        h.command = desiredCommand;                     // refresh stale path
                        return true;
                    }
                }
            }

            eventHooks.push({ matcher: '.*', hooks: [{ type: 'command', command: desiredCommand }] });
            return true;
        };

        const changed = HOOK_EVENTS
            .map(({ event, kind }) => upsertHook(event, cmdFor(kind)))
            .some(Boolean);

        if (changed) {
            try {
                atomicWriteJsonFile(claudeSettingsPath, settings);
                this.dlog(`Registered/refreshed hooks in ${claudeSettingsPath}`);
            } catch (err) {
                this.log(`Failed to write settings file: ${err}`);
            }
        }
    }

    /**
     * Remove our hook entries from Claude settings.
     * Only invoked via the explicit cleanup command — NOT on dispose, so
     * shutting down one VS Code window doesn't break hooks for another.
     * Returns whether any hooks were actually removed.
     */
    public unregisterHooks(): boolean {
        return ClaudeCodeAdapter.removeHooksFromSettings(
            path.join(os.homedir(), '.claude', 'settings.json'),
            (msg) => this.log(msg),
        );
    }

    /**
     * Static so the cleanup command can call it without holding an adapter
     * instance (e.g., when the adapter failed to initialize).
     */
    static removeHooksFromSettings(
        claudeSettingsPath: string,
        log: (msg: string) => void = () => {},
    ): boolean {
        if (!fs.existsSync(claudeSettingsPath)) return false;

        try {
            const settings = parseJsonc<ClaudeSettings>(fs.readFileSync(claudeSettingsPath, 'utf-8'));
            let changed = false;

            if (settings.hooks) {
                for (const event of Object.keys(settings.hooks)) {
                    const hooks = settings.hooks[event];
                    if (!Array.isArray(hooks)) continue;

                    const before = hooks.length;
                    settings.hooks[event] = hooks.filter((h) =>
                        !h.hooks?.some((hh) => hh.command && hh.command.includes('claude-hook.js'))
                    );
                    if (settings.hooks[event].length !== before) changed = true;
                    if (settings.hooks[event].length === 0) delete settings.hooks[event];
                }
            }

            if (changed) {
                atomicWriteJsonFile(claudeSettingsPath, settings);
                log('Cleaned up Claude hook registrations.');
            }
            return changed;
        } catch (err) {
            log(`Error during hook cleanup (preventing overwrite): ${err}`);
            return false;
        }
    }

    dispose(): void {
        this.stopTranscriptWatcher();

        try {
            if (this.portFilePath && fs.existsSync(this.portFilePath)) {
                fs.unlinkSync(this.portFilePath);
            }
        } catch { /* ignore */ }

        this.closeServer();

        // NOTE: Hooks are intentionally NOT removed here — see file header.
    }
}
