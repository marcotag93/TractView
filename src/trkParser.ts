/**
 * TRK File Parser
 *
 * Parses TrackVis .trk binary format files.
 * Format specification: http://trackvis.org/docs/?subsect=fileformat
 *
 */

import {
    Streamline,
    MAX_FILE_SIZE
} from './streamlineTypes';

/** TRK file header structure */
export interface TrkHeader {
    /** ID string - must be "TRACK" */
    idString: string;
    /** Volume dimensions [x, y, z] */
    dim: [number, number, number];
    /** Voxel size in mm [x, y, z] */
    voxelSize: [number, number, number];
    /** Volume origin [x, y, z] */
    origin: [number, number, number];
    /** Number of scalars per point */
    nScalars: number;
    /** Scalar names (up to 10, 20 chars each) */
    scalarNames: string[];
    /** Number of properties per track */
    nProperties: number;
    /** Property names (up to 10, 20 chars each) */
    propertyNames: string[];
    /** 4x4 voxel to RAS transformation matrix */
    voxToRas: Float32Array;
    /** Reserved bytes */
    reserved: Uint8Array;
    /** Voxel order string (e.g., "LAS") */
    voxelOrder: string;
    /** Padding bytes */
    pad2: string;
    /** Image orientation patient */
    imageOrientationPatient: Float32Array;
    /** Padding bytes */
    pad1: string;
    /** Invert flags [x, y, z] */
    invert: [number, number, number];
    /** Swap flags [x, y, z] */
    swap: [number, number, number];
    /** Total number of streamlines */
    nCount: number;
    /** Version number */
    version: number;
    /** Header size (should be 1000) */
    hdrSize: number;
}

/** Single streamline with points and optional data - re-export from shared types */
export { Streamline } from './streamlineTypes';

/** Parsed TRK file data */
export interface TrkData {
    /** File header */
    header: TrkHeader;
    /** Array of streamlines */
    streamlines: Streamline[];
}

/**
 * Validate TRK header fields for security and correctness.
 * @param header - Parsed TRK header
 * @throws
 */
function validateTrkHeader(header: TrkHeader): void {
    // Validate nScalars (0-10 per TRK spec)
    if (header.nScalars < 0 || header.nScalars > 10) {
        throw new Error(`Invalid TRK header: nScalars (${header.nScalars}) must be 0-10`);
    }

    // Validate nProperties (0-10 per TRK spec)
    if (header.nProperties < 0 || header.nProperties > 10) {
        throw new Error(`Invalid TRK header: nProperties (${header.nProperties}) must be 0-10`);
    }

    // Validate dimensions (reasonable positive values)
    for (let i = 0; i < 3; i++) {
        if (header.dim[i] < 0 || header.dim[i] > 65535) {
            throw new Error(`Invalid TRK header: dimension[${i}] (${header.dim[i]}) out of valid range`);
        }
    }

    // Validate voxel sizes (positive, finite values)
    for (let i = 0; i < 3; i++) {
        if (!isFinite(header.voxelSize[i]) || header.voxelSize[i] < 0) {
            throw new Error(`Invalid TRK header: voxelSize[${i}] (${header.voxelSize[i]}) must be non-negative and finite`);
        }
    }

    // Validate header size
    if (header.hdrSize !== 1000) {
        throw new Error(`Invalid TRK header: hdrSize (${header.hdrSize}) must be 1000`);
    }
}

/**
 * Parse a TRK file from binary data.
 *
 * @param buffer - ArrayBuffer containing the .trk file data
 * @returns Parsed TRK data with header and streamlines
 * @throws Error 
 */
