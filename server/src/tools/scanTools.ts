/**
 * SCAN MODULE - MCP Tools
 * 
 * Tools for observing scan results and grid probability data.
 * 
 * DESIGN RATIONALE:
 * - getSectorScanResult: OBSERVATION - AI needs to query specific sector data
 * - getGridHeatmap: OBSERVATION - AI needs full grid view for strategic decisions
 * 
 * NOT EXPOSED (remain internal algorithms):
 * - buildPriorityQueue/buildBoustrophedonQueue: These are optimal search patterns
 *   that would be WORSE if AI overrode them with arbitrary patterns
 * - Sensor fusion calculations: Physics model, AI should read results only
 * - Pheromone trail updates: Emergent swarm behavior, shouldn't be externally controlled
 * - Probability decay/diffusion: Markov model internals
 */

import { droneStore, gridToLabel, labelToGrid, GRID_W, GRID_H } from '../droneStore.js';
import type { 
    SectorScanResult, 
    GridHeatmap,
    MCPToolResult 
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getSectorScanResult
// ═══════════════════════════════════════════════════════════════════════════

export interface GetSectorParams {
    /**
     * Sector identifier - can be:
     * - Grid label (e.g., "A1", "T20")
     * - Coordinates as "x,y" (e.g., "5,10")
     */
    sector: string;
}

/**
 * Get detailed scan data for a specific grid sector.
 * 
 * Returns:
 * - Probability of survivor presence
 * - Terrain type
 * - Scan status (scanned/unscanned)
 * - Signal readings (mobile, thermal, sound, wifi)
 * 
 * Sector formats:
 * - Grid label: "A1", "B5", "T20" (row A is top, row T is bottom)
 * - Coordinates: "5,10" (x,y format)
 */
export async function getSectorScanResult(
    params: GetSectorParams
): Promise<MCPToolResult<SectorScanResult>> {
    let x: number, y: number;

    // Parse sector parameter
    if (params.sector.includes(',')) {
        // Coordinate format: "x,y"
        const parts = params.sector.split(',').map(s => parseInt(s.trim()));
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
            return {
                success: false,
                error: `Invalid coordinate format: "${params.sector}". Use "x,y" (e.g., "5,10")`,
                timestamp: Date.now()
            };
        }
        [x, y] = parts;
    } else {
        // Grid label format: "A1", "T20"
        const parsed = labelToGrid(params.sector.toUpperCase());
        x = parsed.x;
        y = parsed.y;
    }

    // Validate bounds
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) {
        return {
            success: false,
            error: `Sector out of bounds: (${x}, ${y}). Grid is ${GRID_W}x${GRID_H} (0-${GRID_W - 1}, 0-${GRID_H - 1})`,
            timestamp: Date.now()
        };
    }

    const sector = droneStore.getSector(x, y);

    if (!sector) {
        return {
            success: false,
            error: `Sector data not available for (${x}, ${y})`,
            timestamp: Date.now()
        };
    }

    return {
        success: true,
        data: sector,
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getGridHeatmap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the full grid probability heatmap.
 * 
 * Returns:
 * - 20x20 probability matrix
 * - Lists of high-priority cells (>0.6 probability)
 * - Lists of medium-priority cells (0.3-0.6 probability)
 * 
 * Use this for:
 * - Strategic overview of search progress
 * - Identifying hotspots requiring attention
 * - Planning drone deployments
 */
export async function getGridHeatmap(): Promise<MCPToolResult<GridHeatmap>> {
    const heatmap = droneStore.getHeatmap();
    const grid = droneStore.getGrid();
    
    const highPriority: string[] = [];
    const mediumPriority: string[] = [];

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const prob = heatmap[y][x];
            const label = gridToLabel(x, y);
            const sector = grid[y][x];
            
            // Only include unscanned cells as priorities
            if (!sector.scanned) {
                if (prob >= 0.6) {
                    highPriority.push(label);
                } else if (prob >= 0.3) {
                    mediumPriority.push(label);
                }
            }
        }
    }

    return {
        success: true,
        data: {
            width: GRID_W,
            height: GRID_H,
            cells: heatmap,
            highPriorityCells: highPriority,
            mediumPriorityCells: mediumPriority
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getScannedSectors
// ═══════════════════════════════════════════════════════════════════════════

export interface ScannedSectorsSummary {
    scannedCount: number;
    unscannedCount: number;
    totalSectors: number;
    scannedSectors: string[];
    highProbabilityUnscanned: string[];
}

/**
 * Get a summary of scanned vs unscanned sectors.
 * 
 * Useful for:
 * - Tracking scan coverage progress
 * - Identifying gaps in coverage
 * - Prioritizing remaining search areas
 */
export async function getScannedSectors(): Promise<MCPToolResult<ScannedSectorsSummary>> {
    const grid = droneStore.getGrid();
    
    const scanned: string[] = [];
    const highPriorityUnscanned: string[] = [];
    
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const sector = grid[y][x];
            const label = gridToLabel(x, y);
            
            if (sector.scanned) {
                scanned.push(label);
            } else if (sector.probability >= 0.5) {
                highPriorityUnscanned.push(label);
            }
        }
    }

    const total = GRID_W * GRID_H;

    return {
        success: true,
        data: {
            scannedCount: scanned.length,
            unscannedCount: total - scanned.length,
            totalSectors: total,
            scannedSectors: scanned,
            highProbabilityUnscanned: highPriorityUnscanned
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getSurroundingSectors
// ═══════════════════════════════════════════════════════════════════════════

export interface GetSurroundingParams {
    centerSector: string;
    radius?: number;
}

export interface SurroundingSectorsResult {
    center: SectorScanResult;
    surrounding: SectorScanResult[];
    averageProbability: number;
    maxProbability: number;
    suggestedAction: 'micro_scan' | 'wide_scan' | 'skip';
}

/**
 * Get scan data for a sector and its surrounding area.
 * 
 * Useful for:
 * - Contextual analysis of a hotspot
 * - Deciding whether to switch to Micro mode
 * - Understanding probability gradients
 */
export async function getSurroundingSectors(
    params: GetSurroundingParams
): Promise<MCPToolResult<SurroundingSectorsResult>> {
    const radius = params.radius ?? 1;
    
    // Parse center sector
    let cx: number, cy: number;
    if (params.centerSector.includes(',')) {
        const parts = params.centerSector.split(',').map(s => parseInt(s.trim()));
        [cx, cy] = parts;
    } else {
        const parsed = labelToGrid(params.centerSector.toUpperCase());
        cx = parsed.x;
        cy = parsed.y;
    }

    if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) {
        return {
            success: false,
            error: `Center sector out of bounds`,
            timestamp: Date.now()
        };
    }

    const center = droneStore.getSector(cx, cy)!;
    const surrounding: SectorScanResult[] = [];

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                const sector = droneStore.getSector(nx, ny);
                if (sector) surrounding.push(sector);
            }
        }
    }

    const allProbs = [center.probability, ...surrounding.map(s => s.probability)];
    const avgProb = allProbs.reduce((a, b) => a + b, 0) / allProbs.length;
    const maxProb = Math.max(...allProbs);

    // Suggest action based on probability analysis
    let suggestedAction: 'micro_scan' | 'wide_scan' | 'skip';
    if (maxProb >= 0.6) {
        suggestedAction = 'micro_scan';
    } else if (avgProb >= 0.2) {
        suggestedAction = 'wide_scan';
    } else {
        suggestedAction = 'skip';
    }

    return {
        success: true,
        data: {
            center,
            surrounding,
            averageProbability: avgProb,
            maxProbability: maxProb,
            suggestedAction
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const scanTools = {
    getSectorScanResult,
    getGridHeatmap,
    getScannedSectors,
    getSurroundingSectors
};
