/**
 * MISSION MODULE - MCP Tools
 * 
 * Tools for mission-level observation and control.
 * 
 * DESIGN RATIONALE:
 * - getSwarmStatus: OBSERVATION - AI needs complete swarm overview
 * - getMissionStats: OBSERVATION - AI needs progress metrics for decisions
 * - getFoundSurvivors: OBSERVATION - AI needs to track mission success
 * - setSurvivorPin: ACTION - AI confirms a survivor location
 * - resetMission: ACTION - AI can restart simulation
 * 
 * NOT EXPOSED (remain internal):
 * - Swarm initialization logic: Complex orchestration, done once
 * - Region reallocation: Automatic response to drone failure
 * - Scan queue management: Optimal patterns, AI shouldn't override
 */

import { droneStore, GRID_W, GRID_H, gridToLabel } from '../droneStore.js';
import type { 
    SwarmStatus,
    MissionStats, 
    SurvivorInfo,
    SetSurvivorPinParams,
    MCPToolResult,
    DroneStatus
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getSwarmStatus
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the complete status of the drone swarm.
 * 
 * Returns:
 * - All drone statuses (search + relay)
 * - Active/total drone counts
 * - Relay drone details
 * 
 * Use this for:
 * - High-level swarm monitoring
 * - Identifying drones needing attention
 * - Mission planning decisions
 */
export async function getSwarmStatus(): Promise<MCPToolResult<SwarmStatus>> {
    const drones = droneStore.getAllDrones();
    
    const searchDrones = drones.filter(d => d.mode !== 'Relay');
    const relayDrone = drones.find(d => d.mode === 'Relay') || null;
    const activeDrones = drones.filter(d => d.isActive);

    return {
        success: true,
        data: {
            drones: searchDrones,
            activeDroneCount: activeDrones.length,
            totalDroneCount: drones.length,
            relayDrone
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getMissionStats
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get mission progress statistics.
 * 
 * Returns:
 * - Current simulation tick
 * - Scan progress (sectors scanned / total)
 * - Survivors found vs estimated
 * - High-priority zones remaining
 * - Battery and connectivity metrics
 * 
 * Use this for:
 * - Progress tracking
 * - Resource allocation decisions
 * - Mission completion prediction
 */
export async function getMissionStats(): Promise<MCPToolResult<MissionStats>> {
    const stats = droneStore.getMissionStats();
    
    return {
        success: true,
        data: stats,
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getFoundSurvivors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get list of confirmed survivors.
 * 
 * Returns array of survivors with:
 * - Location (grid cell and coordinates)
 * - Message from survivor
 * - Phone battery level
 * - Discovering drone ID
 * - Discovery time (tick)
 */
export async function getFoundSurvivors(): Promise<MCPToolResult<SurvivorInfo[]>> {
    const survivors = droneStore.getFoundSurvivors();
    
    return {
        success: true,
        data: survivors,
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: setSurvivorPin
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a location as a confirmed survivor.
 * 
 * This action:
 * 1. Adds a survivor pin to the map
 * 2. Clears pheromone trails in surrounding area
 * 3. Sends the drone that found it back to Wide mode
 * 4. Updates mission statistics
 * 
 * Parameters:
 * - x, y: Grid coordinates (0-19)
 * - droneId: The drone that confirmed the survivor
 * - message: Optional message from survivor
 */
export async function setSurvivorPin(
    params: SetSurvivorPinParams
): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    // Validate coordinates
    if (params.x < 0 || params.x >= GRID_W || params.y < 0 || params.y >= GRID_H) {
        return {
            success: false,
            error: `Invalid coordinates (${params.x}, ${params.y}). Must be within 0-${GRID_W - 1}, 0-${GRID_H - 1}`,
            timestamp: Date.now()
        };
    }

    const drone = droneStore.getDrone(params.droneId);
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    const commandId = droneStore.enqueueCommand('SET_SURVIVOR_PIN', {
        x: params.x,
        y: params.y,
        droneId: params.droneId,
        message: params.message || 'Survivor confirmed'
    });

    const gridCell = gridToLabel(params.x, params.y);

    return {
        success: true,
        data: {
            commandId,
            message: `Survivor pin queued at sector ${gridCell} (${params.x}, ${params.y}) by ${params.droneId}`
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: resetMission
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reset the mission to initial state.
 * 
 * This action:
 * 1. Stops the simulation
 * 2. Resets all drone positions to base
 * 3. Clears all scan data
 * 4. Regenerates the probability heatmap
 * 5. Clears survivor pins
 * 
 * Use this for:
 * - Starting a new mission
 * - Restarting after completion
 * - Testing different strategies
 */
export async function resetMission(): Promise<MCPToolResult<{ commandId: string; message: string }>> {
    const commandId = droneStore.enqueueCommand('RESET_MISSION', {});

    return {
        success: true,
        data: {
            commandId,
            message: 'Mission reset queued. All drones will return to base and scan data will be cleared.'
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getMissionBriefing
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionBriefing {
    scenario: string;
    objectives: string[];
    constraints: string[];
    currentPhase: 'initialization' | 'wide_scan' | 'micro_scan' | 'extraction' | 'complete';
    recommendations: string[];
}

/**
 * Get a mission briefing with objectives and recommendations.
 * 
 * Analyzes current mission state and provides:
 * - Mission objectives
 * - Current constraints
 * - Current phase of operation
 * - AI recommendations for next steps
 */
export async function getMissionBriefing(): Promise<MCPToolResult<MissionBriefing>> {
    const stats = droneStore.getMissionStats();
    const drones = droneStore.getAllDrones();
    const grid = droneStore.getGrid();

    // Determine current phase
    let currentPhase: MissionBriefing['currentPhase'];
    if (stats.scanProgress < 1) {
        currentPhase = 'initialization';
    } else if (stats.scanProgress < 50) {
        currentPhase = 'wide_scan';
    } else if (stats.highPriorityZonesRemaining > 0) {
        currentPhase = 'micro_scan';
    } else if (stats.survivorsFound < stats.totalEstimatedSurvivors) {
        currentPhase = 'extraction';
    } else {
        currentPhase = 'complete';
    }

    // Generate recommendations
    const recommendations: string[] = [];

    // Check battery levels
    const lowBatteryDrones = drones.filter(d => d.battery < 30 && d.isActive);
    if (lowBatteryDrones.length > 0) {
        recommendations.push(
            `URGENT: ${lowBatteryDrones.map(d => d.id).join(', ')} have low battery (<30%). Consider RTB.`
        );
    }

    // Check disconnected drones
    if (stats.dronesDisconnected > 0) {
        recommendations.push(
            `${stats.dronesDisconnected} drone(s) disconnected. Reposition relay or recall affected units.`
        );
    }

    // Check high priority zones
    if (stats.highPriorityZonesRemaining > 0) {
        const highPriorityLabels = grid.flat()
            .filter(s => !s.scanned && s.probability >= 0.6)
            .slice(0, 3)
            .map(s => s.gridCell);
        recommendations.push(
            `${stats.highPriorityZonesRemaining} high-priority zones remaining. Priority sectors: ${highPriorityLabels.join(', ')}`
        );
    }

    // Phase-specific recommendations
    if (currentPhase === 'wide_scan' && stats.scanProgress > 30) {
        const microDrones = drones.filter(d => d.mode === 'Micro');
        if (microDrones.length === 0) {
            recommendations.push(
                'Consider switching some drones to Micro mode for detailed scanning of detected hotspots.'
            );
        }
    }

    if (currentPhase === 'micro_scan') {
        recommendations.push(
            'Focus resources on high-probability zones. Survivors may be mobile.'
        );
    }

    return {
        success: true,
        data: {
            scenario: 'Search and Rescue - Post-Earthquake Urban Environment',
            objectives: [
                'Locate all survivors within the 20x20 grid operational area',
                'Maintain communication mesh with base station',
                'Optimize battery usage across swarm',
                'Minimize search time while maximizing coverage'
            ],
            constraints: [
                'Drones must maintain mesh connectivity for data relay',
                'Battery consumption increases with Micro mode',
                'Survivors may move between grid cells over time',
                'Obstacles block certain grid cells'
            ],
            currentPhase,
            recommendations
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const missionTools = {
    getSwarmStatus,
    getMissionStats,
    getFoundSurvivors,
    setSurvivorPin,
    resetMission,
    getMissionBriefing
};
