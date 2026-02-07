/**
 * TCK File Parser
 *
 * Parses MRtrix .tck binary format files.
 * Format specification: https://mrtrix.readthedocs.io/en/latest/getting_started/image_data.html
 *
 */

import {
    Streamline,
    TractographyData,
    TractographyHeader,
    DEFAULT_DIMENSIONS,
    DEFAULT_VOXEL_SIZE,
    MAX_FILE_SIZE
} from './streamlineTypes';

/** TCK file header parsed from text section */
export interface TckHeader {
    /** Data type string (e.g., "Float32LE") */
    datatype: string;
    /** Byte offset to binary data start */
    fileOffset: number;
    /** Number of streamlines (from count field) */
    count: number;
    /** Total count before filtering (optional) */
    totalCount?: number;
    /** Timestamp for file identification */
    timestamp?: number;
    /** All raw header key-value pairs */
    metadata: Record<string, string>;
}

/** Data type configuration */
interface DataTypeConfig {
    bytesPerFloat: number;
    littleEndian: boolean;
    reader: (view: DataView, offset: number, le: boolean) => number;
}

/** Supported data types in TCK format */
const DATA_TYPES: Record<string, DataTypeConfig> = {
    'Float32LE': { bytesPerFloat: 4, littleEndian: true, reader: (v, o, le) => v.getFloat32(o, le) },
    'Float32BE': { bytesPerFloat: 4, littleEndian: false, reader: (v, o, le) => v.getFloat32(o, le) },
    'Float64LE': { bytesPerFloat: 8, littleEndian: true, reader: (v, o, le) => v.getFloat64(o, le) },
    'Float64BE': { bytesPerFloat: 8, littleEndian: false, reader: (v, o, le) => v.getFloat64(o, le) },
};

/**
 * Parse a TCK file from binary data.
 *
 * @param buffer - ArrayBuffer containing the .tck file data
 * @returns Parsed tractography data with header and streamlines
 * @throws Error if file format is invalid
 */