export function parseTrkFile(buffer: ArrayBuffer): TrkData {
    // Validate file size
    if (buffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(
            `TRK file too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
        );
    }

    const view = new DataView(buffer);
    const decoder = new TextDecoder('ascii');

    // Parse header (1000 bytes)
    const header = parseHeader(view, decoder);

    // Validate magic bytes
    if (!header.idString.startsWith('TRACK')) {
        throw new Error('Invalid TRK file: missing TRACK identifier');
    }

    // Validate header fields for security
    validateTrkHeader(header);

    // Parse streamlines
    const streamlines = parseStreamlines(buffer, header);

    return { header, streamlines };
}

/**
 * Parse the 1000-byte TRK header.
 */
function parseHeader(view: DataView, decoder: TextDecoder): TrkHeader {
    let offset = 0;

    // ID string (6 bytes)
    const idString = decoder.decode(new Uint8Array(view.buffer, offset, 6)).replace(/\0/g, '');
    offset += 6;

    // Dimensions (3 x int16)
    const dim: [number, number, number] = [
        view.getInt16(offset, true),
        view.getInt16(offset + 2, true),
        view.getInt16(offset + 4, true)
    ];
    offset += 6;

    // Voxel size (3 x float32)
    const voxelSize: [number, number, number] = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
    ];
    offset += 12;

    // Origin (3 x float32)
    const origin: [number, number, number] = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
    ];
    offset += 12;

    // Number of scalars (int16)
    const nScalars = view.getInt16(offset, true);
    offset += 2;

    // Scalar names (10 x 20 bytes)
    const scalarNames: string[] = [];
    for (let i = 0; i < 10; i++) {
        const name = decoder.decode(new Uint8Array(view.buffer, offset, 20)).replace(/\0/g, '');
        if (i < nScalars && name) {
            scalarNames.push(name);
        }
        offset += 20;
    }

    // Number of properties (int16)
    const nProperties = view.getInt16(offset, true);
    offset += 2;

    // Property names (10 x 20 bytes)
    const propertyNames: string[] = [];
    for (let i = 0; i < 10; i++) {
        const name = decoder.decode(new Uint8Array(view.buffer, offset, 20)).replace(/\0/g, '');
        if (i < nProperties && name) {
            propertyNames.push(name);
        }
        offset += 20;
    }

    // Vox to RAS matrix (4x4 float32)
    const voxToRas = new Float32Array(16);
    for (let i = 0; i < 16; i++) {
        voxToRas[i] = view.getFloat32(offset, true);
        offset += 4;
    }

    // Reserved (444 bytes)
    const reserved = new Uint8Array(view.buffer, offset, 444);
    offset += 444;

    // Voxel order (4 bytes)
    const voxelOrder = decoder.decode(new Uint8Array(view.buffer, offset, 4)).replace(/\0/g, '');
    offset += 4;

    // Pad2 (4 bytes)
    const pad2 = decoder.decode(new Uint8Array(view.buffer, offset, 4)).replace(/\0/g, '');
    offset += 4;

    // Image orientation patient (6 x float32)
    const imageOrientationPatient = new Float32Array(6);
    for (let i = 0; i < 6; i++) {
        imageOrientationPatient[i] = view.getFloat32(offset, true);
        offset += 4;
    }

    // Pad1 (2 bytes)
    const pad1 = decoder.decode(new Uint8Array(view.buffer, offset, 2)).replace(/\0/g, '');
    offset += 2;

    // Invert (3 x uint8)
    const invert: [number, number, number] = [
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2)
    ];
    offset += 3;

    // Swap (3 x uint8)
    const swap: [number, number, number] = [
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2)
    ];
    offset += 3;

    // Number of streamlines (int32)
    const nCount = view.getInt32(offset, true);
    offset += 4;

    // Version (int32)
    const version = view.getInt32(offset, true);
    offset += 4;

    // Header size (int32)
    const hdrSize = view.getInt32(offset, true);

    return {
        idString,
        dim,
        voxelSize,
        origin,
        nScalars,
        scalarNames,
        nProperties,
        propertyNames,
        voxToRas,
        reserved,
        voxelOrder,
        pad2,
        imageOrientationPatient,
        pad1,
        invert,
        swap,
        nCount,
        version,
        hdrSize
    };
}

/**
 * Parse streamlines from the TRK file body.
 */
function parseStreamlines(buffer: ArrayBuffer, header: TrkHeader): Streamline[] {
    const streamlines: Streamline[] = [];
    const view = new DataView(buffer);

    // Start after header
    let offset = header.hdrSize || 1000;
    const bufferLength = buffer.byteLength;

    // Calculate bytes per point (3 coords + scalars)
    const bytesPerPoint = 4 * (3 + header.nScalars);
    const bytesPerProperties = 4 * header.nProperties;

    // Read streamlines until end of file or count reached
    const maxStreamlines = header.nCount > 0 ? header.nCount : Infinity;

    while (offset < bufferLength && streamlines.length < maxStreamlines) {
        // Number of points in this streamline (int32)
        if (offset + 4 > bufferLength) break;

        const numPoints = view.getInt32(offset, true);
        offset += 4;

        if (numPoints <= 0 || numPoints > 100000) {
            // Invalid streamline, try to recover
            break;
        }

        // Calculate expected bytes for this streamline
        const streamlineBytes = numPoints * bytesPerPoint + bytesPerProperties;
        if (offset + streamlineBytes > bufferLength) break;

        // Read points
        const points = new Float32Array(numPoints * 3);
        const scalars: Float32Array[] = header.nScalars > 0
            ? Array.from({ length: header.nScalars }, () => new Float32Array(numPoints))
            : [];

        for (let i = 0; i < numPoints; i++) {
            // Read coordinates
            points[i * 3] = view.getFloat32(offset, true);
            points[i * 3 + 1] = view.getFloat32(offset + 4, true);
            points[i * 3 + 2] = view.getFloat32(offset + 8, true);
            offset += 12;

            // Read scalars
            for (let s = 0; s < header.nScalars; s++) {
                scalars[s][i] = view.getFloat32(offset, true);
                offset += 4;
            }
        }

        // Read properties
        let properties: Float32Array | undefined;
        if (header.nProperties > 0) {
            properties = new Float32Array(header.nProperties);
            for (let p = 0; p < header.nProperties; p++) {
                properties[p] = view.getFloat32(offset, true);
                offset += 4;
            }
        }

        streamlines.push({
            points,
            numPoints,
            scalars: scalars.length > 0 ? scalars : undefined,
            properties
        });
    }

    return streamlines;
}

/**
 * Apply skip sampling to streamlines.
 * 
 * @param streamlines - Array of streamlines to sample
 * @param maxCount - Maximum number of streamlines to return
 * @param skipThreshold - Threshold above which skip sampling activates
 * @returns Object with sampled streamlines and skip factor used
 */
export function applySkipSampling(
    streamlines: Streamline[],
    maxCount: number,
    skipThreshold: number
): { sampled: Streamline[]; skipFactor: number; totalCount: number } {
    const totalCount = streamlines.length;

    // If under threshold, no skip needed
    if (totalCount <= skipThreshold) {
        const sampled = streamlines.slice(0, Math.min(maxCount, totalCount));
        return { sampled, skipFactor: 1, totalCount };
    }

    // Calculate skip factor to achieve target count
    const targetCount = Math.min(maxCount, totalCount);
    const skipFactor = Math.ceil(totalCount / targetCount);

    // Sample with skip
    const sampled: Streamline[] = [];
    for (let i = 0; i < totalCount && sampled.length < maxCount; i += skipFactor) {
        sampled.push(streamlines[i]);
    }

    return { sampled, skipFactor, totalCount };
}

/**
 * Calculate bounding box of streamlines.
 */
export function calculateBoundingBox(streamlines: Streamline[]): {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: number;
} {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const streamline of streamlines) {
        const points = streamline.points;
        for (let i = 0; i < points.length; i += 3) {
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }
    }

    const center: [number, number, number] = [
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2
    ];

    const size = Math.sqrt(
        Math.pow(maxX - minX, 2) +
        Math.pow(maxY - minY, 2) +
        Math.pow(maxZ - minZ, 2)
    );

    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        center,
        size
    };
}

/**
 * Check if a buffer likely contains a TRK file.
 *
 * @param buffer - ArrayBuffer to check
 * @returns true if the file appears to be TRK format
 */
export function isTrkFile(buffer: ArrayBuffer): boolean {
    try {
        if (buffer.byteLength < 6) {
            return false;
        }
        const bytes = new Uint8Array(buffer, 0, 6);
        const decoder = new TextDecoder('ascii');
        const magic = decoder.decode(bytes);
        return magic.startsWith('TRACK');
    } catch {
        return false;
    }
}
