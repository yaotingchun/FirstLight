/**
 * ORCHESTRATION MODULE - MCP Tools
 *
 * Higher-level tools for AI orchestration loops.
 * These tools combine policy checks, ranking, and batched command issuance.
 */

import { droneStore, GRID_W, GRID_H, BASE_X, BASE_Y, gridToLabel } from '../droneStore.js';
import type {
    MCPToolResult,
    DroneMode,
    ValidateAssignmentPlanParams,
    ValidateAssignmentPlanResult,
    AssignmentBatchItem,
    AssignHotspotBatchParams,
    AssignHotspotBatchResult,
    RecommendedAction,
    RecommendedActionsResult,
    BatteryRiskMapParams,
    BatteryRiskMapResult,
    BatteryRiskEntry
} from '../types.js';

const MOVE_DRAIN_PER_TILE = 0.075;
const SPEED_WIDE = 0.3;
const SPEED_MICRO = 0.075;
const SENSOR_WIDE = 0.015;
const SENSOR_MICRO = 0.005;

function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function normalizeMode(mode: DroneMode | undefined, fallback: DroneMode): 'Wide' | 'Micro' {
    const m = mode ?? fallback;
    return m === 'Micro' ? 'Micro' : 'Wide';
}

function computeBatteryProjection(
    battery: number,
    fromX: number,
    fromY: number,
    targetX: number,
    targetY: number,
    mode: 'Wide' | 'Micro'
): { projectedBatteryOnReturn: number; estimatedUsed: number; totalDistance: number } {
    const speed = mode === 'Wide' ? SPEED_WIDE : SPEED_MICRO;
    const sensorDrain = mode === 'Wide' ? SENSOR_WIDE : SENSOR_MICRO;

    const distToTarget = distance(fromX, fromY, targetX, targetY);
    const distTargetToBase = distance(targetX, targetY, BASE_X, BASE_Y);
    const totalDistance = distToTarget + distTargetToBase;

    const movementDrain = totalDistance * MOVE_DRAIN_PER_TILE;
    const sensorTotal = (totalDistance / speed) * sensorDrain;
    const estimatedUsed = movementDrain + sensorTotal;

    return {
        projectedBatteryOnReturn: battery - estimatedUsed,
        estimatedUsed,
        totalDistance
    };
}

function checkAssignment(item: AssignmentBatchItem): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (item.targetX < 0 || item.targetX >= GRID_W || item.targetY < 0 || item.targetY >= GRID_H) {
        errors.push(`Target (${item.targetX}, ${item.targetY}) out of bounds`);
        return { errors, warnings };
    }

    const drone = droneStore.getDrone(item.droneId);
    if (!drone) {
        errors.push(`Drone ${item.droneId} not found`);
        return { errors, warnings };
    }

    if (!drone.isActive) errors.push(`Drone ${item.droneId} is inactive`);
    if (!drone.isConnected) warnings.push(`Drone ${item.droneId} is disconnected`);
    if (drone.mode === 'Charging') errors.push(`Drone ${item.droneId} is charging`);

    const sector = droneStore.getSector(item.targetX, item.targetY);
    if (!sector) {
        errors.push(`Sector (${item.targetX}, ${item.targetY}) not available`);
        return { errors, warnings };
    }

    if (sector.scanned) warnings.push(`Target sector ${gridToLabel(item.targetX, item.targetY)} already scanned`);
    if (sector.probability < 0.15) warnings.push(`Low-probability sector (${sector.probability.toFixed(2)})`);

    const mode = normalizeMode(item.mode, drone.mode);
    const projection = computeBatteryProjection(
        drone.battery,
        drone.position.x,
        drone.position.y,
        item.targetX,
        item.targetY,
        mode
    );

    if (projection.projectedBatteryOnReturn <= 5) {
        errors.push(`Insufficient battery margin (projected return: ${projection.projectedBatteryOnReturn.toFixed(1)}%)`);
    } else if (projection.projectedBatteryOnReturn < 15) {
        warnings.push(`Low return margin (${projection.projectedBatteryOnReturn.toFixed(1)}%)`);
    }

    return { errors, warnings };
}

