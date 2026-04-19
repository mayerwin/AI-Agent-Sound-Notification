/**
 * AI Agent Sound Notification — Extension Entry Point
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from './config';
import {
    initNotificationManager,
    triggerNotification,
    dismissNotification,
    registerInteractionListeners,
    disposeNotificationManager,
    refreshActiveTimers,
} from './notificationManager';
import { playSound, getBuiltinSoundPath, disposeAudioPlayer, BUILTIN_SOUNDS } from './audioPlayer';
import { createStatusBarItem, disposeStatusBar } from './statusBar';
import { ClaudeCodeAdapter } from './adapters/claudeCodeAdapter';
import { AgentAdapter } from './adapters/baseAdapter';
import { initLogger, info, debug, bumpDebugCache } from './utils/logger';

let outputChannel: vscode.OutputChannel;
const adapters: AgentAdapter[] = [];

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('AI Agent Sound Notification');
    context.subscriptions.push(outputChannel);

    initLogger(outputChannel);
    const version = context.extension.packageJSON.version ?? 'unknown';
    info(`AI Agent Sound Notification v${version} activating (Node ${process.version}, ${process.platform})...`);

    if (isAntigravity()) {
        info('Detected Google Antigravity host — this extension no longer supports Antigravity. Aborting activation.');
        vscode.window.showErrorMessage(
            'AI Agent Sound Notification does not support Google Antigravity. Please uninstall this extension.',
        );
        return;
    }

    initNotificationManager(context.extensionPath, outputChannel);
    const statusBar = createStatusBarItem();
    context.subscriptions.push(statusBar);
    registerInteractionListeners(context);

    const config = getConfig();
    if (!config.enabled) {
        info('Extension is disabled in settings. Commands and adapters still register; trigger paths will no-op until re-enabled.');
    }
    if (config.debug) {
        info('Debug logging enabled.');
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.triggerAlert', () => {
            triggerNotification('Manual');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.dismissAlert', () => {
            dismissNotification('manual dismiss via command');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.testSound', async () => {
            const freshConfig = getConfig();
            const soundFile = freshConfig.soundFile || getBuiltinSoundPath(context.extensionPath, freshConfig.soundName);
            debug(`Testing sound: ${soundFile}`);
            try {
                await playSound(soundFile);
            } catch (err: any) {
                vscode.window.showErrorMessage(`AI Agent Sound: Failed to play sound. ${err?.message || err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.chooseSound', async () => {
            const freshConfig = getConfig();
            type Item = vscode.QuickPickItem & { name?: string };

            const buildItems = (): Item[] => {
                const items: Item[] = [];
                let lastSource: string | null = null;
                for (const s of BUILTIN_SOUNDS) {
                    if (s.source !== lastSource) {
                        items.push({
                            label: s.source === 'material'
                                ? 'Material Design (Google) — CC-BY 4.0'
                                : 'Built-in synthesized',
                            kind: vscode.QuickPickItemKind.Separator,
                        });
                        lastSource = s.source;
                    }
                    items.push({
                        name: s.name,
                        label: s.label,
                        description: s.name === freshConfig.soundName ? `${s.description}  (current)` : s.description,
                    });
                }
                return items;
            };

            const items = buildItems();

            const qp = vscode.window.createQuickPick<Item>();
            qp.items = items;
            qp.title = 'Choose AI Agent Sound (preview on highlight)';
            qp.placeholder = freshConfig.soundFile
                ? 'Note: a custom soundFile is set and will override this choice.'
                : 'Use ↑/↓ to preview, Enter to select.';
            qp.activeItems = items.filter((i) => i.name === freshConfig.soundName);

            qp.onDidChangeActive((active) => {
                const item = active[0];
                if (!item?.name) return;
                playSound(getBuiltinSoundPath(context.extensionPath, item.name)).catch(() => { /* ignore preview errors */ });
            });

            qp.onDidAccept(async () => {
                const picked = qp.selectedItems[0] || qp.activeItems[0];
                qp.hide();
                if (picked?.name) {
                    await vscode.workspace
                        .getConfiguration('aiAgentSoundNotification')
                        .update('soundName', picked.name, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`AI Agent Sound set to: ${picked.label}`);
                }
            });

            qp.onDidHide(() => qp.dispose());
            qp.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.cleanupClaudeHooks', async () => {
            await cleanupClaudeHooks(outputChannel);
        })
    );

    const previewSound = async (kind: 'alert' | 'completion') => {
        const freshConfig = getConfig();
        const file = kind === 'alert'
            ? (freshConfig.soundFile || getBuiltinSoundPath(context.extensionPath, freshConfig.soundName))
            : (freshConfig.completionSound.file || getBuiltinSoundPath(context.extensionPath, freshConfig.completionSound.name));
        debug(`Preview (${kind}): ${file}`);
        try {
            await playSound(file);
        } catch (err: any) {
            vscode.window.showErrorMessage(`AI Agent Sound: Failed to preview ${kind} sound. ${err?.message || err}`);
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.previewAlertSound', () => previewSound('alert'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.previewCompletionSound', () => previewSound('completion'))
    );

    // Initialize adapters
    if (config.integrations.claudeCode) {
        const claude = new ClaudeCodeAdapter();
        const success = await claude.initialize(context, outputChannel);
        if (success) {
            adapters.push(claude);
            context.subscriptions.push(claude);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgentSoundNotification.resetSettings', () => resetSettings())
    );

    // Hot-reload configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('aiAgentSoundNotification')) {
                bumpDebugCache();
                if (e.affectsConfiguration('aiAgentSoundNotification.debug')) {
                    info(`Debug logging ${getConfig().debug ? 'enabled' : 'disabled'}.`);
                }
                debug('Configuration changed — applying updates to active timers...');
                // Trigger an immediate resync of any active notification timers
                refreshActiveTimers();
            }
        })
    );

    const activeAdapters = adapters.map(a => a.name).join(', ') || 'none';
    info(`AI Agent Sound Notification v${version} activated. Active adapters: ${activeAdapters}`);
}

