/**
 * Drone State Store
 * 
 * In-memory state store that bridges the frontend simulation with MCP tools.
 * The frontend pushes state updates here, and MCP tools read/write from here.
 * 
 * This is intentionally separate from the simulation algorithms.
 * MCP tools interact with HIGH-LEVEL state, not internal algorithms.
 */

import type {
    DroneStatus,
    DroneMode,
    SectorScanResult,
    CommLink,
    SurvivorInfo,
    MissionStats,
    DronePosition
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// GRID CONFIGURATION (mirrors swarmRouting.ts constants)
// ═══════════════════════════════════════════════════════════════════════════

export const GRID_W = 20;
export const GRID_H = 20;
export const BASE_X = 10;
export const BASE_Y = 19;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Grid cell label conversion
// ═══════════════════════════════════════════════════════════════════════════

export function gridToLabel(x: number, y: number): string {
    const row = String.fromCharCode(65 + (GRID_H - 1 - y)); // A-T
    const col = x + 1; // 1-20
    return `${row}${col}`;
}

export function labelToGrid(label: string): { x: number; y: number } {
    const row = label.charCodeAt(0) - 65;
    const col = parseInt(label.slice(1)) - 1;
    return { x: col, y: GRID_H - 1 - row };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE STORE
// ═══════════════════════════════════════════════════════════════════════════

interface DroneStateStore {
    // Drone states
    drones: Map<string, DroneStatus>;
    
    // Grid state
    grid: SectorScanResult[][];
    
    // Communication network
    commLinks: CommLink[];
    
    // Mission data
    survivors: Map<string, SurvivorInfo>;
    foundSurvivors: SurvivorInfo[];
    
    // Simulation state
    currentTick: number;
    isRunning: boolean;
    
    // Pending commands (to be picked up by frontend)
    pendingCommands: PendingCommand[];
}

export type CommandType = 
    | 'SET_TARGET'
    | 'SET_MODE'
    | 'RECALL_TO_BASE'
    | 'KILL_DRONE'
    | 'SET_SURVIVOR_PIN'
    | 'RESET_MISSION';

export interface PendingCommand {
    id: string;
    type: CommandType;
    params: Record<string, unknown>;
    timestamp: number;
    processed: boolean;
}

class DroneStore {
    private state: DroneStateStore = {
        drones: new Map(),
        grid: this.initializeGrid(),
        commLinks: [],
        survivors: new Map(),
        foundSurvivors: [],
        currentTick: 0,
        isRunning: false,
        pendingCommands: []
    };
    
    private listeners: Set<(state: DroneStateStore) => void> = new Set();

    private initializeGrid(): SectorScanResult[][] {
        const grid: SectorScanResult[][] = [];
        for (let y = 0; y < GRID_H; y++) {
            const row: SectorScanResult[] = [];
            for (let x = 0; x < GRID_W; x++) {
                row.push({
                    gridCell: gridToLabel(x, y),
                    x, y,
                    probability: 0.05,
                    pheromone: 0,
                    terrain: 'Open Field',
                    scanned: false,
                    lastScannedTick: 0,
                    signals: { mobile: 0, thermal: 0, sound: 0, wifi: 0 }
                });
            }
            grid.push(row);
        }
        return grid;
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATE UPDATE METHODS (called by frontend simulation)
    // ─────────────────────────────────────────────────────────────────────

    updateDrone(status: DroneStatus): void {
        this.state.drones.set(status.id, status);
        this.notify();
    }

    updateDrones(statuses: DroneStatus[]): void {
        statuses.forEach(s => this.state.drones.set(s.id, s));
        this.notify();
    }

    updateSector(result: SectorScanResult): void {
        if (result.y >= 0 && result.y < GRID_H && result.x >= 0 && result.x < GRID_W) {
            this.state.grid[result.y][result.x] = result;
            this.notify();
        }
    }

    updateGrid(grid: SectorScanResult[][]): void {
        this.state.grid = grid;
        this.notify();
    }

    updateCommLinks(links: CommLink[]): void {
        this.state.commLinks = links;
        this.notify();
    }

    addFoundSurvivor(survivor: SurvivorInfo): void {
        this.state.foundSurvivors.push(survivor);
        this.state.survivors.set(survivor.id, survivor);
        this.notify();
    }

    setTick(tick: number): void {
        this.state.currentTick = tick;
    }

    setRunning(running: boolean): void {
        this.state.isRunning = running;
        this.notify();
    }

    reset(): void {
        this.state = {
            drones: new Map(),
            grid: this.initializeGrid(),
            commLinks: [],
            survivors: new Map(),
            foundSurvivors: [],
            currentTick: 0,
            isRunning: false,
            pendingCommands: []
        };
        this.notify();
    }

    // ─────────────────────────────────────────────────────────────────────
    // COMMAND QUEUE (MCP -> Frontend)
    // ─────────────────────────────────────────────────────────────────────

    enqueueCommand(type: CommandType, params: Record<string, unknown>): string {
        const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.state.pendingCommands.push({
            id,
            type,
            params,
            timestamp: Date.now(),
            processed: false
        });
        this.notify();
        return id;
    }

    getPendingCommands(): PendingCommand[] {
        return this.state.pendingCommands.filter(c => !c.processed);
    }

    markCommandProcessed(id: string): void {
        const cmd = this.state.pendingCommands.find(c => c.id === id);
        if (cmd) {
            cmd.processed = true;
        }
    }

    clearProcessedCommands(): void {
        this.state.pendingCommands = this.state.pendingCommands.filter(c => !c.processed);
    }

    // ─────────────────────────────────────────────────────────────────────
    // READ METHODS (for MCP tools)
    // ─────────────────────────────────────────────────────────────────────

    getDrone(id: string): DroneStatus | undefined {
        return this.state.drones.get(id);
    }

    getAllDrones(): DroneStatus[] {
        return Array.from(this.state.drones.values());
    }

    getSector(x: number, y: number): SectorScanResult | undefined {
        if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) {
            return this.state.grid[y][x];
        }
        return undefined;
    }

    getSectorByLabel(label: string): SectorScanResult | undefined {
        const { x, y } = labelToGrid(label);
        return this.getSector(x, y);
    }

    getGrid(): SectorScanResult[][] {
        return this.state.grid;
    }

    getHeatmap(): number[][] {
        return this.state.grid.map(row => row.map(cell => cell.probability));
    }

    getCommLinks(): CommLink[] {
        return this.state.commLinks;
    }

    getFoundSurvivors(): SurvivorInfo[] {
        return this.state.foundSurvivors;
    }

    getCurrentTick(): number {
        return this.state.currentTick;
    }

    isSimulationRunning(): boolean {
        return this.state.isRunning;
    }

    getMissionStats(): MissionStats {
        const drones = this.getAllDrones();
        const activeDrones = drones.filter(d => d.isActive);
        const scannedSectors = this.state.grid.flat().filter(s => s.scanned).length;
        const totalSectors = GRID_W * GRID_H;
        const highPriorityRemaining = this.state.grid.flat()
            .filter(s => !s.scanned && s.probability > 0.6).length;
        const avgBattery = activeDrones.length > 0
            ? activeDrones.reduce((sum, d) => sum + d.battery, 0) / activeDrones.length
            : 0;
        const charging = drones.filter(d => d.mode === 'Charging').length;
        const disconnected = drones.filter(d => !d.isConnected && d.isActive).length;

        return {
            currentTick: this.state.currentTick,
            sectorsScanned: scannedSectors,
            totalSectors,
            scanProgress: (scannedSectors / totalSectors) * 100,
            survivorsFound: this.state.foundSurvivors.length,
            totalEstimatedSurvivors: 3, // from simulation
            highPriorityZonesRemaining: highPriorityRemaining,
            averageBattery: avgBattery,
            dronesCharging: charging,
            dronesDisconnected: disconnected
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUBSCRIPTION
    // ─────────────────────────────────────────────────────────────────────

    subscribe(listener: (state: DroneStateStore) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        this.listeners.forEach(fn => fn(this.state));
    }
}

// Singleton export
export const droneStore = new DroneStore();
