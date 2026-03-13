/**
 * DRONE MODULE - MCP Tools
 * 
 * Tools for observing and commanding individual drones.
 * 
 * DESIGN RATIONALE:
 * - getDroneStatus: OBSERVATION - AI needs drone telemetry for decision making
 * - setDroneTarget: ACTION - AI can direct search efforts to specific locations
 * - setDroneMode: ACTION - AI can switch drones between Wide/Micro/Relay modes
 * - recallDroneToBase: ACTION - AI can issue RTB for low battery or mission changes
 * - killDrone: ACTION - For testing swarm resilience and reallocation
 * 
 * NOT EXPOSED:
 * - A* pathfinding (automatic navigation, internal to drone movement)
 * - Velocity Obstacle (safety system, must remain automatic)
 * - Battery calculations (physics model, not AI-controllable)
 */

import { droneStore, gridToLabel, BASE_X, BASE_Y } from '../droneStore.js';
import type { 
    DroneStatus, 
    DroneMode,
    MCPToolResult,
    SetDroneTargetParams,
    SetDroneModeParams 
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getDroneStatus
// ═══════════════════════════════════════════════════════════════════════════

export interface GetDroneStatusParams {
    droneId: string;
}

/**
 * Get the current status of a specific drone.
 * 
 * Use this to monitor:
 * - Drone position and target
 * - Battery level and mode
 * - Connectivity status
 * - Assigned search region
 */
export async function getDroneStatus(
    params: GetDroneStatusParams
): Promise<MCPToolResult<DroneStatus>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found. Available drones: ${
                droneStore.getAllDrones().map(d => d.id).join(', ') || 'none'
            }`,
            timestamp: Date.now()
        };
    }

    return {
        success: true,
        data: drone,
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getAllDroneStatuses
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the status of all drones in the swarm.
 * 
 * Returns an array of all drone statuses including:
 * - Search drones (D1-D8)
 * - Relay drone (R1)
 */
export async function getAllDroneStatuses(): Promise<MCPToolResult<DroneStatus[]>> {
    const drones = droneStore.getAllDrones();
    
    return {
        success: true,
        data: drones,
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: setDroneTarget
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Command a drone to move to a specific grid location.
 * 
 * The drone will:
 * 1. Calculate an A* path to the target (automatic, not exposed)
 * 2. Apply velocity obstacle avoidance (automatic, safety-critical)
 * 3. Move toward the target while respecting battery constraints
 * 
 * Parameters:
 * - droneId: The drone to command (e.g., "D1", "DRN-Alpha")
 * - targetX: Grid X coordinate (0-19)
 * - targetY: Grid Y coordinate (0-19)
 */
export async function setDroneTarget(
    params: SetDroneTargetParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    if (!drone.isActive) {
        return {
            success: false,
            error: `Drone ${params.droneId} is inactive`,
            timestamp: Date.now()
        };
    }

    if (drone.mode === 'Charging') {
        return {
            success: false,
            error: `Drone ${params.droneId} is currently charging. Wait for full charge or change mode first.`,
            timestamp: Date.now()
        };
    }

    // Validate coordinates
    if (params.targetX < 0 || params.targetX >= 20 || 
        params.targetY < 0 || params.targetY >= 20) {
        return {
            success: false,
            error: `Invalid coordinates (${params.targetX}, ${params.targetY}). Must be within 0-19.`,
            timestamp: Date.now()
        };
    }

    // Queue command for frontend to process
    const commandId = droneStore.enqueueCommand('SET_TARGET', {
        droneId: params.droneId,
        targetX: params.targetX,
        targetY: params.targetY
    });

    const targetCell = gridToLabel(params.targetX, params.targetY);

    return {
        success: true,
        data: {
            commandId,
            message: `Command queued: ${params.droneId} → sector ${targetCell} (${params.targetX}, ${params.targetY})`
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: setDroneMode
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Change a drone's operational mode.
 * 
 * Modes:
 * - Wide: Fast scanning, covers large areas (speed: 0.4 units/tick)
 * - Micro: Detailed scanning for high-probability areas (speed: 0.1 units/tick)
 * - Relay: Communication relay mode (stationary or slow movement)
 * - Charging: Only valid when at base station
 * 
 * Mode transitions affect:
 * - Movement speed
 * - Sensor resolution
 * - Battery consumption rate
 */
export async function setDroneMode(
    params: SetDroneModeParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    if (!drone.isActive) {
        return {
            success: false,
            error: `Drone ${params.droneId} is inactive`,
            timestamp: Date.now()
        };
    }

    const validModes: DroneMode[] = ['Wide', 'Micro', 'Relay', 'Charging'];
    if (!validModes.includes(params.mode)) {
        return {
            success: false,
            error: `Invalid mode: ${params.mode}. Valid modes: ${validModes.join(', ')}`,
            timestamp: Date.now()
        };
    }

    // Charging mode requires being at base
    if (params.mode === 'Charging') {
        const distToBase = Math.sqrt(
            Math.pow(drone.position.x - BASE_X, 2) + 
            Math.pow(drone.position.y - BASE_Y, 2)
        );
        if (distToBase > 1) {
            return {
                success: false,
                error: `Drone ${params.droneId} must be at base station to enter Charging mode (current distance: ${distToBase.toFixed(1)} units)`,
                timestamp: Date.now()
            };
        }
    }

    const commandId = droneStore.enqueueCommand('SET_MODE', {
        droneId: params.droneId,
        mode: params.mode
    });

    return {
        success: true,
        data: {
            commandId,
            message: `Command queued: ${params.droneId} mode → ${params.mode}`
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: recallDroneToBase
// ═══════════════════════════════════════════════════════════════════════════

export interface RecallDroneParams {
    droneId: string;
}

/**
 * Command a drone to return to base station.
 * 
 * The drone will:
 * 1. Save its current task (if any) for later resumption
 * 2. Calculate optimal path back to base
 * 3. Land and optionally enter charging mode
 * 
 * Use this when:
 * - Battery is low
 * - Mission priorities change
 * - Emergency recall needed
 */
export async function recallDroneToBase(
    params: RecallDroneParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    if (!drone.isActive) {
        return {
            success: false,
            error: `Drone ${params.droneId} is inactive`,
            timestamp: Date.now()
        };
    }

    if (drone.mode === 'Charging') {
        return {
            success: false,
            error: `Drone ${params.droneId} is already at base charging`,
            timestamp: Date.now()
        };
    }

    const commandId = droneStore.enqueueCommand('RECALL_TO_BASE', {
        droneId: params.droneId
    });

    return {
        success: true,
        data: {
            commandId,
            message: `Command queued: ${params.droneId} RTB (return to base)`
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: killDrone
// ═══════════════════════════════════════════════════════════════════════════

export interface KillDroneParams {
    droneId: string;
}

/**
 * Simulate drone failure/deactivation.
 * 
 * This triggers:
 * 1. Drone deactivation
 * 2. Automatic region reallocation (internal algorithm, not exposed)
 * 3. Scan queue rebuilding for remaining drones
 * 
 * Use this for:
 * - Testing swarm resilience
 * - Simulating hardware failures
 * - Load balancing experiments
 */
export async function killDrone(
    params: KillDroneParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    if (!drone.isActive) {
        return {
            success: false,
            error: `Drone ${params.droneId} is already inactive`,
            timestamp: Date.now()
        };
    }

    const commandId = droneStore.enqueueCommand('KILL_DRONE', {
        droneId: params.droneId
    });

    return {
        success: true,
        data: {
            commandId,
            message: `Command queued: Deactivate ${params.droneId} (will trigger region reallocation)`
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const droneTools = {
    getDroneStatus,
    getAllDroneStatuses,
    setDroneTarget,
    setDroneMode,
    recallDroneToBase,
    killDrone
};
