/**
 * SWARM INTELLIGENCE MODULE - MCP Tools
 *
 * Tools that expose pheromone + probability combined signals for AI strategic planning.
 *
 * DESIGN RATIONALE:
 * - getExplorationGradient: OBSERVATION — AI reads combined urgency signal per sector.
 *     Urgency = probability × (1 - pheromone). High prob + low pheromone = untouched hotspot.
 * - getUnassignedHotspots: OBSERVATION + HINT — finds high-value sectors with no drone targeting them.
 *     Gives the AI a ready-made dispatch list to act on immediately.
 * - getDroneAssignmentMap: OBSERVATION — shows every drone's current target and flags redundant coverage.
 *     AI uses this to rebalance assignments without duplicating effort.
 *
 * NOT EXPOSED (remain internal swarm algorithms):
 * - ACO pheromone deposit/evaporation math — emergent, runs automatically each tick
 * - Local sector selection (boustrophedon / priority queue) — optimal internal pattern
 * - Haversine swarm planner — automatic global assignment, AI supplements rather than replaces it
 */

import { droneStore, gridToLabel, GRID_W, GRID_H } from '../droneStore.js';
import type {
    MCPToolResult,
    ExplorationGradient,
    ExplorationCell,
    UnassignedHotspotsResult,
    UnassignedHotspot,
    DroneAssignmentMap,
    DroneAssignment
} from '../types.js';

// Urgency score thresholds
const URGENCY_CRITICAL = 0.6;
const URGENCY_HIGH     = 0.3;
const PROB_MICRO       = 0.6;  // above this → suggest Micro mode

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Euclidean distance
// ═══════════════════════════════════════════════════════════════════════════
function dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getExplorationGradient
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the combined pheromone × probability urgency gradient for the whole grid.
 *
 * urgencyScore = probability × (1 − pheromone)
 *
 * - High urgency  → high survivor probability AND drones haven't visited yet
 * - Low urgency   → already scanned, low probability, OR swarm already swarming there (high pheromone)
 *
 * AI uses this to identify truly unexplored hotspots that the autonomous swarm
 * hasn't reached yet, so it can dispatch drones proactively.
 */
