/**
 *  types.ts — Shared types for the AI Orchestrator
 *
 *  Defines the action vocabulary the AI can output and the environment
 *  snapshot format it receives as input.
 */

// ── Actions the AI can decide ───────────────────────────────────────────────

export type OrchestratorAction =
    | { type: 'move_drone';       droneId: string; x: number; y: number; reason: string }
    | { type: 'scan_area';        droneId: string; reason: string }
    | { type: 'capture_image';    droneId: string; x: number; y: number; reason: string }
    | { type: 'recall_drone';     droneId: string; reason: string }
    | { type: 'reallocate_swarm'; reason: string }
    | { type: 'deploy_team';      teamName: string; cellId: string; reason: string }
    | { type: 'create_alert';     severity: 'low' | 'medium' | 'high' | 'critical'; message: string }
    | { type: 'search_pattern';   droneId: string; pattern: 'spiral' | 'lawnmower' | 'expanding_sq'; x: number; y: number; reason: string }
    | { type: 'no_action';        reason: string };

export interface OrchestratorDecision {
    reasoning: string;
    actions: OrchestratorAction[];
    priority: 'low' | 'medium' | 'high' | 'critical';
}

// ── Environment snapshot fed to the AI ──────────────────────────────────────

export interface MissionObjective {
    id: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'active' | 'completed';
}

export type TrendDirection = 'increasing' | 'decreasing' | 'stable' | 'unknown';

export interface SensorTrend {
    sensor: 'mobile' | 'thermal' | 'sound' | 'wifi';
    direction: TrendDirection;
}

export interface DroneSnapshot {
    id: string;
    x: number;
    y: number;
    battery: number;
    active: boolean;
    assignedRegion: {
        xMin: number; xMax: number;
        yMin: number; yMax: number;
    };
    scanQueueRemaining: number;
}

export interface HotspotInfo {
    cellId: string;
    row: number;
    col: number;
    probability: number;
    scanned: boolean;
}

export interface TerrainSummary {
    shelterCells: number;
    collapsedCells: number;
    roadCells: number;
    openFieldCells: number;
}

export interface SensorSummary {
    mobile: { confidence: number; active: boolean };
    thermal: { confidence: number; active: boolean };
    sound: { confidence: number; active: boolean };
    wifi: { confidence: number; active: boolean };
}

export interface EnvironmentSnapshot {
    /** Pre-computed plain-text summary — most important field for the AI */
    summary: string;
    timestamp: string;
    gridSize: number;
    totalCells: number;
    scannedCells: number;
    unscannedCells: number;
    averageProbability: number;
    hotspots: HotspotInfo[];          // top cells by probability
    terrain: TerrainSummary;
    sensors: SensorSummary;
    drones: DroneSnapshot[];
    activeDrones: number;
    inactiveDrones: number;
    overallBatteryAvg: number;
    tickNumber: number;
    latestVisionResult?: string;
    objectives: MissionObjective[];
    sensorTrends: SensorTrend[];
}
