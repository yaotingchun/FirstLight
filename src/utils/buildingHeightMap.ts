import type { Sector } from '../types/simulation';
import { GRID_W, GRID_H } from '../types/simulation';

/** Building height in 3D units (0 = open ground) */
export type BuildingHeightMap = number[][];

/** Seeded pseudo-random number from grid coordinates */
function seededRandom(x: number, y: number, seed = 42): number {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * Generate building heights for the entire grid.
 * - Road cells → height 0 (open lane)
 * - Shelter cells → height 1 (low structure)
 * - Other cells → random height 0–6 with clustering bias
 */
export function generateBuildingHeights(grid: Sector[][]): BuildingHeightMap {
    const heights: BuildingHeightMap = Array.from({ length: GRID_H }, () =>
        new Array(GRID_W).fill(0)
    );

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const cell = grid[y]?.[x];
            if (!cell) continue;

            if (cell.terrain === 'Road') {
                heights[y][x] = 0;
            } else if (cell.terrain === 'Shelter') {
                heights[y][x] = 1;
            } else {
                // Clear area around base station (x ~9.5, y ~19)
                const isNearBase = Math.abs(x - 9.5) < 3 && Math.abs(y - 19) < 2;
                if (isNearBase) {
                    heights[y][x] = 0;
                    continue;
                }

                // Cluster buildings: if neighbors are tall, be tall too
                const r = seededRandom(x, y);
                // ~58% of cells are empty ground (reduced density from 40%)
                if (r < 0.58) {
                    heights[y][x] = 0;
                } else {
                    // Height 1–5 biased by position (city-like density near center)
                    const distFromCenter = Math.sqrt(
                        Math.pow(x - GRID_W / 2, 2) + Math.pow(y - GRID_H / 2, 2)
                    );
                    const centerBias = Math.max(0, 1 - distFromCenter / (GRID_W / 2));
                    const rawH = seededRandom(x, y, 99);
                    // Slightly lower max height (4 instead of 5) for better visibility
                    heights[y][x] = Math.round(1 + rawH * 4 * (0.5 + centerBias * 0.8));
                }
            }
        }
    }

    return heights;
}

/**
 * Get the safe drone altitude (in 3D units) above a given grid position.
 * Scans nearby cells for tallest building and adds clearance.
 */
export function getDroneAltitude(
    droneX: number,
    droneY: number,
    heightMap: BuildingHeightMap,
    clearance = 1.5
): number {
    let maxH = 0;
    const radius = 1;
    const gx = Math.round(droneX);
    const gy = Math.round(droneY);

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                maxH = Math.max(maxH, heightMap[ny]?.[nx] ?? 0);
            }
        }
    }

    return maxH + clearance;
}
