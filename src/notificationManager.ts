/**
 * Notification Manager
 *
 * Manages the lifecycle of a single notification "group" per workspace.
 */
import * as vscode from 'vscode';
import { getConfig, ExtensionConfig } from './config';
import { playSound, isFocusAssistActive, getBuiltinSoundPath, stopSound } from './audioPlayer';
import { showPending, hide } from './statusBar';
import { formatInterval } from './utils/intervalParser';
import { info, debug } from './utils/logger';

const PREFIX = '[NotificationManager]';
const logInfo  = (msg: string) => info(`${PREFIX} ${msg}`);
const logDebug = (msg: string) => debug(`${PREFIX} ${msg}`);

let activeNotification: NotificationState | null = null;
let extensionPath: string = '';
let alertedThisTurn = false;

interface NotificationState {
    source: string;
    startedAt: number;
    initialPlayed: boolean;
    initialTimer: ReturnType<typeof setTimeout> | null;
    repeatTimers: ReturnType<typeof setTimeout>[];
    repeatIndex: number;
    dismissed: boolean;
}

export function initNotificationManager(extPath: string, _channel?: vscode.OutputChannel): void {
    extensionPath = extPath;
    // Output channel is owned by extension.ts and routed through utils/logger.
}

export function triggerNotification(source: string): void {
    const config = getConfig();

    if (!config.enabled) {
        logDebug(`Notification suppressed: extension disabled`);
        return;
    }

    if (activeNotification && !activeNotification.dismissed) {
        logDebug(`Notification already active from ${activeNotification.source}, ignoring new trigger from ${source}`);
        return;
    }

    logDebug(`Notification triggered by ${source} — initial delay: ${formatInterval(config.initialDelayMs)}`);

    const state: NotificationState = {
        source,
        startedAt: Date.now(),
        initialPlayed: false,
        initialTimer: null,
        repeatTimers: [],
        repeatIndex: 0,
        dismissed: false,
    };

    activeNotification = state;
    showPending(source);
    scheduleInitial(state, config, config.initialDelayMs);
}

function scheduleInitial(state: NotificationState, config: ExtensionConfig, delayMs: number): void {
    state.initialTimer = setTimeout(() => {
        if (state.dismissed) { return; }
        const freshConfig = getConfig();
        if (!freshConfig.enabled) { return; }
        state.initialPlayed = true;
        alertedThisTurn = true;
        playAlertSoundIfAllowed(freshConfig, state.source).then(() => {
            if (freshConfig.repeat.enabled && freshConfig.repeat.intervalsMs.length > 0) {
                scheduleNextRepeat(state, freshConfig);
            }
        });
    }, Math.max(0, delayMs));
}

/**
 * Called by an adapter when the user starts a new turn (e.g. Claude
 * UserPromptSubmit). Resets the per-turn "an alert was shown" flag so a
 * subsequent Stop event correctly plays the completion sound for the next turn.
 */
export function notifyTurnReset(): void {
    if (alertedThisTurn) {
        logDebug('Turn reset: clearing alertedThisTurn flag');
    }
    alertedThisTurn = false;
}

/**
 * Called by an adapter when the agent's turn completes.
 * Plays the completion sound iff:
 *   - completion sound is enabled
 *   - no permission alert was shown during this turn
 *   - extension is enabled
 *   - DND is not active (when respectDND is set)
 */
export async function triggerCompletion(source: string): Promise<void> {
    const config = getConfig();

    if (!config.enabled) return;
    if (!config.completionSound.enabled) {
        logDebug(`Completion suppressed: completionSound.enabled = false (source: ${source})`);
        return;
    }
    if (alertedThisTurn) {
        logDebug(`Completion suppressed: alert was shown this turn (source: ${source})`);
        return;
    }

    if (config.respectDND && (await isFocusAssistActive())) {
        logDebug(`Completion suppressed: Focus Assist active (source: ${source})`);
        return;
    }

    const file = config.completionSound.file
        || getBuiltinSoundPath(extensionPath, config.completionSound.name);
    logDebug(`Playing completion sound: ${file} (source: ${source})`);
    try {
        await playSound(file);
    } catch (err) {
        logInfo(`Failed to play completion sound: ${err}`);
    }
}

/**
 * Re-evaluate active timers when configuration changes.
 * If repeat settings changed, we clear pending timers and schedule
 * the next one based on the NEW intervals.
 */