export async function validateAssignmentPlan(
    params: ValidateAssignmentPlanParams
): Promise<MCPToolResult<ValidateAssignmentPlanResult>> {
    const assignments = params.assignments || [];

    if (!Array.isArray(assignments) || assignments.length === 0) {
        return {
            success: false,
            error: 'assignments must be a non-empty array',
            timestamp: Date.now()
        };
    }

    const results: ValidateAssignmentPlanResult['results'] = [];
    const targetMap = new Map<string, string[]>();

    for (const item of assignments) {
        const key = `${item.targetX},${item.targetY}`;
        if (!targetMap.has(key)) targetMap.set(key, []);
        targetMap.get(key)!.push(item.droneId);
    }

    assignments.forEach(item => {
        const { errors, warnings } = checkAssignment(item);
        const sameTarget = targetMap.get(`${item.targetX},${item.targetY}`) || [];
        if (sameTarget.length > 1) {
            warnings.push(`Target conflict: ${sameTarget.join(', ')} share ${gridToLabel(item.targetX, item.targetY)}`);
        }

        results.push({
            assignment: item,
            valid: errors.length === 0,
            errors,
            warnings
        });
    });

    const validCount = results.filter(r => r.valid).length;

    return {
        success: true,
        data: {
            valid: validCount === results.length,
            validCount,
            invalidCount: results.length - validCount,
            results
        },
        timestamp: Date.now()
    };
}

export async function assignHotspotBatch(
    params: AssignHotspotBatchParams
): Promise<MCPToolResult<AssignHotspotBatchResult>> {
    const assignments = params.assignments || [];

    if (!Array.isArray(assignments) || assignments.length === 0) {
        return {
            success: false,
            error: 'assignments must be a non-empty array',
            timestamp: Date.now()
        };
    }

    const accepted: AssignHotspotBatchResult['accepted'] = [];
    const rejected: AssignHotspotBatchResult['rejected'] = [];

    for (const item of assignments) {
        const { errors, warnings } = checkAssignment(item);
        if (errors.length > 0) {
            rejected.push({ assignment: item, reason: errors.join('; ') });
            continue;
        }

        const drone = droneStore.getDrone(item.droneId)!;
        const targetCell = gridToLabel(item.targetX, item.targetY);
        const commandIds: string[] = [];

        if (item.mode && item.mode !== drone.mode) {
            commandIds.push(
                droneStore.enqueueCommand('SET_MODE', {
                    droneId: item.droneId,
                    mode: item.mode
                })
            );
        }

        commandIds.push(
            droneStore.enqueueCommand('SET_TARGET', {
                droneId: item.droneId,
                targetX: item.targetX,
                targetY: item.targetY
            })
        );

        accepted.push({
            assignment: item,
            commandIds,
            message: `Queued ${item.droneId} -> ${targetCell}${warnings.length ? ` (${warnings.join(', ')})` : ''}`
        });
    }

    return {
        success: true,
        data: {
            accepted,
            rejected,
            queuedCount: accepted.length
        },
        timestamp: Date.now()
    };
}

export async function getBatteryRiskMap(
    params: BatteryRiskMapParams = {}
): Promise<MCPToolResult<BatteryRiskMapResult>> {
    const safetyBuffer = params.safetyBuffer ?? 15;
    const drones = droneStore.getAllDrones().filter(d => d.isActive && d.mode !== 'Relay' && d.mode !== 'Charging');

    const entries: BatteryRiskEntry[] = drones.map(d => {
        const mode = normalizeMode(undefined, d.mode);
        const targetX = d.target ? Math.round(d.target.x) : Math.round(d.position.x);
        const targetY = d.target ? Math.round(d.target.y) : Math.round(d.position.y);
        const projection = computeBatteryProjection(
            d.battery,
            d.position.x,
            d.position.y,
            targetX,
            targetY,
            mode
        );

        const projectedBatteryOnReturn = Math.round(projection.projectedBatteryOnReturn * 100) / 100;
        const sector = gridToLabel(targetX, targetY);

        let riskLevel: BatteryRiskEntry['riskLevel'] = 'low';
        let recommendation: BatteryRiskEntry['recommendation'] = 'continue';

        if (projectedBatteryOnReturn <= 5 || d.battery <= 12) {
            riskLevel = 'critical';
            recommendation = 'recall';
        } else if (projectedBatteryOnReturn < safetyBuffer || d.battery <= 20) {
            riskLevel = 'high';
            recommendation = 'avoid-micro';
        } else if (projectedBatteryOnReturn < safetyBuffer + 10 || d.battery <= 30) {
            riskLevel = 'medium';
            recommendation = 'monitor';
        }

        return {
            droneId: d.id,
            currentBattery: Math.round(d.battery * 100) / 100,
            targetSector: sector,
            projectedBatteryOnReturn,
            riskLevel,
            recommendation
        };
    });

    entries.sort((a, b) => {
        const rank = { critical: 4, high: 3, medium: 2, low: 1 };
        return rank[b.riskLevel] - rank[a.riskLevel];
    });

    return {
        success: true,
        data: {
            entries,
            critical: entries.filter(e => e.riskLevel === 'critical').map(e => e.droneId),
            high: entries.filter(e => e.riskLevel === 'high').map(e => e.droneId),
            medium: entries.filter(e => e.riskLevel === 'medium').map(e => e.droneId),
            low: entries.filter(e => e.riskLevel === 'low').map(e => e.droneId)
        },
        timestamp: Date.now()
    };
}

