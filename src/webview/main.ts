/**
 * TRK Viewer WebView Main Entry Point
 * 
 * Handles communication with VS Code extension and
 * initializes the 3D renderer.
 */

import { TrkRenderer, StreamlineData, BoundingBox, RenderMode, ColoringMode } from './trkRenderer';

// Declare VS Code API
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

/**
 * Simple debounce function for performance optimization.
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
function debounce<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    delay: number
): (...args: TArgs) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: TArgs) => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delay);
    };
}

/** Message types from extension */
interface InitMessage {
    type: 'init';
    data: {
        header: {
            dim: [number, number, number];
            voxelSize: [number, number, number];
            format: string;
        };
        streamlines: StreamlineData[];
        totalStreamlines: number;
        displayedStreamlines: number;
        skipFactor: number;
        boundingBox: BoundingBox;
        settings: {
            backgroundColor: string;
            renderMode: RenderMode;
            tubeRadius: number;
            maxStreamlines: number;
            skipThreshold: number;
            extensionVersion: string;
        };
        fileName: string;
        filePath: string;
        format: string;
    };
}

interface UpdateStreamlinesMessage {
    type: 'updateStreamlines';
    data: {
        streamlines: StreamlineData[];
        displayedStreamlines: number;
        skipFactor: number;
        boundingBox: BoundingBox;
    };
}

type ExtensionMessage = InitMessage | UpdateStreamlinesMessage;

/**
 * Main application class.
 */
class TrkViewerApp {
    private vscode: ReturnType<typeof acquireVsCodeApi>;
    private renderer: TrkRenderer | null = null;
    private totalStreamlines: number = 0;
    private maxStreamlines: number = 10000;
    private currentMode: RenderMode = 'lines';

    // UI Elements
    private loadingEl: HTMLElement | null = null;
    private controlsEl: HTMLElement | null = null;
    private displayedCountEl: HTMLElement | null = null;
    private totalCountEl: HTMLElement | null = null;
    private skipFactorEl: HTMLElement | null = null;
    private skipRowEl: HTMLElement | null = null;
    private sliderEl: HTMLInputElement | null = null;
    private btnLines: HTMLElement | null = null;
    private btnTubes: HTMLElement | null = null;
    private btnReset: HTMLElement | null = null;
    private btnBg: HTMLElement | null = null;
    private btnScreenshot: HTMLElement | null = null;
    private btnDownload: HTMLElement | null = null;
    private btnColorOrient: HTMLElement | null = null;
    private btnColorLength: HTMLElement | null = null;
    private btnColorScalar: HTMLButtonElement | null = null;
    private colorLegendOrient: HTMLElement | null = null;
    private colorLegendGradient: HTMLElement | null = null;
    private colorMinEl: HTMLElement | null = null;
    private colorMaxEl: HTMLElement | null = null;
    private filenameEl: HTMLElement | null = null;
    private filepathEl: HTMLElement | null = null;
    private dimensionsEl: HTMLElement | null = null;
    private voxelSizeEl: HTMLElement | null = null;
    private fileVersionEl: HTMLElement | null = null;
    private brightnessSliderEl: HTMLInputElement | null = null;
    private brightnessValueEl: HTMLElement | null = null;
    private fileFormatEl: HTMLElement | null = null;

    // Debounced brightness 
    private debouncedBrightnessUpdate: ((brightness: number) => void) | null = null;

    constructor() {
        this.vscode = acquireVsCodeApi();
        this.initializeElements();
        this.setupEventListeners();
        this.setupMessageHandler();

        // Notify 
        this.vscode.postMessage({ type: 'ready' });
    }

    /**
     * Initialize UI element references.
     */
    private initializeElements(): void {
        this.loadingEl = document.getElementById('loading');
        this.controlsEl = document.getElementById('controls');
        this.displayedCountEl = document.getElementById('displayed-count');
        this.totalCountEl = document.getElementById('total-count');
        this.skipFactorEl = document.getElementById('skip-factor');
        this.skipRowEl = document.getElementById('skip-row');
        this.sliderEl = document.getElementById('streamline-slider') as HTMLInputElement;
        this.btnLines = document.getElementById('btn-lines');
        this.btnTubes = document.getElementById('btn-tubes');
        this.btnReset = document.getElementById('btn-reset');
        this.btnBg = document.getElementById('btn-bg');
        this.btnScreenshot = document.getElementById('btn-screenshot');
        this.btnDownload = document.getElementById('btn-download');
        this.btnColorOrient = document.getElementById('btn-color-orient');
        this.btnColorLength = document.getElementById('btn-color-length');
        this.btnColorScalar = document.getElementById('btn-color-scalar') as HTMLButtonElement;
        this.colorLegendOrient = document.getElementById('color-legend-orient');
        this.colorLegendGradient = document.getElementById('color-legend-gradient');
        this.colorMinEl = document.getElementById('color-min');
        this.colorMaxEl = document.getElementById('color-max');
        this.filenameEl = document.getElementById('filename');
        this.filepathEl = document.getElementById('filepath');
        this.dimensionsEl = document.getElementById('dimensions');
        this.voxelSizeEl = document.getElementById('voxel-size');
        this.fileVersionEl = document.getElementById('file-version');
        this.brightnessSliderEl = document.getElementById('brightness-slider') as HTMLInputElement;
        this.brightnessValueEl = document.getElementById('brightness-value');
        this.fileFormatEl = document.getElementById('file-format');

        // Initialize debounced brightness updater (50ms delay)
        this.debouncedBrightnessUpdate = debounce((brightness: number) => {
            this.renderer?.setBrightness(brightness);
        }, 50);
    }

