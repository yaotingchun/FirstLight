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
    SetDroneModeParams,
    GetBatteryForecastParams,
    BatteryForecast,
    DroneDiscoveryList,
    DroneDiscoveryEntry,
    SetAutoRecallThresholdParams
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
// TOOL: getBatteryForecast
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estimate whether a drone can reach a target and return to base before its battery dies.
 *
 * Battery drain model (mirrors SimulationMapMCP.tsx constants):
 *   movement drain  = distance × 0.075 per tile
 *   sensor overhead = 0.015 per estimated tick (Wide) | 0.005 per tick (Micro)
 *   speed           = 0.4 tile/tick (Wide) | 0.1 tile/tick (Micro)
 *
 * Optional `assumedMode` lets the caller override the drone's current mode
 * to forecast battery usage if the mode will change mid-trip.
 *
 * Safety buffer: canReach = true only if projectedBatteryOnReturn > 5.
 */
export async function getBatteryForecast(
    params: GetBatteryForecastParams
): Promise<MCPToolResult<BatteryForecast>> {
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

    // Validate coordinates
    if (params.targetX < 0 || params.targetX >= 20 || params.targetY < 0 || params.targetY >= 20) {
        return {
            success: false,
            error: `Invalid coordinates (${params.targetX}, ${params.targetY}). Must be within 0-19.`,
            timestamp: Date.now()
        };
    }

    const mode = params.assumedMode ?? (drone.mode === 'Micro' ? 'Micro' : 'Wide');
    const speed = mode === 'Wide' ? 0.4 : 0.1;       // tile/tick
    const sensorDrain = mode === 'Wide' ? 0.015 : 0.005; // per tick
    const moveDrainPerTile = 0.075;

    const distToTarget = Math.sqrt(
        Math.pow(params.targetX - drone.position.x, 2) +
        Math.pow(params.targetY - drone.position.y, 2)
    );
    const distTargetToBase = Math.sqrt(
        Math.pow(BASE_X - params.targetX, 2) +
        Math.pow(BASE_Y - params.targetY, 2)
    );

    const totalDist = distToTarget + distTargetToBase;
    const estimatedTicks = totalDist / speed;
    const movementDrain = totalDist * moveDrainPerTile;
    const sensorTotal = sensorDrain * estimatedTicks;
    const estimatedBatteryUsed = movementDrain + sensorTotal;
    const projectedBatteryOnReturn = drone.battery - estimatedBatteryUsed;
    const canReach = projectedBatteryOnReturn > 5;

    let warning: string | null = null;
    if (!canReach) {
        warning = `Insufficient battery. Drone needs ~${estimatedBatteryUsed.toFixed(1)}% but only has ${drone.battery.toFixed(1)}%.`;
    } else if (projectedBatteryOnReturn < 15) {
        warning = `Low margin: only ${projectedBatteryOnReturn.toFixed(1)}% battery on return. Consider charging first.`;
    }

    return {
        success: true,
        data: {
            droneId: drone.id,
            currentBattery: drone.battery,
            assumedMode: mode,
            distanceToTarget: Math.round(distToTarget * 100) / 100,
            distanceTargetToBase: Math.round(distTargetToBase * 100) / 100,
            estimatedBatteryUsed: Math.round(estimatedBatteryUsed * 100) / 100,
            projectedBatteryOnReturn: Math.round(projectedBatteryOnReturn * 100) / 100,
            canReach,
            warning
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getDroneDiscoveryList
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enumerate ALL drones known to the system (both active and inactive).
 *
 * IMPORTANT: Call this tool FIRST before issuing any drone commands.
 * Use the returned IDs for subsequent tool calls — do NOT hard-code drone IDs.
 * This tool satisfies the MCP dynamic discovery requirement.
 *
 * Returns:
 * - Full drone list with isActive flag, mode, battery, and position
 * - activeCount and totalCount summary
 */
export async function getDroneDiscoveryList(): Promise<MCPToolResult<DroneDiscoveryList>> {
    const allDrones = droneStore.getAllDrones();

    const drones: DroneDiscoveryEntry[] = allDrones.map(d => ({
        id: d.id,
        isActive: d.isActive,
        mode: d.mode,
        battery: Math.round(d.battery * 10) / 10,
        position: d.position
    }));

    const activeCount = drones.filter(d => d.isActive).length;

    return {
        success: true,
        data: {
            drones,
            activeCount,
            totalCount: drones.length
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: setAutoRecallThreshold
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set a per-drone auto-recall battery threshold.
 *
 * When the drone's battery falls below this percentage the simulation will
 * immediately initiate return-to-base — overriding the default distance-based
 * threshold. This lets the agent set policy rather than micromanage each tick.
 *
 * Parameters:
 * - droneId: The drone to configure
 * - batteryThreshold: Battery % at which to auto-recall (0-100)
 *
 * The policy persists until the mission is reset or a new threshold is set.
 */
export async function setAutoRecallThreshold(
    params: SetAutoRecallThresholdParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const drone = droneStore.getDrone(params.droneId);

    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    if (params.batteryThreshold < 0 || params.batteryThreshold > 100) {
        return {
            success: false,
            error: `batteryThreshold must be between 0 and 100, got ${params.batteryThreshold}`,
            timestamp: Date.now()
        };
    }

    // Persist in store (so other tools can read it) AND queue to frontend
    droneStore.setAutoRecallThreshold(params.droneId, params.batteryThreshold);
    const commandId = droneStore.enqueueCommand('SET_AUTO_RECALL', {
        droneId: params.droneId,
        batteryThreshold: params.batteryThreshold
    });

    return {
        success: true,
        data: {
            commandId,
            message: `Auto-recall threshold for ${params.droneId} set to ${params.batteryThreshold}%. Drone will RTB when battery drops below this level.`
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
    killDrone,
    getBatteryForecast,
    getDroneDiscoveryList,
    setAutoRecallThreshold
};
