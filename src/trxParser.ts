/**
 * TRX File Parser
 *
 * Parses the TRX tractography format (ZIP-based).
 * Format specification: https://github.com/tee-ar-ex/trx-spec
 *
 */

import * as zlib from 'zlib';
import {
    Streamline,
    TractographyData,
    TractographyHeader,
    DEFAULT_DIMENSIONS,
    DEFAULT_VOXEL_SIZE,
    MAX_FILE_SIZE
} from './streamlineTypes';

/** TRX header structure from header.json */
export interface TrxHeader {
    /** 4x4 voxel to RAS-mm transformation matrix */
    VOXEL_TO_RASMM: number[][];
    /** Volume dimensions [x, y, z] */
    DIMENSIONS: [number, number, number];
    /** Total number of streamlines */
    NB_STREAMLINES: number;
    /** Total number of vertices across all streamlines */
    NB_VERTICES: number;
}

/**
 * Validate and parse TRX header from JSON object.
 * @param obj - Parsed JSON object
 * @returns Validated TrxHeader
 * @throws Error if validation fails
 */
function validateTrxHeader(obj: unknown): TrxHeader {
    if (typeof obj !== 'object' || obj === null) {
        throw new Error('Invalid TRX header: not an object');
    }

    const header = obj as Record<string, unknown>;

    // Validate VOXEL_TO_RASMM (4x4 matrix)
    if (!Array.isArray(header.VOXEL_TO_RASMM) || header.VOXEL_TO_RASMM.length !== 4) {
        throw new Error('Invalid TRX header: VOXEL_TO_RASMM must be a 4x4 matrix');
    }
    for (const row of header.VOXEL_TO_RASMM) {
        if (!Array.isArray(row) || row.length !== 4 || !row.every(v => typeof v === 'number')) {
            throw new Error('Invalid TRX header: VOXEL_TO_RASMM rows must be arrays of 4 numbers');
        }
    }

    // Validate DIMENSIONS (3-tuple of non-negative integers)
    if (!Array.isArray(header.DIMENSIONS) || header.DIMENSIONS.length !== 3 ||
        !header.DIMENSIONS.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0)) {
        throw new Error('Invalid TRX header: DIMENSIONS must be 3 non-negative integers');
    }

    // Validate NB_STREAMLINES
    if (typeof header.NB_STREAMLINES !== 'number' || !Number.isInteger(header.NB_STREAMLINES) || header.NB_STREAMLINES < 0) {
        throw new Error('Invalid TRX header: NB_STREAMLINES must be a non-negative integer');
    }

    // Validate NB_VERTICES
    if (typeof header.NB_VERTICES !== 'number' || !Number.isInteger(header.NB_VERTICES) || header.NB_VERTICES < 0) {
        throw new Error('Invalid TRX header: NB_VERTICES must be a non-negative integer');
    }

    return {
        VOXEL_TO_RASMM: header.VOXEL_TO_RASMM as number[][],
        DIMENSIONS: header.DIMENSIONS as [number, number, number],
        NB_STREAMLINES: header.NB_STREAMLINES,
        NB_VERTICES: header.NB_VERTICES
    };
}

/** Parsed ZIP file entry */
interface ZipEntry {
    name: string;
    data: Uint8Array;
}

/**
 * Parse a TRX file from binary data.
 *
 * @param buffer - ArrayBuffer containing the .trx file data
 * @returns Parsed tractography data with header and streamlines
 * @throws 
 */
