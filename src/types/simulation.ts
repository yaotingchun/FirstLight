export const GRID_W = 20;
export const GRID_H = 20;
export const CELL_SIZE = 35;

export const THRESHOLD_MICRO = 0.50;
export const THRESHOLD_FOUND = 0.85;
export const SIM_TICK_MS = 100;

// Zone pipeline cadence (every N ticks)
export const ZONE_PIPELINE_INTERVAL = 15;

// MCP Sync interval (every N ticks)
export const MCP_SYNC_INTERVAL = 10;
export const AI_DECISION_INTERVAL_MS = 3000;
export const AI_DECISION_POLL_MS = 1000;

export type Sector = {
    x: number;
    y: number;
    prob: number;
    pheromone: number;
    terrain: string;
    scanned: boolean;
    lastScanned: number;
    lastVisitedTick: number;
    currentDrones: number;
    confidence: number;
    signals: {
        mobile: number;
        thermal: number;
        sound: number;
        wifi: number;
    };
    disasterImage?: string;
};

export type Drone = {
    id: string;
    x: number;
    y: number;
    tx: number;
    ty: number;
    mode: 'Wide' | 'Micro' | 'Relay' | 'Charging';
    battery: number;
    targetSector: Sector | null;
    isConnected: boolean;
    memory: string[];
    savedTx?: number;
    savedTy?: number;
    startTick?: number;
    knownOtherDrones: { [id: string]: { x: number; y: number; lastUpdate: number } };
    lastScannedX?: number;
    lastScannedY?: number;
    lockTarget?: boolean;
    preventReassignment?: boolean;
    path: { x: number; y: number; tick: number; scanned?: boolean; }[];
};

export type SwarmMessage = {
    id: string;
    sender: string;
    time: number;
    type: 'HIGH_SIGNAL' | 'REQUEST_ASSIST' | 'MAP_SHARE';
    payload: Record<string, unknown>;
};

export const COMM_RANGE_DRONE = 5;
export const COMM_RANGE_RELAY = 10;
export const COMM_RANGE_BASE = 12;
export const RELAY_LOW_BATTERY_THRESHOLD = 25;
export const RELAY_TAKEOVER_MIN_BATTERY = 95;
export const RELAY_BASE_DOCK_EPSILON = 0.4;
export const RELAY_DEFAULT_TARGET = { x: 9.8, y: 10.0 };

export const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

export type CommEdge = { source: string; target: string; active: boolean };

export type HiddenSurvivor = {
    id: string;
    x: number;
    y: number;
    found: boolean;
    info: { message: string, battery: string, img?: string };
};

export type FoundPin = {
    id: string;
    x: number;
    y: number;
    info: { message: string, battery: string, img?: string };
};

export type OrchestratorChatMessage = {
    role: 'user' | 'ai' | 'system';
    text: string;
    droneId?: string;
};

export type FailureEvent = {
    type: 'DRONE_CONNECTION_LOST';
    droneId: string;
    tick: number;
};
