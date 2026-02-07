/**
 * Tractography Editor Provider
 *
 * Provides a custom editor for tractography files (.trk, .tck, .trx)
 * with WebView-based 3D visualization.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { parseTrkFile, TrkData, TrkHeader, applySkipSampling, calculateBoundingBox } from './trkParser';
import { parseTckFile } from './tckParser';
import { parseTrxFile } from './trxParser';
import { Streamline, TractographyFormat, MAX_FILE_SIZE } from './streamlineTypes';

/** Supported file formats */
type FormatInfo = {
    format: TractographyFormat;
    header: TrkHeader | { format: TractographyFormat; dim: [number, number, number]; voxelSize: [number, number, number]; nCount: number; version: number };
    streamlines: Streamline[];
};

/**
 * Custom document for tractography files (TRK, TCK, TRX).
 */
class TractDocument implements vscode.CustomDocument {
    public readonly uri: vscode.Uri;
    public readonly format: TractographyFormat;
    public readonly header: FormatInfo['header'];
    public readonly streamlines: Streamline[];

    private constructor(
        uri: vscode.Uri,
        format: TractographyFormat,
        header: FormatInfo['header'],
        streamlines: Streamline[]
    ) {
        this.uri = uri;
        this.format = format;
        this.header = header;
        this.streamlines = streamlines;
    }

