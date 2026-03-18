/**
 *  zoneAllocator.ts — Assigns drones to zones strategically
 *
 *  Uses zone scores and drone positions to create optimal drone-to-zone
 *  assignments. Prevents over-concentration and balances exploration
 *  vs exploitation.
 */

import type { SearchZone } from './zoneClustering.js';
import type { SearchMemory } from './searchMemory.js';
import { shouldAvoidZone } from './searchMemory.js';
import type { FoundPin } from '../types/simulation';

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal drone interface — works with SimulationMapMCP's Drone type */
export interface AllocatableDrone {
    id: string;
    x: number;
    y: number;
    battery: number;
    mode: 'Wide' | 'Micro' | 'Relay' | 'Charging';
}

/** Action type for a drone mission */
export type MissionAction = 'wide_scan' | 'micro_scan';

/** Drone mission assignment */
export interface DroneMission {
    droneId: string;
    zoneId: string;
    targetX: number;
    targetY: number;
    action: MissionAction;
    reason: string;
}

// ── Configurable allocation parameters ───────────────────────────────────────

export interface AllocationConfig {
    /** Number of top zones to consider for allocation */
    topN: number;
    /** Maximum drones that can be assigned to a single zone */
    maxDronesPerZone: number;
    /** Minimum battery % to consider a drone for new assignments */
    minBattery: number;
    /** Probability threshold to trigger micro-scan instead of wide-scan */
    microScanThreshold: number;
    /** Distance weight: how much to penalize far-away drone assignments */
    distancePenalty: number;
}

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
    topN: 8,
    maxDronesPerZone: 2,
    minBattery: 25,
    microScanThreshold: 0.4,
    distancePenalty: 0.1,
};

// ── Allocation function ──────────────────────────────────────────────────────

/**
 * Allocate drones to the best available zones.
 *
 * Algorithm:
 * 1. Filter zones: skip exhausted zones, pick top-N by score
 * 2. Filter drones: skip charging, relay, and low-battery drones
 * 3. Greedy assignment: for each available drone, find the best
 *    (score / distance-penalty) zone that isn't full
 * 4. Choose wide_scan or micro_scan based on zone probability
 *
 * @param drones   Current drone states
 * @param zones    Scored zones (should already be sorted by zoneScore desc)
 * @param memory   Search memory for avoidance checks
 * @param config   Optional allocation configuration
 */
export const allocateDrones = (
    drones: AllocatableDrone[],
    zones: SearchZone[],
    memory: SearchMemory,
    currentTick: number,
    pins: FoundPin[] = [],
    config: AllocationConfig = DEFAULT_ALLOCATION_CONFIG,
): DroneMission[] => {
    const missions: DroneMission[] = [];

    // ── 1. Select candidate zones ────────────────────────────────────────
    const candidateZones = zones
        .filter(z => !shouldAvoidZone(memory, z.zoneId))
        .slice(0, config.topN);

    if (candidateZones.length === 0) return missions;

    // Track how many drones assigned per zone during this cycle
    const zoneAssignments = new Map<string, number>();
    for (const z of candidateZones) {
        zoneAssignments.set(z.zoneId, z.assignedDroneIds.length);
    }

    // ── 2. Select available drones ───────────────────────────────────────
    const available = drones.filter(d =>
        d.mode !== 'Relay' &&
        d.mode !== 'Charging' &&
        d.battery >= config.minBattery
    );

    // ── 3. Greedy assignment ─────────────────────────────────────────────
    // Sort drones by battery descending (healthiest drones first)
    const sortedDrones = [...available].sort((a, b) => b.battery - a.battery);

    for (const drone of sortedDrones) {
        let bestZone: SearchZone | null = null;
        let bestValue = -Infinity;

        for (const zone of candidateZones) {
            const currentCount = zoneAssignments.get(zone.zoneId) ?? 0;
            if (currentCount >= config.maxDronesPerZone) continue;

            // Distance from drone to zone centroid
            const dx = drone.x - zone.centroid.x;
            const dy = drone.y - zone.centroid.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Value = zone score minus distance penalty
            const value = zone.zoneScore - (config.distancePenalty * dist);

            if (value > bestValue) {
                bestValue = value;
                bestZone = zone;
            }
        }

        if (bestZone) {
            // Pick the best cell in the zone using weighted scoring
            const target = getBestCellInZone(bestZone, currentTick, pins);
            // Choose action based on zone probability
            const action: MissionAction = bestZone.probabilityScore >= config.microScanThreshold
                ? 'micro_scan'
                : 'wide_scan';

            missions.push({
                droneId: drone.id,
                zoneId: bestZone.zoneId,
                targetX: target.x,
                targetY: target.y,
                action,
                reason: `Zone ${bestZone.zoneId} score=${bestZone.zoneScore.toFixed(2)} prob=${bestZone.probabilityScore.toFixed(2)} target=[${target.x},${target.y}]`,
            });

            // Update assignment count
            const count = zoneAssignments.get(bestZone.zoneId) ?? 0;
            zoneAssignments.set(bestZone.zoneId, count + 1);
            bestZone.assignedDroneIds.push(drone.id);
        }
    }

    return missions;
};

/**
 * Get the best unscanned cell within a zone for precise targeting.
 * Returns the highest-probability unscanned cell, or the centroid if all are scanned.
 */
export const getBestCellInZone = (
    zone: SearchZone,
    currentTick: number,
    pins: FoundPin[] = [],
): { x: number; y: number } => {
    if (zone.cells.length === 0) return zone.centroid;

    // score = (probability * 0.6) + ((1 - pheromone) * 0.3) + (recencyFactor * 0.1)
    // recencyFactor = min(1, (currentTick - lastVisitedTick) / 10)
    
    // Survivor Avoidance & Target Selection
    const unscannedCells = zone.cells.filter(c => !c.scanned);
    const candidateCells = unscannedCells.length > 0 ? unscannedCells : zone.cells;

    const scoredCells = candidateCells.map(c => {
        const lastVisited = c.lastVisitedTick ?? 0;
        const recencyFactor = Math.min(1, (currentTick - lastVisited) / 10);
        
        // Survivor Avoidance: check if cell is near a pin
        const isNearPin = pins.some(p => Math.abs(p.x - c.x) <= 1.5 && Math.abs(p.y - c.y) <= 1.5);
        const isExactPin = pins.some(p => Math.abs(p.x - c.x) < 0.5 && Math.abs(p.y - c.y) < 0.5);
        
        // STRIKE: Strictly forbid targeting the exact pin.
        // Penalty for proximity to Pin.
        const pinPenalty = isExactPin ? 1000.0 : (isNearPin ? 100.0 : 0);

        const score = (c.prob * 0.6) + ((1 - c.pheromone) * 0.3) + (recencyFactor * 0.1) - pinPenalty;
        return { cell: c, score };
    });

    scoredCells.sort((a, b) => b.score - a.score);
    return { x: scoredCells[0].cell.x, y: scoredCells[0].cell.y };
};
