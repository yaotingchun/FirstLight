/**
 * MCP Tool Registry
 * 
 * Central registry of all MCP tools for the FirstLight drone swarm system.
 * This file exports all tools with their schemas for MCP server integration.
 */

import { droneTools } from './droneTools.js';
import { scanTools } from './scanTools.js';
import { communicationTools } from './communicationTools.js';
import { missionTools } from './missionTools.js';
import { swarmIntelTools } from './swarmIntelTools.js';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL SCHEMAS (for MCP protocol)
// ═══════════════════════════════════════════════════════════════════════════

export const toolSchemas = {
    // ─────────────────────────────────────────────────────────────────────
    // DRONE MODULE
    // ─────────────────────────────────────────────────────────────────────
    getDroneStatus: {
        name: 'getDroneStatus',
        description: 'Get the current status of a specific drone including position, battery, mode, and connectivity',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID (e.g., "D1", "DRN-Alpha")'
                }
            },
            required: ['droneId']
        }
    },
    getAllDroneStatuses: {
        name: 'getAllDroneStatuses',
        description: 'Get the status of all drones in the swarm',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    setDroneTarget: {
        name: 'setDroneTarget',
        description: 'Command a drone to move to a specific grid location. The drone will automatically calculate the path and avoid obstacles.',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to command'
                },
                targetX: {
                    type: 'number',
                    description: 'Target X coordinate (0-19)'
                },
                targetY: {
                    type: 'number',
                    description: 'Target Y coordinate (0-19)'
                }
            },
            required: ['droneId', 'targetX', 'targetY']
        }
    },
    setDroneMode: {
        name: 'setDroneMode',
        description: 'Change a drone\'s operational mode (Wide/Micro/Relay/Charging)',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to command'
                },
                mode: {
                    type: 'string',
                    enum: ['Wide', 'Micro', 'Relay', 'Charging'],
                    description: 'The new mode for the drone'
                }
            },
            required: ['droneId', 'mode']
        }
    },
    recallDroneToBase: {
        name: 'recallDroneToBase',
        description: 'Command a drone to return to base station',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to recall'
                }
            },
            required: ['droneId']
        }
    },
    killDrone: {
        name: 'killDrone',
        description: 'Simulate drone failure/deactivation. Triggers automatic region reallocation.',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to deactivate'
                }
            },
            required: ['droneId']
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // SCAN MODULE
    // ─────────────────────────────────────────────────────────────────────
    getSectorScanResult: {
        name: 'getSectorScanResult',
        description: 'Get detailed scan data for a specific grid sector',
        inputSchema: {
            type: 'object',
            properties: {
                sector: {
                    type: 'string',
                    description: 'Sector identifier - either grid label (e.g., "A1", "T20") or coordinates (e.g., "5,10")'
                }
            },
            required: ['sector']
        }
    },
    getGridHeatmap: {
        name: 'getGridHeatmap',
        description: 'Get the full 20x20 grid probability heatmap with priority cell lists',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getScannedSectors: {
        name: 'getScannedSectors',
        description: 'Get summary of scanned vs unscanned sectors',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getSurroundingSectors: {
        name: 'getSurroundingSectors',
        description: 'Get scan data for a sector and its surrounding area',
        inputSchema: {
            type: 'object',
            properties: {
                centerSector: {
                    type: 'string',
                    description: 'Center sector identifier'
                },
                radius: {
                    type: 'number',
                    description: 'Radius in grid cells (default: 1)'
                }
            },
            required: ['centerSector']
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // COMMUNICATION MODULE
    // ─────────────────────────────────────────────────────────────────────
    getCommNetworkStatus: {
        name: 'getCommNetworkStatus',
        description: 'Get the current communication mesh network status',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getDisconnectedDrones: {
        name: 'getDisconnectedDrones',
        description: 'Get detailed information about disconnected drones with reconnection suggestions',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    checkDroneConnectivity: {
        name: 'checkDroneConnectivity',
        description: 'Check connectivity status and path for a specific drone',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to check'
                }
            },
            required: ['droneId']
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // MISSION MODULE
    // ─────────────────────────────────────────────────────────────────────
    getSwarmStatus: {
        name: 'getSwarmStatus',
        description: 'Get complete status of the drone swarm',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getMissionStats: {
        name: 'getMissionStats',
        description: 'Get mission progress statistics',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getFoundSurvivors: {
        name: 'getFoundSurvivors',
        description: 'Get list of confirmed survivors',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    setSurvivorPin: {
        name: 'setSurvivorPin',
        description: 'Mark a location as a confirmed survivor',
        inputSchema: {
            type: 'object',
            properties: {
                x: {
                    type: 'number',
                    description: 'X coordinate (0-19)'
                },
                y: {
                    type: 'number',
                    description: 'Y coordinate (0-19)'
                },
                droneId: {
                    type: 'string',
                    description: 'The drone that confirmed the survivor'
                },
                message: {
                    type: 'string',
                    description: 'Optional message from survivor'
                }
            },
            required: ['x', 'y', 'droneId']
        }
    },
    resetMission: {
        name: 'resetMission',
        description: 'Reset the mission to initial state',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    setSimulationRunning: {
        name: 'setSimulationRunning',
        description: 'Start or pause the simulation loop on the frontend dashboard',
        inputSchema: {
            type: 'object',
            properties: {
                running: {
                    type: 'boolean',
                    description: 'Whether the simulation should be running'
                }
            },
            required: ['running']
        }
    },
    getMissionBriefing: {
        name: 'getMissionBriefing',
        description: 'Get mission briefing with objectives, constraints, and AI recommendations',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // SWARM INTELLIGENCE MODULE
    // ─────────────────────────────────────────────────────────────────────
    getExplorationGradient: {
        name: 'getExplorationGradient',
        description: 'Get pheromone × probability urgency gradient for every unscanned sector. urgencyScore = probability × (1 − pheromone). Use this to find truly unexplored hotspots the swarm has not reached yet.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    getUnassignedHotspots: {
        name: 'getUnassignedHotspots',
        description: 'Return high-value unscanned sectors with NO active drone targeting them, ranked by urgencyScore. Includes recommended drone dispatches (droneId, targetX/Y, mode) ready to pass into setDroneTarget + setDroneMode.',
        inputSchema: {
            type: 'object',
            properties: {
                probabilityThreshold: {
                    type: 'number',
                    description: 'Minimum survivor probability to include (default 0.3)'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of hotspots to return (default 10)'
                }
            }
        }
    },
    getDroneAssignmentMap: {
        name: 'getDroneAssignmentMap',
        description: 'Show every active drone\'s current target sector (with embedded probability + pheromone) and flag redundant coverage (2+ drones on same sector). Returns coverageEfficiency = uniqueTargets / totalSearchingDrones.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

export const toolHandlers: Record<string, Function> = {
    // Drone tools
    getDroneStatus: droneTools.getDroneStatus,
    getAllDroneStatuses: droneTools.getAllDroneStatuses,
    setDroneTarget: droneTools.setDroneTarget,
    setDroneMode: droneTools.setDroneMode,
    recallDroneToBase: droneTools.recallDroneToBase,
    killDrone: droneTools.killDrone,

    // Scan tools
    getSectorScanResult: scanTools.getSectorScanResult,
    getGridHeatmap: scanTools.getGridHeatmap,
    getScannedSectors: scanTools.getScannedSectors,
    getSurroundingSectors: scanTools.getSurroundingSectors,

    // Communication tools
    getCommNetworkStatus: communicationTools.getCommNetworkStatus,
    getDisconnectedDrones: communicationTools.getDisconnectedDrones,
    checkDroneConnectivity: communicationTools.checkDroneConnectivity,

    // Mission tools
    getSwarmStatus: missionTools.getSwarmStatus,
    getMissionStats: missionTools.getMissionStats,
    getFoundSurvivors: missionTools.getFoundSurvivors,
    setSurvivorPin: missionTools.setSurvivorPin,
    resetMission: missionTools.resetMission,
    setSimulationRunning: missionTools.setSimulationRunning,
    getMissionBriefing: missionTools.getMissionBriefing,

    // Swarm intelligence tools
    getExplorationGradient: swarmIntelTools.getExplorationGradient,
    getUnassignedHotspots: swarmIntelTools.getUnassignedHotspots,
    getDroneAssignmentMap: swarmIntelTools.getDroneAssignmentMap
};

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTE TOOL
// ═══════════════════════════════════════════════════════════════════════════

export async function executeTool(
    toolName: string, 
    params: Record<string, unknown> = {}
): Promise<unknown> {
    const handler = toolHandlers[toolName];
    
    if (!handler) {
        return {
            success: false,
            error: `Unknown tool: ${toolName}. Available tools: ${Object.keys(toolHandlers).join(', ')}`,
            timestamp: Date.now()
        };
    }

    try {
        return await handler(params);
    } catch (error) {
        return {
            success: false,
            error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now()
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST TOOLS (for MCP protocol)
// ═══════════════════════════════════════════════════════════════════════════

export function listTools() {
    return Object.values(toolSchemas);
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORT MODULES
// ═══════════════════════════════════════════════════════════════════════════

export { droneTools } from './droneTools.js';
export { scanTools } from './scanTools.js';
export { communicationTools } from './communicationTools.js';
export { missionTools } from './missionTools.js';
export { swarmIntelTools } from './swarmIntelTools.js';
