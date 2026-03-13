/**
 *  actionExecutor.ts — Executes AI decisions against the simulation
 *
 *  Takes the OrchestratorDecision and applies each action to the drone swarm
 *  and grid state. Returns a log of what was executed.
 */

import type { OrchestratorAction, OrchestratorDecision } from './types.js';
import type { SearchDrone } from '../utils/swarmRouting.js';
import {
    aStarPath,
    OBSTACLE_SET,
    GRID_W,
    GRID_H,
    BASE_X,
    BASE_Y,
    recalculateRegionsByPriority,
    buildScanQueueForDrone,
} from '../utils/swarmRouting.js';

export interface ExecutionResult {
    executed: number;
    skipped: number;
    log: string[];
    // Flag to tell the orchestrator chat loop to perform computer vision
    imageCaptureRequests: { droneId: string, x: number, y: number }[];
}

/**
 * Apply the AI's decisions to the current drone array and heatmap.
 * Returns a new drone array (immutable) and execution log.
 */
export const executeDecision = (
    decision: OrchestratorDecision,
    drones: SearchDrone[],
    _heatmap: number[][],
): { drones: SearchDrone[]; result: ExecutionResult } => {
    let currentDrones = [...drones];
    const log: string[] = [];
    const imageCaptureRequests: { droneId: string, x: number, y: number }[] = [];
    let executed = 0;
    let skipped = 0;

    for (const action of decision.actions) {
        try {
            switch (action.type) {
                case 'move_drone': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1 || !currentDrones[idx].active) {
                        log.push(`⚠ SKIP move_drone: ${action.droneId} not found or inactive`);
                        skipped++;
                        break;
                    }

                    const drone = currentDrones[idx];
                    const targetX = Math.max(0, Math.min(GRID_W - 1, action.x));
                    const targetY = Math.max(0, Math.min(GRID_H - 1, action.y));

                    // Compute A* path from current position to target
                    const path = aStarPath(
                        { x: drone.x, y: drone.y },
                        { x: targetX, y: targetY },
                        OBSTACLE_SET,
                        GRID_W,
                        GRID_H,
                    );

                    currentDrones[idx] = {
                        ...drone,
                        tx: targetX,
                        ty: targetY,
                        path,
                        pathIndex: 0,
                    };

                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`✓ move_drone: ${action.droneId} → (${targetX},${targetY}) path=${path.length} steps${reasonStr}`);
                    executed++;
                    break;
                }

                case 'scan_area': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1 || !currentDrones[idx].active) {
                        log.push(`⚠ SKIP scan_area: ${action.droneId} not found or inactive`);
                        skipped++;
                        break;
                    }

                    // Scan is handled by the simulation tick — just log the intent
                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`✓ scan_area: ${action.droneId} at (${currentDrones[idx].x},${currentDrones[idx].y})${reasonStr}`);
                    executed++;
                    break;
                }

                case 'capture_image': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1 || !currentDrones[idx].active) {
                        log.push(`⚠ SKIP capture_image: ${action.droneId} not found or inactive`);
                        skipped++;
                        break;
                    }

                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`📸 capture_image: ${action.droneId} activating optical payload at (${action.x},${action.y})${reasonStr}`);
                    
                    // Queue the request for the chat loop to actually process the image with Gemini
                    imageCaptureRequests.push({ droneId: action.droneId, x: action.x, y: action.y });
                    executed++;
                    break;
                }

                case 'recall_drone': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1) {
                        log.push(`⚠ SKIP recall_drone: ${action.droneId} not found`);
                        skipped++;
                        break;
                    }

                    const drone = currentDrones[idx];
                    const returnPath = aStarPath(
                        { x: drone.x, y: drone.y },
                        { x: BASE_X, y: BASE_Y },
                        OBSTACLE_SET,
                        GRID_W,
                        GRID_H,
                    );

                    currentDrones[idx] = {
                        ...drone,
                        tx: BASE_X,
                        ty: BASE_Y,
                        path: returnPath,
                        pathIndex: 0,
                    };

                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`✓ recall_drone: ${action.droneId} returning to base${reasonStr}`);
                    executed++;
                    break;
                }

                case 'reallocate_swarm': {
                    // Trigger full region reallocation for all active drones
                    const activeBefore = currentDrones.filter(d => d.active).length;
                    const reallocated = recalculateRegionsByPriority(currentDrones, _heatmap, GRID_W, GRID_H);
                    
                    // Rebuild scan queues for the new regions
                    currentDrones = reallocated.map(d => {
                        if (!d.active) return d;
                        const newQueue = buildScanQueueForDrone(d, _heatmap);
                        return { ...d, scanQueue: newQueue, scanQueueIndex: 0 };
                    });

                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`✓ reallocate_swarm: Grid re-partitioned for ${activeBefore} active drones${reasonStr}`);
                    executed++;
                    break;
                }

                case 'deploy_team': {
                    const reasonStr = ('reason' in action && action.reason) ? ` — ${action.reason}` : '';
                    log.push(`✓ deploy_team: "${action.teamName}" → cell ${action.cellId}${reasonStr}`);
                    executed++;
                    break;
                }

                case 'create_alert': {
                    const icon = action.severity === 'critical' ? '🔴' :
                                 action.severity === 'high' ? '🟠' :
                                 action.severity === 'medium' ? '🟡' : '🟢';
                    log.push(`${icon} ALERT [${action.severity.toUpperCase()}]: ${action.message}`);
                    executed++;
                    break;
                }

                case 'search_pattern': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1 || !currentDrones[idx].active) {
                        log.push(`⚠ SKIP search_pattern: ${action.droneId} not found or inactive`);
                        skipped++;
                        break;
                    }

                    const drone = currentDrones[idx];
                    const cx = action.x;
                    const cy = action.y;
                    let pQueue: { x: number, y: number }[] = [];

                    if (action.pattern === 'spiral') {
                        pQueue = [
                            { x: cx, y: cy }, { x: cx+1, y: cy }, { x: cx+1, y: cy+1 },
                            { x: cx, y: cy+1 }, { x: cx-1, y: cy+1 }, { x: cx-1, y: cy },
                            { x: cx-1, y: cy-1 }, { x: cx, y: cy-1 }, { x: cx+1, y: cy-1 }
                        ];
                    } else if (action.pattern === 'lawnmower') {
                        pQueue = [
                            { x: cx-1, y: cy-1 }, { x: cx, y: cy-1 }, { x: cx+1, y: cy-1 },
                            { x: cx+1, y: cy }, { x: cx, y: cy }, { x: cx-1, y: cy },
                            { x: cx-1, y: cy+1 }, { x: cx, y: cy+1 }, { x: cx+1, y: cy+1 }
                        ];
                    } else { // expanding_sq
                        pQueue = [
                            { x: cx, y: cy }, { x: cx-1, y: cy-1 }, { x: cx+1, y: cy-1 },
                            { x: cx+1, y: cy+1 }, { x: cx-1, y: cy+1 }
                        ];
                    }

                    pQueue = pQueue.filter(p => p.x >= 0 && p.x < GRID_W && p.y >= 0 && p.y < GRID_H);

                    currentDrones[idx] = {
                        ...drone,
                        scanQueue: pQueue,
                        scanQueueIndex: 0
                    };

                    log.push(`🌀 search_pattern: ${action.droneId} executing ${action.pattern} at (${cx},${cy})`);
                    executed++;
                    break;
                }

                case 'no_action': {
                    const reasonStr = ('reason' in action && action.reason) ? `: ${action.reason}` : '';
                    log.push(`○ no_action${reasonStr}`);
                    executed++;
                    break;
                }

                default: {
                    log.push(`⚠ SKIP unknown action type: ${(action as OrchestratorAction).type}`);
                    skipped++;
                }
            }
        } catch (err) {
            log.push(`✗ ERROR executing ${action.type}: ${err}`);
            skipped++;
        }
    }

    return {
        drones: currentDrones,
        result: { executed, skipped, log, imageCaptureRequests },
    };
};