function isAntigravity(): boolean {
    const appName = vscode.env.appName?.toLowerCase() ?? '';
    if (appName.includes('antigravity')) return true;
    return vscode.extensions.getExtension('google.antigravity') !== undefined;
}

async function resetSettings(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        'Reset all AI Agent Sound Notification settings to their defaults? This affects user (global) settings.',
        { modal: true },
        'Reset',
    );
    if (choice !== 'Reset') return;

    const cfg = vscode.workspace.getConfiguration('aiAgentSoundNotification');
    const props = (vscode.extensions.getExtension('erwin.ai-agent-sound-notification')
        ?.packageJSON?.contributes?.configuration?.properties ?? {}) as Record<string, unknown>;

    const keys = Object.keys(props)
        .map((k) => k.replace(/^aiAgentSoundNotification\./, ''))
        .filter((k) => k.length > 0);

    for (const key of keys) {
        try {
            await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        } catch (err: any) {
            info(`Reset: failed to clear "${key}": ${err?.message || err}`);
        }
    }

    vscode.window.showInformationMessage('AI Agent Sound: settings reset to defaults.');
}

async function cleanupClaudeHooks(channel: vscode.OutputChannel): Promise<void> {
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(claudeSettingsPath)) {
        vscode.window.showInformationMessage('Claude settings file not found.');
        return;
    }

    const removed = ClaudeCodeAdapter.removeHooksFromSettings(
        claudeSettingsPath,
        (msg) => channel.appendLine(msg),
    );

    if (removed) {
        vscode.window.showInformationMessage('Claude hooks removed.');
    } else {
        vscode.window.showInformationMessage('No hooks found to remove (or removal failed — see Output).');
    }
}

export function deactivate() {
    for (const adapter of adapters) {
        adapter.dispose();
    }
    adapters.length = 0;
    disposeNotificationManager();
    disposeStatusBar();
    disposeAudioPlayer();
}
