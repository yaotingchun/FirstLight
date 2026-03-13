/**
 * MCP Client Service
 * 
 * Frontend service to communicate with the MCP server.
 * Provides methods for:
 * - Executing MCP tools
 * - Syncing simulation state to server
 * - Polling for pending commands
 */

const MCP_SERVER_URL = 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════
// TOOL EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

export interface MCPToolResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
}

/**
 * Execute an MCP tool
 */
export async function executeTool<T = unknown>(
    toolName: string,
    params: Record<string, unknown> = {}
): Promise<MCPToolResult<T>> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/tools/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        return await response.json();
    } catch (error) {
        return {
            success: false,
            error: `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now()
        };
    }
}

/**
 * List all available tools
 */
export async function listTools(): Promise<{
    success: boolean;
    tools?: Array<{ name: string; description: string; inputSchema: object }>;
    modules?: Record<string, string[]>;
    error?: string;
}> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/tools`);
        return await response.json();
    } catch (error) {
        return {
            success: false,
            error: `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Check server status
 */
export async function getServerStatus(): Promise<{
    status: string;
    version: string;
    timestamp: number;
    simulationRunning: boolean;
    currentTick: number;
    dronesOnline: number;
} | null> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/status`);
        return await response.json();
    } catch {
        return null;
    }
}

export interface OrchestratorChatResponse {
    success: boolean;
    reply?: string;
    decision?: {
        reasoning: string;
        priority?: 'low' | 'medium' | 'high' | 'critical';
        actions: Array<Record<string, unknown>>;
    };
    executionLog?: string[];
    error?: string;
    timestamp: number;
}

/**
 * Send a message to the orchestrator AI through the MCP server.
 */
export async function orchestratorChat(message: string): Promise<OrchestratorChatResponse> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/orchestrator/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        return await response.json();
    } catch (error) {
        return {
            success: false,
            error: `Failed to reach orchestrator endpoint: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now()
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE SYNC (Frontend -> Server)
// ═══════════════════════════════════════════════════════════════════════════

export interface DroneStateForSync {
    id: string;
    position: { x: number; y: number; gridCell: string };
    target: { x: number; y: number; gridCell: string } | null;
    mode: string;
    battery: number;
    isConnected: boolean;
    isActive: boolean;
    assignedRegion: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
    } | null;
}

export interface SectorStateForSync {
    gridCell: string;
    x: number;
    y: number;
    probability: number;
    pheromone?: number;
    terrain: string;
    scanned: boolean;
    lastScannedTick: number;
    disasterImage?: string;
    signals: {
        mobile: number;
        thermal: number;
        sound: number;
        wifi: number;
    };
}

/**
 * Sync drone states to MCP server
 */
export async function syncDroneStates(drones: DroneStateForSync[]): Promise<boolean> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/state/drones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drones })
        });
        const result = await response.json();
        return result.success;
    } catch {
        return false;
    }
}

/**
 * Sync grid state to MCP server
 */
export async function syncGridState(grid: SectorStateForSync[][]): Promise<boolean> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/state/grid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grid })
        });
        const result = await response.json();
        return result.success;
    } catch {
        return false;
    }
}

/**
 * Sync simulation tick to MCP server
 */
export async function syncTick(tick: number, running: boolean): Promise<boolean> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/state/tick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tick, running })
        });
        const result = await response.json();
        return result.success;
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND POLLING (Server -> Frontend)
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingCommand {
    id: string;
    type: string;
    params: Record<string, unknown>;
    timestamp: number;
    processed: boolean;
}

/**
 * Get pending commands from MCP server
 */
export async function getPendingCommands(): Promise<PendingCommand[]> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/commands`);
        const result = await response.json();
        return result.commands || [];
    } catch {
        return [];
    }
}

/**
 * Acknowledge that a command has been processed
 */
export async function acknowledgeCommand(commandId: string): Promise<boolean> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/commands/${commandId}/ack`, {
            method: 'POST'
        });
        const result = await response.json();
        return result.success;
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHORTHAND TOOL METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Report a confirmed survivor back to the MCP server
 */
export async function syncSurvivor(survivor: {
    id: string;
    x: number;
    y: number;
    droneId: string;
    message: string;
    tick: number;
}): Promise<boolean> {
    try {
        const response = await fetch(`${MCP_SERVER_URL}/api/state/survivor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: survivor.id,
                position: { x: survivor.x, y: survivor.y, gridCell: '' },
                message: survivor.message,
                phoneBattery: 'unknown',
                foundByDrone: survivor.droneId,
                foundAtTick: survivor.tick
            })
        });
        const result = await response.json();
        return result.success;
    } catch {
        return false;
    }
}

export const mcpTools = {
    // Drone tools
    getDroneStatus: (droneId: string) => executeTool('getDroneStatus', { droneId }),
    getAllDroneStatuses: () => executeTool('getAllDroneStatuses'),
    setDroneTarget: (droneId: string, targetX: number, targetY: number) =>
        executeTool('setDroneTarget', { droneId, targetX, targetY }),
    setDroneMode: (droneId: string, mode: string) =>
        executeTool('setDroneMode', { droneId, mode }),
    recallDroneToBase: (droneId: string) =>
        executeTool('recallDroneToBase', { droneId }),
    killDrone: (droneId: string) => executeTool('killDrone', { droneId }),
    getBatteryForecast: (droneId: string, targetX: number, targetY: number, assumedMode?: 'Wide' | 'Micro') =>
        executeTool('getBatteryForecast', { droneId, targetX, targetY, ...(assumedMode ? { assumedMode } : {}) }),
    getDroneDiscoveryList: () => executeTool('getDroneDiscoveryList'),
    setAutoRecallThreshold: (droneId: string, batteryThreshold: number) =>
        executeTool('setAutoRecallThreshold', { droneId, batteryThreshold }),

    // Scan tools
    getSectorScanResult: (sector: string) =>
        executeTool('getSectorScanResult', { sector }),
    getGridHeatmap: () => executeTool('getGridHeatmap'),
    getScannedSectors: () => executeTool('getScannedSectors'),
    getSurroundingSectors: (centerSector: string, radius?: number) =>
        executeTool('getSurroundingSectors', { centerSector, radius }),

    // Communication tools
    getCommNetworkStatus: () => executeTool('getCommNetworkStatus'),
    getDisconnectedDrones: () => executeTool('getDisconnectedDrones'),
    checkDroneConnectivity: (droneId: string) =>
        executeTool('checkDroneConnectivity', { droneId }),

    // Mission tools
    getSwarmStatus: () => executeTool('getSwarmStatus'),
    getMissionStats: () => executeTool('getMissionStats'),
    getFoundSurvivors: () => executeTool('getFoundSurvivors'),
    setSurvivorPin: (x: number, y: number, droneId: string, message?: string) =>
        executeTool('setSurvivorPin', { x, y, droneId, message }),
    resetMission: () => executeTool('resetMission'),
    getMissionBriefing: () => executeTool('getMissionBriefing'),
    getSectorAssignments: () => executeTool('getSectorAssignments'),
    setSimulationRunning: (running: boolean) => executeTool('setSimulationRunning', { running })
};