    /**
     * Setup UI event listeners.
     */
    private setupEventListeners(): void {
        // Streamline count slider
        this.sliderEl?.addEventListener('input', () => {
            const value = parseInt(this.sliderEl!.value, 10);
            this.updateSliderLabel(value);
        });

        this.sliderEl?.addEventListener('change', () => {
            const value = parseInt(this.sliderEl!.value, 10);
            this.requestStreamlineUpdate(value);
        });

        // Render mode buttons
        this.btnLines?.addEventListener('click', () => {
            this.setRenderMode('lines');
        });

        this.btnTubes?.addEventListener('click', () => {
            this.setRenderMode('tubes');
        });

        // Reset view button
        this.btnReset?.addEventListener('click', () => {
            this.renderer?.resetView();
        });

        // Toggle background button
        this.btnBg?.addEventListener('click', () => {
            this.renderer?.toggleBackground();
        });

        // Screenshot button
        this.btnScreenshot?.addEventListener('click', () => {
            if (this.renderer) {
                this.vscode.postMessage({
                    type: 'saveScreenshot',
                    data: this.renderer.captureScreenshot()
                });
            }
        });

        // Download button
        this.btnDownload?.addEventListener('click', () => {
            this.vscode.postMessage({ type: 'downloadFile' });
        });

        // Coloring mode buttons
        this.btnColorOrient?.addEventListener('click', () => this.setColoringMode('orientation'));
        this.btnColorLength?.addEventListener('click', () => this.setColoringMode('length'));
        this.btnColorScalar?.addEventListener('click', () => this.setColoringMode('scalar'));

        // Brightness slider - use debounced updates for performance
        this.brightnessSliderEl?.addEventListener('input', () => {
            const value = parseInt(this.brightnessSliderEl!.value, 10);
            if (this.brightnessValueEl) {
                this.brightnessValueEl.textContent = `${value}%`;
            }
            // Use debounced update to avoid excessive re-renders
            this.debouncedBrightnessUpdate?.(value / 100);
        });
    }

    /**
     * Setup message handler from extension.
     */
    private setupMessageHandler(): void {
        window.addEventListener('message', (event) => {
            const message = event.data as ExtensionMessage;

            switch (message.type) {
                case 'init':
                    this.handleInit(message.data);
                    break;
                case 'updateStreamlines':
                    this.handleUpdateStreamlines(message.data);
                    break;
            }
        });
    }