export function refreshActiveTimers(): void {
    if (!activeNotification || activeNotification.dismissed) {
        return;
    }

    const config = getConfig();

    // If extension was disabled, dismiss now
    if (!config.enabled) {
        dismissNotification('extension disabled in settings');
        return;
    }

    logDebug('Configuration changed: Refreshing active notification timers...');

    if (activeNotification.initialTimer) {
        clearTimeout(activeNotification.initialTimer);
        activeNotification.initialTimer = null;
    }
    for (const timer of activeNotification.repeatTimers) {
        clearTimeout(timer);
    }
    activeNotification.repeatTimers = [];

    // If we're still in the initial-delay phase, reschedule the initial sound
    // using the *new* delay, preserving elapsed time.
    if (!activeNotification.initialPlayed) {
        const elapsed = Date.now() - activeNotification.startedAt;
        const remaining = config.initialDelayMs - elapsed;
        logDebug(`Re-scheduling initial sound (elapsed: ${formatInterval(elapsed)}, remaining: ${formatInterval(Math.max(0, remaining))})`);
        scheduleInitial(activeNotification, config, remaining);
        return;
    }

    if (!config.repeat.enabled) {
        logDebug('Repeats disabled: pending timers cleared.');
        return;
    }

    scheduleNextRepeat(activeNotification, config);
}

function scheduleNextRepeat(state: NotificationState, config: ExtensionConfig): void {
    if (state.dismissed) { return; }
    if (state.repeatIndex >= config.repeat.intervalsMs.length) {
        logDebug(`All ${config.repeat.intervalsMs.length} repeat intervals exhausted. Stopping notifications.`);
        return;
    }

    const delayMs = config.repeat.intervalsMs[state.repeatIndex];
    logDebug(`Scheduling repeat #${state.repeatIndex + 1} in ${formatInterval(delayMs)}`);

    const timer = setTimeout(() => {
        if (state.dismissed) { return; }
        const freshConfig = getConfig();
        if (!freshConfig.enabled || !freshConfig.repeat.enabled) {
            logDebug('Repeat cancelled: settings changed');
            return;
        }
        playAlertSoundIfAllowed(freshConfig, state.source).then(() => {
            state.repeatIndex++;
            scheduleNextRepeat(state, freshConfig);
        });
    }, delayMs);

    state.repeatTimers.push(timer);
}

async function playAlertSoundIfAllowed(config: ExtensionConfig, source: string): Promise<void> {
    if (config.respectDND && (await isFocusAssistActive())) {
        logDebug(`Alert suppressed: Focus Assist is active`);
        return;
    }

    const soundFile = config.soundFile || getBuiltinSoundPath(extensionPath, config.soundName);
    logDebug(`Playing alert sound: ${soundFile} (source: ${source})`);

    try {
        await playSound(soundFile);
    } catch (err) {
        logInfo(`Failed to play sound: ${err}`);
    }
}

export function dismissNotification(reason: string = 'user interaction'): void {
    if (!activeNotification || activeNotification.dismissed) {
        return;
    }

    logDebug(`Notification dismissed: ${reason}`);
    activeNotification.dismissed = true;

    if (activeNotification.initialTimer) {
        clearTimeout(activeNotification.initialTimer);
    }
    for (const timer of activeNotification.repeatTimers) {
        clearTimeout(timer);
    }
    activeNotification.repeatTimers = [];

    stopSound();
    hide();
    activeNotification = null;
}

export function isNotificationActive(): boolean {
    return activeNotification !== null && !activeNotification.dismissed;
}

export function registerInteractionListeners(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (!isNotificationActive()) { return; }
            if (e.contentChanges.length === 0) { return; }

            const scheme = e.document.uri.scheme;
            if (scheme === 'file' || scheme === 'untitled') {
                dismissNotification(`file edit: ${e.document.uri.fsPath}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTerminal((terminal) => {
            // Only dismiss when the user explicitly switches to a terminal — not
            // when one is closed (terminal === undefined). onDidOpenTerminal is
            // intentionally NOT used because extensions can spawn terminals.
            if (terminal && isNotificationActive()) {
                dismissNotification('terminal switched');
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor || !isNotificationActive()) return;
            const scheme = editor.document.uri.scheme;
            if (scheme === 'file' || scheme === 'untitled') {
                dismissNotification(`editor focus: ${editor.document.uri.fsPath}`);
            }
        })
    );
}

export function disposeNotificationManager(): void {
    dismissNotification('extension deactivated');
}