export async function getRecommendedActions(
    params: { maxActions?: number } = {}
): Promise<MCPToolResult<RecommendedActionsResult>> {
    const maxActions = Math.max(1, params.maxActions ?? 8);
    const actions: RecommendedAction[] = [];

    const drones = droneStore.getAllDrones();
    const grid = droneStore.getGrid();

    // 1) Battery-critical first
    const battery = await getBatteryRiskMap({ safetyBuffer: 15 });
    if (battery.success && battery.data) {
        battery.data.entries
            .filter(e => e.riskLevel === 'critical')
            .forEach(e => {
                actions.push({
                    priority: 'critical',
                    type: 'recallDroneToBase',
                    params: { droneId: e.droneId },
                    reason: `Battery critical (${e.currentBattery.toFixed(1)}%), projected return ${e.projectedBatteryOnReturn.toFixed(1)}%`
                });
            });
    }

    // 2) Connectivity recovery hints
    const disconnected = drones.filter(d => d.isActive && !d.isConnected);
    disconnected.forEach(d => {
        actions.push({
            priority: 'high',
            type: 'recallDroneToBase',
            params: { droneId: d.id },
            reason: 'Drone disconnected from mesh'
        });
    });

    // 3) Unassigned hotspots
    const hotspots: Array<{ x: number; y: number; probability: number; pheromone: number; urgency: number }> = [];
    const targeted = new Set(
        drones
            .filter(d => d.isActive && d.target)
            .map(d => `${Math.round(d.target!.x)},${Math.round(d.target!.y)}`)
    );

    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const s = grid[y][x];
            if (s.scanned || s.probability < 0.35) continue;
            const key = `${x},${y}`;
            if (targeted.has(key)) continue;
            hotspots.push({
                x,
                y,
                probability: s.probability,
                pheromone: s.pheromone,
                urgency: s.probability * (1 - Math.min(1, s.pheromone))
            });
        }
    }

    hotspots
        .sort((a, b) => b.urgency - a.urgency)
        .slice(0, 4)
        .forEach(h => {
            const candidate = drones
                .filter(d => d.isActive && d.isConnected && d.mode !== 'Charging' && d.mode !== 'Relay' && d.battery > 25)
                .sort((a, b) => distance(a.position.x, a.position.y, h.x, h.y) - distance(b.position.x, b.position.y, h.x, h.y))[0];

            if (candidate) {
                const mode: DroneMode = h.probability >= 0.6 ? 'Micro' : 'Wide';
                actions.push({
                    priority: h.urgency >= 0.6 ? 'critical' : 'medium',
                    type: 'assignHotspotBatch',
                    params: {
                        assignments: [
                            {
                                droneId: candidate.id,
                                targetX: h.x,
                                targetY: h.y,
                                mode
                            }
                        ]
                    },
                    reason: `Unassigned hotspot ${gridToLabel(h.x, h.y)} urgency ${h.urgency.toFixed(2)}`
                });
            }
        });

    const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };
    actions.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);

    return {
        success: true,
        data: {
            actions: actions.slice(0, maxActions),
            generatedAtTick: droneStore.getCurrentTick()
        },
        timestamp: Date.now()
    };
}

export const orchestrationTools = {
    validateAssignmentPlan,
    assignHotspotBatch,
    getRecommendedActions,
    getBatteryRiskMap
};