export async function getExplorationGradient(): Promise<MCPToolResult<ExplorationGradient>> {
    const grid = droneStore.getGrid();
    const cells: ExplorationCell[] = [];
    const criticalZones: string[] = [];
    const highZones: string[] = [];
    const pheromoneHotspots: string[] = [];
    let totalUnscanned = 0;

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const s = grid[y][x];
            if (s.scanned) continue;

            totalUnscanned++;

            const urgencyScore = s.probability * (1 - Math.min(1, s.pheromone));
            const label = gridToLabel(x, y);

            let category: ExplorationCell['category'];
            if (urgencyScore >= URGENCY_CRITICAL) {
                category = 'critical';
                criticalZones.push(label);
            } else if (urgencyScore >= URGENCY_HIGH) {
                category = 'high';
                highZones.push(label);
            } else if (s.probability >= 0.1) {
                category = 'medium';
            } else {
                category = 'low';
            }

            if (s.pheromone > 0.5) {
                pheromoneHotspots.push(label);
            }

            cells.push({ gridCell: label, x, y, probability: s.probability, pheromone: s.pheromone, terrain: s.terrain, urgencyScore, category });
        }
    }

    // Sort by urgencyScore descending
    cells.sort((a, b) => b.urgencyScore - a.urgencyScore);

    return {
        success: true,
        data: { cells, criticalZones, highZones, pheromoneHotspots, totalUnscanned },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getUnassignedHotspots
// ═══════════════════════════════════════════════════════════════════════════

export interface GetUnassignedHotspotsParams {
    probabilityThreshold?: number; // default 0.3
    maxResults?: number;            // default 10
}

/**
 * Return high-value unscanned sectors that NO active drone is currently heading toward.
 *
 * For each hotspot, also recommends:
 * - Which drone to dispatch (nearest connected, non-charging, non-relay)
 * - Which mode to use (Micro if prob > 0.6, Wide otherwise)
 *
 * This gives the AI a direct action list: call setDroneTarget + setDroneMode for each recommended dispatch.
 */
export async function getUnassignedHotspots(
    params: GetUnassignedHotspotsParams = {}
): Promise<MCPToolResult<UnassignedHotspotsResult>> {
    const threshold = params.probabilityThreshold ?? 0.3;
    const maxResults = params.maxResults ?? 10;

    const grid   = droneStore.getGrid();
    const drones = droneStore.getAllDrones();

    // Build set of sectors currently targeted by active drones
    const assignedTargets = new Set<string>();
    drones.forEach(d => {
        if (d.isActive && d.mode !== 'Charging' && d.mode !== 'Relay' && d.target) {
            assignedTargets.add(`${Math.round(d.target.x)},${Math.round(d.target.y)}`);
        }
    });

    // Available drones for dispatch
    const availableDrones = drones.filter(d => d.isActive && d.isConnected && d.mode !== 'Relay' && d.mode !== 'Charging' && d.battery > 20);

    const hotspots: UnassignedHotspot[] = [];

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const s = grid[y][x];
            if (s.scanned) continue;
            if (s.probability < threshold) continue;
            if (assignedTargets.has(`${x},${y}`)) continue;

            const urgencyScore = s.probability * (1 - Math.min(1, s.pheromone));

            // Find nearest available drone
            let nearestAvailableDrone: { id: string; distance: number } | null = null;
            for (const d of availableDrones) {
                const d_dist = dist(d.position.x, d.position.y, x, y);
                if (!nearestAvailableDrone || d_dist < nearestAvailableDrone.distance) {
                    nearestAvailableDrone = { id: d.id, distance: d_dist };
                }
            }

            hotspots.push({
                gridCell: gridToLabel(x, y),
                x, y,
                probability: s.probability,
                pheromone: s.pheromone,
                urgencyScore,
                terrain: s.terrain,
                suggestedMode: s.probability >= PROB_MICRO ? 'Micro' : 'Wide',
                nearestAvailableDrone
            });
        }
    }

    hotspots.sort((a, b) => b.urgencyScore - a.urgencyScore);
    const topHotspots = hotspots.slice(0, maxResults);

    // Build recommended dispatches: greedily assign nearest available drone to each hotspot
    const recommended: UnassignedHotspotsResult['recommendedDispatches'] = [];
    const usedDrones = new Set<string>();

    for (const hotspot of topHotspots) {
        if (!hotspot.nearestAvailableDrone) continue;

        // Find best unused available drone for this hotspot
        let best: { id: string; distance: number } | null = null;
        for (const d of availableDrones) {
            if (usedDrones.has(d.id)) continue;
            const d_dist = dist(d.position.x, d.position.y, hotspot.x, hotspot.y);
            if (!best || d_dist < best.distance) {
                best = { id: d.id, distance: d_dist };
            }
        }

        if (best) {
            usedDrones.add(best.id);
            recommended.push({
                droneId: best.id,
                targetX: hotspot.x,
                targetY: hotspot.y,
                mode: hotspot.suggestedMode,
                reason: `Urgency ${hotspot.urgencyScore.toFixed(2)}: prob=${hotspot.probability.toFixed(2)}, pheromone=${hotspot.pheromone.toFixed(2)} (${hotspot.terrain})`
            });
        }
    }

    return {
        success: true,
        data: {
            hotspots: topHotspots,
            totalUnassigned: hotspots.length,
            recommendedDispatches: recommended
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getDroneAssignmentMap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show every active drone's current assignment and flag redundant coverage.
 *
 * Redundant coverage = two or more drones heading to the same sector.
 * Idle = drone is active + connected but has no distinct target (at same position as target).
 *
 * AI uses this to:
 * 1. Redirect redundant drones to unassigned hotspots
 * 2. Identify idle drones to dispatch proactively
 * 3. Understand current swarm coverage without calling getDroneStatus per drone
 */
export async function getDroneAssignmentMap(): Promise<MCPToolResult<DroneAssignmentMap>> {
    const drones = droneStore.getAllDrones();
    const grid   = droneStore.getGrid();

    // Count how many drones target each sector
    const targetCount = new Map<string, string[]>();
    drones.forEach(d => {
        if (!d.isActive || !d.target) return;
        const key = `${Math.round(d.target.x)},${Math.round(d.target.y)}`;
        if (!targetCount.has(key)) targetCount.set(key, []);
        targetCount.get(key)!.push(d.id);
    });

    const assignments: DroneAssignment[] = [];
    const idleDrones: string[] = [];
    const redundantPairs: DroneAssignmentMap['redundantPairs'] = [];

    drones.forEach(d => {
        if (!d.isActive) return;

        let status: DroneAssignment['status'] = 'searching';
        if (d.mode === 'Charging') status = 'charging';
        else if (d.mode === 'Relay') status = 'relaying';

        let targetEnriched: DroneAssignment['targetSector'] = null;
        let redundant = false;

        if (d.target) {
            const tx = Math.round(d.target.x);
            const ty = Math.round(d.target.y);
            const sectorData = (ty >= 0 && ty < GRID_H && tx >= 0 && tx < GRID_W) ? grid[ty][tx] : null;
            targetEnriched = {
                x: tx,
                y: ty,
                gridCell: gridToLabel(tx, ty),
                probability: sectorData?.probability ?? 0,
                pheromone: sectorData?.pheromone ?? 0
            };
            const key = `${tx},${ty}`;
            redundant = (targetCount.get(key)?.length ?? 0) > 1;
        }

        // Drone is idle if at its target (or no target set) and not relaying/charging
        const atTarget = !d.target ||
            (Math.abs(d.position.x - d.target.x) < 0.5 && Math.abs(d.position.y - d.target.y) < 0.5);
        if (atTarget && status === 'searching') {
            status = 'idle';
            idleDrones.push(d.id);
        }

        assignments.push({
            droneId: d.id,
            mode: d.mode,
            battery: d.battery,
            isConnected: d.isConnected,
            currentPosition: { x: d.position.x, y: d.position.y, gridCell: d.position.gridCell },
            targetSector: targetEnriched,
            redundantCoverage: redundant,
            status
        });
    });

    // Collect redundant pairs (only report each pair once)
    const reportedPairs = new Set<string>();
    targetCount.forEach((droneIds, key) => {
        if (droneIds.length < 2) return;
        const sector = gridToLabel(...(key.split(',').map(Number) as [number, number]));
        for (let i = 0; i < droneIds.length - 1; i++) {
            for (let j = i + 1; j < droneIds.length; j++) {
                const pairKey = [droneIds[i], droneIds[j]].sort().join('|');
                if (!reportedPairs.has(pairKey)) {
                    reportedPairs.add(pairKey);
                    redundantPairs.push({ drone1: droneIds[i], drone2: droneIds[j], sector });
                }
            }
        }
    });

    const activeDrones = drones.filter(d => d.isActive && d.mode !== 'Relay' && d.mode !== 'Charging');
    const uniqueTargets = new Set(
        activeDrones.filter(d => d.target).map(d => `${Math.round(d.target!.x)},${Math.round(d.target!.y)}`)
    );
    const coverageEfficiency = activeDrones.length > 0
        ? uniqueTargets.size / activeDrones.length
        : 1;

    return {
        success: true,
        data: { assignments, redundantPairs, idleDrones, coverageEfficiency },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const swarmIntelTools = {
    getExplorationGradient,
    getUnassignedHotspots,
    getDroneAssignmentMap
};
