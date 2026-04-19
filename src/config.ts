/**
 * Typed configuration wrapper for extension settings.
 */
import * as vscode from 'vscode';
import { parseInterval, parseIntervals } from './utils/intervalParser';

const SECTION = 'aiAgentSoundNotification';

export interface ExtensionConfig {
    enabled: boolean;
    initialDelayMs: number;
    soundName: string;
    soundFile: string;
    completionSound: {
        enabled: boolean;
        name: string;
        file: string;
    };
    repeat: {
        enabled: boolean;
        intervalsMs: number[];
    };
    respectDND: boolean;
    integrations: {
        claudeCode: boolean;
    };
    debug: boolean;
}

/**
 * Read and parse the full extension configuration.
 */
export function getConfig(): ExtensionConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION);

    const initialDelayStr = cfg.get<string>('initialDelay', '10s');
    const repeatIntervalStrs = cfg.get<string[]>('repeat.intervals', ['1m', '5m', '10m', '30m', '1h', '3h']);

    let initialDelayMs: number;
    try {
        initialDelayMs = parseInterval(initialDelayStr);
    } catch {
        initialDelayMs = 10_000; // fallback
    }

    let intervalsMs: number[];
    try {
        intervalsMs = parseIntervals(repeatIntervalStrs);
    } catch {
        intervalsMs = [60_000, 300_000, 600_000]; // fallback
    }

    return {
        enabled: cfg.get<boolean>('enabled', true),
        initialDelayMs,
        soundName: cfg.get<string>('soundName', 'alert'),
        soundFile: cfg.get<string>('soundFile', ''),
        completionSound: {
            enabled: cfg.get<boolean>('completionSound.enabled', true),
            name: cfg.get<string>('completionSound.name', 'success'),
            file: cfg.get<string>('completionSound.file', ''),
        },
        repeat: {
            enabled: cfg.get<boolean>('repeat.enabled', false),
            intervalsMs,
        },
        respectDND: cfg.get<boolean>('respectDND', false),
        integrations: {
            claudeCode: cfg.get<boolean>('integrations.claudeCode', true),
        },
        debug: cfg.get<boolean>('debug', false),
    };
}
