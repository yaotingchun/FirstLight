/**
 * Relay Drone Engine
 * 
 * Pure functions for relay drone positioning, battery management,
 * swarm data aggregation, and swarm coordination.
 * 
 * These functions are stateless — they take inputs and return computed results.
 * State is managed by the droneStore.
 */

import type {
    DroneStatus,
    DronePosition,
    SwarmKnowledge,
    SectorScanResult,
    RelayDroneStatus,
} from '../types.js';
import { gridToLabel, GRID_W, GRID_H, BASE_X, BASE_Y } from '../droneStore.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Battery % below which a relay is considered low and should be replaced */
export const RELAY_BATTERY_THRESHOLD = 25;

/** Communication ranges (must match SimulationMapMCP.tsx) */
export const COMM_RANGE_DRONE = 5;
export const COMM_RANGE_RELAY = 10;
export const COMM_RANGE_BASE = 12;

/** Number of candidate positions to evaluate in coverage optimization */
const COVERAGE_CANDIDATE_COUNT = 36;

// ═══════════════════════════════════════════════════════════════════════════
// CENTROID POSITIONING (Normal Mode)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the centroid of active search drones.
 * Filters out drones that are charging, returning to base, or inactive.
 * 
 * Formula:
 *   centroidX = sum(drone.x) / count
 *   centroidY = sum(drone.y) / count
 */
