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
import { orchestrationTools } from './orchestrationTools.js';
import { relayTools } from './relayTools.js';
import * as multiAgentTools from './multiAgentTools.js';

type ToolSchema = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    [key: string]: unknown;
};

// Canonical docstrings for AI orchestration clients.
// These are surfaced by listTools() and getToolSchema().
const TOOL_DOCSTRINGS: Record<string, string> = {
    getDroneStatus: 'Observe one drone. Returns position, target, mode, battery, connectivity, activity, and assigned region. Use for spot checks after issuing commands.',
    getAllDroneStatuses: 'Observe all drones in one call. Use as a periodic telemetry snapshot for orchestration loops and health monitoring.',
    setDroneTarget: 'Action. Queue a movement target for one drone. Requires droneId,targetX,targetY (0-19). Drone must be active and not charging. Returns queued commandId.',
    setDroneMode: 'Action. Queue a mode change for one drone. Valid modes: Wide, Micro, Relay, Charging. Charging requires being at base. Returns queued commandId.',
    recallDroneToBase: 'Action. Queue return-to-base (RTB) for one drone. Use for battery risk, connectivity recovery, or mission reprioritization.',
    killDrone: 'Action. Simulate drone failure/deactivation for resilience testing. Triggers reallocation behavior on the simulation side.',
    getBatteryForecast: 'Predict if a drone can reach a target and return to base with safety margin. Returns canReach, estimatedBatteryUsed, projectedBatteryOnReturn, and warning.',
    getDroneDiscoveryList: 'Discover current drone IDs dynamically. Call first before issuing commands to avoid hard-coding IDs.',
    setAutoRecallThreshold: 'Action. Set per-drone battery threshold (0-100) that forces RTB when battery drops below it. Returns queued commandId.',

    getSectorScanResult: 'Observe one sector by grid label (e.g., E10) or coordinates (x,y). Returns probability, pheromone, terrain, scanned state, lastScannedTick, and signal channels.',
    getGridHeatmap: 'Observe full probability matrix and priority cell lists. Use for coarse global planning and hotspot selection.',
    getScannedSectors: 'Observe coverage summary: scanned/unscanned counts and high-probability unscanned sectors.',
    getSurroundingSectors: 'Observe neighborhood context around a center sector with optional radius. Returns average/max probability and suggested action hint.',

    getCommNetworkStatus: 'Observe mesh network status: connected/disconnected nodes, links, relay position, and base position.',
    getDisconnectedDrones: 'Observe disconnected drones with distance metrics and reconnection suggestions.',
    checkDroneConnectivity: 'Observe connectivity path quality for a specific drone, including route to base and signal quality estimate.',

    getSwarmStatus: 'Observe mission-level swarm snapshot: drones, active count, total count, and relay details.',
    getMissionStats: 'Observe mission KPIs: scan progress, survivors found, battery/connectivity aggregates, current tick, and simulation state.',
    getFoundSurvivors: 'Observe confirmed survivors list with location, message, battery note, finding drone, and timestamp tick.',
    setSurvivorPin: 'Action. Mark a survivor at x,y by droneId with optional message. Queues SET_SURVIVOR_PIN for frontend handling.',
    resetMission: 'Action. Queue full mission reset (state, drones, scan data, survivors).',
    setSimulationRunning: 'Action. Start or pause simulation loop (running=true|false).',
    getMissionBriefing: 'Observe mission phase and recommendations. Returns objectives, constraints, current phase, and strategic guidance.',
    getSectorAssignments: 'Observe sector reservation map inferred from active drone targets, including reserved/free counts and probability/pheromone context.',

    getExplorationGradient: 'Observe urgency per unscanned sector where urgency = probability * (1 - pheromone). Returns ranked cells plus critical/high zones.',
    getUnassignedHotspots: 'Observe high-value unscanned sectors not currently targeted. Returns ranked hotspots and recommended dispatches.',
    getDroneAssignmentMap: 'Observe per-drone assignment state with redundancy detection and coverageEfficiency metric.',

    validateAssignmentPlan: 'Dry-run planner validation for batched assignments. Flags invalid drones/targets, low battery margin, and duplicate target conflicts.',
    assignHotspotBatch: 'Action. Queue multiple assignments in one call. Each accepted item may queue SET_MODE and SET_TARGET. Returns accepted/rejected breakdown.',
    getRecommendedActions: 'Policy tool. Returns prioritized machine-actionable recommendations derived from battery risk, connectivity, and unassigned hotspots.',
    getBatteryRiskMap: 'Risk tool. Classify active drones by projected return battery and provide recommendation tiers (continue/monitor/avoid-micro/recall).',

    deployRelayDrone: 'Action. Deploy a new relay drone at specified position. Creates a drone in Relay mode that extends communication range and aggregates swarm data.',
    moveRelayDrone: 'Action. Reposition an existing relay drone to a new target. Relay maintains function during transit.',
    replaceRelayDrone: 'Action. Replace a low-battery relay: deploy backup at same position, recall old relay to base for charging.',
    getRelayStatus: 'Observe one relay. Returns battery, position, connected search drones, edge intelligence data, and movement mode.',
    getNetworkTopology: 'Observe full mesh network. Returns relay chain, links with quality, hop counts, connected/disconnected drones, and offline buffer size.',
    broadcastSwarmCommand: 'Action. Broadcast RECRUIT/MICRO_SCAN/REDISTRIBUTE/RTB_ALL to all reachable search drones via relay network.',
    calculateOptimalRelayPosition: 'Observe. Compute optimal relay position to maximize swarm coverage. Returns position, coverage score, and which disconnected drones would be reconnected.',

    // Multi-agent tools (LLM strategic layer)
    createTask: 'Action. Create a mission task (HOTSPOT/SCAN/CONFIRM) at position (x,y) with priority 1-10. Tasks are the ONLY way to direct drones — do NOT use setDroneTarget. Engine deduplicates tasks within 2 cells. Prefer cancel_task over creating duplicates.',
    cancelTask: 'Action. Cancel/expire a task by ID. Use when a task is no longer relevant or a drone task is complete. Prefer this over letting tasks expire naturally.',
    getActiveTasks: 'Observe. Get all active tasks with status (PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/EXPIRED). Check this before creating new tasks to avoid duplicates.',
    getTaskAssignments: 'Observe. Get current drone-task assignments (which drone is working on which task). Use to understand swarm workload.',
    getMultiAgentState: 'Observe. Get full multi-agent snapshot: tasks, assignments, orchestrator relay ID, bidding status, and recent chat log. Use as primary situational awareness tool.'
};

