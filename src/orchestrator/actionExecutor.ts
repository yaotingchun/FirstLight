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

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

/**
 * Apply the AI's decisions to the current drone array and heatmap.
 * Returns a new drone array (immutable) and execution log.
 */
export const executeDecision = async (
    decision: OrchestratorDecision,
    drones: SearchDrone[],
    _heatmap: number[][],
    isLiveMode = false,
): Promise<{ drones: SearchDrone[]; result: ExecutionResult }> => {
    let currentDrones = [...drones];
    const log: string[] = [];
    const imageCaptureRequests: { droneId: string, x: number, y: number }[] = [];
    let executed = 0;
    let skipped = 0;

    // Proactive: if any drone action is decided in Live Mode, ensure sim is running
    if (isLiveMode && decision.actions.some(a => ['move_drone', 'set_drone_mode', 'search_pattern', 'recall_drone'].includes(a.type))) {
        await fetch(`${MCP_SERVER_URL}/api/tools/setSimulationRunning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ running: true })
        }).catch(e => console.error(`Failed to auto-start simulation: ${e}`));
    }

    for (const action of decision.actions) {
        try {
            switch (action.type) {
                case 'set_drone_mode': {
                    const idx = currentDrones.findIndex(d => d.id === action.droneId);
                    if (idx === -1) {
                        log.push(`⚠ SKIP set_drone_mode: ${action.droneId} not found`);
                        skipped++;
                        break;
                    }

                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/setDroneMode`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ droneId: action.droneId, mode: action.mode })
                        }).catch(e => console.error(`Remote mode set failed: ${e}`));
                    } else {
                        currentDrones[idx] = { ...currentDrones[idx], mode: action.mode };
                    }

                    const reasonStr = action.reason ? ` — ${action.reason}` : '';
                    log.push(`✓ set_drone_mode: ${action.droneId} → ${action.mode}${reasonStr}`);
                    executed++;
                    break;
                }

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

                    const path = aStarPath(
                        { x: drone.x, y: drone.y },
                        { x: targetX, y: targetY },
                        OBSTACLE_SET,
                        GRID_W,
                        GRID_H,
                    );

                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/setDroneTarget`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ droneId: action.droneId, targetX, targetY })
                        }).catch(e => console.error(`Remote move failed: ${e}`));
                    } else {
                        currentDrones[idx] = { ...drone, tx: targetX, ty: targetY, path, pathIndex: 0 };
                    }

                    const reasonStr = action.reason ? ` — ${action.reason}` : '';
                    log.push(`✓ move_drone: ${action.droneId} → (${targetX},${targetY}) path=${path.length} steps${reasonStr}`);
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

                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/recallDroneToBase`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ droneId: action.droneId })
                        }).catch(e => console.error(`Remote recall failed: ${e}`));
                    } else {
                        const drone = currentDrones[idx];
                        currentDrones[idx] = {
                            ...drone,
                            tx: BASE_X,
                            ty: BASE_Y,
                            path: aStarPath({ x: drone.x, y: drone.y }, { x: BASE_X, y: BASE_Y }, OBSTACLE_SET, GRID_W, GRID_H),
                            pathIndex: 0,
                        };
                    }

                    const reasonStr = action.reason ? ` — ${action.reason}` : '';
                    log.push(`✓ recall_drone: ${action.droneId} returning to base${reasonStr}`);
                    executed++;
                    break;
                }

                case 'deploy_team': {
                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/setSurvivorPin`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                x: action.x, 
                                y: action.y, 
                                droneId: 'AI_AGENT', 
                                message: `Team ${action.teamName} deployed: ${action.reason}` 
                            })
                        }).catch(e => console.error(`Remote pin failed: ${e}`));
                    }
                    const reasonStr = action.reason ? ` — ${action.reason}` : '';
                    log.push(`✓ deploy_team: "${action.teamName}" → cell ${action.cellId} (${action.x},${action.y})${reasonStr}`);
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

                    const donor = currentDrones[idx];
                    const cx = action.x;
                    const cy = action.y;

                    if (isLiveMode) {
                        // 1. Set mode to Micro
                        await fetch(`${MCP_SERVER_URL}/api/tools/setDroneMode`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ droneId: action.droneId, mode: 'Micro' })
                        }).catch(e => console.error(`Remote pattern mode failed: ${e}`));
                        
                        // 2. Set target to center
                        await fetch(`${MCP_SERVER_URL}/api/tools/setDroneTarget`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ droneId: action.droneId, targetX: cx, targetY: cy })
                        }).catch(e => console.error(`Remote pattern target failed: ${e}`));
                    } else {
                        // Local pattern logic
                        let pQueue: { x: number, y: number }[] = [];
                        if (action.pattern === 'spiral') {
                            pQueue = [{ x: cx, y: cy }, { x: cx+1, y: cy }, { x: cx+1, y: cy+1 }, { x: cx, y: cy+1 }, { x: cx-1, y: cy+1 }, { x: cx-1, y: cy }, { x: cx-1, y: cy-1 }, { x: cx, y: cy-1 }, { x: cx+1, y: cy-1 }];
                        } else if (action.pattern === 'lawnmower') {
                            pQueue = [{ x: cx-1, y: cy-1 }, { x: cx, y: cy-1 }, { x: cx+1, y: cy-1 }, { x: cx+1, y: cy }, { x: cx, y: cy }, { x: cx-1, y: cy }, { x: cx-1, y: cy+1 }, { x: cx, y: cy+1 }, { x: cx+1, y: cy+1 }];
                        } else {
                            pQueue = [{ x: cx, y: cy }, { x: cx-1, y: cy-1 }, { x: cx+1, y: cy-1 }, { x: cx+1, y: cy+1 }, { x: cx-1, y: cy+1 }];
                        }
                        pQueue = pQueue.filter(p => p.x >= 0 && p.x < GRID_W && p.y >= 0 && p.y < GRID_H);
                        currentDrones[idx] = { ...donor, scanQueue: pQueue, scanQueueIndex: 0 };
                    }

                    log.push(`🌀 search_pattern: ${action.droneId} executing ${action.pattern} at (${cx},${cy})`);
                    executed++;
                    break;
                }

                case 'reset_simulation': {
                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/resetMission`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        }).catch(e => console.error(`Remote reset failed: ${e}`));
                    }
                    log.push(`⚠ reset_simulation: Mission restart triggered — ${action.reason}`);
                    executed++;
                    break;
                }

                case 'set_simulation_state': {
                    if (isLiveMode) {
                        await fetch(`${MCP_SERVER_URL}/api/tools/setSimulationRunning`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ running: action.running })
                        }).catch(e => console.error(`Remote simulation state set failed: ${e}`));
                    }
                    log.push(`⚙ set_simulation_state: Simulation ${action.running ? 'started' : 'paused'} — ${action.reason}`);
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
                    log.push(`📸 capture_image: ${action.droneId} activating optical payload at (${action.x},${action.y})`);
                    imageCaptureRequests.push({ droneId: action.droneId, x: action.x, y: action.y });
                    executed++;
                    break;
                }

                case 'reallocate_swarm': {
                    const activeBefore = currentDrones.filter(d => d.active).length;
                    const reallocated = recalculateRegionsByPriority(currentDrones, _heatmap, GRID_W, GRID_H);
                    currentDrones = reallocated.map(d => {
                        if (!d.active) return d;
                        return { ...d, scanQueue: buildScanQueueForDrone(d, _heatmap), scanQueueIndex: 0 };
                    });
                    log.push(`✓ reallocate_swarm: Grid re-partitioned for ${activeBefore} active drones`);
                    executed++;
                    break;
                }

                case 'create_alert': {
                    const icon = action.severity === 'critical' ? '🔴' : action.severity === 'high' ? '🟠' : action.severity === 'medium' ? '🟡' : '🟢';
                    log.push(`${icon} ALERT [${action.severity.toUpperCase()}]: ${action.message}`);
                    executed++;
                    break;
                }

                case 'no_action': {
                    log.push(`○ no_action: ${action.reason}`);
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