export function computeCentroidPosition(
    searchDrones: DroneStatus[]
): { x: number; y: number } | null {
    const active = searchDrones.filter(
        d => d.isActive && d.mode !== 'Charging' && d.mode !== 'Relay'
    );

    if (active.length === 0) return null;

    let sumX = 0;
    let sumY = 0;
    for (const d of active) {
        sumX += d.position.x;
        sumY += d.position.y;
    }

    return {
        x: Math.max(0, Math.min(GRID_W - 1, sumX / active.length)),
        y: Math.max(0, Math.min(GRID_H - 1, sumY / active.length)),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE OPTIMIZATION (Emergency Mode)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find the position that maximizes the number of drones connected to base.
 * Evaluates candidate positions in a grid pattern and scores each by the
 * number of drones that would be within relay communication range AND
 * have a path back to base through the relay.
 * 
 * Returns the best position and its coverage score.
 */
export function computeCoveragePosition(
    searchDrones: DroneStatus[],
    basePosition: { x: number; y: number },
    otherRelays: DroneStatus[] = []
): { x: number; y: number; score: number } {
    const activeDrones = searchDrones.filter(
        d => d.isActive && d.mode !== 'Charging' && d.mode !== 'Relay'
    );

    if (activeDrones.length === 0) {
        return { x: basePosition.x, y: basePosition.y, score: 0 };
    }

    let bestPos = { x: GRID_W / 2, y: GRID_H / 2 };
    let bestScore = -1;

    // Sample candidate positions across the grid
    const step = Math.max(1, Math.floor(GRID_W / Math.sqrt(COVERAGE_CANDIDATE_COUNT)));
    for (let cx = 0; cx < GRID_W; cx += step) {
        for (let cy = 0; cy < GRID_H; cy += step) {
            // Score: count drones that would be connected
            // A drone connects if within COMM_RANGE_RELAY of this position
            // AND this position is within COMM_RANGE_RELAY of base or another relay
            const distToBase = Math.sqrt(
                Math.pow(cx - basePosition.x, 2) +
                Math.pow(cy - basePosition.y, 2)
            );

            const canReachBase = distToBase <= COMM_RANGE_RELAY ||
                distToBase <= COMM_RANGE_BASE ||
                otherRelays.some(r => {
                    const distToRelay = Math.sqrt(
                        Math.pow(cx - r.position.x, 2) +
                        Math.pow(cy - r.position.y, 2)
                    );
                    return distToRelay <= COMM_RANGE_RELAY;
                });

            if (!canReachBase) continue;

            let score = 0;
            for (const d of activeDrones) {
                const dist = Math.sqrt(
                    Math.pow(cx - d.position.x, 2) +
                    Math.pow(cy - d.position.y, 2)
                );
                if (dist <= COMM_RANGE_RELAY) {
                    score++;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestPos = { x: cx, y: cy };
            }
        }
    }

    return { ...bestPos, score: bestScore };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATTERY MONITORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a relay drone's battery is below the replacement threshold.
 */
export function checkBatteryThreshold(
    battery: number,
    threshold: number = RELAY_BATTERY_THRESHOLD
): boolean {
    return battery < threshold;
}

// ═══════════════════════════════════════════════════════════════════════════
// SWARM DATA AGGREGATION (Edge Intelligence)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an empty SwarmKnowledge snapshot.
 */
export function createEmptySwarmKnowledge(): SwarmKnowledge {
    return {
        probabilityHeatmap: [],
        exploredCells: [],
        detectedHazards: [],
        droneBatteryMap: [],
        sensorDetections: [],
        lastUpdated: 0,
    };
}

/**
 * Aggregate data from the grid and drones into a SwarmKnowledge snapshot.
 * This merges:
 *   - Survivor probability heatmap from scanned sectors
 *   - List of explored cells
 *   - Detected hazards (high-probability sectors as potential hazard indicators)
 *   - Drone battery status map
 *   - Sensor signal detections from scanned sectors
 */
export function aggregateSwarmData(
    grid: SectorScanResult[][],
    drones: DroneStatus[],
    currentTick: number,
    existingKnowledge?: SwarmKnowledge
): SwarmKnowledge {
    const probabilityHeatmap: SwarmKnowledge['probabilityHeatmap'] = [];
    const exploredCells: string[] = [];
    const detectedHazards: SwarmKnowledge['detectedHazards'] = [];
    const sensorDetections: SwarmKnowledge['sensorDetections'] = [];

    // Merge existing knowledge (for offline buffering)
    const existingExplored = new Set(existingKnowledge?.exploredCells ?? []);

    for (const row of grid) {
        for (const cell of row) {
            const label = cell.gridCell;

            // Probability heatmap: include all cells with meaningful probability
            if (cell.probability > 0.05) {
                probabilityHeatmap.push({
                    gridCell: label,
                    probability: Math.round(cell.probability * 1000) / 1000,
                });
            }

            // Explored cells
            if (cell.scanned) {
                exploredCells.push(label);
                existingExplored.add(label);
            }

            // Hazard detection: high probability indicates potential danger zone
            if (cell.scanned && cell.probability > 0.6) {
                detectedHazards.push({
                    gridCell: label,
                    type: 'high_signal',
                    severity: Math.round(cell.probability * 10) / 10,
                });
            }

            // Sensor detections: aggregate strongest signals
            if (cell.scanned) {
                const signals = cell.signals;
                const strongest = Math.max(
                    signals.mobile, signals.thermal,
                    signals.sound, signals.wifi
                );
                if (strongest > 0.3) {
                    const signalType =
                        signals.thermal >= strongest ? 'thermal' :
                        signals.mobile >= strongest ? 'mobile' :
                        signals.sound >= strongest ? 'sound' : 'wifi';
                    sensorDetections.push({
                        gridCell: label,
                        signal: signalType,
                        strength: Math.round(strongest * 100) / 100,
                    });
                }
            }
        }
    }

    // Battery map from all drones
    const droneBatteryMap = drones.map(d => ({
        droneId: d.id,
        battery: Math.round(d.battery * 10) / 10,
    }));

    return {
        probabilityHeatmap,
        exploredCells: Array.from(existingExplored),
        detectedHazards,
        droneBatteryMap,
        sensorDetections: sensorDetections.slice(0, 50), // cap at 50 for performance
        lastUpdated: currentTick,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SWARM COORDINATION
// ═══════════════════════════════════════════════════════════════════════════

export interface SwarmDirective {
    type: 'recruit' | 'micro_scan' | 'redistribute';
    targetX: number;
    targetY: number;
    radius: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
}

/**
 * Generate swarm coordination directives based on current knowledge.
 * 
 * Directives:
 *   - RECRUIT: pull nearby drones to high-probability zones
 *   - MICRO_SCAN: assign fine-grained scan to promising areas
 *   - REDISTRIBUTE: spread drones when coverage is uneven
 */
export function coordinateSwarm(
    knowledge: SwarmKnowledge,
    searchDrones: DroneStatus[]
): SwarmDirective[] {
    const directives: SwarmDirective[] = [];
    const activeDrones = searchDrones.filter(
        d => d.isActive && d.mode !== 'Charging' && d.mode !== 'Relay'
    );

    if (activeDrones.length === 0) return directives;

    // 1. Recruit to high-probability zones
    const hotspots = knowledge.probabilityHeatmap
        .filter(h => h.probability > 0.6)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 3);

    for (const hotspot of hotspots) {
        const [colStr, rowStr] = [hotspot.gridCell.charAt(0), hotspot.gridCell.slice(1)];
        const row = colStr.charCodeAt(0) - 65;
        const col = parseInt(rowStr) - 1;
        const x = col;
        const y = GRID_H - 1 - row;

        // Check if drones are already near this hotspot
        const dronesNearby = activeDrones.filter(d => {
            const dist = Math.sqrt(
                Math.pow(d.position.x - x, 2) +
                Math.pow(d.position.y - y, 2)
            );
            return dist <= 3;
        });

        if (dronesNearby.length < 2) {
            directives.push({
                type: 'recruit',
                targetX: x,
                targetY: y,
                radius: 3,
                priority: hotspot.probability > 0.8 ? 'critical' : 'high',
                reason: `High survivor probability (${hotspot.probability}) at ${hotspot.gridCell}, only ${dronesNearby.length} drones nearby`,
            });
        }
    }

    // 2. Micro-scan suggestion for strong sensor detections
    const strongSignals = knowledge.sensorDetections
        .filter(s => s.strength > 0.5)
        .slice(0, 2);

    for (const signal of strongSignals) {
        const [colStr, rowStr] = [signal.gridCell.charAt(0), signal.gridCell.slice(1)];
        const row = colStr.charCodeAt(0) - 65;
        const col = parseInt(rowStr) - 1;
        const x = col;
        const y = GRID_H - 1 - row;

        directives.push({
            type: 'micro_scan',
            targetX: x,
            targetY: y,
            radius: 2,
            priority: 'medium',
            reason: `Strong ${signal.signal} signal (${signal.strength}) at ${signal.gridCell}`,
        });
    }

    return directives;
}

// ═══════════════════════════════════════════════════════════════════════════
// RELAY STATUS BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a RelayDroneStatus from a generic DroneStatus and network context.
 */
export function buildRelayStatus(
    drone: DroneStatus,
    allDrones: DroneStatus[],
    knowledge: SwarmKnowledge,
    isBackup: boolean = false
): RelayDroneStatus {
    // Find search drones within relay communication range
    const connectedSearchDrones = allDrones
        .filter(d => {
            if (d.id === drone.id || d.mode === 'Relay') return false;
            const dist = Math.sqrt(
                Math.pow(d.position.x - drone.position.x, 2) +
                Math.pow(d.position.y - drone.position.y, 2)
            );
            return dist <= COMM_RANGE_RELAY;
        })
        .map(d => d.id);

    // Determine movement mode based on disconnected drone count
    const disconnected = allDrones.filter(d =>
        d.isActive && !d.isConnected && d.mode !== 'Relay'
    );
    const movementMode: 'centroid' | 'coverage' = disconnected.length > 0 ? 'coverage' : 'centroid';

    return {
        id: drone.id,
        position: drone.position,
        battery: drone.battery,
        mode: 'Relay',
        isConnected: drone.isConnected,
        connectedSearchDrones,
        swarmKnowledge: knowledge,
        isBackup,
        movementMode,
    };
}
