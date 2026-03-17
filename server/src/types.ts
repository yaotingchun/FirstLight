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

export interface GetBatteryForecastParams {
    droneId: string;
    targetX: number;
    targetY: number;
    assumedMode?: 'Wide' | 'Micro'; // defaults to drone's current mode
}

export interface BatteryForecast {
    droneId: string;
    currentBattery: number;
    assumedMode: 'Wide' | 'Micro';
    distanceToTarget: number;
    distanceTargetToBase: number;
    estimatedBatteryUsed: number;
    projectedBatteryOnReturn: number;
    canReach: boolean; // projectedBatteryOnReturn > 5 (safety buffer)
    warning: string | null;
}

export interface DroneDiscoveryEntry {
    id: string;
    isActive: boolean;
    mode: DroneMode;
    battery: number;
    position: DronePosition;
}

export interface DroneDiscoveryList {
    drones: DroneDiscoveryEntry[];
    activeCount: number;
    totalCount: number;
}

export interface SetAutoRecallThresholdParams {
    droneId: string;
    batteryThreshold: number; // 0-100
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
    disasterImage?: string;
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
    simulationRunning: boolean;
    averageZoneCoverage?: number;
    meanProbabilityScanned?: number;
    repeatedScanRate?: number;
    missionTimeSec?: number;
}

export interface SetSurvivorPinParams {
    x: number;
    y: number;
    droneId: string;
    message?: string;
}

export interface SectorAssignment {
    gridCell: string;
    x: number;
    y: number;
    reservedByDrone: string | null; // null = free to assign
    isReserved: boolean;            // true only if drone is still en-route (dist > 0.3)
    probability: number;
    pheromone: number;
}

export interface SectorAssignmentsResult {
    assignments: SectorAssignment[];
    reservedCount: number;
    freeCount: number;
}

