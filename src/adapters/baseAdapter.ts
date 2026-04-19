/**
 * Base adapter interface.
 * Each adapter detects when a specific AI agent requires user input
 * and triggers the NotificationManager.
 */
import * as vscode from 'vscode';

export interface AgentAdapter extends vscode.Disposable {
    /** Human-readable name of the agent (e.g., "Claude Code") */
    readonly name: string;

    /**
     * Initialize the adapter. Called during extension activation.
     * Should set up event listeners, hooks, or IPC channels.
     * Returns true if the adapter was successfully initialized.
     */
    initialize(context: vscode.ExtensionContext, outputChannel?: vscode.OutputChannel): Promise<boolean>;

    /**
     * Check if this adapter's agent is available in the current environment.
     */
    isAvailable(): boolean;
}