export function parseTrxFile(buffer: ArrayBuffer): TractographyData {
    // Validate file size
    if (buffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(
            `TRX file too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
        );
    }

    // Parse ZIP structure
    const entries = parseZipEntries(buffer);

    // Find and parse header.json
    const headerEntry = entries.find(e => e.name === 'header.json' || e.name.endsWith('/header.json'));
    if (!headerEntry) {
        throw new Error('Invalid TRX file: missing header.json');
    }

    const decoder = new TextDecoder('utf-8');
    const headerJson = decoder.decode(headerEntry.data);
    const trxHeader = validateTrxHeader(JSON.parse(headerJson));

    // Find positions file
    const positionsEntry = entries.find(e =>
        e.name.startsWith('positions.') ||
        e.name.includes('/positions.')
    );
    if (!positionsEntry) {
        throw new Error('Invalid TRX file: missing positions file');
    }

    // Find offsets file
    const offsetsEntry = entries.find(e =>
        e.name.startsWith('offsets.') ||
        e.name.includes('/offsets.')
    );
    if (!offsetsEntry) {
        throw new Error('Invalid TRX file: missing offsets file');
    }

    // Parse positions based on filename extension
    const positions = parsePositions(positionsEntry.name, positionsEntry.data);

    // Parse offsets based on filename extension
    const offsets = parseOffsets(offsetsEntry.name, offsetsEntry.data);

    // Build streamlines from positions and offsets
    const streamlines = buildStreamlines(positions, offsets, trxHeader.NB_STREAMLINES);

    // Create unified header
    const header: TractographyHeader = {
        format: 'trx',
        dim: trxHeader.DIMENSIONS || DEFAULT_DIMENSIONS,
        voxelSize: extractVoxelSize(trxHeader.VOXEL_TO_RASMM) || DEFAULT_VOXEL_SIZE,
        nCount: streamlines.length,
        version: 1,
        metadata: {
            nbVertices: trxHeader.NB_VERTICES,
            voxelToRasmm: trxHeader.VOXEL_TO_RASMM
        }
    };

    return { header, streamlines };
}

/**
 * Parse ZIP file structure (minimal implementation for uncompressed/DEFLATE).
 */
function parseZipEntries(buffer: ArrayBuffer): ZipEntry[] {
    const entries: ZipEntry[] = [];
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let offset = 0;
    const decoder = new TextDecoder('utf-8');

    while (offset < buffer.byteLength - 4) {
        // Check for local file header signature (0x04034b50)
        const signature = view.getUint32(offset, true);
        if (signature !== 0x04034b50) {
            break; // End of local file headers
        }

        // Parse local file header
        const compressionMethod = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const uncompressedSize = view.getUint32(offset + 22, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);

        // Read filename
        const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLength);
        const name = decoder.decode(nameBytes);

        // Calculate data offset
        const dataOffset = offset + 30 + nameLength + extraLength;

        // Read file data
        let data: Uint8Array;
        if (compressionMethod === 0) {
            // STORE (uncompressed)
            data = bytes.slice(dataOffset, dataOffset + compressedSize);
        } else if (compressionMethod === 8) {
            // DEFLATE - decompress using browser's DecompressionStream or fallback
            const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);
            data = inflateSync(compressedData, uncompressedSize);
        } else {
            // Unsupported compression - skip this entry
            offset = dataOffset + compressedSize;
            continue;
        }

        entries.push({ name, data });

        // Move to next header
        offset = dataOffset + compressedSize;
    }

    return entries;
}

/**
 * DEFLATE decompression using Node.js zlib.
 */
function inflateSync(compressed: Uint8Array, _expectedSize: number): Uint8Array {
    return new Uint8Array(zlib.inflateRawSync(compressed));
}

/**
 * Parse positions array from file data.
 */
function parsePositions(filename: string, data: Uint8Array): Float32Array {
    const basename = filename.split('/').pop() || filename;
    const parts = basename.split('.');

    // Find the data type extension (last part)
    const dtype = parts[parts.length - 1].toLowerCase();

    // Get dimension info (e.g., "positions.3.float32" -> 3 components per vertex)
    const componentCount = parts.length > 2 ? parseInt(parts[parts.length - 2], 10) || 3 : 3;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let positions: Float32Array;

    if (dtype === 'float16') {
        // Float16 requires conversion
        const numValues = data.byteLength / 2;
        positions = new Float32Array(numValues);
        for (let i = 0; i < numValues; i++) {
            positions[i] = float16ToFloat32(view.getUint16(i * 2, true));
        }
    } else if (dtype === 'float32') {
        const numValues = data.byteLength / 4;
        positions = new Float32Array(numValues);
        for (let i = 0; i < numValues; i++) {
            positions[i] = view.getFloat32(i * 4, true);
        }
    } else if (dtype === 'float64') {
        const numValues = data.byteLength / 8;
        positions = new Float32Array(numValues);
        for (let i = 0; i < numValues; i++) {
            positions[i] = view.getFloat64(i * 8, true);
        }
    } else {
        throw new Error(`Unsupported positions data type: ${dtype}`);
    }

    return positions;
}

/**
 * Parse offsets array from file data.
 * Supports: uint64, int64, uint32, int32
 */
function parseOffsets(filename: string, data: Uint8Array): BigUint64Array | BigInt64Array | Uint32Array | Int32Array {
    const basename = filename.split('/').pop() || filename;
    const dtype = basename.split('.').pop()?.toLowerCase();

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (dtype === 'uint64') {
        const numValues = data.byteLength / 8;
        const offsets = new BigUint64Array(numValues);
        for (let i = 0; i < numValues; i++) {
            offsets[i] = view.getBigUint64(i * 8, true);
        }
        return offsets;
    } else if (dtype === 'int64') {
        // Support for signed int64
        const numValues = data.byteLength / 8;
        const offsets = new BigInt64Array(numValues);
        for (let i = 0; i < numValues; i++) {
            offsets[i] = view.getBigInt64(i * 8, true);
        }
        return offsets;
    } else if (dtype === 'uint32') {
        const numValues = data.byteLength / 4;
        const offsets = new Uint32Array(numValues);
        for (let i = 0; i < numValues; i++) {
            offsets[i] = view.getUint32(i * 4, true);
        }
        return offsets;
    } else if (dtype === 'int32') {
        // Support for signed int32
        const numValues = data.byteLength / 4;
        const offsets = new Int32Array(numValues);
        for (let i = 0; i < numValues; i++) {
            offsets[i] = view.getInt32(i * 4, true);
        }
        return offsets;
    } else {
        throw new Error(`Unsupported offsets data type: ${dtype}`);
    }
}

/**
 * Build streamlines from positions and offsets arrays.
 */
function buildStreamlines(
    positions: Float32Array,
    offsets: BigUint64Array | BigInt64Array | Uint32Array | Int32Array,
    nbStreamlines: number
): Streamline[] {
    const streamlines: Streamline[] = [];
    const totalVertices = positions.length / 3;

    for (let i = 0; i < nbStreamlines; i++) {
        // Get start offset for this streamline
        const startOffset = Number(offsets[i]);

        // Get end offset (start of next streamline or end of positions)
        const endOffset = i + 1 < offsets.length
            ? Number(offsets[i + 1])
            : totalVertices;

        const numPoints = endOffset - startOffset;

        if (numPoints < 2) {
            continue; // Skip streamlines with less than 2 points
        }

        // Extract points for this streamline (using view for efficiency)
        const startIdx = startOffset * 3;
        const endIdx = endOffset * 3;
        const points = positions.slice(startIdx, endIdx);

        streamlines.push({
            points: new Float32Array(points),
            numPoints
        });
    }

    return streamlines;
}

/**
 * Convert IEEE 754 half-precision float (float16) to single-precision (float32).
 *
 * @param h - 16-bit unsigned integer representing float16
 * @returns 32-bit float value
 */
function float16ToFloat32(h: number): number {
    const sign = (h >>> 15) & 0x1;
    const exponent = (h >>> 10) & 0x1f;
    const mantissa = h & 0x3ff;

    if (exponent === 0) {
        if (mantissa === 0) {
            // Zero
            return sign === 0 ? 0 : -0;
        } else {
            // Subnormal number
            const value = mantissa / 1024 * Math.pow(2, -14);
            return sign === 0 ? value : -value;
        }
    } else if (exponent === 31) {
        if (mantissa === 0) {
            // Infinity
            return sign === 0 ? Infinity : -Infinity;
        } else {
            // NaN
            return NaN;
        }
    } else {
        // Normalized number
        const value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
        return sign === 0 ? value : -value;
    }
}

/**
 * Extract voxel size from VOXEL_TO_RASMM transformation matrix.
 */
function extractVoxelSize(matrix?: number[][]): [number, number, number] | null {
    if (!matrix || matrix.length < 3) {
        return null;
    }

    try {
        const vx = Math.sqrt(
            matrix[0][0] ** 2 + matrix[1][0] ** 2 + matrix[2][0] ** 2
        );
        const vy = Math.sqrt(
            matrix[0][1] ** 2 + matrix[1][1] ** 2 + matrix[2][1] ** 2
        );
        const vz = Math.sqrt(
            matrix[0][2] ** 2 + matrix[1][2] ** 2 + matrix[2][2] ** 2
        );
        return [vx, vy, vz];
    } catch {
        return null;
    }
}

/**
 * Check if a buffer likely contains a TRX file (ZIP with header.json).
 *
 * @param buffer - ArrayBuffer to check
 * @returns true if the file appears to be TRX format
 */
export function isTrxFile(buffer: ArrayBuffer): boolean {
    // Check for ZIP magic number (PK..)
    const view = new DataView(buffer);
    if (buffer.byteLength < 4) {
        return false;
    }
    const signature = view.getUint32(0, true);
    return signature === 0x04034b50; // ZIP local file header
}