export interface SetSimulationStateParams {
    running: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AssignmentBatchItem {
    droneId: string;
    targetX: number;
    targetY: number;
    mode?: DroneMode;
}

export interface ValidateAssignmentPlanParams {
    assignments: AssignmentBatchItem[];
}

export interface ValidateAssignmentPlanResult {
    valid: boolean;
    validCount: number;
    invalidCount: number;
    results: Array<{
        assignment: AssignmentBatchItem;
        valid: boolean;
        errors: string[];
        warnings: string[];
    }>;
}

export interface AssignHotspotBatchParams {
    assignments: AssignmentBatchItem[];
}

export interface AssignHotspotBatchResult {
    accepted: Array<{
        assignment: AssignmentBatchItem;
        commandIds: string[];
        message: string;
    }>;
    rejected: Array<{
        assignment: AssignmentBatchItem;
        reason: string;
    }>;
    queuedCount: number;
}

export interface RecommendedAction {
    priority: 'low' | 'medium' | 'high' | 'critical';
    type: string;
    params: Record<string, unknown>;
    reason: string;
}

export interface RecommendedActionsResult {
    actions: RecommendedAction[];
    generatedAtTick: number;
}

export interface BatteryRiskMapParams {
    safetyBuffer?: number;
}

export interface BatteryRiskEntry {
    droneId: string;
    currentBattery: number;
    targetSector: string;
    projectedBatteryOnReturn: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    recommendation: 'continue' | 'monitor' | 'avoid-micro' | 'recall';
}

export interface BatteryRiskMapResult {
    entries: BatteryRiskEntry[];
    critical: string[];
    high: string[];
    medium: string[];
    low: string[];
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

// ═══════════════════════════════════════════════════════════════════════════
// RELAY DRONE MODULE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface RelayDroneStatus {
    id: string;
    position: DronePosition;
    battery: number;
    mode: 'Relay';
    isConnected: boolean;
    connectedSearchDrones: string[];
    swarmKnowledge: SwarmKnowledge;
    isBackup: boolean;
    movementMode: 'centroid' | 'coverage';
    isOrchestrator: boolean;
    orchestratorState?: OrchestratorState;
}

export interface SwarmKnowledge {
    probabilityHeatmap: { gridCell: string; probability: number }[];
    exploredCells: string[];
    detectedHazards: { gridCell: string; type: string; severity: number }[];
    droneBatteryMap: { droneId: string; battery: number }[];
    sensorDetections: { gridCell: string; signal: string; strength: number }[];
    lastUpdated: number;
}

export interface NetworkTopology {
    relayChain: string[];
    links: NetworkLink[];
    connectedDrones: string[];
    disconnectedDrones: string[];
    hopCounts: { droneId: string; hops: number }[];
    isBaseConnected: boolean;
    bufferedDataSize: number;
}

export interface NetworkLink {
    source: string;
    target: string;
    quality: number;
    hopCount: number;
}

// Relay MCP tool params
export interface DeployRelayDroneParams {
    x: number;
    y: number;
    relayId?: string;
}

export interface MoveRelayDroneParams {
    relayId: string;
    x: number;
    y: number;
}

export interface ReplaceRelayDroneParams {
    relayId: string;
}

export interface GetRelayStatusParams {
    relayId: string;
}

export interface BroadcastSwarmCommandParams {
    command: 'RECRUIT' | 'MICRO_SCAN' | 'REDISTRIBUTE' | 'RTB_ALL';
    targetArea?: { x: number; y: number; radius: number };
}

// Relay MCP tool results
export interface DeployRelayDroneResult {
    relayId: string;
    commandId: string;
    message: string;
}

export interface MoveRelayDroneResult {
    commandId: string;
    message: string;
}

export interface ReplaceRelayDroneResult {
    oldRelayId: string;
    newRelayId: string;
    commandIds: string[];
    message: string;
}

export interface BroadcastSwarmCommandResult {
    commandId: string;
    reachableDrones: string[];
    message: string;
}

export interface OptimalRelayPositionResult {
    position: { x: number; y: number; gridCell: string };
    coverageScore: number;
    wouldConnect: string[];
    currentDisconnected: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-AGENT ARCHITECTURE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Task lifecycle status */
export type TaskStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';

/** Task type — what kind of action is needed */
export type TaskType = 'HOTSPOT' | 'SCAN' | 'CONFIRM';

/** Role of a drone in the multi-agent system */
export type DroneRole = 'SEARCH' | 'RELAY';

/**
 * A task published by the LLM via MCP tools.
 * Tasks are ONLY created by the LLM — the execution engine never generates them.
 */
export interface Task {
    id: string;
    type: TaskType;
    position: { x: number; y: number };
    priority: number;          // 1–10, higher = more urgent
    createdAt: number;         // tick when created
    expiresAt: number;         // tick when task expires (-1 = never)
    status: TaskStatus;
    assignedDroneId?: string;
    completedAt?: number;
}

/** A drone's bid on a task — lower cost wins */
export interface Bid {
    droneId: string;
    taskId: string;
    cost: number;
}

/** Final drone-task assignment after a bidding round resolves */
export interface Assignment {
    droneId: string;
    taskId: string;
    assignedAt: number; // tick
}

/** Chat message from any agent (LLM orchestrator, search drone, relay drone) */
export interface AgentChatMessage {
    id: string;
    /** 'ORCHESTRATOR' for the LLM/engine. droneId (e.g. 'DRN-Alpha') for drones. */
    role: string;
    text: string;
    timestamp: number;
    source: 'user' | 'system' | 'llm' | 'engine' | 'drone';
}

/** Orchestrator state held by the active relay drone */
export interface OrchestratorState {
    activeTasks: Task[];
    assignments: Assignment[];
    lastBiddingTick: number;
    chatLog: AgentChatMessage[];
}

/** Full multi-agent state snapshot synced to frontend */
export interface MultiAgentState {
    activeTasks: Task[];
    assignments: Assignment[];
    orchestratorDroneId: string | null; // which relay hosts the orchestrator
    chatLog: AgentChatMessage[];
    isBiddingPaused: boolean;           // true during relay swap freeze
    isSystemFrozen: boolean;            // relay swap in progress
    lastUpdatedTick: number;
}

// ─── MCP tool param/result types for multi-agent tools ───────────────────────

export interface CreateTaskParams {
    type: TaskType;
    x: number;
    y: number;
    priority: number;
    expiresInTicks?: number; // default 200
}

export interface CancelTaskParams {
    taskId: string;
}

export interface GetActiveTasksResult {
    tasks: Task[];
    totalActive: number;
    pending: number;
    assigned: number;
    inProgress: number;
}

export interface CreateTaskResult {
    task?: Task;
    deduplicated: boolean;  // true if rejected as too close to existing task
    reason?: string;
}

