/**
 * Status bar indicator for active notifications.
 * Shows a bell icon when an agent prompt is pending.
 */
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBarItem(): vscode.StatusBarItem {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'aiAgentSoundNotification.dismissAlert';
        statusBarItem.tooltip = 'AI Agent is waiting for your input — click to dismiss alert';
        hide();
    }
    return statusBarItem;
}

export function showPending(source: string): void {
    if (!statusBarItem) { return; }
    statusBarItem.text = `$(bell-dot) ${source}: Input Required`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.show();
}

export function hide(): void {
    if (!statusBarItem) { return; }
    statusBarItem.text = '$(bell) AI Agent Sound';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.hide();
}

export function disposeStatusBar(): void {
    statusBarItem?.dispose();
    statusBarItem = undefined;
}
