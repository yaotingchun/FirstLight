/**
 *  zoneScoring.ts — Computes strategic scores for each SearchZone
 *
 *  Uses a weighted formula combining probability, sensor signals,
 *  recency penalties, and drone overlap to rank zones for allocation.
 */

import type { SearchZone } from './zoneClustering.js';
import type { SearchMemory } from './searchMemory.js';

// ── Configurable scoring weights ─────────────────────────────────────────────

export interface ZoneScoringWeights {
    probability: number;       // weight for avg zone probability
    maxProbability: number;    // weight for peak probability in zone
    sensor: number;            // weight for aggregated sensor signals
    unscannedBonus: number;    // bonus per unscanned cell ratio
    recency: number;           // penalty weight for recently scanned zones
    droneOverlap: number;      // penalty weight per drone already assigned
    failedScanPenalty: number; // penalty weight for zones with many failed scans
    persistentSignal: number;  // bonus for zones with sustained signals
}

export const DEFAULT_ZONE_WEIGHTS: ZoneScoringWeights = {
    probability: 1.0,
    maxProbability: 0.5,
    sensor: 0.6,
    unscannedBonus: 0.8,
    recency: 0.7,
    droneOverlap: 0.4,
    failedScanPenalty: 0.3,
    persistentSignal: 0.4,
};

// ── Scoring function ─────────────────────────────────────────────────────────

/**
 * Score all zones using the weighted formula. Mutates each zone's
 * `recencyPenalty` and `zoneScore` fields in-place, then returns
 * the array sorted by descending score.
 *
 * @param zones           Zones from clusterZones()
 * @param memory          Search memory for recency / failure tracking
 * @param currentTick     Current simulation tick
 * @param weights         Optional custom scoring weights
 */
export const scoreZones = (
    zones: SearchZone[],
    memory: SearchMemory,
    currentTick: number,
    weights: ZoneScoringWeights = DEFAULT_ZONE_WEIGHTS,
): SearchZone[] => {
    for (const zone of zones) {
        // ── Recency penalty (0–1, higher = scanned more recently) ────────
        const lastScan = memory.recentlyScannedZones.get(zone.zoneId) ?? 0;
        const ticksSinceScan = currentTick - lastScan;
        // Exponential decay: penalty = 1 at tick 0, ~0.5 at 30 ticks, ~0.1 at 70 ticks
        const recency = lastScan > 0
            ? Math.exp(-ticksSinceScan / 30)
            : 0;
        zone.recencyPenalty = recency;

        // ── Unscanned ratio bonus ────────────────────────────────────────
        const unscannedRatio = zone.totalCells > 0
            ? zone.unscannedCount / zone.totalCells
            : 0;

        // ── Failed scan penalty ──────────────────────────────────────────
        const failedCount = memory.failedScanCounts.get(zone.zoneId) ?? 0;
        const failedPenalty = Math.min(1, failedCount / 5); // saturates at 5 failures

        // ── Persistent signal bonus ──────────────────────────────────────
        const persistentBonus = memory.persistentSignals.get(zone.zoneId) ?? 0;

        // ── Drone overlap penalty ────────────────────────────────────────
        const droneCount = zone.assignedDroneIds.length;

        // ── Composite score ──────────────────────────────────────────────
        zone.zoneScore =
            (weights.probability * zone.probabilityScore) +
            (weights.maxProbability * zone.maxProbability) +
            (weights.sensor * zone.sensorScore) +
            (weights.unscannedBonus * unscannedRatio) +
            (weights.persistentSignal * persistentBonus) -
            (weights.recency * recency) -
            (weights.droneOverlap * droneCount) -
            (weights.failedScanPenalty * failedPenalty);
    }

    // Sort descending by score
    return zones.sort((a, b) => b.zoneScore - a.zoneScore);
};