export function parseTckFile(buffer: ArrayBuffer): TractographyData {
    // Validate file size
    if (buffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(
            `TCK file too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
        );
    }

    // Parse text header
    const tckHeader = parseHeader(buffer);

    // Validate magic identifier
    if (!tckHeader.metadata['mrtrix tracks']) {
        // Check first line contains "mrtrix tracks"
        const firstLine = Object.keys(tckHeader.metadata)[0] || '';
        if (!firstLine.toLowerCase().includes('mrtrix tracks')) {
            throw new Error('Invalid TCK file: missing "mrtrix tracks" identifier');
        }
    }

    // Parse binary streamlines
    const streamlines = parseStreamlines(buffer, tckHeader);

    // Convert to unified format
    const header: TractographyHeader = {
        format: 'tck',
        dim: DEFAULT_DIMENSIONS,
        voxelSize: DEFAULT_VOXEL_SIZE,
        nCount: streamlines.length,
        version: 1,
        metadata: {
            datatype: tckHeader.datatype,
            timestamp: tckHeader.timestamp,
            originalCount: tckHeader.count,
        }
    };

    return { header, streamlines };
}

/**
 * Parse the text header section of a TCK file.
 */
function parseHeader(buffer: ArrayBuffer): TckHeader {
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder('ascii');

    // Find the "END" marker that terminates the header
    let headerEnd = -1;
    const maxHeaderSize = Math.min(buffer.byteLength, 10000); // Header shouldn't exceed 10KB

    for (let i = 0; i < maxHeaderSize - 2; i++) {
        // Look for "END" followed by newline
        if (bytes[i] === 69 && bytes[i + 1] === 78 && bytes[i + 2] === 68) { // "END"
            // Check if followed by newline or is at reasonable position
            if (i + 3 < bytes.length && (bytes[i + 3] === 10 || bytes[i + 3] === 13)) {
                headerEnd = i + 4; // Include newline
                if (bytes[i + 3] === 13 && bytes[i + 4] === 10) {
                    headerEnd = i + 5; // Handle CRLF
                }
                break;
            }
        }
    }

    if (headerEnd === -1) {
        throw new Error('Invalid TCK file: could not find END marker in header');
    }

    // Decode header text
    const headerText = decoder.decode(bytes.slice(0, headerEnd));
    const lines = headerText.split(/\r?\n/).filter(line => line.trim() !== '');

    // Parse key-value pairs
    const metadata: Record<string, string> = {};
    let datatype = 'Float32LE'; // Default
    let fileOffset = headerEnd; // Default to right after header
    let count = 0;
    let totalCount: number | undefined;
    let timestamp: number | undefined;

    for (const line of lines) {
        if (line.trim() === 'END') continue;

        // First line might just be "mrtrix tracks"
        if (line.trim().toLowerCase() === 'mrtrix tracks') {
            metadata['mrtrix tracks'] = 'true';
            continue;
        }

        // Parse key: value
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();

        metadata[key] = value;

        switch (key) {
            case 'datatype':
                datatype = value;
                break;
            case 'file':
                // Format: ". offset" or just offset
                const parts = value.split(/\s+/);
                if (parts.length >= 2 && parts[0] === '.') {
                    fileOffset = parseInt(parts[1], 10);
                } else if (parts.length === 1) {
                    fileOffset = parseInt(parts[0], 10);
                }
                break;
            case 'count':
                count = parseInt(value, 10);
                break;
            case 'total_count':
                totalCount = parseInt(value, 10);
                break;
            case 'timestamp':
                timestamp = parseFloat(value);
                break;
        }
    }

    // Validate datatype
    if (!DATA_TYPES[datatype]) {
        throw new Error(`Unsupported TCK datatype: ${datatype}. Supported: ${Object.keys(DATA_TYPES).join(', ')}`);
    }

    return {
        datatype,
        fileOffset,
        count,
        totalCount,
        timestamp,
        metadata
    };
}

/**
 * Parse binary streamline data from TCK file.
 */
function parseStreamlines(buffer: ArrayBuffer, header: TckHeader): Streamline[] {
    const streamlines: Streamline[] = [];
    const view = new DataView(buffer);
    const config = DATA_TYPES[header.datatype];

    if (!config) {
        throw new Error(`Invalid datatype configuration: ${header.datatype}`);
    }

    const { bytesPerFloat, littleEndian, reader } = config;
    const bytesPerTriplet = bytesPerFloat * 3;

    let offset = header.fileOffset;
    const bufferLength = buffer.byteLength;

    // Collect points for current streamline
    let currentPoints: number[] = [];

    while (offset + bytesPerTriplet <= bufferLength) {
        // Read triplet
        const x = reader(view, offset, littleEndian);
        const y = reader(view, offset + bytesPerFloat, littleEndian);
        const z = reader(view, offset + bytesPerFloat * 2, littleEndian);

        offset += bytesPerTriplet;

        // Check for Inf (end of file)
        if (!isFinite(x) && !isNaN(x)) {
            // Inf detected - end of file
            // Save current streamline if any points
            if (currentPoints.length >= 6) { // At least 2 points
                const points = new Float32Array(currentPoints);
                streamlines.push({
                    points,
                    numPoints: currentPoints.length / 3
                });
            }
            break;
        }

        // Check for NaN (streamline separator)
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            // NaN detected - end of current streamline
            if (currentPoints.length >= 6) { // At least 2 points
                const points = new Float32Array(currentPoints);
                streamlines.push({
                    points,
                    numPoints: currentPoints.length / 3
                });
            }
            currentPoints = [];
            continue;
        }

        // Add valid point
        currentPoints.push(x, y, z);

        // Safety check for malformed files
        if (currentPoints.length > 300000) { // 100k points per streamline max
            throw new Error('Malformed TCK file: streamline exceeds maximum point count');
        }
    }

    // Handle any remaining points (file ended without Inf marker)
    if (currentPoints.length >= 6) {
        const points = new Float32Array(currentPoints);
        streamlines.push({
            points,
            numPoints: currentPoints.length / 3
        });
    }

    return streamlines;
}

/**
 * Check if a buffer likely contains a TCK file.
 *
 * @param buffer - ArrayBuffer to check
 * @returns true if the file appears to be TCK format
 */
export function isTckFile(buffer: ArrayBuffer): boolean {
    try {
        const bytes = new Uint8Array(buffer, 0, Math.min(100, buffer.byteLength));
        const decoder = new TextDecoder('ascii');
        const header = decoder.decode(bytes).toLowerCase();
        return header.includes('mrtrix tracks');
    } catch {
        return false;
    }
}
