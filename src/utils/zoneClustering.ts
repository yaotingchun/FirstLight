/**
 *  zoneClustering.ts — Clusters grid cells into SearchZones
 *
 *  Divides the 20×20 grid into fixed-size tiles (default 4×4),
 *  computing each zone's aggregate probability, sensor signals,
 *  and centroid for the deterministic planning pipeline.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface GridCell {
    x: number;
    y: number;
    prob: number;
    scanned: boolean;
    lastScanned: number;
    signals: {
        mobile: number;
        thermal: number;
        sound: number;
        wifi: number;
    };
}

export interface SearchZone {
    zoneId: string;
    cells: GridCell[];
    centroid: { x: number; y: number };
    probabilityScore: number;   // average probability across cells
    maxProbability: number;     // peak probability in zone
    sensorScore: number;        // weighted average of sensor signals
    recencyPenalty: number;     // filled in by zoneScoring
    zoneScore: number;          // filled in by zoneScoring
    assignedDroneIds: string[];
    unscannedCount: number;     // cells not yet scanned
    totalCells: number;
    lastScannedTick: number;    // most recent scan tick across all cells
}

// ── Sensor weights for computing aggregate sensor score ──────────────────────

const SENSOR_WEIGHTS = {
    mobile: 0.4,
    thermal: 0.3,
    sound: 0.2,
    wifi: 0.1,
} as const;

// ── Main clustering function ─────────────────────────────────────────────────

/**
 * Cluster a flat grid into fixed-size tile zones.
 *
 * @param grid     2D array [y][x] of GridCell (must have at least prob, signals, scanned, lastScanned)
 * @param gridW    Grid width  (default 20)
 * @param gridH    Grid height (default 20)
 * @param zoneSize Tile size in cells (default 4 → 5×5 = 25 zones for a 20×20 grid)
 */
export const clusterZones = (
    grid: GridCell[][],
    gridW = 20,
    gridH = 20,
    zoneSize = 4,
): SearchZone[] => {
    const zonesX = Math.ceil(gridW / zoneSize);
    const zonesY = Math.ceil(gridH / zoneSize);
    const zones: SearchZone[] = [];

    for (let zy = 0; zy < zonesY; zy++) {
        for (let zx = 0; zx < zonesX; zx++) {
            const cells: GridCell[] = [];
            let sumX = 0;
            let sumY = 0;
            let sumProb = 0;
            let maxProb = 0;
            let sumSensor = 0;
            let unscanned = 0;
            let lastTick = 0;

            const xStart = zx * zoneSize;
            const yStart = zy * zoneSize;
            const xEnd = Math.min(xStart + zoneSize, gridW);
            const yEnd = Math.min(yStart + zoneSize, gridH);

            for (let y = yStart; y < yEnd; y++) {
                for (let x = xStart; x < xEnd; x++) {
                    const cell = grid[y]?.[x];
                    if (!cell) continue;

                    cells.push(cell);
                    sumX += x;
                    sumY += y;
                    sumProb += cell.prob;
                    if (cell.prob > maxProb) maxProb = cell.prob;

                    // Aggregate sensor score
                    const s = cell.signals;
                    sumSensor +=
                        SENSOR_WEIGHTS.mobile * s.mobile +
                        SENSOR_WEIGHTS.thermal * s.thermal +
                        SENSOR_WEIGHTS.sound * s.sound +
                        SENSOR_WEIGHTS.wifi * s.wifi;

                    if (!cell.scanned) unscanned++;
                    if (cell.lastScanned > lastTick) lastTick = cell.lastScanned;
                }
            }

            const n = cells.length;
            if (n === 0) continue;

            zones.push({
                zoneId: `Z-${zx}-${zy}`,
                cells,
                centroid: {
                    x: Math.round(sumX / n),
                    y: Math.round(sumY / n),
                },
                probabilityScore: sumProb / n,
                maxProbability: maxProb,
                sensorScore: sumSensor / n,
                recencyPenalty: 0,       // to be computed by zoneScoring
                zoneScore: 0,            // to be computed by zoneScoring
                assignedDroneIds: [],
                unscannedCount: unscanned,
                totalCells: n,
                lastScannedTick: lastTick,
            });
        }
    }

    return zones;
};

/**
 * Find the zone that contains a given cell coordinate.
 */
export const getZoneForCell = (
    zones: SearchZone[],
    x: number,
    y: number,
): SearchZone | undefined => {
    return zones.find(z => z.cells.some(c => c.x === x && c.y === y));
};

/**
 * Find a zone by its ID.
 */
export const getZoneById = (
    zones: SearchZone[],
    zoneId: string,
): SearchZone | undefined => {
    return zones.find(z => z.zoneId === zoneId);
};
