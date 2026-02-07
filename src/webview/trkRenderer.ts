/**
 * TRK 3D Renderer
 * 
 * Three.js-based renderer for tractography streamlines.
 * Supports both line and tube rendering modes.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Streamline data structure */
export interface StreamlineData {
    points: number[];
    numPoints: number;
    /** Optional per-point scalar values (TRK only) */
    scalars?: number[];
    /** Calculated length in mm */
    length?: number;
}

/** Bounding box data */
export interface BoundingBox {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: number;
}

/** Render mode type */
export type RenderMode = 'lines' | 'tubes';

/** Coloring mode type */
export type ColoringMode = 'orientation' | 'length' | 'scalar';

/**
 * TRK 3D Renderer class.
 */
export class TrkRenderer {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private tractGroup: THREE.Group;
    private boundingBox: BoundingBox | null = null;
    private streamlines: StreamlineData[] = [];
    private currentMode: RenderMode = 'lines';
    private tubeRadius: number = 0.3;
    private initialCameraPosition: THREE.Vector3 = new THREE.Vector3();
    private initialTarget: THREE.Vector3 = new THREE.Vector3();
    private darkBackground: boolean = false;
    private animationId: number | null = null;
    private brightness: number = 1.0;
    // Store original colors for efficient brightness updates
    private originalColors: Float32Array | null = null;
    // Coloring mode state
    private currentColoringMode: ColoringMode = 'orientation';
    private minLength: number = 0;
    private maxLength: number = 1;
    private minScalar: number = 0;
    private maxScalar: number = 1;
    private hasScalars: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2d2d2d);

        // Camera setup
        const aspect = canvas.clientWidth / canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
        this.camera.position.set(0, 0, 200);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Orbit controls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.8;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.8;

        // Group for tractography
        this.tractGroup = new THREE.Group();
        this.scene.add(this.tractGroup);

        // Lighting for tubes
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 100);
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-100, -100, -100);
        this.scene.add(directionalLight2);

        // Handle resize
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);

        // Start render loop
        this.animate();
    }

    /**
     * Render streamlines.
     */
    public renderStreamlines(
        streamlines: StreamlineData[],
        boundingBox: BoundingBox,
        mode?: RenderMode
    ): void {
        this.streamlines = streamlines;
        this.boundingBox = boundingBox;

        if (mode) {
            this.currentMode = mode;
        }

        // Clear previous geometry
        this.clearTract();

        if (streamlines.length === 0) {
            return;
        }

        if (this.currentMode === 'tubes') {
            this.renderAsTubes(streamlines);
        } else {
            this.renderAsLines(streamlines);
        }

        // Center camera on first render
        this.centerCamera(boundingBox);
    }

    /**
     * Render streamlines as lines (fast).
     * Supports orientation, length, and scalar coloring modes.
     */
    private renderAsLines(streamlines: StreamlineData[]): void {
        // Calculate color ranges for normalization
        this.calculateColorRanges(streamlines);

        // Calculate total vertices needed
        let totalVertices = 0;
        for (const s of streamlines) {
            if (s.numPoints >= 2) {
                totalVertices += (s.numPoints - 1) * 2; // Line segments
            }
        }

        if (totalVertices === 0) return;

        // Create buffer arrays
        const positions = new Float32Array(totalVertices * 3);
        const colors = new Float32Array(totalVertices * 3);

        let vertexIndex = 0;

        for (const streamline of streamlines) {
            const points = streamline.points;
            const numPoints = streamline.numPoints;

            if (numPoints < 2) continue;

            // Calculate color based on current coloring mode
            let r: number, g: number, b: number;
            let usePerPointColor = false;

            if (this.currentColoringMode === 'length' && streamline.length !== undefined) {
                // Length-based coloring (uniform per streamline)
                const lengthRange = this.maxLength - this.minLength || 1;
                const normalizedLength = (streamline.length - this.minLength) / lengthRange;
                [r, g, b] = this.valueToRainbowColor(normalizedLength);
            } else if (this.currentColoringMode === 'scalar' && streamline.scalars) {
                // Scalar-based: use per-point coloring
                usePerPointColor = true;
                r = g = b = 0; // per-point
            } else {
                // Default: orientation-based coloring
                const startIdx = 0;
                const endIdx = (numPoints - 1) * 3;
                const dx = Math.abs(points[endIdx] - points[startIdx]);
                const dy = Math.abs(points[endIdx + 1] - points[startIdx + 1]);
                const dz = Math.abs(points[endIdx + 2] - points[startIdx + 2]);
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                r = dx / len;
                g = dy / len;
                b = dz / len;
            }

            for (let i = 0; i < numPoints - 1; i++) {
                const idx1 = i * 3;
                const idx2 = (i + 1) * 3;

                // Start point
                positions[vertexIndex * 3] = points[idx1];
                positions[vertexIndex * 3 + 1] = points[idx1 + 1];
                positions[vertexIndex * 3 + 2] = points[idx1 + 2];

                // End point
                positions[vertexIndex * 3 + 3] = points[idx2];
                positions[vertexIndex * 3 + 4] = points[idx2 + 1];
                positions[vertexIndex * 3 + 5] = points[idx2 + 2];

                // Per-point scalar coloring
                if (usePerPointColor && streamline.scalars) {
                    const scalarRange = this.maxScalar - this.minScalar || 1;
                    const scalar1 = streamline.scalars[i] ?? 0;
                    const scalar2 = streamline.scalars[i + 1] ?? scalar1;
                    const norm1 = (scalar1 - this.minScalar) / scalarRange;
                    const norm2 = (scalar2 - this.minScalar) / scalarRange;
                    const [r1, g1, b1] = this.valueToRainbowColor(norm1);
                    const [r2, g2, b2] = this.valueToRainbowColor(norm2);

                    colors[vertexIndex * 3] = r1;
                    colors[vertexIndex * 3 + 1] = g1;
                    colors[vertexIndex * 3 + 2] = b1;
                    colors[vertexIndex * 3 + 3] = r2;
                    colors[vertexIndex * 3 + 4] = g2;
                    colors[vertexIndex * 3 + 5] = b2;
                } else {
                    // Uniform color for streamline
                    colors[vertexIndex * 3] = r;
                    colors[vertexIndex * 3 + 1] = g;
                    colors[vertexIndex * 3 + 2] = b;
                    colors[vertexIndex * 3 + 3] = r;
                    colors[vertexIndex * 3 + 4] = g;
                    colors[vertexIndex * 3 + 5] = b;
                }

                vertexIndex += 2;
            }
        }

        // Create geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Create material
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 1
        });

        // Create mesh
        const lines = new THREE.LineSegments(geometry, material);
        this.tractGroup.add(lines);

        // Store original colors for brightness adjustments
        this.originalColors = new Float32Array(colors);
    }

    /**
     * Render streamlines as tubes (high quality, slower).
     * Supports orientation, length, and scalar coloring modes.
     */
    private renderAsTubes(streamlines: StreamlineData[]): void {
        // Calculate color ranges for normalization
        this.calculateColorRanges(streamlines);

        const radialSegments = 6;

        // Limit tubes for performance
        const maxTubes = Math.min(streamlines.length, 2000);
        const step = Math.max(1, Math.floor(streamlines.length / maxTubes));

        for (let i = 0; i < streamlines.length && this.tractGroup.children.length < maxTubes; i += step) {
            const streamline = streamlines[i];
            if (streamline.numPoints < 2) continue;

            // Create curve points
            const curvePoints: THREE.Vector3[] = [];
            for (let j = 0; j < streamline.numPoints; j++) {
                curvePoints.push(new THREE.Vector3(
                    streamline.points[j * 3],
                    streamline.points[j * 3 + 1],
                    streamline.points[j * 3 + 2]
                ));
            }

            // Skip if too few points
            if (curvePoints.length < 2) continue;

            // Create curve
            const curve = new THREE.CatmullRomCurve3(curvePoints);

            // Calculate color based on current coloring mode
            let color: THREE.Color;

            if (this.currentColoringMode === 'length' && streamline.length !== undefined) {
                // Length-based coloring
                const lengthRange = this.maxLength - this.minLength || 1;
                const normalizedLength = (streamline.length - this.minLength) / lengthRange;
                const [r, g, b] = this.valueToRainbowColor(normalizedLength);
                color = new THREE.Color(r, g, b);
            } else if (this.currentColoringMode === 'scalar' && streamline.scalars) {
                // Scalar-based: use average scalar value for tube color
                const avgScalar = streamline.scalars.reduce((a, b) => a + b, 0) / streamline.scalars.length;
                const scalarRange = this.maxScalar - this.minScalar || 1;
                const norm = (avgScalar - this.minScalar) / scalarRange;
                const [r, g, b] = this.valueToRainbowColor(norm);
                color = new THREE.Color(r, g, b);
            } else {
                // Default: orientation-based coloring
                const start = curvePoints[0];
                const end = curvePoints[curvePoints.length - 1];
                const dx = Math.abs(end.x - start.x);
                const dy = Math.abs(end.y - start.y);
                const dz = Math.abs(end.z - start.z);
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                color = new THREE.Color(dx / len, dy / len, dz / len);
            }

            // Create tube geometry
            const geometry = new THREE.TubeGeometry(
                curve,
                Math.min(4 * streamline.numPoints, 64),
                this.tubeRadius,
                radialSegments,
                false
            );

            // Create material with the calculated color
            const material = new THREE.MeshLambertMaterial({
                color: color
            });

            // Create mesh
            const tube = new THREE.Mesh(geometry, material);
            this.tractGroup.add(tube);
        }
    }

    /**
     * Clear tractography from scene.
     */
    private clearTract(): void {
        while (this.tractGroup.children.length > 0) {
            const child = this.tractGroup.children[0];
            if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            this.tractGroup.remove(child);
        }
    }

    /**
     * Center camera on bounding box.
     */
    private centerCamera(boundingBox: BoundingBox): void {
        const center = new THREE.Vector3(...boundingBox.center);
        const size = boundingBox.size;

        // Position camera at a distance based on bounding box size
        const distance = size * 1.5;
        this.camera.position.set(
            center.x + distance * 0.5,
            center.y + distance * 0.3,
            center.z + distance
        );

        this.controls.target.copy(center);
        this.controls.update();

        // Store initial position for reset
        this.initialCameraPosition.copy(this.camera.position);
        this.initialTarget.copy(center);
    }

    /**
     * Reset camera to initial view.
     */
    public resetView(): void {
        if (this.boundingBox) {
            this.camera.position.copy(this.initialCameraPosition);
            this.controls.target.copy(this.initialTarget);
            this.controls.update();
        }
    }

    /**
     * Set render mode.
     */
    public setRenderMode(mode: RenderMode): void {
        if (mode === this.currentMode) return;

        this.currentMode = mode;

        if (this.streamlines.length > 0 && this.boundingBox) {
            this.clearTract();
            if (mode === 'tubes') {
                this.renderAsTubes(this.streamlines);
            } else {
                this.renderAsLines(this.streamlines);
            }
        }
    }

    /**
     * Get current render mode.
     */
    public getRenderMode(): RenderMode {
        return this.currentMode;
    }

    /**
     * Set tube radius.
     */
    public setTubeRadius(radius: number): void {
        this.tubeRadius = radius;
    }

    /**
     * Map a normalized value (0-1) to a rainbow color.
     * Blue (cold/low) -> Cyan -> Green -> Yellow -> Red (hot/high)
     * @param value - Normalized value between 0 and 1
     * @returns RGB color as [r, g, b] (0-1 range)
     */
    private valueToRainbowColor(value: number): [number, number, number] {
        const v = Math.max(0, Math.min(1, value));
        // Rainbow: blue -> cyan -> green -> yellow -> red
        const hue = (1 - v) * 0.7; // 0.7 = blue, 0 = red

        // HSV to RGB conversion (S=1, V=1)
        const h = hue * 6;
        const i = Math.floor(h);
        const f = h - i;

        let r = 0, g = 0, b = 0;
        switch (i % 6) {
            case 0: r = 1; g = f; b = 0; break;
            case 1: r = 1 - f; g = 1; b = 0; break;
            case 2: r = 0; g = 1; b = f; break;
            case 3: r = 0; g = 1 - f; b = 1; break;
            case 4: r = f; g = 0; b = 1; break;
            case 5: r = 1; g = 0; b = 1 - f; break;
        }

        return [r, g, b];
    }

    /**
     * Calculate color value ranges for normalization.
     * @param streamlines - Array of streamline data
     */
    private calculateColorRanges(streamlines: StreamlineData[]): void {
        this.minLength = Infinity;
        this.maxLength = -Infinity;
        this.minScalar = Infinity;
        this.maxScalar = -Infinity;
        this.hasScalars = false;

        for (const s of streamlines) {
            if (s.length !== undefined) {
                this.minLength = Math.min(this.minLength, s.length);
                this.maxLength = Math.max(this.maxLength, s.length);
            }
            if (s.scalars && s.scalars.length > 0) {
                this.hasScalars = true;
                for (const v of s.scalars) {
                    this.minScalar = Math.min(this.minScalar, v);
                    this.maxScalar = Math.max(this.maxScalar, v);
                }
            }
        }

        // Handle edge cases
        if (!isFinite(this.minLength)) this.minLength = 0;
        if (!isFinite(this.maxLength)) this.maxLength = 1;
        if (!isFinite(this.minScalar)) this.minScalar = 0;
        if (!isFinite(this.maxScalar)) this.maxScalar = 1;
    }

    /**
     * Set the coloring mode for streamlines.
     * @param mode - The coloring mode to use
     */
    public setColoringMode(mode: ColoringMode): void {
        if (mode === this.currentColoringMode) return;

        // Don't allow scalar mode if no scalars available
        if (mode === 'scalar' && !this.hasScalars) {
            console.warn('Scalar coloring not available: no scalar data');
            return;
        }

        this.currentColoringMode = mode;

        // Re-render with new coloring
        if (this.streamlines.length > 0 && this.boundingBox) {
            this.clearTract();
            if (this.currentMode === 'tubes') {
                this.renderAsTubes(this.streamlines);
            } else {
                this.renderAsLines(this.streamlines);
            }
        }
    }

    /**
     * Get current coloring mode.
     */
    public getColoringMode(): ColoringMode {
        return this.currentColoringMode;
    }

    /**
     * Check if scalar data is available.
     */
    public hasScalarData(): boolean {
        return this.hasScalars;
    }

    /**
     * Set brightness of streamlines by adjusting scene lighting and vertex colors.
     * @param brightness - Value from 0.2 to 1.5 where 1 is normal brightness
     */
    public setBrightness(brightness: number): void {
        this.brightness = brightness;

        // Adjust all lights in the scene (for tubes) - use higher multipliers for more visible effect
        this.scene.traverse((object) => {
            if (object instanceof THREE.AmbientLight) {
                // Increased base intensity for better tube visibility
                object.intensity = 0.4 + (brightness * 1.2);
            } else if (object instanceof THREE.DirectionalLight) {
                // Scale directional lights with stronger effect
                if (object.position.x > 0) {
                    object.intensity = 0.5 + (brightness * 1.5);
                } else {
                    object.intensity = 0.3 + (brightness * 0.8);
                }
            }
        });

        // Update vertex colors for lines directly (no re-render needed)
        if (this.currentMode === 'lines' && this.originalColors) {
            this.tractGroup.traverse((object) => {
                if (object instanceof THREE.LineSegments) {
                    const geometry = object.geometry;
                    const colorAttr = geometry.getAttribute('color');
                    if (colorAttr && this.originalColors) {
                        const colors = colorAttr.array as Float32Array;
                        // Use gamma-based brightness adjustment to preserve color saturation
                        // Lower gamma = brighter, higher gamma = darker
                        // brightness 1.0 = gamma 1.0 (no change)
                        // brightness 0.5 = gamma 2.0 (darker)
                        // brightness 1.5 = gamma 0.67 (brighter)
                        const gamma = 1.0 / brightness;
                        for (let i = 0; i < colors.length; i++) {
                            // Apply gamma correction: preserves color relationships
                            colors[i] = Math.pow(this.originalColors[i], gamma);
                        }
                        colorAttr.needsUpdate = true;
                    }
                }
            });
        }
    }

    /**
     * Toggle background color.
     */
    public toggleBackground(): void {
        this.darkBackground = !this.darkBackground;

        if (this.darkBackground) {
            this.scene.background = new THREE.Color(0x1a1a2e);
        } else {
            this.scene.background = new THREE.Color(0x2d2d2d);
        }
    }

    /**
     * Set background color.
     */
    public setBackgroundColor(color: string): void {
        this.scene.background = new THREE.Color(color);
        this.darkBackground = this.isColorDark(color);
    }

    /**
     * Check if a color is dark.
     */
    private isColorDark(color: string): boolean {
        const c = new THREE.Color(color);
        const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        return luminance < 0.5;
    }

    /**
     * Handle window resize.
     */
    private handleResize(): void {
        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== width || canvas.height !== height) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * Animation loop.
     */
    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    /**
     * Capture current view as PNG data URL.
     * @returns Base64-encoded PNG image data URL
     */
    public captureScreenshot(): string {
        // Force a render to ensure current state is captured
        this.renderer.render(this.scene, this.camera);
        return this.renderer.domElement.toDataURL('image/png');
    }

    /**
     * Dispose of renderer resources.
     */
    public dispose(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }

        window.removeEventListener('resize', this.handleResize);

        this.clearTract();
        this.controls.dispose();
        this.renderer.dispose();
    }
}
