/**
 * RELAY MODULE - MCP Tools
 * 
 * Tools for deploying, repositioning, replacing relay drones,
 * querying relay status and network topology, broadcasting swarm
 * commands, and computing optimal relay positions.
 * 
 * DESIGN RATIONALE:
 * - deployRelayDrone: ACTION - AI deploys new relay to extend coverage
 * - moveRelayDrone: ACTION - AI repositions relay for better connectivity
 * - replaceRelayDrone: ACTION - AI swaps low-battery relay with backup
 * - getRelayStatus: OBSERVATION - AI checks relay telemetry + edge data
 * - getNetworkTopology: OBSERVATION - AI inspects mesh health
 * - broadcastSwarmCommand: ACTION - AI coordinates swarm via relay network
 * - calculateOptimalRelayPosition: OBSERVATION - AI plans relay placement
 */

import { droneStore, gridToLabel, BASE_X, BASE_Y, GRID_W, GRID_H } from '../droneStore.js';
import { networkManager } from '../simulation/networkManager.js';
import {
    computeCoveragePosition,
    buildRelayStatus,
    COMM_RANGE_RELAY,
    COMM_RANGE_BASE,
} from '../simulation/relayDrone.js';
import type {
    MCPToolResult,
    DeployRelayDroneParams,
    DeployRelayDroneResult,
    MoveRelayDroneParams,
    MoveRelayDroneResult,
    ReplaceRelayDroneParams,
    ReplaceRelayDroneResult,
    GetRelayStatusParams,
    RelayDroneStatus,
    NetworkTopology,
    BroadcastSwarmCommandParams,
    BroadcastSwarmCommandResult,
    OptimalRelayPositionResult,
    DroneStatus,
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: moveRelayDrone
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: moveRelayDrone
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reposition an existing relay drone to a new target position.
 * 
 * The relay will navigate to the new position while maintaining
 * its communication relay function during transit.
 */
export async function moveRelayDrone(
    params: MoveRelayDroneParams
): Promise<MCPToolResult<MoveRelayDroneResult>> {
    const drone = droneStore.getDrone(params.relayId);

    if (!drone) {
        return {
            success: false,
            error: `Relay ${params.relayId} not found. Available relays: ${
                droneStore.getAllDrones()
                    .filter(d => d.mode === 'Relay')
                    .map(d => d.id)
                    .join(', ') || 'none'
            }`,
            timestamp: Date.now(),
        };
    }

    if (drone.mode !== 'Relay') {
        if (drone.id.startsWith('RLY-') && drone.mode === 'Charging') {
            droneStore.enqueueCommand('SET_MODE', {
                droneId: params.relayId,
                mode: 'Relay',
            });
        } else {
            return {
                success: false,
                error: `${params.relayId} is not in Relay mode (current: ${drone.mode})`,
                timestamp: Date.now(),
            };
        }
    }

    if (params.x < 0 || params.x >= GRID_W || params.y < 0 || params.y >= GRID_H) {
        return {
            success: false,
            error: `Invalid coordinates (${params.x}, ${params.y}). Must be within 0-${GRID_W - 1}.`,
            timestamp: Date.now(),
        };
    }

    const commandId = droneStore.enqueueCommand('MOVE_RELAY', {
        relayId: params.relayId,
        x: params.x,
        y: params.y,
    });

    return {
        success: true,
        data: {
            commandId,
            message: `Relay ${params.relayId} repositioning to (${params.x}, ${params.y}). Grid cell: ${gridToLabel(Math.round(params.x), Math.round(params.y))}`,
        },
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: replaceRelayDrone
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replace a low-battery relay drone with a fresh backup.
 * 
 * Behavior:
 * 1. Deploy a new relay at the old relay's position
 * 2. Recall the old relay to base for charging
 * 3. Transfer swarm knowledge to the new relay
 * 
 * Use when relay battery drops below 25%.
 */
export async function replaceRelayDrone(
    params: ReplaceRelayDroneParams
): Promise<MCPToolResult<ReplaceRelayDroneResult>> {
    const oldRelay = droneStore.getDrone(params.relayId);

    if (!oldRelay) {
        return {
            success: false,
            error: `Relay ${params.relayId} not found`,
            timestamp: Date.now(),
        };
    }

    if (oldRelay.mode !== 'Relay') {
        return {
            success: false,
            error: `${params.relayId} is not in Relay mode (current: ${oldRelay.mode})`,
            timestamp: Date.now(),
        };
    }

    const newRelayId = params.relayId === 'RLY-Prime' ? 'RLY-Backup' : 'RLY-Prime';
    const newRelay = droneStore.getDrone(newRelayId);

    if (!newRelay) {
        return {
            success: false,
            error: `Backup relay ${newRelayId} not found in state`,
            timestamp: Date.now(),
        };
    }

    // Queue: Atomic Relay Swap command
    const commandId = droneStore.enqueueCommand('REPLACE_RELAY', {
        oldRelayId: params.relayId,
        newRelayId: newRelayId,
        targetX: oldRelay.position.x,
        targetY: oldRelay.position.y
    });

    return {
        success: true,
        data: {
            oldRelayId: params.relayId,
            newRelayId,
            commandIds: [commandId],
            message: `Relay replacement: ${newRelayId} deploying to (${oldRelay.position.x.toFixed(1)}, ${oldRelay.position.y.toFixed(1)}), ${params.relayId} returning to base (battery: ${oldRelay.battery.toFixed(1)}%)`,
        },
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getRelayStatus
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get relay-specific telemetry including:
 * - Battery, position, connectivity
 * - Connected search drones within range
 * - Swarm knowledge summary (edge intelligence)
 * - Current movement mode (centroid vs coverage)
 */
export async function getRelayStatus(
    params: GetRelayStatusParams
): Promise<MCPToolResult<RelayDroneStatus>> {
    const drone = droneStore.getDrone(params.relayId);

    if (!drone) {
        return {
            success: false,
            error: `Relay ${params.relayId} not found. Available relays: ${
                droneStore.getAllDrones()
                    .filter(d => d.mode === 'Relay')
                    .map(d => d.id)
                    .join(', ') || 'none'
            }`,
            timestamp: Date.now(),
        };
    }

    if (drone.mode !== 'Relay') {
        return {
            success: false,
            error: `${params.relayId} is not in Relay mode (current: ${drone.mode})`,
            timestamp: Date.now(),
        };
    }

    const allDrones = droneStore.getAllDrones();
    const knowledge = droneStore.getSwarmKnowledge();
    const relayStatus = buildRelayStatus(drone, allDrones, knowledge);

    // Also persist to relay states
    droneStore.updateRelayState(relayStatus);

    return {
        success: true,
        data: relayStatus,
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getNetworkTopology
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get full mesh network topology including:
 * - Relay chain (Base → R1 → R2 → ...)
 * - All links with quality scores
 * - Connected / disconnected drone lists
 * - Hop counts from base for each drone
 * - Offline buffer size (if base disconnected)
 */
export async function getNetworkTopology(): Promise<MCPToolResult<NetworkTopology>> {
    const drones = droneStore.getAllDrones();
    const topology = networkManager.buildTopology(drones);

    // Persist topology to store
    droneStore.updateNetworkTopology(topology);

    return {
        success: true,
        data: topology,
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: broadcastSwarmCommand
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Broadcast a command to all search drones reachable through the relay network.
 * 
 * Commands:
 * - RECRUIT: Pull nearby drones to a target area
 * - MICRO_SCAN: Switch drones in area to micro-scan mode
 * - REDISTRIBUTE: Spread drones evenly across the grid
 * - RTB_ALL: Recall all drones to base (emergency)
 */
export async function broadcastSwarmCommand(
    params: BroadcastSwarmCommandParams
): Promise<MCPToolResult<BroadcastSwarmCommandResult>> {
    const validCommands = ['RECRUIT', 'MICRO_SCAN', 'REDISTRIBUTE', 'RTB_ALL'];
    if (!validCommands.includes(params.command)) {
        return {
            success: false,
            error: `Invalid command: ${params.command}. Valid: ${validCommands.join(', ')}`,
            timestamp: Date.now(),
        };
    }

    // Target area validation (required for RECRUIT and MICRO_SCAN)
    if (['RECRUIT', 'MICRO_SCAN'].includes(params.command) && !params.targetArea) {
        return {
            success: false,
            error: `${params.command} requires targetArea: { x, y, radius }`,
            timestamp: Date.now(),
        };
    }

    // Find drones reachable through relay network
    const drones = droneStore.getAllDrones();
    const topology = networkManager.buildTopology(drones);
    const reachableDrones = topology.connectedDrones.filter(id => {
        const d = droneStore.getDrone(id);
        return d && d.mode !== 'Relay' && d.mode !== 'Charging' && d.isActive;
    });

    const commandId = droneStore.enqueueCommand('BROADCAST_SWARM', {
        command: params.command,
        targetArea: params.targetArea ?? null,
        reachableDrones,
    });

    return {
        success: true,
        data: {
            commandId,
            reachableDrones,
            message: `Broadcast ${params.command} to ${reachableDrones.length} drones${
                params.targetArea
                    ? ` targeting area (${params.targetArea.x}, ${params.targetArea.y}) r=${params.targetArea.radius}`
                    : ''
            }`,
        },
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: calculateOptimalRelayPosition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the optimal position for a new relay drone to maximize
 * swarm coverage. Evaluates candidate positions across the grid
 * and scores each by the number of currently-disconnected drones
 * that would gain connectivity.
 */
export async function calculateOptimalRelayPosition(): Promise<MCPToolResult<OptimalRelayPositionResult>> {
    const drones = droneStore.getAllDrones();
    const searchDrones = drones.filter(d => d.mode !== 'Relay');
    const otherRelays = drones.filter(d => d.mode === 'Relay' && d.isActive);
    const basePosition = { x: BASE_X, y: BASE_Y };

    // Find disconnected drones
    const topology = networkManager.buildTopology(drones);
    const disconnected = topology.disconnectedDrones;

    if (disconnected.length === 0) {
        // No disconnected drones — suggest centroid position for redundancy
        const active = searchDrones.filter(d => d.isActive && d.mode !== 'Charging');
        let cx = GRID_W / 2;
        let cy = GRID_H / 2;
        if (active.length > 0) {
            cx = active.reduce((s, d) => s + d.position.x, 0) / active.length;
            cy = active.reduce((s, d) => s + d.position.y, 0) / active.length;
        }

        return {
            success: true,
            data: {
                position: {
                    x: Math.round(cx * 10) / 10,
                    y: Math.round(cy * 10) / 10,
                    gridCell: gridToLabel(Math.round(cx), Math.round(cy)),
                },
                coverageScore: searchDrones.filter(d => d.isActive).length,
                wouldConnect: [],
                currentDisconnected: [],
            },
            timestamp: Date.now(),
        };
    }

    // Compute coverage-optimized position
    const result = computeCoveragePosition(searchDrones, basePosition, otherRelays);

    // Determine which disconnected drones would be connected
    const wouldConnect: string[] = [];
    for (const id of disconnected) {
        const d = droneStore.getDrone(id);
        if (!d) continue;
        const dist = Math.sqrt(
            Math.pow(d.position.x - result.x, 2) +
            Math.pow(d.position.y - result.y, 2)
        );
        if (dist <= COMM_RANGE_RELAY) {
            wouldConnect.push(id);
        }
    }

    return {
        success: true,
        data: {
            position: {
                x: Math.round(result.x * 10) / 10,
                y: Math.round(result.y * 10) / 10,
                gridCell: gridToLabel(Math.round(result.x), Math.round(result.y)),
            },
            coverageScore: result.score,
            wouldConnect,
            currentDisconnected: disconnected,
        },
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const relayTools = {
    moveRelayDrone,
    replaceRelayDrone,
    getRelayStatus,
    getNetworkTopology,
    broadcastSwarmCommand,
    calculateOptimalRelayPosition,
};
