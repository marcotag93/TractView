/**
 * TractView Extension Entry Point
 * 
 * VS Code extension for viewing .trk tractography files.
 */

import * as vscode from 'vscode';
import { TrkEditorProvider } from './trkEditorProvider';

/**
 * Extension activation.
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('TractView extension activated');

    // Register custom editor provider
    context.subscriptions.push(TrkEditorProvider.register(context));

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('tractview.resetView', () => {
            vscode.window.showInformationMessage('Use the Reset View button in the viewer panel');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tractview.toggleRenderMode', () => {
            vscode.window.showInformationMessage('Use the Lines/Tubes buttons in the viewer panel');
        })
    );
}

/**
 * Extension deactivation.
 */
export function deactivate(): void {
    console.log('TractView extension deactivated');
}
