/**
 * MCP Tool Types for FirstLight Drone Swarm System
 * 
 * These types define the interface between the AI orchestration layer
 * and the drone swarm simulation.
 */

// ═══════════════════════════════════════════════════════════════════════════
// DRONE MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type DroneMode = 'Wide' | 'Micro' | 'Relay' | 'Charging';

export interface DronePosition {
    x: number;
    y: number;
    gridCell: string; // e.g., "A1", "T20"
}

export interface DroneStatus {
    id: string;
    position: DronePosition;
    target: DronePosition | null;
    mode: DroneMode;
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

export interface SetDroneTargetParams {
    droneId: string;
    targetX: number;
    targetY: number;
}

export interface SetDroneModeParams {
    droneId: string;
    mode: DroneMode;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAN MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SectorScanResult {
    gridCell: string;
    x: number;
    y: number;
    probability: number;
    pheromone: number;       // ACO pheromone deposit (0-1); high = drones recently visited
    terrain: string;
    scanned: boolean;
    lastScannedTick: number;
    signals: {
        mobile: number;
        thermal: number;
        sound: number;
        wifi: number;
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SWARM INTELLIGENCE MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ExplorationCell {
    gridCell: string;
    x: number;
    y: number;
    probability: number;
    pheromone: number;
    terrain: string;
    urgencyScore: number;   // probability * (1 - pheromone); higher = more deserving of attention
    category: 'critical' | 'high' | 'medium' | 'low';
}

export interface ExplorationGradient {
    cells: ExplorationCell[];
    criticalZones: string[];    // gridCells with urgencyScore > 0.6
    highZones: string[];        // 0.3-0.6
    pheromoneHotspots: string[]; // cells with pheromone > 0.5 (swarm already here)
    totalUnscanned: number;
}

export interface UnassignedHotspot {
    gridCell: string;
    x: number;
    y: number;
    probability: number;
    pheromone: number;
    urgencyScore: number;
    terrain: string;
    suggestedMode: 'Wide' | 'Micro'; // Micro if prob > 0.6
    nearestAvailableDrone: { id: string; distance: number } | null;
}

export interface UnassignedHotspotsResult {
    hotspots: UnassignedHotspot[];
    totalUnassigned: number;
    recommendedDispatches: Array<{ droneId: string; targetX: number; targetY: number; mode: 'Wide' | 'Micro'; reason: string }>;
}

export interface DroneAssignment {
    droneId: string;
    mode: string;
    battery: number;
    isConnected: boolean;
    currentPosition: { x: number; y: number; gridCell: string };
    targetSector: { x: number; y: number; gridCell: string; probability: number; pheromone: number } | null;
    redundantCoverage: boolean; // another drone also heading to same target
    status: 'searching' | 'charging' | 'relaying' | 'idle';
}

export interface DroneAssignmentMap {
    assignments: DroneAssignment[];
    redundantPairs: Array<{ drone1: string; drone2: string; sector: string }>;
    idleDrones: string[];
    coverageEfficiency: number; // 0-1, ratio of unique targets / total active drones
}

export interface GridHeatmap {
    width: number;
    height: number;
    cells: number[][];
    highPriorityCells: string[];  // cells with prob > 0.6
    mediumPriorityCells: string[]; // cells with prob 0.3-0.6
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNICATION MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CommLink {
    source: string;
    target: string;
    active: boolean;
    signalStrength: number;
}

export interface CommNetworkStatus {
    connectedNodes: string[];
    disconnectedNodes: string[];
    links: CommLink[];
    relayDronePosition: DronePosition | null;
    baseStationPosition: DronePosition;
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SurvivorInfo {
    id: string;
    position: DronePosition;
    message: string;
    phoneBattery: string;
    foundByDrone: string;
    foundAtTick: number;
}

export interface SwarmStatus {
    drones: DroneStatus[];
    activeDroneCount: number;
    totalDroneCount: number;
    relayDrone: DroneStatus | null;
}

export interface MissionStats {
    currentTick: number;
    sectorsScanned: number;
    totalSectors: number;
    scanProgress: number; // percentage
    survivorsFound: number;
    totalEstimatedSurvivors: number;
    highPriorityZonesRemaining: number;
    averageBattery: number;
    dronesCharging: number;
    dronesDisconnected: number;
}

export interface SetSurvivorPinParams {
    x: number;
    y: number;
    droneId: string;
    message?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface MCPToolResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
}

export type MCPToolHandler<TParams, TResult> = (params: TParams) => Promise<MCPToolResult<TResult>>;