    /**
     * Create a TractDocument from a file URI.
     * Automatically detects format from file extension.
     */
    static async create(uri: vscode.Uri): Promise<TractDocument> {
        const extension = uri.fsPath.split('.').pop()?.toLowerCase() || '';
        const format = TractDocument.getFormatFromExtension(extension);

        const fileData = await vscode.workspace.fs.readFile(uri);

        // Validate file size before processing
        if (fileData.byteLength > MAX_FILE_SIZE) {
            throw new Error(
                `File too large: ${(fileData.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
            );
        }

        // Create a proper ArrayBuffer copy from Uint8Array
        const buffer = new ArrayBuffer(fileData.byteLength);
        new Uint8Array(buffer).set(fileData);

        const { header, streamlines } = TractDocument.parseFile(buffer, format);

        return new TractDocument(uri, format, header, streamlines);
    }

    /**
     * Determine format from file extension.
     */
    private static getFormatFromExtension(extension: string): TractographyFormat {
        switch (extension) {
            case 'tck':
                return 'tck';
            case 'trx':
                return 'trx';
            case 'trk':
            default:
                return 'trk';
        }
    }

    /**
     * Parse file based on format.
     */
    private static parseFile(buffer: ArrayBuffer, format: TractographyFormat): FormatInfo {
        switch (format) {
            case 'tck': {
                const data = parseTckFile(buffer);
                return {
                    format: 'tck',
                    header: {
                        format: 'tck',
                        dim: data.header.dim,
                        voxelSize: data.header.voxelSize,
                        nCount: data.header.nCount,
                        version: data.header.version
                    },
                    streamlines: data.streamlines
                };
            }
            case 'trx': {
                const data = parseTrxFile(buffer);
                return {
                    format: 'trx',
                    header: {
                        format: 'trx',
                        dim: data.header.dim,
                        voxelSize: data.header.voxelSize,
                        nCount: data.header.nCount,
                        version: data.header.version
                    },
                    streamlines: data.streamlines
                };
            }
            case 'trk':
            default: {
                const data = parseTrkFile(buffer);
                return {
                    format: 'trk',
                    header: data.header,
                    streamlines: data.streamlines
                };
            }
        }
    }

    dispose(): void {
        // Clear streamlines array to help garbage collection
        (this.streamlines as Streamline[]).length = 0;
    }
}

/**
 * Provider for tractography file custom editors.
 */
export class TrkEditorProvider implements vscode.CustomReadonlyEditorProvider<TractDocument> {
    public static readonly viewType = 'tractview.trkViewer';

    private readonly extensionUri: vscode.Uri;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
    }

    /**
     * Register this provider with VS Code.
     */
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new TrkEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            TrkEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    /**
     * Open a tractography file as a custom document.
     */
    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<TractDocument> {
        return TractDocument.create(uri);
    }

    /**
     * Resolve a custom editor for the document.
     */
    async resolveCustomEditor(
        document: TractDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Configure webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                vscode.Uri.joinPath(this.extensionUri, 'media')
            ]
        };

        // Set webview HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Get configuration
        const config = vscode.workspace.getConfiguration('tractview');
        const maxStreamlines = config.get<number>('maxStreamlines', 10000);
        const skipThreshold = config.get<number>('skipThreshold', 5000);
        const backgroundColor = config.get<string>('backgroundColor', '#2d2d2d');
        const defaultRenderMode = config.get<string>('defaultRenderMode', 'lines');
        const tubeRadius = config.get<number>('tubeRadius', 0.3);

        // Apply skip sampling
        const { sampled, skipFactor, totalCount } = applySkipSampling(
            document.streamlines,
            maxStreamlines,
            skipThreshold
        );

        // Calculate bounding box
        const boundingBox = calculateBoundingBox(sampled);

        // Prepare streamline data for WebView with length and scalars
        // Note: Array.from() is required for JSON serialization over postMessage.
        const streamlineData = sampled.map(s => {
            // Calculate streamline length
            let length = 0;
            for (let i = 0; i < s.numPoints - 1; i++) {
                const dx = s.points[(i + 1) * 3] - s.points[i * 3];
                const dy = s.points[(i + 1) * 3 + 1] - s.points[i * 3 + 1];
                const dz = s.points[(i + 1) * 3 + 2] - s.points[i * 3 + 2];
                length += Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            return {
                points: Array.from(s.points),
                numPoints: s.numPoints,
                length,
                // Pass first scalar channel if available (TRK format only)
                scalars: s.scalars && s.scalars.length > 0
                    ? Array.from(s.scalars[0])
                    : undefined
            };
        });

        // Get format-specific header info
        const headerInfo = this.getHeaderInfo(document);

        // Send initial data to webview when ready
        const sendInitialData = () => {
            webviewPanel.webview.postMessage({
                type: 'init',
                data: {
                    header: headerInfo,
                    streamlines: streamlineData,
                    totalStreamlines: totalCount,
                    displayedStreamlines: sampled.length,
                    skipFactor: skipFactor,
                    boundingBox: boundingBox,
                    settings: {
                        backgroundColor,
                        renderMode: defaultRenderMode,
                        tubeRadius,
                        maxStreamlines,
                        skipThreshold,
                        extensionVersion: '1.0.0'
                    },
                    fileName: document.uri.fsPath.split(/[/\\]/).pop() || 'unknown',
                    filePath: document.uri.fsPath,
                    format: document.format
                }
            });
        };

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'ready':
                        sendInitialData();
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(`TRK Viewer: ${message.error}`);
                        break;
                    case 'updateStreamlineCount':
                        // Re-sample with new count
                        const newCount = message.count;
                        const { sampled: newSampled, skipFactor: newSkip } = applySkipSampling(
                            document.streamlines,
                            newCount,
                            skipThreshold
                        );
                        const newBoundingBox = calculateBoundingBox(newSampled);
                        const newStreamlineData = newSampled.map(s => {
                            let length = 0;
                            for (let i = 0; i < s.numPoints - 1; i++) {
                                const dx = s.points[(i + 1) * 3] - s.points[i * 3];
                                const dy = s.points[(i + 1) * 3 + 1] - s.points[i * 3 + 1];
                                const dz = s.points[(i + 1) * 3 + 2] - s.points[i * 3 + 2];
                                length += Math.sqrt(dx * dx + dy * dy + dz * dz);
                            }
                            return {
                                points: Array.from(s.points),
                                numPoints: s.numPoints,
                                length,
                                scalars: s.scalars && s.scalars.length > 0
                                    ? Array.from(s.scalars[0])
                                    : undefined
                            };
                        });
                        webviewPanel.webview.postMessage({
                            type: 'updateStreamlines',
                            data: {
                                streamlines: newStreamlineData,
                                displayedStreamlines: newSampled.length,
                                skipFactor: newSkip,
                                boundingBox: newBoundingBox
                            }
                        });
                        break;
                    case 'saveScreenshot':
                        this.handleSaveScreenshot(message.data, document.uri.fsPath);
                        break;
                    case 'downloadFile':
                        this.handleDownloadFile(document.uri);
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * Get format-specific header information.
     */
    private getHeaderInfo(document: TractDocument): {
        dim: [number, number, number];
        voxelSize: [number, number, number];
        format: string;
    } {
        const header = document.header;

        // Handle TRK header (has more fields)
        if ('idString' in header) {
            return {
                dim: header.dim,
                voxelSize: header.voxelSize,
                format: 'TRK (TrackVis)'
            };
        }

        // Handle unified header (TCK/TRX)
        const formatName = document.format === 'tck' ? 'TCK (MRtrix)' : 'TRX';
        return {
            dim: header.dim,
            voxelSize: header.voxelSize,
            format: formatName
        };
    }

    /**
     * Handle screenshot save request from webview.
     * @param imageData - Base64-encoded PNG data URL
     * @param filePath - Original file path for default name
     */
    private async handleSaveScreenshot(imageData: string, filePath: string): Promise<void> {
        try {
            const defaultName = filePath.replace(/\.(trk|tck|trx)$/i, '_screenshot.png');
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultName),
                filters: { 'PNG Images': ['png'] }
            });

            if (saveUri && imageData) {
                // Convert base64 data URL to buffer
                const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                await vscode.workspace.fs.writeFile(saveUri, buffer);
                vscode.window.showInformationMessage(`Screenshot saved to ${saveUri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to save screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Handle file download request from webview.
     * @param uri - Original file URI
     */
    private async handleDownloadFile(uri: vscode.Uri): Promise<void> {
        try {
            const originalName = uri.fsPath.split(/[/\\]/).pop() || 'download';
            const extension = uri.fsPath.split('.').pop()?.toLowerCase() || 'trk';
            const filterName = extension.toUpperCase() + ' Files';

            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(originalName),
                filters: { [filterName]: [extension] }
            });

            if (saveUri) {
                const fileData = await vscode.workspace.fs.readFile(uri);
                await vscode.workspace.fs.writeFile(saveUri, fileData);
                vscode.window.showInformationMessage(`File saved to ${saveUri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Generate HTML content for the WebView.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
        );

        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
    <title>TRK Viewer</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #2d2d2d;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #container {
            width: 100%;
            height: 100%;
            position: relative;
        }
        #canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        #controls {
            position: absolute;
            top: 10px;
            left: 10px;
            bottom: 10px;
            width: 200px;
            background: rgba(25, 25, 30, 0.95);
            backdrop-filter: blur(12px);
            border-radius: 10px;
            padding: 14px;
            color: #cdd6f4;
            font-size: 11px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.06);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }
        #controls::-webkit-scrollbar {
            width: 4px;
        }
        #controls::-webkit-scrollbar-track {
            background: transparent;
        }
        #controls::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: 2px;
        }
        .panel-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .panel-header h3 {
            font-size: 13px;
            font-weight: 600;
            color: #89b4fa;
            letter-spacing: 0.3px;
            margin: 0;
        }
        .panel-icon {
            width: 32px;
            height: 32px;
            border-radius: 5px;
            object-fit: contain;
        }
        .section {
            margin-bottom: 14px;
        }
        .section:last-child {
            margin-bottom: 0;
        }
        .section-title {
            font-size: 9px;
            font-weight: 600;
            color: #6c7086;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 8px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            padding: 4px 0;
        }
        .info-row:last-child {
            margin-bottom: 0;
        }
        .info-label {
            color: #a6adc8;
            font-size: 10px;
        }
        .info-value {
            color: #cdd6f4;
            font-size: 10px;
            font-weight: 500;
            text-align: right;
        }
        .info-value.highlight {
            color: #a6e3a1;
        }
        .info-value.filename {
            color: #f9e2af;
            font-weight: 600;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .info-value.filepath {
            color: #7f849c;
            font-size: 9px;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .info-value.format-badge {
            color: #cba6f7;
            font-size: 9px;
            background: rgba(203, 166, 247, 0.15);
            padding: 2px 6px;
            border-radius: 3px;
        }
        .divider {
            height: 1px;
            background: rgba(255,255,255,0.06);
            margin: 12px 0;
        }
        input[type="range"] {
            width: 100%;
            height: 4px;
            margin: 8px 0;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            outline: none;
            -webkit-appearance: none;
        }
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #89b4fa;
            cursor: pointer;
            border: 2px solid #1e1e2e;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        input[type="range"]::-webkit-slider-thumb:hover {
            background: #b4befe;
            transform: scale(1.1);
        }
        .btn-row {
            display: flex;
            gap: 6px;
        }
        .btn {
            flex: 1;
            padding: 7px 6px;
            font-size: 9px;
            font-weight: 600;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.15s ease;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .btn-mode {
            background: rgba(137, 180, 250, 0.15);
            color: #89b4fa;
            border: 1px solid rgba(137, 180, 250, 0.25);
        }
        .btn-mode:hover {
            background: rgba(137, 180, 250, 0.25);
        }
        .btn-mode.active {
            background: #89b4fa;
            color: #1e1e2e;
            border-color: #89b4fa;
        }
        .btn-mode:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .btn-mode:disabled:hover {
            background: rgba(137, 180, 250, 0.15);
        }
        .btn-action {
            flex: 1;
            padding: 7px 6px;
            background: rgba(166, 173, 200, 0.1);
            color: #a6adc8;
            border: 1px solid rgba(166, 173, 200, 0.15);
        }
        .btn-action:hover {
            background: rgba(166, 173, 200, 0.2);
            color: #cdd6f4;
        }
        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #89b4fa;
            font-size: 13px;
            font-weight: 500;
        }
        .skip-badge {
            display: inline-block;
            background: rgba(250, 179, 135, 0.2);
            color: #fab387;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: 600;
        }
        .color-legend {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .color-item {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 9px;
            color: #6c7086;
        }
        .color-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .color-dot.x { background: #f38ba8; }
        .color-dot.y { background: #a6e3a1; }
        .color-dot.z { background: #89b4fa; }
        .spacer {
            flex: 1;
        }
    </style>
</head>
<body>
    <div id="container">
        <canvas id="canvas"></canvas>
        <div class="loading" id="loading">Loading tractography...</div>
        <div id="controls" style="display: none;">
            <div class="panel-header">
                <img class="panel-icon" src="${iconUri}" alt="TractView">
                <h3>TractView</h3>
            </div>
            
            <div class="section">
                <div class="section-title">File Info</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value filename" id="filename" title="">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Path</span>
                    <span class="info-value filepath" id="filepath" title="">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Format</span>
                    <span class="info-value format-badge" id="file-format">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Dimensions</span>
                    <span class="info-value" id="dimensions">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Voxel Size</span>
                    <span class="info-value" id="voxel-size">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Version</span>
                    <span class="info-value" id="file-version">-</span>
                </div>
            </div>
            
            <div class="divider"></div>
            
            <div class="section">
                <div class="section-title">Streamlines</div>
                <div class="info-row">
                    <span class="info-label">Total</span>
                    <span class="info-value" id="total-count">0</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Displayed</span>
                    <span class="info-value highlight" id="displayed-count">0</span>
                </div>
                <div class="info-row" id="skip-row" style="display: none;">
                    <span class="info-label">Skip Factor</span>
                    <span class="skip-badge" id="skip-factor">1x</span>
                </div>
                <input type="range" id="streamline-slider" min="100" max="10000" value="5000">
                <div class="info-row" style="margin-top: 8px;">
                    <span class="info-label">Brightness</span>
                    <span class="info-value" id="brightness-value">20%</span>
                </div>
                <input type="range" id="brightness-slider" min="20" max="150" value="20">
            </div>
            
            <div class="divider"></div>
            
            <div class="section">
                <div class="section-title">Render Mode</div>
                <div class="btn-row">
                    <button class="btn btn-mode active" id="btn-lines">Lines</button>
                    <button class="btn btn-mode" id="btn-tubes">Tubes</button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Coloring</div>
                <div class="btn-row">
                    <button class="btn btn-mode active" id="btn-color-orient">Dir</button>
                    <button class="btn btn-mode" id="btn-color-length">Len</button>
                    <button class="btn btn-mode" id="btn-color-scalar" disabled>Scalar</button>
                </div>
                <div class="color-legend" id="color-legend-orient">
                    <div class="color-item"><div class="color-dot x"></div>X</div>
                    <div class="color-item"><div class="color-dot y"></div>Y</div>
                    <div class="color-item"><div class="color-dot z"></div>Z</div>
                </div>
                <div class="color-legend" id="color-legend-gradient" style="display: none;">
                    <div style="width: 100%; height: 8px; background: linear-gradient(to right, blue, cyan, green, yellow, red); border-radius: 2px;"></div>
                    <div style="display: flex; justify-content: space-between; font-size: 8px; color: #6c7086; margin-top: 2px;">
                        <span id="color-min">Min</span>
                        <span id="color-max">Max</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Actions</div>
                <div class="btn-row">
                    <button class="btn btn-action" id="btn-reset">Reset</button>
                    <button class="btn btn-action" id="btn-bg">BG</button>
                </div>
                <div class="btn-row" style="margin-top: 6px;">
                    <button class="btn btn-action" id="btn-screenshot">Screenshot</button>
                    <button class="btn btn-action" id="btn-download">Download</button>
                </div>
            </div>
            
            <div class="spacer"></div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/**
 * Generate a cryptographically secure random nonce for CSP.
 */
function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}
