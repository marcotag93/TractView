/**
 * Shared Streamline Types
 *
 * Common interfaces for all tractography file formats.
 * Provides a unified data structure for TRK, TCK, and TRX parsers.
 */

/** Single streamline with points and optional metadata */
export interface Streamline {
    /** Point coordinates as flat array [x1,y1,z1, x2,y2,z2, ...] */
    points: Float32Array;
    /** Number of points in this streamline */
    numPoints: number;
    /** Optional per-point scalars */
    scalars?: Float32Array[];
    /** Optional per-track properties */
    properties?: Float32Array;
}

/** Streamline data for WebView transfer (serializable) */
export interface StreamlineData {
    /** Point coordinates as regular array (for JSON transfer) */
    points: number[];
    /** Number of points in this streamline */
    numPoints: number;
    /** Optional per-point scalar values for first scalar channel (TRK only) */
    scalars?: number[];
    /** Calculated length of the streamline in mm */
    length?: number;
}

/** Bounding box for streamline visualization */
export interface BoundingBox {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: number;
}

/** Supported tractography file formats */
export type TractographyFormat = 'trk' | 'tck' | 'trx';

/** Format-agnostic header information */
export interface TractographyHeader {
    /** File format type */
    format: TractographyFormat;
    /** Volume dimensions [x, y, z] (if available) */
    dim: [number, number, number];
    /** Voxel size in mm [x, y, z] (if available) */
    voxelSize: [number, number, number];
    /** Total number of streamlines */
    nCount: number;
    /** Format version (if applicable) */
    version: number;
    /** Additional format-specific metadata */
    metadata?: Record<string, unknown>;
}

/** Parsed tractography file data */
export interface TractographyData {
    /** Format-agnostic header */
    header: TractographyHeader;
    /** Array of streamlines */
    streamlines: Streamline[];
}

/**
 * Maximum file size for parsing (500MB).
 * Prevents memory exhaustion.
 */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

/**
 * Default dimensions.
 */
export const DEFAULT_DIMENSIONS: [number, number, number] = [0, 0, 0];

/**
 * Default voxel size.
 */
export const DEFAULT_VOXEL_SIZE: [number, number, number] = [1.0, 1.0, 1.0];
