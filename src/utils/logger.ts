/**
 * Centralized logging.
 *
 *   info(msg)  — always written. Reserve for activation, errors, warnings.
 *   debug(msg) — written only when `aiAgentSoundNotification.debug` is true.
 *
 * The debug flag is read from VS Code settings with a 1-second cache so that
 * high-frequency events (audio spawns, timer fires) don't hammer the config API.
 * The cache is also invalidated immediately by `bumpDebugCache()`, which the
 * extension calls from its onDidChangeConfiguration listener.
 */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initLogger(c: vscode.OutputChannel): void {
    channel = c;
}

/** Always logged. Use for activation messages, errors, and warnings. */
export function info(msg: string): void {
    channel?.appendLine(msg);
}

/** Logged only when the `debug` setting is enabled. */
export function debug(msg: string): void {
    if (!isDebugEnabled()) return;
    channel?.appendLine(msg);
}

let cachedDebug: boolean | undefined;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 1000;

function isDebugEnabled(): boolean {
    const now = Date.now();
    if (cachedDebug === undefined || now >= cacheExpiresAt) {
        try {
            cachedDebug = vscode.workspace
                .getConfiguration('aiAgentSoundNotification')
                .get<boolean>('debug', false);
        } catch {
            cachedDebug = false;
        }
        cacheExpiresAt = now + CACHE_TTL_MS;
    }
    return !!cachedDebug;
}

/**
 * Invalidate the cached debug flag. Call from onDidChangeConfiguration so the
 * next log call re-reads the setting immediately rather than waiting up to 1s.
 */
export function bumpDebugCache(): void {
    cachedDebug = undefined;
    cacheExpiresAt = 0;
}