function withDocstring(schema: ToolSchema): ToolSchema {
    return {
        ...schema,
        docstring: TOOL_DOCSTRINGS[schema.name] ?? schema.description
    };
}

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
    getBatteryForecast: {
        name: 'getBatteryForecast',
        description: 'Estimate if a drone can reach a target grid cell and return to base before its battery runs out. Returns canReach, projectedBatteryOnReturn, and estimatedBatteryUsed. Use this before dispatching a drone to a distant sector to enable proactive battery management.',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to forecast for'
                },
                targetX: {
                    type: 'number',
                    description: 'Target X coordinate (0-19)'
                },
                targetY: {
                    type: 'number',
                    description: 'Target Y coordinate (0-19)'
                },
                assumedMode: {
                    type: 'string',
                    enum: ['Wide', 'Micro'],
                    description: 'Override the mode used for battery calculation (defaults to drone\'s current mode)'
                }
            },
            required: ['droneId', 'targetX', 'targetY']
        }
    },
    getDroneDiscoveryList: {
        name: 'getDroneDiscoveryList',
        description: 'Call this tool FIRST to enumerate all drone IDs before issuing any commands. Returns all drones (active and inactive) with id, isActive, mode, battery, and position. Required for dynamic drone discovery — do not hard-code drone IDs.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    setAutoRecallThreshold: {
        name: 'setAutoRecallThreshold',
        description: 'Set a per-drone auto-recall battery threshold. When the drone battery drops below this %, it will immediately RTB regardless of its current mission. Lets the agent set policy rather than monitoring each tick.',
        inputSchema: {
            type: 'object',
            properties: {
                droneId: {
                    type: 'string',
                    description: 'The drone ID to configure'
                },
                batteryThreshold: {
                    type: 'number',
                    description: 'Battery percentage (0-100) at which to auto-recall'
                }
            },
            required: ['droneId', 'batteryThreshold']
        }
    },
    // NOTE: The following low-level primitives are intentionally NOT exposed as MCP tools:
    //   thermal_scan()        — covered by getSectorScanResult (includes thermal readings in signals)
    //   move_to(x, y)         — replaced by setDroneTarget (correct abstraction level with validation)
    //   get_battery_status()  — included in getDroneStatus and getDroneDiscoveryList

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
    updateMissionStats: {
        name: 'updateMissionStats',
        description: 'Update mission progress statistics with precise UI analytics',
        inputSchema: {
            type: 'object',
            properties: {
                averageZoneCoverage: { type: 'number' },
                meanProbabilityScanned: { type: 'number' },
                repeatedScanRate: { type: 'number' },
                missionTimeSec: { type: 'number' }
            }
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
    getSectorAssignments: {
        name: 'getSectorAssignments',
        description: 'Get the current sector reservation map. A sector is reserved only if a drone is actively en-route to it. Use this before dispatching drones to avoid sending two drones to the same zone.',
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
    },

    // ─────────────────────────────────────────────────────────────────────
    // ORCHESTRATION MODULE
    // ─────────────────────────────────────────────────────────────────────
    validateAssignmentPlan: {
        name: 'validateAssignmentPlan',
        description: 'Dry-run validation for a planned batch assignment. Checks inactive/charging drones, out-of-bounds targets, low battery return margin, and duplicate target conflicts before execution.',
        inputSchema: {
            type: 'object',
            properties: {
                assignments: {
                    type: 'array',
                    description: 'Planned assignments to validate',
                    items: {
                        type: 'object',
                        properties: {
                            droneId: { type: 'string' },
                            targetX: { type: 'number' },
                            targetY: { type: 'number' },
                            mode: { type: 'string', enum: ['Wide', 'Micro', 'Relay', 'Charging'] }
                        },
                        required: ['droneId', 'targetX', 'targetY']
                    }
                }
            },
            required: ['assignments']
        }
    },
    assignHotspotBatch: {
        name: 'assignHotspotBatch',
        description: 'Queue a batch of hotspot assignments in one call. Each accepted assignment queues SET_TARGET and optionally SET_MODE. Rejected assignments include reasons.',
        inputSchema: {
            type: 'object',
            properties: {
                assignments: {
                    type: 'array',
                    description: 'Assignments to queue',
                    items: {
                        type: 'object',
                        properties: {
                            droneId: { type: 'string' },
                            targetX: { type: 'number' },
                            targetY: { type: 'number' },
                            mode: { type: 'string', enum: ['Wide', 'Micro', 'Relay', 'Charging'] }
                        },
                        required: ['droneId', 'targetX', 'targetY']
                    }
                }
            },
            required: ['assignments']
        }
    },
    getRecommendedActions: {
        name: 'getRecommendedActions',
        description: 'Generate a prioritized action list for the current tick by combining battery risk, connectivity health, and unassigned hotspots. Returns machine-actionable tool calls.',
        inputSchema: {
            type: 'object',
            properties: {
                maxActions: {
                    type: 'number',
                    description: 'Maximum action suggestions to return (default 8)'
                }
            }
        }
    },
    getBatteryRiskMap: {
        name: 'getBatteryRiskMap',
        description: 'Classify active drones by battery risk using projected return battery from current/target positions. Use before assigning long-range hotspots.',
        inputSchema: {
            type: 'object',
            properties: {
                safetyBuffer: {
                    type: 'number',
                    description: 'Battery percentage used as high-risk return threshold (default 15)'
                }
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // RELAY MODULE
    // ─────────────────────────────────────────────────────────────────────
    moveRelayDrone: {
        name: 'moveRelayDrone',
        description: 'Reposition an existing relay drone to a new target position',
        inputSchema: {
            type: 'object',
            properties: {
                relayId: { type: 'string', description: 'ID of the relay drone to move' },
                x: { type: 'number', description: 'New target X coordinate (0-19)' },
                y: { type: 'number', description: 'New target Y coordinate (0-19)' }
            },
            required: ['relayId', 'x', 'y']
        }
    },
    replaceRelayDrone: {
        name: 'replaceRelayDrone',
        description: 'Replace a low-battery relay drone: deploy backup at same position, recall old relay to base',
        inputSchema: {
            type: 'object',
            properties: {
                relayId: { type: 'string', description: 'ID of the relay drone to replace' }
            },
            required: ['relayId']
        }
    },
    getRelayStatus: {
        name: 'getRelayStatus',
        description: 'Get relay-specific telemetry: battery, position, connected drones, edge intelligence data, movement mode',
        inputSchema: {
            type: 'object',
            properties: {
                relayId: { type: 'string', description: 'ID of the relay drone' }
            },
            required: ['relayId']
        }
    },
    getNetworkTopology: {
        name: 'getNetworkTopology',
        description: 'Get full mesh network topology: relay chain, links, hop counts, connected/disconnected drones, offline buffer status',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    broadcastSwarmCommand: {
        name: 'broadcastSwarmCommand',
        description: 'Broadcast a command to all search drones reachable through relay network. Commands: RECRUIT, MICRO_SCAN, REDISTRIBUTE, RTB_ALL',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', enum: ['RECRUIT', 'MICRO_SCAN', 'REDISTRIBUTE', 'RTB_ALL'], description: 'Swarm command to broadcast' },
                targetArea: {
                    type: 'object',
                    description: 'Target area for RECRUIT/MICRO_SCAN commands',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        radius: { type: 'number' }
                    }
                }
            },
            required: ['command']
        }
    },
    calculateOptimalRelayPosition: {
        name: 'calculateOptimalRelayPosition',
        description: 'Compute optimal relay position to maximize swarm coverage. Returns position, coverage score, and which disconnected drones would be reconnected',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },

    // ─────────────────────────────────────────────────────────────────────
    // MULTI-AGENT MODULE
    // ─────────────────────────────────────────────────────────────────────
    createTask: {
        name: 'createTask',
        description: 'Create a mission task for the drone swarm. Drones will automatically bid and the best candidate will be assigned.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['HOTSPOT', 'SCAN', 'CONFIRM'], description: 'Task type: HOTSPOT=investigate high-probability cell, SCAN=cover unexplored area, CONFIRM=verify a detected signal' },
                x: { type: 'number', description: 'Target X coordinate (0-19)' },
                y: { type: 'number', description: 'Target Y coordinate (0-19)' },
                priority: { type: 'number', description: 'Priority 1-10 (10=most urgent)' },
                expiresInTicks: { type: 'number', description: 'TTL ticks before auto-expiry (default 200, -1=never)' }
            },
            required: ['type', 'x', 'y', 'priority']
        }
    },
    cancelTask: {
        name: 'cancelTask',
        description: 'Cancel/expire a task by ID. Frees any assigned drone.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'ID of the task to cancel' }
            },
            required: ['taskId']
        }
    },
    getActiveTasks: {
        name: 'getActiveTasks',
        description: 'Get all active tasks with status breakdown. Call this before creating tasks to avoid duplicates.',
        inputSchema: { type: 'object', properties: {} }
    },
    getTaskAssignments: {
        name: 'getTaskAssignments',
        description: 'Get current drone-task assignments with task type and position.',
        inputSchema: { type: 'object', properties: {} }
    },
    getMultiAgentState: {
        name: 'getMultiAgentState',
        description: 'Get full multi-agent snapshot: tasks, assignments, orchestrator relay, bidding status, chat log.',
        inputSchema: { type: 'object', properties: {} }
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
    getBatteryForecast: droneTools.getBatteryForecast,
    getDroneDiscoveryList: droneTools.getDroneDiscoveryList,
    setAutoRecallThreshold: droneTools.setAutoRecallThreshold,

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
    updateMissionStats: missionTools.updateMissionStats,
    getFoundSurvivors: missionTools.getFoundSurvivors,
    setSurvivorPin: missionTools.setSurvivorPin,
    resetMission: missionTools.resetMission,
    setSimulationRunning: missionTools.setSimulationRunning,
    getMissionBriefing: missionTools.getMissionBriefing,
    getSectorAssignments: missionTools.getSectorAssignments,

    // Swarm intelligence tools
    getExplorationGradient: swarmIntelTools.getExplorationGradient,
    getUnassignedHotspots: swarmIntelTools.getUnassignedHotspots,
    getDroneAssignmentMap: swarmIntelTools.getDroneAssignmentMap,

    // Orchestration tools
    validateAssignmentPlan: orchestrationTools.validateAssignmentPlan,
    assignHotspotBatch: orchestrationTools.assignHotspotBatch,
    getRecommendedActions: orchestrationTools.getRecommendedActions,
    getBatteryRiskMap: orchestrationTools.getBatteryRiskMap,

    // Relay tools
    moveRelayDrone: relayTools.moveRelayDrone,
    replaceRelayDrone: relayTools.replaceRelayDrone,
    getRelayStatus: relayTools.getRelayStatus,
    getNetworkTopology: relayTools.getNetworkTopology,
    broadcastSwarmCommand: relayTools.broadcastSwarmCommand,
    calculateOptimalRelayPosition: relayTools.calculateOptimalRelayPosition,

    // Multi-agent tools
    createTask: multiAgentTools.createTask,
    cancelTask: multiAgentTools.cancelTask,
    getActiveTasks: multiAgentTools.getActiveTasks,
    getTaskAssignments: multiAgentTools.getTaskAssignments,
    getMultiAgentState: multiAgentTools.getMultiAgentState,
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

export function getToolSchema(toolName: string): ToolSchema | undefined {
    const schema = toolSchemas[toolName as keyof typeof toolSchemas] as unknown as ToolSchema | undefined;
    if (!schema) return undefined;
    return withDocstring(schema);
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST TOOLS (for MCP protocol)
// ═══════════════════════════════════════════════════════════════════════════

export function listTools() {
    return Object.values(toolSchemas).map(s => withDocstring(s as unknown as ToolSchema));
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORT MODULES
// ═══════════════════════════════════════════════════════════════════════════

export { droneTools } from './droneTools.js';
export { scanTools } from './scanTools.js';
export { communicationTools } from './communicationTools.js';
export { missionTools } from './missionTools.js';
export { swarmIntelTools } from './swarmIntelTools.js';
export { orchestrationTools } from './orchestrationTools.js';
export { relayTools } from './relayTools.js';
export * as multiAgentTools from './multiAgentTools.js';