    /**
     * Handle initial data from extension.
     */
    private handleInit(data: InitMessage['data']): void {
        try {
            // Initialize renderer
            const canvas = document.getElementById('canvas') as HTMLCanvasElement;
            if (!canvas) {
                throw new Error('Canvas element not found');
            }

            this.renderer = new TrkRenderer(canvas);

            // Apply settings
            this.renderer.setBackgroundColor(data.settings.backgroundColor);
            this.renderer.setTubeRadius(data.settings.tubeRadius);
            this.currentMode = data.settings.renderMode;
            this.maxStreamlines = data.settings.maxStreamlines;
            this.totalStreamlines = data.totalStreamlines;

            // Update slider range
            if (this.sliderEl) {
                this.sliderEl.max = Math.min(this.maxStreamlines, this.totalStreamlines).toString();
                this.sliderEl.value = data.displayedStreamlines.toString();
            }

            // Render streamlines
            this.renderer.renderStreamlines(
                data.streamlines,
                data.boundingBox,
                this.currentMode
            );

            // Apply initial brightness from slider (default 20%)
            const initialBrightness = this.brightnessSliderEl
                ? parseInt(this.brightnessSliderEl.value, 10) / 100
                : 0.2;
            this.renderer.setBrightness(initialBrightness);

            // Update UI
            this.updateUI(data.displayedStreamlines, data.totalStreamlines, data.skipFactor);
            this.updateFileInfo(data.fileName, data.filePath, data.header, data.settings.extensionVersion);
            this.updateRenderModeButtons();

            // Enable scalar button only if scalars are available
            const hasScalars = data.streamlines.some(s => s.scalars && s.scalars.length > 0);
            this.updateScalarButtonState(hasScalars);

            // Show UI, hide loading
            if (this.loadingEl) this.loadingEl.style.display = 'none';
            if (this.controlsEl) this.controlsEl.style.display = 'flex';

        } catch (error) {
            this.vscode.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Handle streamline update from extension.
     */
    private handleUpdateStreamlines(data: UpdateStreamlinesMessage['data']): void {
        if (!this.renderer) return;

        this.renderer.renderStreamlines(
            data.streamlines,
            data.boundingBox,
            this.currentMode
        );

        this.updateUI(data.displayedStreamlines, this.totalStreamlines, data.skipFactor);
    }

    /**
     * Update UI elements.
     */
    private updateUI(displayed: number, total: number, skipFactor: number): void {
        if (this.displayedCountEl) {
            this.displayedCountEl.textContent = displayed.toLocaleString();
        }
        if (this.totalCountEl) {
            this.totalCountEl.textContent = total.toLocaleString();
        }
        if (this.skipFactorEl) {
            this.skipFactorEl.textContent = `${skipFactor}x`;
        }
        if (this.skipRowEl) {
            this.skipRowEl.style.display = skipFactor > 1 ? 'flex' : 'none';
        }
    }

    /**
     * Update file info display.
     */
    private updateFileInfo(
        fileName: string,
        filePath: string,
        header: { dim: [number, number, number]; voxelSize: [number, number, number]; format?: string },
        extensionVersion?: string
    ): void {
        if (this.filenameEl) {
            this.filenameEl.textContent = fileName;
            this.filenameEl.title = fileName;
        }
        if (this.filepathEl) {
            // Get directory path (remove filename)
            const dirPath = filePath.replace(/[\\/][^\\/]+$/, '');
            this.filepathEl.textContent = dirPath;
            this.filepathEl.title = filePath;
        }
        if (this.fileFormatEl && header.format) {
            this.fileFormatEl.textContent = header.format;
        }
        if (this.dimensionsEl) {
            const dim = header.dim;
            // Show dimensions or N/A for formats that don't provide them
            if (dim[0] > 0 && dim[1] > 0 && dim[2] > 0) {
                this.dimensionsEl.textContent = `${dim[0]}×${dim[1]}×${dim[2]}`;
            } else {
                this.dimensionsEl.textContent = 'N/A';
            }
        }
        if (this.voxelSizeEl) {
            const vox = header.voxelSize;
            // Show voxel size or N/A for formats that don't provide them
            if (vox[0] > 0 || vox[1] > 0 || vox[2] > 0) {
                this.voxelSizeEl.textContent = `${vox.map(v => v.toFixed(2)).join('×')} mm`;
            } else {
                this.voxelSizeEl.textContent = 'N/A';
            }
        }
        if (this.fileVersionEl && extensionVersion) {
            this.fileVersionEl.textContent = `v${extensionVersion}`;
        }
    }

    /**
     * Update slider label during drag.
     */
    private updateSliderLabel(value: number): void {
        if (this.displayedCountEl) {
            this.displayedCountEl.textContent = value.toLocaleString();
        }
    }

    /**
     * Request streamline update from extension.
     */
    private requestStreamlineUpdate(count: number): void {
        this.vscode.postMessage({
            type: 'updateStreamlineCount',
            count: count
        });
    }

    /**
     * Set render mode.
     */
    private setRenderMode(mode: RenderMode): void {
        if (mode === this.currentMode) return;

        this.currentMode = mode;
        this.renderer?.setRenderMode(mode);
        this.updateRenderModeButtons();
    }

    /**
     * Update render mode button states.
     */
    private updateRenderModeButtons(): void {
        if (this.btnLines && this.btnTubes) {
            if (this.currentMode === 'lines') {
                this.btnLines.classList.add('active');
                this.btnTubes.classList.remove('active');
            } else {
                this.btnLines.classList.remove('active');
                this.btnTubes.classList.add('active');
            }
        }
    }

    /**
     * Set coloring mode.
     */
    private setColoringMode(mode: ColoringMode): void {
        if (!this.renderer) return;

        this.renderer.setColoringMode(mode);
        this.updateColoringModeButtons(mode);
        this.updateColorLegend(mode);
    }

    /**
     * Update coloring mode button states.
     */
    private updateColoringModeButtons(mode: ColoringMode): void {
        this.btnColorOrient?.classList.toggle('active', mode === 'orientation');
        this.btnColorLength?.classList.toggle('active', mode === 'length');
        this.btnColorScalar?.classList.toggle('active', mode === 'scalar');
    }

    /**
     * Update color legend display.
     */
    private updateColorLegend(mode: ColoringMode): void {
        if (this.colorLegendOrient && this.colorLegendGradient) {
            if (mode === 'orientation') {
                this.colorLegendOrient.style.display = 'flex';
                this.colorLegendGradient.style.display = 'none';
            } else {
                this.colorLegendOrient.style.display = 'none';
                this.colorLegendGradient.style.display = 'block';

                // Update legend labels
                if (this.colorMinEl && this.colorMaxEl) {
                    if (mode === 'length') {
                        this.colorMinEl.textContent = 'Short';
                        this.colorMaxEl.textContent = 'Long';
                    } else {
                        this.colorMinEl.textContent = 'Low';
                        this.colorMaxEl.textContent = 'High';
                    }
                }
            }
        }
    }

    /**
     * Enable or disable scalar button based on data availability.
     */
    private updateScalarButtonState(hasScalars: boolean): void {
        if (this.btnColorScalar) {
            this.btnColorScalar.disabled = !hasScalars;
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TrkViewerApp());
} else {
    new TrkViewerApp();
}
