import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, FastForward, Target, Radio, Crosshair, RotateCcw, Activity, Hexagon, MapPin, X, Wifi, WifiOff, Terminal, MessageSquare, Send } from 'lucide-react';

const GRID_W = 20;
const GRID_H = 20;
const CELL_SIZE = 35;

import { gridDataService, INITIAL_SENSORS } from '../services/gridDataService';
import * as mcpClient from '../services/mcpClient';

// Zone-based planning modules
import { clusterZones, getZoneForCell } from '../utils/zoneClustering';
import type { SearchZone, GridCell } from '../utils/zoneClustering';
import { scoreZones } from '../utils/zoneScoring';
import { allocateDrones } from '../utils/zoneAllocator';
import type { DroneMission } from '../utils/zoneAllocator';
import { createSearchMemory, recordCellScan, getRepeatScanRate } from '../utils/searchMemory';
import type { SearchMemory } from '../utils/searchMemory';

const THRESHOLD_MICRO = 0.50;
const THRESHOLD_FOUND = 0.85;

// Zone pipeline cadence (every N ticks)
const ZONE_PIPELINE_INTERVAL = 15;

// MCP Sync interval (every N ticks)
const MCP_SYNC_INTERVAL = 10;
const AI_DECISION_INTERVAL_MS = 3000;
const AI_DECISION_POLL_MS = 1000;

// Types
type Sector = {
    x: number;
    y: number;
    prob: number;
    pheromone: number;
    terrain: string;
    scanned: boolean;
    lastScanned: number;
    signals: {
        mobile: number;
        thermal: number;
        sound: number;
        wifi: number;
    };
    disasterImage?: string;
};

type Drone = {
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
};

type SwarmMessage = {
    id: string;
    sender: string;
    time: number;
    type: 'HIGH_SIGNAL' | 'REQUEST_ASSIST' | 'MAP_SHARE';
    payload: Record<string, unknown>;
};

const COMM_RANGE_DRONE = 5;
const COMM_RANGE_RELAY = 10;
const COMM_RANGE_BASE = 12;

const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

type CommEdge = { source: string; target: string; active: boolean };

type HiddenSurvivor = {
    id: string;
    x: number;
    y: number;
    found: boolean;
    info: { message: string, battery: string, img?: string };
};

type FoundPin = {
    id: string;
    x: number;
    y: number;
    info: { message: string, battery: string, img?: string };
};

type OrchestratorChatMessage = {
    role: 'user' | 'ai' | 'system';
    text: string;
};


// Grid generation — uses real terrain from OSM data via gridDataService
const createGrid = (survivors?: HiddenSurvivor[]): Sector[][] => {
    const g: Sector[][] = [];
    const terrainData = gridDataService.getTerrainGrid();
    const sensorWeights = gridDataService.getSensorWeights();
    const tacticalWeights = gridDataService.getWeights();

    // 1. Initialize grid with baseline noise and tactical map influence
    for (let y = 0; y < GRID_H; y++) {
        const row: Sector[] = [];
        for (let x = 0; x < GRID_W; x++) {
            const terrain = terrainData[y]?.[x] ?? 'Open Field';
            // Influence initial signals with tactical weights (OSM findings)
            const tacWeight = tacticalWeights[y]?.[x] ?? 0.05;
            const noise = () => Math.pow(Math.random(), 15) * 0.1; // Reduced background noise

            row.push({
                x, y,
                prob: 0,
                pheromone: 0,
                terrain,
                scanned: false,
                lastScanned: 0,
                signals: {
                    mobile: tacWeight * 0.2 + noise(),
                    thermal: tacWeight * 0.2 + noise(),
                    sound: tacWeight * 0.2 + noise(),
                    wifi: tacWeight * 0.2 + noise()
                }
            });
        }
        g.push(row);
    }

    // 2. If survivors provided, generate wide signal gradients leading to them
    if (survivors) {
        survivors.forEach(s => {
            // "Bread crumbs" range - how far out the signal "trail" starts
            const gradientRadius = 8;

            for (let dy = -gradientRadius; dy <= gradientRadius; dy++) {
                for (let dx = -gradientRadius; dx <= gradientRadius; dx++) {
                    const nx = s.x + dx;
                    const ny = s.y + dy;
                    if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= gradientRadius) {
                            // Exponential decay for the gradient: 1.0 at center, drops off to near 0 at radius
                            // Signal = base * exp(-dist / scale)
                            // Sharpened gradient (from 2.5 to 1.5) for smaller, more difficult hotspots
                            const intensity = Math.exp(-dist / 1.5);
                            const signals = g[ny][nx].signals;

                            // 2. Calibrated Peak: Ensure discovery (Prob > 0.85) at center
                            // We target 0.86 for ALL signals at center to ensure a safe margin for discovery
                            const targetVal = 0.86;

                            signals.mobile = Math.min(1.0, signals.mobile + intensity * Math.max(0, targetVal - signals.mobile));
                            signals.thermal = Math.min(1.0, signals.thermal + intensity * Math.max(0, targetVal - signals.thermal));
                            signals.sound = Math.min(1.0, signals.sound + intensity * Math.max(0, targetVal - signals.sound));
                            signals.wifi = Math.min(1.0, signals.wifi + intensity * Math.max(0, targetVal - signals.wifi));
                        }
                    }
                }
            }
        });
    } else {
        // Fallback to legacy hotspots if no survivors provided during init
        const numHotspots = 3;
        for (let i = 0; i < numHotspots; i++) {
            const hx = Math.floor(Math.random() * GRID_W);
            const hy = Math.floor(Math.random() * GRID_H);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = hx + dx;
                    const ny = hy + dy;
                    if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                        const dist = Math.abs(dx) + Math.abs(dy);
                        const boost = dist === 0 ? 0.8 : 0.4;
                        const s = g[ny][nx].signals;
                        s.mobile = Math.min(1.0, s.mobile + boost);
                        s.thermal = Math.min(1.0, s.thermal + boost);
                        s.sound = Math.min(1.0, s.sound + boost);
                        s.wifi = Math.min(1.0, s.wifi + boost);
                    }
                }
            }
        }
    }

    // 3. Calculate initial probabilities
    const getProb = (signals: Sector['signals']) => {
        const score = (sensorWeights.mobile.base * sensorWeights.mobile.conf * signals.mobile) +
            (sensorWeights.thermal.base * sensorWeights.thermal.conf * signals.thermal) +
            (sensorWeights.sound.base * sensorWeights.sound.conf * signals.sound) +
            (sensorWeights.wifi.base * sensorWeights.wifi.conf * signals.wifi);

        const sumWeights = (sensorWeights.mobile.base * sensorWeights.mobile.conf) +
            (sensorWeights.thermal.base * sensorWeights.thermal.conf) +
            (sensorWeights.sound.base * sensorWeights.sound.conf) +
            (sensorWeights.wifi.base * sensorWeights.wifi.conf);

        return score / sumWeights;
    };

    const allSectors: Sector[] = g.flat();
    allSectors.forEach(s => {
        s.prob = getProb(s.signals);
    });

    const topSectors = [...allSectors].sort((a, b) => b.prob - a.prob).slice(0, 3);
    const disasterImages = [
        '/assets/disasters/earthquake_1.png',
        '/assets/disasters/earthquake_2.png',
        '/assets/disasters/earthquake_3.png'
    ];

    topSectors.forEach((s, i) => {
        // Some images on peak, some in surrounding (40% center, 60% surrounding)
        const isCenter = Math.random() < 0.4;
        const dx = isCenter ? 0 : Math.floor(Math.random() * 5) - 2; // -2 to 2
        const dy = isCenter ? 0 : Math.floor(Math.random() * 5) - 2; // -2 to 2
        const nx = Math.max(0, Math.min(GRID_W - 1, s.x + dx));
        const ny = Math.max(0, Math.min(GRID_H - 1, s.y + dy));
        g[ny][nx].disasterImage = disasterImages[i];
    });

    return g;
};

const createDrones = (): Drone[] => {
    const bx = BASE_STATION.x;
    const by = BASE_STATION.y;
    // Departure stagger: drones flying to distant targets leave first so all arrive roughly together.
    // Alpha/Beta  → upper corners (~18.6 cells away) → depart tick 0
    // RLY-Prime   → center      (~9 cells away)       → depart tick 15
    // Gamma/Delta → lower corners (~7.8 cells away)  → depart tick 25
    return [
        { id: 'DRN-Alpha', x: bx, y: by, tx: 2,  ty: 2,  mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0,  knownOtherDrones: {} },
        { id: 'DRN-Beta',  x: bx, y: by, tx: 17, ty: 2,  mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0,  knownOtherDrones: {} },
        { id: 'RLY-Prime', x: bx, y: by, tx: GRID_W / 2, ty: GRID_H / 2, mode: 'Relay', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 15, knownOtherDrones: {} },
        { id: 'RLY-Backup', x: bx, y: by, tx: bx, ty: by, mode: 'Charging', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {} },
        { id: 'DRN-Gamma', x: bx, y: by, tx: 2,  ty: 17, mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {} },
        { id: 'DRN-Delta', x: bx, y: by, tx: 17, ty: 17, mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {} }
    ];
};

const createSurvivors = (grid?: Sector[][]): HiddenSurvivor[] => {
    const messages = [
        "Trapped under concrete. Leg injured.",
        "Safe but cannot exit building. 3 people here.",
        "Need water asap."
    ];

    if (grid) {
        const allSectors = grid.flat();
        // Sort by probability but enforce spreading
        const sorted = [...allSectors].sort((a, b) => b.prob - a.prob);
        const selected: Sector[] = [];
        const MIN_DIST = 6; // Enforce at least 6 cells distance between survivors

        for (const s of sorted) {
            if (selected.length >= 3) break;
            const tooClose = selected.some(sel =>
                Math.sqrt(Math.pow(s.x - sel.x, 2) + Math.pow(s.y - sel.y, 2)) < MIN_DIST
            );
            if (!tooClose) {
                selected.push(s);
            }
        }

        return selected.map((s, i) => ({
            id: `S${i + 1}`,
            x: s.x,
            y: s.y,
            found: false,
            info: { message: messages[i], battery: `${Math.floor(Math.random() * 50 + 5)}%` }
        }));
    }

    // Fallback if no grid provided (bootstrap phase)
    // We'll use the tactical map weights if available to find spread centers
    const tacticalWeights = gridDataService.getWeights();
    const candidates: { x: number, y: number, w: number }[] = [];
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            candidates.push({ x, y, w: tacticalWeights[y][x] + Math.random() * 0.1 });
        }
    }
    candidates.sort((a, b) => b.w - a.w);

    const selectedPoints: { x: number, y: number }[] = [];
    for (const c of candidates) {
        if (selectedPoints.length >= 3) break;
        const tooClose = selectedPoints.some(p => Math.sqrt(Math.pow(c.x - p.x, 2) + Math.pow(c.y - p.y, 2)) < 6);
        if (!tooClose) selectedPoints.push(c);
    }

    return selectedPoints.map((p, i) => ({
        id: `S${i + 1}`,
        x: p.x,
        y: p.y,
        found: false,
        info: { message: messages[i % messages.length], battery: "45%" }
    }));
};

// Component
const SimulationMapMCP: React.FC = () => {
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(1);

    // Sim State Refs
    const initialSurvivors = createSurvivors(); // Phase 1: Determine spread positions
    const gridRef = useRef<Sector[][]>(createGrid(initialSurvivors)); // Phase 2: Create grid with gradients
    const dronesRef = useRef<Drone[]>(createDrones());
    const survivorsRef = useRef<HiddenSurvivor[]>(initialSurvivors);
    const pinsRef = useRef<FoundPin[]>([]);
    const timeRef = useRef<number>(0);
    const commLinksRef = useRef<CommEdge[]>([]);
    const swarmMessagesRef = useRef<SwarmMessage[]>([]);
    const sensorWeightsRef = useRef(gridDataService.getSensorWeights());
    const logsRef = useRef<{ time: number, msg: string, type: 'alert' | 'info' | 'success' }[]>([]);
    // Per-drone auto-recall thresholds set via MCP (droneId -> batteryThreshold %)
    const autoRecallThresholdsRef = useRef<Map<string, number>>(new Map());

    // Zone-based planning state
    const zonesRef = useRef<SearchZone[]>([]);
    const searchMemoryRef = useRef<SearchMemory>(createSearchMemory());
    const activeMissionsRef = useRef<DroneMission[]>([]);
    const metricsRef = useRef({
        repeatedScanRate: 0,
        averageZoneCoverage: 0,
        droneIdleTime: 0,
        meanProbabilityScanned: 0,
        totalScans: 0,
        totalRepeatScans: 0,
        scannedProbSum: 0,
    });

    const [, setTickFlip] = useState(0);
    const [selectedPin, setSelectedPin] = useState<FoundPin | null>(null);
    const [showSensors, setShowSensors] = useState(false);

    // MCP State
    const [mcpConnected, setMcpConnected] = useState(false);
    const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
    const [mcpToolOutput, setMcpToolOutput] = useState<string>('');
    const [mcpSelectedTool, setMcpSelectedTool] = useState<string>('getSwarmStatus');
    const [mcpToolParams, setMcpToolParams] = useState<string>('{}');
    const [chatOpen, setChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatSending, setChatSending] = useState(false);
    const aiBusyRef = useRef(false);
    const aiLastRunRef = useRef(0);
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const [chatMessages, setChatMessages] = useState<OrchestratorChatMessage[]>([
        { role: 'system', text: 'AI chat ready. Ask status or issue commands (e.g. "move DRN-Alpha to 5,8"). Use THINK NOW to force one AI decision cycle.' }
    ]);

    useEffect(() => {
        if (!chatOpen) return;
        const el = chatScrollRef.current;
        if (!el) return;
        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    }, [chatMessages, chatOpen]);

    // MCP Connection Check
    useEffect(() => {
        const checkConnection = async () => {
            const status = await mcpClient.getServerStatus();
            setMcpConnected(!!status);
        };
        checkConnection();
        const interval = setInterval(checkConnection, 5000);
        return () => clearInterval(interval);
    }, []);

    // MCP Tool Execution
    const executeMcpTool = async () => {
        try {
            const params = JSON.parse(mcpToolParams);
            const result = await mcpClient.executeTool(mcpSelectedTool, params);
            setMcpToolOutput(JSON.stringify(result, null, 2));
            addLog(`MCP: ${mcpSelectedTool} executed`, 'info');
        } catch (error) {
            setMcpToolOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
            addLog(`MCP: ${mcpSelectedTool} failed`, 'alert');
        }
    };

    const runOrchestratorPrompt = useCallback(async (message: string, source: 'user' | 'auto' = 'user') => {
        const trimmed = message.trim();
        if (!trimmed || aiBusyRef.current) return;

        aiBusyRef.current = true;
        setChatSending(true);

        if (source === 'user') {
            setChatMessages(prev => [...prev, { role: 'user', text: trimmed }]);
        } else {
            setChatMessages(prev => [...prev, { role: 'system', text: 'Auto-think: AI is evaluating current swarm state...' }]);
        }

        const result = await mcpClient.orchestratorChat(trimmed);

        if (!result.success) {
            setChatMessages(prev => [...prev, { role: 'system', text: `Error: ${result.error ?? 'Unknown error'}` }]);
            setChatSending(false);
            aiBusyRef.current = false;
            return;
        }

        const decision = result.decision;
        if (decision) {
            const actions = decision.actions ?? [];
            const actionSummary = actions
                .map((a) => {
                    const type = String(a.type ?? 'unknown');
                    if (type === 'move_drone') {
                        return `${type}(${String(a.droneId ?? '?')} -> ${String(a.x ?? '?')},${String(a.y ?? '?')})`;
                    }
                    if (type === 'set_drone_mode') {
                        return `${type}(${String(a.droneId ?? '?')} -> ${String(a.mode ?? '?')})`;
                    }
                    if (type === 'set_simulation_state') {
                        return `${type}(${String(a.running ?? '?')})`;
                    }
                    return type;
                })
                .join(' | ');

            setChatMessages(prev => [
                ...prev,
                {
                    role: 'ai',
                    text: `Decision [${(decision.priority ?? 'medium').toUpperCase()}]\nReasoning: ${decision.reasoning}\nActions: ${actionSummary || 'none'}`
                }
            ]);
        } else {
            const replyText = result.reply;
            if (replyText) {
                setChatMessages(prev => [...prev, { role: 'ai', text: replyText }]);
            }
        }

        const executionLog = result.executionLog;
        if (executionLog && executionLog.length > 0) {
            setChatMessages(prev => [...prev, { role: 'system', text: `Executed: ${executionLog.join(' | ')}` }]);
        }

        setChatSending(false);
        aiBusyRef.current = false;
    }, []);

    const sendChatMessage = useCallback(async () => {
        const message = chatInput.trim();
        if (!message || chatSending) return;
        setChatInput('');
        await runOrchestratorPrompt(message, 'user');
    }, [chatInput, chatSending, runOrchestratorPrompt]);

    const runThinkNow = useCallback(async () => {
        await runOrchestratorPrompt(
            'Evaluate current swarm state. Recall any drone with battery below 20% immediately. Then assign remaining drones to improve search coverage. Output JSON actions only.',
            'auto'
        );
    }, [runOrchestratorPrompt]);

    // MCP State Sync Helper
    const syncToMcp = useCallback(async (forceMcpConnected = false) => {
        if (!mcpConnected && !forceMcpConnected) return;

        const drones = dronesRef.current;
        const grid = gridRef.current;

        // Build drone states for sync
        const droneStates: mcpClient.DroneStateForSync[] = drones.map(d => ({
            id: d.id,
            position: {
                x: d.x,
                y: d.y,
                gridCell: String.fromCharCode(65 + Math.floor(d.x)) + (Math.floor(d.y) + 1)
            },
            target: d.tx !== undefined ? {
                x: d.tx,
                y: d.ty,
                gridCell: String.fromCharCode(65 + Math.floor(d.tx)) + (Math.floor(d.ty) + 1)
            } : null,
            mode: d.mode,
            battery: d.battery,
            isConnected: d.isConnected,
            isActive: d.mode !== 'Charging' || d.battery > 0,
            assignedRegion: null
        }));

        // Sync drone states
        await mcpClient.syncDroneStates(droneStates);

        // Sync tick and running state
        await mcpClient.syncTick(timeRef.current, running);

        // Sync full grid state on every MCP sync so orchestrator stats stay fresh
        // (20x20 grid is small enough; this prevents stale "0% scan progress" in AI chat)
        const gridState = grid.map(row => row.map(s => ({
            gridCell: String.fromCharCode(65 + s.x) + (s.y + 1),
            x: s.x,
            y: s.y,
            probability: s.prob,
            pheromone: s.pheromone,
            terrain: s.terrain,
            scanned: s.scanned,
            lastScannedTick: s.lastScanned,
            disasterImage: s.disasterImage,
            signals: s.signals
        })));
        await mcpClient.syncGridState(gridState);
    }, [mcpConnected, running]);

    // MCP Command Polling
    const processMcpCommands = useCallback(async () => {
        if (!mcpConnected) return;

        const commands = await mcpClient.getPendingCommands();
        for (const cmd of commands) {
            if (cmd.processed) continue;

            const drones = dronesRef.current;

            switch (cmd.type) {
                case 'SET_TARGET': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        drone.tx = cmd.params.targetX as number;
                        drone.ty = cmd.params.targetY as number;
                        addLog(`MCP: ${drone.id} target set to (${drone.tx}, ${drone.ty})`, 'info');
                    }
                    break;
                }
                case 'SET_MODE': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        const newMode = cmd.params.mode as Drone['mode'];
                        // MODE LOCK: Relay drones cannot be converted to search modes
                        if (drone.id.startsWith('RLY-')) {
                            if (newMode !== 'Relay' && newMode !== 'Charging') {
                                addLog(`MCP Override denied: Relay drone ${drone.id} mode lock prevents conversion to ${newMode}`, 'alert');
                                break;
                            }
                        }
                        drone.mode = newMode;
                        addLog(`MCP: ${drone.id} mode set to ${drone.mode}`, 'info');
                    }
                    break;
                }
                case 'RECALL_TO_BASE': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        drone.tx = BASE_STATION.x;
                        drone.ty = BASE_STATION.y;
                        addLog(`MCP: ${drone.id} recalled to base`, 'info');
                    }
                    break;
                }
                case 'KILL_DRONE': {
                    const droneIndex = drones.findIndex(d => d.id === cmd.params.droneId);
                    if (droneIndex >= 0) {
                        drones.splice(droneIndex, 1);
                        addLog(`MCP: ${cmd.params.droneId} killed`, 'alert');
                    }
                    break;
                }
                case 'RESET_MISSION': {
                    resetSim();
                    addLog('MCP: Mission reset', 'info');
                    break;
                }
                case 'SET_SIMULATION_STATE': {
                    const shouldRun = cmd.params.running as boolean;
                    setRunning(shouldRun);
                    addLog(`MCP: Simulation ${shouldRun ? 'started' : 'paused'} remotely`, 'info');
                    break;
                }
                case 'REPLACE_RELAY': {
                    const { oldRelayId, newRelayId, targetX, targetY } = cmd.params;
                    const oldRelay = drones.find(d => d.id === oldRelayId);
                    const newRelay = drones.find(d => d.id === newRelayId);
                    
                    if (oldRelay && newRelay) {
                        // 1. Activate backup
                        newRelay.mode = 'Relay';
                        newRelay.tx = targetX as number;
                        newRelay.ty = targetY as number;
                        
                        // 2. Recall old one
                        oldRelay.tx = BASE_STATION.x;
                        oldRelay.ty = BASE_STATION.y;
                        
                        addLog(`MCP: Atomic Relay Swap - ${newRelayId} deploying, ${oldRelayId} returning`, 'info');
                    }
                    break;
                }
                case 'SET_SURVIVOR_PIN': {
                    const sx = cmd.params.x as number;
                    const sy = cmd.params.y as number;
                    const sdroneId = cmd.params.droneId as string;
                    const smessage = (cmd.params.message as string) || 'Survivor confirmed by MCP';
                    const pinId = `MCP-${Date.now()}`;
                    // Avoid duplicate pins at same location
                    if (!pinsRef.current.find(p => p.x === sx && p.y === sy)) {
                        pinsRef.current.push({
                            id: pinId,
                            x: sx,
                            y: sy,
                            info: { message: smessage, battery: 'unknown' }
                        });
                        // Clear probability in surrounding area so drones stop targeting it
                        const grid = gridRef.current;
                        for (let py = Math.max(0, sy - 3); py <= Math.min(GRID_H - 1, sy + 3); py++) {
                            for (let px = Math.max(0, sx - 3); px <= Math.min(GRID_W - 1, sx + 3); px++) {
                                grid[py][px].pheromone = 0;
                                grid[py][px].prob = 0;
                            }
                        }
                        // Sync the new pin back to the server's found survivors list
                        mcpClient.syncSurvivor({ id: pinId, x: sx, y: sy, droneId: sdroneId, message: smessage, tick: timeRef.current });
                        addLog(`MCP: Survivor pin placed at (${sx}, ${sy}) by ${sdroneId}`, 'success');
                    }
                    break;
                }
                case 'SET_AUTO_RECALL': {
                    const targetDroneId = cmd.params.droneId as string;
                    const threshold = cmd.params.batteryThreshold as number;
                    autoRecallThresholdsRef.current.set(targetDroneId, threshold);
                    addLog(`MCP: Auto-recall threshold for ${targetDroneId} set to ${threshold}%`, 'info');
                    break;
                }
                case 'MOVE_RELAY': {
                    const relayId = cmd.params.relayId as string;
                    const x = cmd.params.x as number;
                    const y = cmd.params.y as number;
                    const drone = drones.find(d => d.id === relayId);
                    if (drone && drone.mode === 'Relay') {
                        drone.tx = x;
                        drone.ty = y;
                        addLog(`MCP: Relay ${relayId} moving to (${x}, ${y})`, 'info');
                    }
                    break;
                }
                case 'BROADCAST_SWARM': {
                    const command = cmd.params.command as string;
                    const reachableDrones = cmd.params.reachableDrones as string[] || [];
                    addLog(`MCP: Swarm Broadcast [${command}] received for ${reachableDrones.length} drones`, 'info');
                    
                    if (command === 'RTB_ALL') {
                        reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Relay') {
                                d.tx = BASE_STATION.x;
                                d.ty = BASE_STATION.y;
                            }
                        });
                    } else if (command === 'MICRO_SCAN' && cmd.params.targetArea) {
                        const { x, y, radius } = cmd.params.targetArea as any;
                        reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Relay' && d.mode !== 'Charging') {
                                const dist = Math.sqrt(Math.pow(d.x - x, 2) + Math.pow(d.y - y, 2));
                                if (dist <= radius) {
                                    d.mode = 'Micro';
                                    d.tx = x;
                                    d.ty = y;
                                }
                            }
                        });
                    } else if (command === 'RECRUIT' && cmd.params.targetArea) {
                         const { x, y } = cmd.params.targetArea as any;
                         reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Charging' && d.mode !== 'Relay') {
                                d.tx = x;
                                d.ty = y;
                            }
                        });
                    }
                    break;
                }
            }

            await mcpClient.acknowledgeCommand(cmd.id);
        }
    }, [mcpConnected]);

    const toggleRunning = useCallback(async () => {
        const nextRunning = !running;
        setRunning(nextRunning);

        // Push running-state change immediately so external orchestrators
        // can react without waiting for periodic MCP sync.
        if (mcpConnected) {
            await mcpClient.syncTick(timeRef.current, nextRunning);
        }
    }, [running, mcpConnected]);

    // If OSM terrain loads after this page, refresh the grid automatically
    useEffect(() => {
        if (gridDataService.isTerrainReady()) {
            // Already loaded — refresh grid right away
            const newSurvivors = createSurvivors();
            const newGrid = createGrid(newSurvivors);
            gridRef.current = newGrid;
            survivorsRef.current = newSurvivors;
            setTickFlip(f => f + 1);
        } else {
            gridDataService.onTerrainReady(() => {
                const newSurvivors = createSurvivors();
                const newGrid = createGrid(newSurvivors);
                gridRef.current = newGrid;
                survivorsRef.current = newSurvivors;
                setTickFlip(f => f + 1);
            });
        }
    }, []);

    const addLog = (msg: string, type: 'alert' | 'info' | 'success') => {
        logsRef.current.unshift({ time: timeRef.current, msg, type });
        if (logsRef.current.length > 20) logsRef.current.pop();
    };

    const resetSim = () => {
        setRunning(false);
        gridDataService.releaseSource(); // allow prediction to write again after full reset
        const newSurvivors = createSurvivors();
        const newGrid = createGrid(newSurvivors);
        gridRef.current = newGrid;
        dronesRef.current = createDrones();
        survivorsRef.current = newSurvivors;
        pinsRef.current = [];
        commLinksRef.current = [];
        swarmMessagesRef.current = [];
        sensorWeightsRef.current = JSON.parse(JSON.stringify(INITIAL_SENSORS));
        gridDataService.setSensorWeights(sensorWeightsRef.current);
        logsRef.current = [];
        timeRef.current = 0;
        // Reset zone planning state
        zonesRef.current = [];
        searchMemoryRef.current = createSearchMemory();
        activeMissionsRef.current = [];
        metricsRef.current = {
            repeatedScanRate: 0, averageZoneCoverage: 0, droneIdleTime: 0,
            meanProbabilityScanned: 0, totalScans: 0, totalRepeatScans: 0, scannedProbSum: 0,
        };
        setSelectedPin(null);
        setTickFlip(f => f + 1);
    };

    const getEffectiveWeight = (key: keyof typeof INITIAL_SENSORS) => {
        const w = sensorWeightsRef.current[key];
        return w.base * w.conf;
    };

    const getSectorProbability = (x: number, y: number) => {
        const sector = gridRef.current[y][x];
        const signals = sector.signals;

        const score = (getEffectiveWeight('mobile') * signals.mobile) +
            (getEffectiveWeight('wifi') * signals.wifi) +
            (getEffectiveWeight('thermal') * signals.thermal) +
            (getEffectiveWeight('sound') * signals.sound);

        const sumWeights = getEffectiveWeight('mobile') + getEffectiveWeight('wifi') + getEffectiveWeight('thermal') + getEffectiveWeight('sound');
        return score / sumWeights;
    };

    const performTick = useCallback(() => {
        timeRef.current++;
        const grid = gridRef.current;
        const drones = dronesRef.current;
        const survivors = survivorsRef.current;
        const messages = swarmMessagesRef.current;

        if (messages.length > 5) swarmMessagesRef.current = messages.slice(messages.length - 5);

        const addMessage = (droneId: string, type: 'HIGH_SIGNAL' | 'REQUEST_ASSIST' | 'MAP_SHARE', payload: Record<string, unknown>) => {
            swarmMessagesRef.current.push({
                id: Math.random().toString(36).substring(2, 9),
                sender: droneId,
                time: timeRef.current,
                type,
                payload
            });
        };

        // 1. Prediction / Markov Chain: (Disabled) Hidden survivors no longer move per USER request
        /*
        if (timeRef.current % 50 === 0) {
            survivors.forEach(s => {
                if (s.found) return;
                const r = Math.random();
                if (r < 0.1) {
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    const validDirs = dirs.filter(d => s.x + d[0] >= 0 && s.x + d[0] < GRID_W && s.y + d[1] >= 0 && s.y + d[1] < GRID_H);
                    if (validDirs.length > 0) {
                        const move = validDirs[Math.floor(Math.random() * validDirs.length)];
                        s.x += move[0];
                        s.y += move[1];
                    }
                }
            });
        }
        */

        // 1.5a Mesh Network Position Broadcast (for collision avoidance)
        const COMMS_RANGE = 8;
        if (timeRef.current % 5 === 0) {
            drones.forEach(broadcaster => {
                drones.forEach(receiver => {
                    if (broadcaster.id !== receiver.id) {
                        const distToOther = Math.sqrt(Math.pow(broadcaster.x - receiver.x, 2) + Math.pow(broadcaster.y - receiver.y, 2));
                        if (distToOther <= COMMS_RANGE || broadcaster.mode === 'Relay' || receiver.mode === 'Relay') {
                            receiver.knownOtherDrones[broadcaster.id] = {
                                x: broadcaster.x,
                                y: broadcaster.y,
                                lastUpdate: timeRef.current
                            };
                        }
                    }
                });
            });
        }

        // 1.5b Communication Mesh Graph & BFS (for relay / data sync)
        const nodes = [{ id: BASE_STATION.id, x: BASE_STATION.x, y: BASE_STATION.y, isConnected: true }, ...drones];
        const adj = new Map<string, string[]>();
        nodes.forEach(n => adj.set(n.id, []));

        commLinksRef.current = [];

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const n1 = nodes[i];
                const n2 = nodes[j];
                const dist = Math.sqrt(Math.pow(n1.x - n2.x, 2) + Math.pow(n1.y - n2.y, 2));

                let range1 = COMM_RANGE_DRONE;
                if (n1.id === BASE_STATION.id) range1 = COMM_RANGE_BASE;
                else if ((n1 as Drone).mode === 'Relay') range1 = COMM_RANGE_RELAY;

                let range2 = COMM_RANGE_DRONE;
                if (n2.id === BASE_STATION.id) range2 = COMM_RANGE_BASE;
                else if ((n2 as Drone).mode === 'Relay') range2 = COMM_RANGE_RELAY;

                if (dist <= Math.max(range1, range2)) {
                    adj.get(n1.id)!.push(n2.id);
                    adj.get(n2.id)!.push(n1.id);
                    commLinksRef.current.push({ source: n1.id, target: n2.id, active: false });
                }
            }
        }

        const visited = new Set<string>();
        const queue = [BASE_STATION.id];
        const parent = new Map<string, string>();
        visited.add(BASE_STATION.id);

        while (queue.length > 0) {
            const curr = queue.shift()!;
            const neighbors = adj.get(curr)!;
            for (const nxt of neighbors) {
                if (!visited.has(nxt)) {
                    visited.add(nxt);
                    queue.push(nxt);
                    parent.set(nxt, curr);
                }
            }
        }

        let disconnectedCount = 0;
        drones.forEach(d => {
            d.isConnected = visited.has(d.id);
            if (!d.isConnected && d.mode !== 'Relay') disconnectedCount++;
        });

        // Smart Relay Coverage Maximization (Reactive Centroid)
        // Only apply this to the ACTIVE relay (the one not currently returning to base or charging)
        const activeRelay = drones.find(d => d.mode === 'Relay' && (d.tx !== BASE_STATION.x || d.ty !== BASE_STATION.y));
        if (activeRelay && disconnectedCount > 0) {
            const disconnected = drones.filter(d => !d.isConnected && d.mode !== 'Relay' && d.mode !== 'Charging');
            if (disconnected.length > 0) {
                let cx = 0, cy = 0;
                disconnected.forEach(d => { cx += d.x; cy += d.y; });
                cx /= disconnected.length;
                cy /= disconnected.length;
                activeRelay.tx = (cx + BASE_STATION.x) / 2;
                activeRelay.ty = (cy + BASE_STATION.y) / 2;
            }
        } else if (activeRelay && disconnectedCount === 0) {
            // Default active relay to center of map when everyone is connected
            activeRelay.tx = GRID_W / 2;
            activeRelay.ty = GRID_H / 2;
        }

        if (Math.random() < 0.2 && drones.length > 0) {
            const connected = drones.filter(d => d.isConnected);
            if (connected.length > 0) {
                const sender = connected[Math.floor(Math.random() * connected.length)];
                let curr = sender.id;
                while (curr !== BASE_STATION.id && parent.has(curr)) {
                    const p = parent.get(curr)!;
                    const edge = commLinksRef.current.find(e => (e.source === curr && e.target === p) || (e.source === p && e.target === curr));
                    if (edge) edge.active = true;
                    curr = p;
                }
            }
        }

        // 2. Drone Logic
        const BASE_X = BASE_STATION.x;
        const BASE_Y = BASE_STATION.y;

        drones.forEach(d => {
            // --- Staggered Departure Gate ---
            if (d.startTick !== undefined && timeRef.current < d.startTick) return;

            // --- Charging Logic ---
            if (d.mode === 'Charging') {
                d.battery = Math.min(100, d.battery + 0.5);
                if (d.battery >= 100) {
                    if (d.id.startsWith('RLY')) {
                        return; // Relay drones just wait here until AI commands replace_relay
                    }

                    d.battery = 100;
                    d.mode = 'Wide';

                    // Post-Charge Targeting: check for unassigned hotspots first
                    let newTarget: { x: number, y: number } | null = null;
                    const highProbSectors: Sector[] = [];
                    grid.forEach(row => row.forEach(sec => {
                        if (sec.scanned && sec.prob > THRESHOLD_MICRO) highProbSectors.push(sec);
                    }));

                    for (const sec of highProbSectors) {
                        const isOccupied = drones.some(other => other.id !== d.id && Math.round(other.tx) === sec.x && Math.round(other.ty) === sec.y);
                        if (!isOccupied) {
                            newTarget = { x: sec.x, y: sec.y };
                            break;
                        }
                    }

                    if (newTarget) {
                        d.tx = newTarget.x;
                        d.ty = newTarget.y;
                        d.mode = 'Micro';
                        addLog(`${d.id} fully charged. Intercepting unassigned hotspot.`, 'info');
                    } else if (d.savedTx !== undefined && d.savedTy !== undefined) {
                        d.tx = d.savedTx;
                        d.ty = d.savedTy;
                        addLog(`${d.id} fully charged. Resuming previous task.`, 'info');
                    } else {
                        // Zone-aware fallback: find highest-scoring zone instead of random
                        let assigned = false;
                        if (zonesRef.current.length > 0) {
                            const availZone = zonesRef.current.find(z =>
                                z.unscannedCount > 0 && z.assignedDroneIds.length < 2
                            );
                            if (availZone) {
                                d.tx = availZone.centroid.x;
                                d.ty = availZone.centroid.y;
                                addLog(`${d.id} fully charged. Assigned to zone ${availZone.zoneId} (score=${availZone.zoneScore.toFixed(2)}).`, 'info');
                                assigned = true;
                            }
                        }

                        if (!assigned) {
                            // Legacy fallback: find highest prob unscanned cell
                            let bestSector: Sector | null = null;
                            let maxProb = -1;
                            grid.forEach(row => row.forEach(sec => {
                                if (!sec.scanned && sec.prob > maxProb) {
                                    const isOccupied = drones.some(other => other.id !== d.id && Math.round(other.tx) === sec.x && Math.round(other.ty) === sec.y);
                                    if (!isOccupied) {
                                        maxProb = sec.prob;
                                        bestSector = sec;
                                    }
                                }
                            }));

                            if (bestSector !== null) {
                                d.tx = (bestSector as Sector).x;
                                d.ty = (bestSector as Sector).y;
                                addLog(`${d.id} fully charged. Assigned highest probability search block.`, 'info');
                            } else {
                                // Last resort: grid center instead of purely random
                                d.tx = Math.floor(GRID_W / 2);
                                d.ty = Math.floor(GRID_H / 2);
                                addLog(`${d.id} fully charged. No targets available, returning to center.`, 'info');
                            }
                        }
                    }

                    d.savedTx = undefined;
                    d.savedTy = undefined;
                }
                return; // Can't move while charging
            }

            if (d.mode === 'Relay') {
                d.battery = Math.max(0, d.battery - 0.035); // Accelerated battery drain to demonstrate handoff mechanism
                // Move relay toward its assigned target position
                const relayDistToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));
                
                if (relayDistToTarget < 0.3 && d.tx === BASE_X && d.ty === BASE_Y) {
                    d.mode = 'Charging';
                    addLog(`${d.id} docked at Base. Charging...`, 'info');
                    return;
                }
                
                if (relayDistToTarget >= 0.3) {
                    const relaySpeed = 0.3;
                    const relayAngle = Math.atan2(d.ty - d.y, d.tx - d.x);
                    d.x += Math.cos(relayAngle) * Math.min(relaySpeed, relayDistToTarget);
                    d.y += Math.sin(relayAngle) * Math.min(relaySpeed, relayDistToTarget);
                    d.x = Math.max(0, Math.min(GRID_W - 1, d.x));
                    d.y = Math.max(0, Math.min(GRID_H - 1, d.y));
                }
                return;
            }

            // --- MCP Auto-Recall Policy (checked BEFORE movement to prevent overshoot) ---
            const mcpRecallThreshold = autoRecallThresholdsRef.current.get(d.id);
            if (mcpRecallThreshold !== undefined && d.battery <= mcpRecallThreshold) {
                if (d.tx !== BASE_STATION.x || d.ty !== BASE_STATION.y) {
                    if (d.savedTx === undefined) {
                        d.savedTx = d.tx;
                        d.savedTy = d.ty;
                    }
                    d.tx = BASE_STATION.x;
                    d.ty = BASE_STATION.y;
                    addLog(`${d.id} MCP auto-recall triggered at ${Math.floor(d.battery)}% (threshold: ${mcpRecallThreshold}%)`, 'alert');
                }
            }

            // --- Battery & RTB Logic ---
            const distToBase = Math.sqrt(Math.pow(BASE_X - d.x, 2) + Math.pow(BASE_Y - d.y, 2));
            const batteryReqForReturn = distToBase * 0.3;
            const criticalBattery = Math.max(5, batteryReqForReturn + 2); // Critical: distance-based + 2% safety
            const lowBattery = Math.max(20, criticalBattery + 15);        // Low: ~15-20% above critical
            const distTargetToBase = Math.sqrt(Math.pow(BASE_X - d.tx, 2) + Math.pow(BASE_Y - d.ty, 2));

            // --- Hotspot Handover ---
            if (d.battery < lowBattery && d.tx !== BASE_X && d.ty !== BASE_Y) {
                const mySectorX = Math.max(0, Math.min(GRID_W - 1, Math.round(d.tx)));
                const mySectorY = Math.max(0, Math.min(GRID_H - 1, Math.round(d.ty)));
                const myProb = grid[mySectorY][mySectorX].prob;

                if ((d.mode === 'Micro' || myProb > THRESHOLD_MICRO) && d.savedTx === undefined) {
                    let swapDrone: Drone | null = null;
                    let minDist = Infinity;
                    for (const other of drones) {
                        const otherDistToBase = Math.sqrt(Math.pow(BASE_X - other.x, 2) + Math.pow(BASE_Y - other.y, 2));
                        const otherLowBatteryThreshold = Math.max(20, Math.max(5, otherDistToBase * 0.3 + 2) + 15);

                        if (other.id !== d.id && other.mode === 'Wide' && other.battery > otherLowBatteryThreshold) {
                            const otherSectorX = Math.max(0, Math.min(GRID_W - 1, Math.round(other.tx)));
                            const otherSectorY = Math.max(0, Math.min(GRID_H - 1, Math.round(other.ty)));
                            const otherProb = grid[otherSectorY][otherSectorX].prob;
                            if (myProb > otherProb) {
                                const dist = Math.sqrt(Math.pow(other.x - d.x, 2) + Math.pow(other.y - d.y, 2));
                                if (dist < minDist) {
                                    minDist = dist;
                                    swapDrone = other;
                                }
                            }
                        }
                    }

                    if (swapDrone) {
                        d.savedTx = (swapDrone as Drone).tx;
                        d.savedTy = (swapDrone as Drone).ty;
                        addLog(`${d.id} low power. Handing over hotspot to ${(swapDrone as Drone).id}.`, 'alert');
                        if (d.isConnected) addMessage(d.id, 'REQUEST_ASSIST', { handoverTo: (swapDrone as Drone).id });

                        (swapDrone as Drone).tx = d.tx;
                        (swapDrone as Drone).ty = d.ty;
                        (swapDrone as Drone).mode = d.mode;

                        d.mode = 'Wide';
                    }
                }
            }

            // --- Critical RTB ---
            if (d.battery < criticalBattery && d.tx !== BASE_X && d.ty !== BASE_Y) {
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }
                d.tx = BASE_X;
                d.ty = BASE_Y;
                addLog(`${d.id} adaptive RTB initiated (${Math.floor(d.battery)}%).`, 'alert');
            }
            // --- Low Battery Patrol: stay within 4-tile radius of base ---
            else if (d.battery < lowBattery && d.battery >= criticalBattery && distTargetToBase > 4 && d.mode === 'Wide') {
                let bestX = BASE_X; let bestY = BASE_Y;
                let found = false;
                for (let r = 1; r <= 4; r++) {
                    for (let i = 0; i < 20; i++) {
                        const testX = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + (Math.random() - 0.5) * r * 2)));
                        const testY = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + (Math.random() - 0.5) * r * 2)));
                        const distToNewTarget = Math.sqrt(Math.pow(BASE_X - testX, 2) + Math.pow(BASE_Y - testY, 2));
                        if (distToNewTarget <= 4 && !grid[testY][testX].scanned) {
                            bestX = testX; bestY = testY; found = true; break;
                        }
                    }
                    if (found) break;
                }
                if (!found) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = Math.random() * 4;
                    bestX = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + Math.cos(angle) * r)));
                    bestY = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + Math.sin(angle) * r)));
                }
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }
                d.tx = bestX;
                d.ty = bestY;
                addLog(`${d.id} low battery (${Math.floor(d.battery)}%). Reassigning near base.`, 'info');
            }

            // Check if we reached target
            const distToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));

            if (distToTarget < 0.3) {
                // Dock at base if returning
                if (d.tx === BASE_X && d.ty === BASE_Y && d.battery <= 50) {
                    d.mode = 'Charging';
                    addLog(`${d.id} docked at Base. Charging...`, 'info');
                    return;
                }

                // At target! Scan and assign new
                const sx = Math.round(d.tx);
                const sy = Math.round(d.ty);
                const sector = grid[sy][sx];

                sector.scanned = true;
                sector.lastScanned = timeRef.current;
                // Add realistic temporal jitter (+/- 2%) to simulate environmental noise
                const jitter = (Math.random() * 0.04) - 0.02; 
                const newProb = Math.max(0, Math.min(1.0, getSectorProbability(sx, sy) + jitter));

                // Record scan in zone memory
                const zone = getZoneForCell(zonesRef.current, sx, sy);
                if (zone) {
                    recordCellScan(
                        searchMemoryRef.current, zone.zoneId,
                        sx, sy, timeRef.current, newProb > THRESHOLD_MICRO
                    );
                }
                // Update metrics
                metricsRef.current.totalScans = searchMemoryRef.current.totalScans;
                metricsRef.current.totalRepeatScans = searchMemoryRef.current.repeatScans;
                metricsRef.current.repeatedScanRate = getRepeatScanRate(searchMemoryRef.current);
                metricsRef.current.scannedProbSum += newProb;
                metricsRef.current.meanProbabilityScanned = metricsRef.current.totalScans > 0
                    ? metricsRef.current.scannedProbSum / metricsRef.current.totalScans : 0;

                const oldProb = sector.prob;
                sector.prob = newProb;
                if (newProb > oldProb) {
                    sector.pheromone += newProb;
                }

                if (d.mode === 'Wide') {
                    if (newProb > THRESHOLD_MICRO && d.battery >= lowBattery && !d.id.startsWith('RLY-')) {
                        d.mode = 'Micro';
                        if (d.isConnected) addMessage(d.id, 'REQUEST_ASSIST', { sector: `[${sx},${sy}]` });
                    } else {
                        // Zone-aware + probability-based next-cell selection (no randomness)
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        let options = dirs
                            .map(dir => ({ x: sx + dir[0], y: sy + dir[1] }))
                            .filter(pos => pos.x >= 0 && pos.x < GRID_W && pos.y >= 0 && pos.y < GRID_H);

                        // Avoid cells targeted by other drones
                        const filtered = options.filter(opt => {
                            return !drones.some(other => other.id !== d.id && Math.round(other.tx) === opt.x && Math.round(other.ty) === opt.y);
                        });
                        if (filtered.length > 0) options = filtered;

                        // Deterministic scoring: unscanned bonus + probability + pheromone (no random)
                        options.sort((a, b) => {
                            const cellA = grid[a.y][a.x];
                            const cellB = grid[b.y][b.x];
                            const unscannedBonusA = cellA.scanned ? 0 : 0.5;
                            const unscannedBonusB = cellB.scanned ? 0 : 0.5;
                            const scoreA = cellA.prob + unscannedBonusA + (cellA.pheromone * 0.1);
                            const scoreB = cellB.prob + unscannedBonusB + (cellB.pheromone * 0.1);
                            return scoreB - scoreA;
                        });

                        if (options.length > 0) {
                            d.tx = options[0].x;
                            d.ty = options[0].y;
                        } else if (zonesRef.current.length > 0) {
                            // Fallback: go to nearest high-scoring zone centroid
                            const availZone = zonesRef.current.find(z =>
                                z.unscannedCount > 0 && z.assignedDroneIds.length < 2
                            );
                            if (availZone) {
                                d.tx = availZone.centroid.x;
                                d.ty = availZone.centroid.y;
                            }
                        }
                    }
                }

                // --- Discovery Condition (Robust Check) ---
                // Trigger discovery in ANY mode if the threshold is met and a survivor is at this location
                if (newProb >= THRESHOLD_FOUND) {
                    const s = survivors.find(s => s.x === sx && s.y === sy && !s.found);
                    if (s) {
                        s.found = true;
                        // Avoid drones immediately targeting the same spot
                        for (let py = Math.max(0, sy - 3); py <= Math.min(GRID_H - 1, sy + 3); py++) {
                            for (let px = Math.max(0, sx - 3); px <= Math.min(GRID_W - 1, sx + 3); px++) {
                                grid[py][px].pheromone = 0;
                                grid[py][px].prob = 0;
                            }
                        }

                        d.memory.push(s.id);

                        // Adaptive Learning: increase sensor confidence
                        const weights = sensorWeightsRef.current;
                        (Object.keys(weights) as Array<keyof typeof INITIAL_SENSORS>).forEach(k => {
                            weights[k].conf = Math.min(1.0, weights[k].conf + 0.04);
                        });
                        gridDataService.setSensorWeights({ ...weights });

                        if (d.isConnected) addMessage(d.id, 'HIGH_SIGNAL', { survivorId: s.id });

                        if (!pinsRef.current.find(p => p.id === s.id)) {
                            pinsRef.current.push({ id: s.id, x: sx, y: sy, info: s.info });
                            addLog(`${d.id} confirmed Survivor ${s.id} at [${sx},${sy}]`, 'success');
                        }

                        d.mode = 'Wide';
                        // Redeploy
                        d.tx = Math.floor(GRID_W / 2);
                        d.ty = Math.floor(GRID_H / 2);
                    }
                }

                if (d.mode === 'Micro') {

                    // Abort Micro if signal drops or battery is low
                    if (d.mode === 'Micro' && (newProb < THRESHOLD_MICRO || d.battery < lowBattery)) {
                        d.mode = 'Wide';
                    }

                    // Micro moves to adjacent high-prob cells (including staying put if at peak)
                    if (d.mode === 'Micro') {
                        const dirs = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];

                        let validDirs = dirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H;
                        });

                        const filteredDirs = validDirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return !drones.some(other => other.id !== d.id && other.mode === 'Micro' && Math.round(other.tx) === nx && Math.round(other.ty) === ny);
                        });
                        if (filteredDirs.length > 0) validDirs = filteredDirs;

                        validDirs.sort((a, b) => {
                            const probA = grid[sy + a[1]][sx + a[0]].prob;
                            const probB = grid[sy + b[1]][sx + b[0]].prob;
                            return probB - probA;
                        });

                        if (validDirs.length > 0) {
                            // Always pick the highest-probability adjacent cell (deterministic)
                            const move = validDirs[0];
                            d.tx = sx + move[0];
                            d.ty = sy + move[1];
                        }
                    }
                }
            } else {
                // Move towards target with collision avoidance
                const moveSpeed = d.mode === 'Wide' ? 0.4 : 0.1;
                let totalMove = Math.min(moveSpeed, distToTarget);
                let angle = Math.atan2(d.ty - d.y, d.tx - d.x);

                // Separation Force (Collision Avoidance based on mesh network knowledge)
                const SEPARATION_DIST = d.mode === 'Wide' ? 3.0 : 2.0;
                let sepX = 0;
                let sepY = 0;
                let neighborCount = 0;

                Object.entries(d.knownOtherDrones).forEach(([id, knownPos]) => {
                    if (id !== d.id && (timeRef.current - knownPos.lastUpdate) < 20) {
                        const distToOther = Math.sqrt(Math.pow(knownPos.x - d.x, 2) + Math.pow(knownPos.y - d.y, 2));
                        if (distToOther < SEPARATION_DIST && distToOther > 0.01) {
                            let pushStrength = (SEPARATION_DIST - distToOther);
                            if (distToOther < 1.0) pushStrength *= 4.0;
                            else pushStrength *= 2.0;

                            sepX += (d.x - knownPos.x) / distToOther * pushStrength;
                            sepY += (d.y - knownPos.y) / distToOther * pushStrength;
                            neighborCount++;
                        }
                    }
                });

                if (neighborCount > 0) {
                    sepX /= neighborCount;
                    sepY /= neighborCount;

                    const targetDx = Math.cos(angle) * moveSpeed;
                    const targetDy = Math.sin(angle) * moveSpeed;

                    const sepMag = Math.sqrt(sepX * sepX + sepY * sepY);
                    if (sepMag > 0) {
                        const damp = Math.min(1, Math.max(0, (distToTarget - 0.3) / 1.2));
                        const maxSep = moveSpeed * damp * 0.9;
                        sepX = (sepX / sepMag) * maxSep;
                        sepY = (sepY / sepMag) * maxSep;
                    }

                    const finalDx = targetDx + sepX;
                    const finalDy = targetDy + sepY;
                    angle = Math.atan2(finalDy, finalDx);
                    totalMove = Math.min(moveSpeed, Math.sqrt(finalDx * finalDx + finalDy * finalDy));
                }

                d.x += Math.cos(angle) * totalMove;
                d.y += Math.sin(angle) * totalMove;

                // Keep inside bounds
                d.x = Math.max(0, Math.min(GRID_W - 1, d.x));
                d.y = Math.max(0, Math.min(GRID_H - 1, d.y));

                // Battery drain: movement + sensor usage
                // Battery drain: movement + sensor usage
                const sensorDrain = d.mode === 'Wide' ? 0.015 : 0.005;
                
                const movementDrain = totalMove * 0.075;
                d.battery -= (sensorDrain + movementDrain);
            }
        });

        // Data Sync (Reporting to Base Station)
        drones.forEach(d => {
            if (d.isConnected && d.memory.length > 0) {
                d.memory.forEach(sId => {
                    if (!pinsRef.current.find(p => p.id === sId)) {
                        const s = survivors.find(sup => sup.id === sId);
                        if (s) {
                            pinsRef.current.push({ id: s.id, x: s.x, y: s.y, info: s.info });
                            let curr = d.id;
                            while (curr && curr !== BASE_STATION.id && parent.has(curr)) {
                                const p = parent.get(curr)!;
                                const edge = commLinksRef.current.find(e => (e.source === curr && e.target === p) || (e.source === p && e.target === curr));
                                if (edge) edge.active = true;
                                curr = p;
                            }
                        }
                    }
                });
                d.memory = [];
            }
        });

        // Map share heartbeat
        if (timeRef.current > 0 && timeRef.current % 100 === 0) {
            const connected = drones.filter(d => d.isConnected && d.mode !== 'Relay');
            if (connected.length > 0) {
                addMessage(connected[Math.floor(Math.random() * connected.length)].id, 'MAP_SHARE', { bytes: 1420 });
            }
        }

        // 3. ZONE PIPELINE (replaces old Global Swarm Planner)
        if (timeRef.current % ZONE_PIPELINE_INTERVAL === 0 && timeRef.current > 0) {
            // Convert grid to GridCell format for zone clustering
            const gridCells: GridCell[][] = grid.map(row =>
                row.map(sec => ({
                    x: sec.x,
                    y: sec.y,
                    prob: sec.prob,
                    scanned: sec.scanned,
                    lastScanned: sec.lastScanned,
                    signals: sec.signals,
                }))
            );

            // Step 1: Cluster
            const zones = clusterZones(gridCells, GRID_W, GRID_H, 4);

            // Step 2: Score
            const scoredZones = scoreZones(zones, searchMemoryRef.current, timeRef.current);
            zonesRef.current = scoredZones;

            // Step 3: Allocate drones to zones
            const allocatable = drones
                .filter(d => d.mode !== 'Relay' && d.mode !== 'Charging')
                .map(d => ({ id: d.id, x: d.x, y: d.y, battery: d.battery, mode: d.mode }));

            const missions = allocateDrones(allocatable, scoredZones, searchMemoryRef.current);
            activeMissionsRef.current = missions;

            // Step 4: Apply missions to drones
            for (const mission of missions) {
                const drone = drones.find(d => d.id === mission.droneId);
                if (!drone) continue;

                // Skip if drone is currently returning to base (low battery)
                const distToBase = Math.sqrt(Math.pow(BASE_STATION.x - drone.x, 2) + Math.pow(BASE_STATION.y - drone.y, 2));
                const criticalBattery = Math.max(5, distToBase * 0.3 + 2);
                const lowBattery = Math.max(20, criticalBattery + 15);
                if (drone.battery < lowBattery) continue;

                const distToTarget = Math.sqrt(Math.pow(drone.tx - drone.x, 2) + Math.pow(drone.ty - drone.y, 2));
                const isIdle = distToTarget < 0.5;
                const isWideExploring = drone.mode === 'Wide';

                if (isIdle || isWideExploring) {
                    drone.tx = mission.targetX;
                    drone.ty = mission.targetY;
                    if (mission.action === 'micro_scan' && drone.mode !== 'Micro') {
                        drone.mode = 'Micro';
                    }
                    addLog(`[Zone] ${drone.id} -> ${mission.zoneId} (${mission.action})`, 'info');
                }
            }

            // Update zone coverage metric
            const scannedZoneCount = scoredZones.filter(z => z.unscannedCount < z.totalCells).length;
            metricsRef.current.averageZoneCoverage = scoredZones.length > 0
                ? (scannedZoneCount / scoredZones.length) * 100 : 0;
        }

        // Evaporate pheromones slowly
        grid.forEach(row => row.forEach(sec => {
            if (sec.pheromone > 0) sec.pheromone *= 0.99;
        }));

        // Sync scanned grid probabilities → gridDataService so other pages receive live updates
        // Only overwrite cells that have actually been scanned; keep prediction values for the rest
        if (timeRef.current % 5 === 0) {
            const existing = gridDataService.getWeights();
            const weightGrid: number[][] = Array.from({ length: GRID_H }, (_, y) =>
                Array.from({ length: GRID_W }, (_, x) =>
                    grid[y][x].scanned ? grid[y][x].prob : (existing[y]?.[x] ?? 0.05)
                )
            );
            gridDataService.setWeights(weightGrid, 'scan');
        }

        // MCP Sync: Send state to MCP server every MCP_SYNC_INTERVAL ticks
        if (timeRef.current % MCP_SYNC_INTERVAL === 0) {
            syncToMcp();
        }

        // MCP Commands: Process pending commands every 5 ticks
        if (timeRef.current % 5 === 0) {
            processMcpCommands();
        }

        setTickFlip(f => f + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncToMcp, processMcpCommands]);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (running) {
            gridDataService.claimSource('scan');
            interval = setInterval(performTick, 100 / speed);
        }
        // Don't release source on pause — scan data should persist on the tactical map.
        // Source is only released on full reset (resetSim).
        return () => clearInterval(interval);
    }, [running, speed, performTick]);

    // Initial sync on connection
    useEffect(() => {
        if (mcpConnected) {
            syncToMcp(true); // Force sync skip connection check to be safe
            addLog('MCP: Link established - Initial state synced', 'info');
        }
    }, [mcpConnected, syncToMcp]);

    // Background State Sync (works even when simulation is paused)
    useEffect(() => {
        if (!mcpConnected) return;

        const syncInterval = setInterval(() => {
            // Only sync if not already handled by performTick
            if (!running) {
                syncToMcp();
            }
        }, 5000); // Sync every 5 seconds when paused

        return () => clearInterval(syncInterval);
    }, [mcpConnected, running, syncToMcp]);

    // MCP Command Polling (works even when simulation is paused)
    useEffect(() => {
        if (!mcpConnected) return;

        const pollInterval = setInterval(() => {
            processMcpCommands();
        }, 500); // Poll every 500ms

        return () => clearInterval(pollInterval);
    }, [mcpConnected, processMcpCommands]);

    // Trigger one immediate AI decision when simulation starts
    useEffect(() => {
        if (!mcpConnected || !running) return;
        if (aiBusyRef.current) return;

        aiLastRunRef.current = Date.now();
        runThinkNow();
    }, [mcpConnected, running, runThinkNow]);

    // Always-on auto decision loop (terminal-like behavior)
    useEffect(() => {
        if (!mcpConnected || !running) return;

        const interval = setInterval(() => {
            const now = Date.now();
            if (now - aiLastRunRef.current < AI_DECISION_INTERVAL_MS) return;
            aiLastRunRef.current = now;
            runThinkNow();
        }, AI_DECISION_POLL_MS);

        return () => clearInterval(interval);
    }, [mcpConnected, running, runThinkNow]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px', color: 'var(--text-primary)' }}>
            <header style={{ padding: '16px', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Hexagon /> MULTI-RES SWARM SIMULATION
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; ADAPTIVE SEARCH & SURVIVOR DETECTION</p>
                </div>

                <div style={{ display: 'flex', gap: '12px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <button onClick={toggleRunning} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        {running ? <Pause size={18} /> : <Play size={18} />} {running ? 'PAUSE' : 'START SCAN'}
                    </button>
                    <button onClick={() => setSpeed(s => s === 1 ? 5 : 1)} className={`hud-btn ${speed > 1 ? 'glow-text' : ''}`} style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer', borderColor: speed > 1 ? 'var(--accent-primary)' : '' }}>
                        <FastForward size={18} /> x{speed}
                    </button>
                    <button onClick={() => setShowSensors(!showSensors)} className={`hud-btn ${showSensors ? 'glow-text' : ''}`} style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer', borderColor: showSensors ? 'var(--accent-primary)' : '' }}>
                        <Activity size={18} /> {showSensors ? 'SENSORS' : 'SENSORS'}
                    </button>
                    <button onClick={resetSim} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        <RotateCcw size={18} /> RESET
                    </button>
                    <button
                        onClick={() => setMcpPanelOpen(!mcpPanelOpen)}
                        className={`hud-btn ${mcpPanelOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '8px 16px',
                            display: 'flex',
                            gap: '8px',
                            cursor: 'pointer',
                            borderColor: mcpPanelOpen ? 'var(--accent-primary)' : '',
                            marginLeft: '8px'
                        }}
                    >
                        {mcpConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
                        MCP {mcpConnected ? 'ONLINE' : 'OFFLINE'}
                    </button>
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`hud-btn ${chatOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '8px 16px',
                            display: 'flex',
                            gap: '8px',
                            cursor: 'pointer',
                            borderColor: chatOpen ? 'var(--accent-primary)' : ''
                        }}
                    >
                        <MessageSquare size={18} /> AI CHAT
                    </button>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '12px', margin: '0 12px 12px 12px' }}>
                {/* Main Simulator Map */}
                <div className="hud-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

                    <svg width={GRID_W * CELL_SIZE} height={GRID_H * CELL_SIZE} style={{ border: '1px dashed rgba(0,255,204,0.2)', backgroundColor: '#050a10' }}>
                        {/* Grid & Heatmap */}
                        {gridRef.current.map((row, y) =>
                            row.map((cell, x) => (
                                <React.Fragment key={`cell-group-${x}-${y}`}>
                                    <rect
                                        x={x * CELL_SIZE}
                                        y={y * CELL_SIZE}
                                        width={CELL_SIZE}
                                        height={CELL_SIZE}
                                        fill={cell.scanned ? `rgba(255, 68, 68, ${getSectorProbability(x, y) * 0.8})` : 'transparent'}
                                        stroke="rgba(0, 255, 204, 0.05)"
                                        strokeWidth="1"
                                    />

                                    {/* Disaster Image Discovery - Visible if scanned OR sensors toggled */}
                                    {(cell.scanned || showSensors) && cell.disasterImage && (
                                        <image
                                            href={cell.disasterImage}
                                            x={x * CELL_SIZE + 2}
                                            y={y * CELL_SIZE + 2}
                                            width={CELL_SIZE - 4}
                                            height={CELL_SIZE - 4}
                                            style={{ opacity: 0.6, pointerEvents: 'none' }}
                                        />
                                    )}

                                    {/* Sensor Values Overlay */}
                                    {showSensors && (
                                        <g style={{ pointerEvents: 'none' }}>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 8} fontSize="5" fill="#00ffcc" opacity="0.9" fontFamily="var(--font-mono)">M:{cell.signals.mobile.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 15} fontSize="5" fill="#ff4444" opacity="0.9" fontFamily="var(--font-mono)">T:{cell.signals.thermal.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 22} fontSize="5" fill="#ffff00" opacity="0.9" fontFamily="var(--font-mono)">S:{cell.signals.sound.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 29} fontSize="5" fill="#ff00ff" opacity="0.9" fontFamily="var(--font-mono)">W:{cell.signals.wifi.toFixed(1)}</text>

                                            {/* Survivor Ground Truth Indicator */}
                                            {survivorsRef.current.some(s => s.x === x && s.y === y) && (
                                                <text
                                                    x={x * CELL_SIZE + CELL_SIZE - 2}
                                                    y={y * CELL_SIZE + CELL_SIZE - 2}
                                                    fontSize="6"
                                                    fill="#00ffcc"
                                                    textAnchor="end"
                                                    fontWeight="bold"
                                                    fontFamily="var(--font-mono)"
                                                >
                                                    [S]
                                                </text>
                                            )}
                                        </g>
                                    )}
                                </React.Fragment>
                            ))
                        )}

                        {/* Comm Network Edges */}
                        {commLinksRef.current.map((link, idx) => {
                            const getCoords = (id: string) => {
                                if (id === BASE_STATION.id) return { x: BASE_STATION.x, y: BASE_STATION.y };
                                const d = dronesRef.current.find(dr => dr.id === id);
                                if (d) return { x: d.x, y: d.y };
                                return null;
                            };
                            const c1 = getCoords(link.source);
                            const c2 = getCoords(link.target);
                            if (!c1 || !c2) return null;
                            const x1 = c1.x * CELL_SIZE + CELL_SIZE / 2;
                            const y1 = c1.y * CELL_SIZE + CELL_SIZE / 2;
                            const x2 = c2.x * CELL_SIZE + CELL_SIZE / 2;
                            const y2 = c2.y * CELL_SIZE + CELL_SIZE / 2;

                            return (
                                <g key={`edge-${idx}`}>
                                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#33ffaa" strokeWidth="1" strokeDasharray="4" style={{ opacity: 0.3 }} />
                                    {link.active && (
                                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffff00" strokeWidth="3" style={{ opacity: 0.8, filter: 'drop-shadow(0 0 4px #ffff00)' }} />
                                    )}
                                </g>
                            );
                        })}

                        {/* Mesh Network Lines (collision avoidance awareness) */}
                        {dronesRef.current.map(d => (
                            <g key={`mesh-${d.id}`}>
                                {Object.entries(d.knownOtherDrones).map(([otherId, knownPos]) => {
                                    if (timeRef.current - knownPos.lastUpdate < 20) {
                                        const otherDrone = dronesRef.current.find(od => od.id === otherId);
                                        if (otherDrone) {
                                            const isPinging = (timeRef.current - knownPos.lastUpdate <= 1);
                                            return (
                                                <g key={`link-group-${d.id}-${otherId}`}>
                                                    <line
                                                        x1={otherDrone.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y1={otherDrone.y * CELL_SIZE + CELL_SIZE / 2}
                                                        x2={d.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y2={d.y * CELL_SIZE + CELL_SIZE / 2}
                                                        strokeWidth="1"
                                                        className="mesh-link-base"
                                                    />
                                                    {isPinging && (
                                                        <line
                                                            x1={otherDrone.x * CELL_SIZE + CELL_SIZE / 2}
                                                            y1={otherDrone.y * CELL_SIZE + CELL_SIZE / 2}
                                                            x2={d.x * CELL_SIZE + CELL_SIZE / 2}
                                                            y2={d.y * CELL_SIZE + CELL_SIZE / 2}
                                                            strokeWidth="2"
                                                            className="mesh-link"
                                                        />
                                                    )}
                                                </g>
                                            );
                                        }
                                    }
                                    return null;
                                })}
                            </g>
                        ))}

                        {/* Base Station */}
                        <g transform={`translate(${BASE_STATION.x * CELL_SIZE + CELL_SIZE / 2}, ${BASE_STATION.y * CELL_SIZE + CELL_SIZE / 2})`}>
                            <rect x="-15" y="-15" width="30" height="30" fill="var(--panel-bg)" stroke="#33ffaa" strokeWidth="2" />
                            <Radio color="#33ffaa" size={20} style={{ transform: 'translate(-10px, -10px)' }} />
                            <text x="20" y="5" fill="#33ffaa" fontSize="10" fontFamily="var(--font-mono)">BASE</text>
                            <circle r={COMM_RANGE_BASE * CELL_SIZE} fill="transparent" stroke="#33ffaa" strokeWidth="1" strokeDasharray="10 5" style={{ animation: 'spin 10s linear infinite reverse', opacity: 0.2 }} />
                        </g>

                        {/* Terrain Overlays */}
                        {gridRef.current.map((row, y) => row.map((cell, x) => {
                            if (cell.terrain === 'Road') {
                                return <line key={`road-${x}-${y}`} x1={x * CELL_SIZE} y1={y * CELL_SIZE + CELL_SIZE / 2} x2={x * CELL_SIZE + CELL_SIZE} y2={y * CELL_SIZE + CELL_SIZE / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeDasharray="4" />
                            }
                            if (cell.terrain === 'Shelter') {
                                return <rect key={`shelter-${x}-${y}`} x={x * CELL_SIZE + 4} y={y * CELL_SIZE + 4} width={CELL_SIZE - 8} height={CELL_SIZE - 8} fill="rgba(60, 150, 255, 0.1)" stroke="rgba(60, 150, 255, 0.3)" />
                            }
                            return null;
                        }))}

                        {/* Drones */}
                        {dronesRef.current.map(d => (
                            <g key={d.id} transform={`translate(${d.x * CELL_SIZE + CELL_SIZE / 2}, ${d.y * CELL_SIZE + CELL_SIZE / 2})`}>
                                {/* Scan Radius Indicator */}
                                {d.mode !== 'Relay' && d.mode !== 'Charging' && (
                                    <circle
                                        r={d.mode === 'Wide' ? CELL_SIZE * 1.5 : CELL_SIZE * 0.75}
                                        fill="transparent"
                                        stroke={d.mode === 'Wide' ? '#00ffcc' : '#ff4444'}
                                        strokeWidth="1"
                                        strokeDasharray="4"
                                        className="spin-xs"
                                        style={{ opacity: 0.5, animation: 'spin 4s linear infinite' }}
                                    />
                                )}
                                {d.mode === 'Relay' && (
                                    <circle r={CELL_SIZE * 3.5} fill="transparent" stroke="#0077ff" strokeWidth="1" strokeDasharray="8" style={{ opacity: 0.2, animation: 'spin 8s linear infinite reverse' }} />
                                )}
                                {/* Drone blip */}
                                <circle r="4" fill={!d.isConnected ? '#555555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444'} />
                                <polygon points="0,-6 6,4 -6,4" fill={!d.isConnected ? '#555555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444'} />
                                {/* Label */}
                                <rect x="-18" y="-22" width="36" height="12" fill="rgba(0,0,0,0.7)" rx="2" />
                                <text x="0" y="-14" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="var(--font-mono)">
                                    {d.id.replace('DRN-', '').replace('RLY-', 'R:')}
                                </text>
                                {!d.isConnected && <text x="10" y="0" fill="#ff4444" fontSize="8" fontFamily="var(--font-mono)">OFFLINE</text>}
                                {/* Haversine Line visually tracking target */}
                                {d.mode === 'Micro' && (
                                    <line
                                        x1={0} y1={0}
                                        x2={(d.tx - d.x) * CELL_SIZE} y2={(d.ty - d.y) * CELL_SIZE}
                                        stroke="#ff4444" strokeWidth="1" strokeDasharray="2" style={{ opacity: 0.4 }}
                                    />
                                )}
                            </g>
                        ))}

                        {/* Visible Survivor Pins */}
                        {pinsRef.current.map(pin => (
                            <g key={pin.id}
                                transform={`translate(${pin.x * CELL_SIZE + CELL_SIZE / 2}, ${pin.y * CELL_SIZE + CELL_SIZE / 2})`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => setSelectedPin(pin)}
                            >
                                <circle r="12" fill="rgba(0, 255, 204, 0.3)" className="animate-pulse" />
                                <circle r="6" fill="#00ffcc" />
                                <foreignObject x="-10" y="-10" width="20" height="20">
                                    <MapPin size={20} color="#00ffcc" style={{ transform: 'translateY(-18px)' }} />
                                </foreignObject>
                            </g>
                        ))}
                    </svg>

                    {/* Legend */}
                    <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid var(--panel-border)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', backdropFilter: 'blur(4px)' }}>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>MAP LEGEND</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #00ffcc' }}></div> Wide-Scan Mode</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ff4444' }}></div> Micro-Scan Mode</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #0077ff' }}></div> Relay Drone</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ffa500' }}></div> Charging</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #555555' }}></div> Disconnected</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00ffcc' }}><MapPin size={12} /> Confirmed Survivor</div>
                        </div>
                    </div>

                    {/* Survivor Pin Popup */}
                    {selectedPin && (
                        <div style={{
                            position: 'absolute',
                            left: selectedPin.x * CELL_SIZE + CELL_SIZE / 2 + 20,
                            top: selectedPin.y * CELL_SIZE + CELL_SIZE / 2 - 20,
                            background: 'rgba(5, 10, 16, 0.95)',
                            border: '1px solid #00ffcc',
                            padding: '16px',
                            borderRadius: '4px',
                            boxShadow: '0 0 20px rgba(0, 255, 204, 0.2)',
                            zIndex: 10,
                            minWidth: '220px'
                        }}>
                            <button onClick={() => setSelectedPin(null)} style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <X size={16} />
                            </button>
                            <h4 className="glow-text" style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#00ffcc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Radio size={16} /> SIGNAL UPLINK
                            </h4>
                            <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '12px', padding: '8px', background: 'rgba(0, 255, 204, 0.1)', borderLeft: '2px solid #00ffcc' }}>
                                "{selectedPin.info.message}"
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                <span>DEVICE BATTERY:</span>
                                <span style={{ color: '#ff4444' }}>{selectedPin.info.battery}</span>
                            </div>
                            <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                LAT: {(1.5600 - selectedPin.y * 0.001).toFixed(4)} <br />
                                LON: {(103.6300 + selectedPin.x * 0.001).toFixed(4)}
                            </div>
                        </div>
                    )}
                </div>

                {/* Info Dashboard Sidebar */}
                <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="hud-panel" style={{ padding: '16px' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={18} /> LIVE SWARM STATUS
                        </h4>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>ACTIVE DRONES</div>
                                <div style={{ fontSize: '1.5rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{dronesRef.current.length}</div>
                            </div>
                            <div style={{ background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>TIME CYCLES</div>
                                <div style={{ fontSize: '1.5rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{timeRef.current}</div>
                            </div>
                        </div>

                        <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {dronesRef.current.map((d, i) => {
                                const batColor = d.battery > 50 ? '#00ffcc' : d.battery > 20 ? '#ffff00' : '#ff4444';
                                return (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {d.mode === 'Wide' ? <Target size={14} color="#00ffcc" /> : d.mode === 'Relay' ? <Radio size={14} color="#0077ff" /> : d.mode === 'Charging' ? <Activity size={14} color="#ffa500" /> : <Crosshair size={14} color="#ff4444" />}
                                            {d.id}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ color: batColor, fontSize: '0.7rem' }}>{Math.floor(d.battery)}%</div>
                                            <div style={{ color: !d.isConnected ? '#555555' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Charging' ? '#ffa500' : '#ff4444', minWidth: '55px', textAlign: 'right' }}>
                                                {!d.isConnected ? 'OFFLINE' : d.mode}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Swarm Strategy Analytics Overhaul */}
                    <div className="hud-panel" style={{ padding: '16px', background: 'rgba(0, 255, 204, 0.05)', border: '1px solid var(--panel-border)' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1px' }}>
                            SWARM STRATEGY ANALYTICS
                        </h4>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            {/* Metric: Zone Coverage */}
                            <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                    ZONE COVERAGE
                                </div>
                                <div style={{ fontSize: '1.2rem', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                    {metricsRef.current.averageZoneCoverage.toFixed(1)}%
                                </div>
                            </div>

                            {/* Metric: Repeat Scans */}
                            <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                    REPEAT RATE
                                </div>
                                <div style={{ fontSize: '1.2rem', color: metricsRef.current.repeatedScanRate > 15 ? '#ff4444' : '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                    {metricsRef.current.repeatedScanRate.toFixed(1)}%
                                </div>
                            </div>

                            {/* Metric: Idle Time */}
                            <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                    IDLE CYCLES
                                </div>
                                <div style={{ fontSize: '1.2rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                    {metricsRef.current.droneIdleTime}
                                </div>
                            </div>

                            {/* Metric: Mean Probability */}
                            <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                    MEAN PROB
                                </div>
                                <div style={{ fontSize: '1.2rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                    {metricsRef.current.meanProbabilityScanned.toFixed(3)}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(0, 255, 204, 0.1)', fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>TOTAL SCANS:</span>
                            <span style={{ color: 'var(--text-primary)' }}>{metricsRef.current.totalScans.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="hud-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Radio size={18} /> ADAPTIVE SENSORS
                        </h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {(Object.entries(sensorWeightsRef.current) as [keyof typeof INITIAL_SENSORS, { base: number, conf: number, color: string }][]).map(([key, data]) => {
                                const finalW = (data.base * data.conf).toFixed(2);
                                return (
                                    <div key={key}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginBottom: '4px', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                                            <span>{key} SIG</span>
                                            <span style={{ color: data.color }}>w={finalW}</span>
                                        </div>
                                        <div style={{ width: '100%', height: '4px', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                            <div style={{ width: `${(parseFloat(finalW) / 0.4) * 100}%`, height: '100%', background: data.color }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Algorithm Log */}
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                                <span>ALGORITHM LOG</span>
                                <span className="animate-pulse" style={{ color: '#00ffcc' }}>● LIVE</span>
                            </div>
                            <div className="hud-text" style={{ fontSize: '0.65rem', color: 'var(--text-primary)', opacity: 0.8, overflowY: 'auto', flex: 1, maxHeight: '120px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {logsRef.current.map((log, idx) => (
                                    <div key={idx} style={{
                                        color: log.type === 'alert' ? '#ff4444' : log.type === 'success' ? '#00ffcc' : 'var(--text-secondary)'
                                    }}>
                                        <span style={{ opacity: 0.5 }}>[{log.time}]</span> &gt; {log.msg}
                                    </div>
                                ))}
                                {logsRef.current.length === 0 && (
                                    <>
                                        <div><span style={{ color: '#555' }}>[SYS]</span> Decentralized swarm initialized.</div>
                                        <div><span style={{ color: '#555' }}>[SYS]</span> Using Haversine pathfinding.</div>
                                        <div><span style={{ color: '#555' }}>[SYS]</span> ACO Exploration mode active.</div>
                                    </>
                                )}

                                {swarmMessagesRef.current.map((msg) => (
                                    <div key={msg.id} style={{ display: 'flex', gap: '4px' }}>
                                        <span style={{ color: '#555' }}>[T-{msg.time}]</span>
                                        <span style={{ color: '#00ffcc' }}>{msg.sender}:</span>
                                        <span style={{ color: msg.type === 'HIGH_SIGNAL' ? '#ff4444' : msg.type === 'REQUEST_ASSIST' ? '#ffff00' : 'var(--text-primary)' }}>
                                            {msg.type.toLowerCase()}({JSON.stringify(msg.payload)})
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* MCP Tools Panel */}
            {mcpPanelOpen && (
                <div style={{
                    position: 'fixed',
                    top: 80,
                    right: 20,
                    width: 450,
                    maxHeight: 'calc(100vh - 120px)',
                    background: 'rgba(5, 10, 16, 0.98)',
                    border: '1px solid #00ffcc',
                    borderRadius: 8,
                    padding: 16,
                    zIndex: 1000,
                    overflow: 'auto',
                    boxShadow: '0 0 30px rgba(0, 255, 204, 0.3)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ margin: 0, color: '#00ffcc', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Terminal size={18} /> MCP Tools
                        </h3>
                        <button
                            onClick={() => setMcpPanelOpen(false)}
                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Tool</label>
                        <select
                            value={mcpSelectedTool}
                            onChange={(e) => {
                                setMcpSelectedTool(e.target.value);
                                // Set default params based on tool
                                const paramTemplates: Record<string, string> = {
                                    'getDroneStatus': '{"droneId": "DRN-Alpha"}',
                                    'getAllDroneStatuses': '{}',
                                    'setDroneTarget': '{"droneId": "DRN-Alpha", "targetX": 5, "targetY": 5}',
                                    'setDroneMode': '{"droneId": "DRN-Alpha", "mode": "Micro"}',
                                    'recallDroneToBase': '{"droneId": "DRN-Alpha"}',
                                    'killDrone': '{"droneId": "DRN-Alpha"}',
                                    'getBatteryForecast': '{"droneId": "DRN-Alpha", "targetX": 15, "targetY": 3}',
                                    'getDroneDiscoveryList': '{}',
                                    'setAutoRecallThreshold': '{"droneId": "DRN-Alpha", "batteryThreshold": 25}',
                                    'getSectorScanResult': '{"sector": "E10"}',
                                    'getGridHeatmap': '{}',
                                    'getScannedSectors': '{}',
                                    'getSurroundingSectors': '{"centerSector": "J10", "radius": 2}',
                                    'getCommNetworkStatus': '{}',
                                    'getDisconnectedDrones': '{}',
                                    'checkDroneConnectivity': '{"droneId": "DRN-Alpha"}',
                                    'getSwarmStatus': '{}',
                                    'getMissionStats': '{}',
                                    'getFoundSurvivors': '{}',
                                    'setSurvivorPin': '{"x": 5, "y": 5, "droneId": "DRN-Alpha", "message": "Survivor found"}',
                                    'resetMission': '{}',
                                    'setSimulationRunning': '{"running": true}',
                                    'getMissionBriefing': '{}',
                                    'getSectorAssignments': '{}',
                                    'getExplorationGradient': '{}',
                                    'getUnassignedHotspots': '{"probabilityThreshold": 0.3, "maxResults": 10}',
                                    'getDroneAssignmentMap': '{}',
                                    'validateAssignmentPlan': '{"assignments":[{"droneId":"DRN-Alpha","targetX":11,"targetY":8,"mode":"Wide"}]}',
                                    'assignHotspotBatch': '{"assignments":[{"droneId":"DRN-Alpha","targetX":11,"targetY":8,"mode":"Wide"}]}',
                                    'getRecommendedActions': '{"maxActions": 8}',
                                    'getBatteryRiskMap': '{"safetyBuffer": 15}'
                                };
                                setMcpToolParams(paramTemplates[e.target.value] || '{}');
                            }}
                            style={{
                                width: '100%',
                                padding: 8,
                                background: '#0a1520',
                                border: '1px solid #333',
                                borderRadius: 4,
                                color: '#fff',
                                fontSize: 13
                            }}
                        >
                            <optgroup label="Drone Tools">
                                <option value="getDroneStatus">getDroneStatus</option>
                                <option value="getAllDroneStatuses">getAllDroneStatuses</option>
                                <option value="setDroneTarget">setDroneTarget</option>
                                <option value="setDroneMode">setDroneMode</option>
                                <option value="recallDroneToBase">recallDroneToBase</option>
                                <option value="killDrone">killDrone</option>
                                <option value="getBatteryForecast">getBatteryForecast ✦</option>
                                <option value="getDroneDiscoveryList">getDroneDiscoveryList ✦</option>
                                <option value="setAutoRecallThreshold">setAutoRecallThreshold ✦</option>
                            </optgroup>
                            <optgroup label="Scan Tools">
                                <option value="getSectorScanResult">getSectorScanResult</option>
                                <option value="getGridHeatmap">getGridHeatmap</option>
                                <option value="getScannedSectors">getScannedSectors</option>
                                <option value="getSurroundingSectors">getSurroundingSectors</option>
                            </optgroup>
                            <optgroup label="Communication Tools">
                                <option value="getCommNetworkStatus">getCommNetworkStatus</option>
                                <option value="getDisconnectedDrones">getDisconnectedDrones</option>
                                <option value="checkDroneConnectivity">checkDroneConnectivity</option>
                            </optgroup>
                            <optgroup label="Mission Tools">
                                <option value="getSwarmStatus">getSwarmStatus</option>
                                <option value="getMissionStats">getMissionStats</option>
                                <option value="getFoundSurvivors">getFoundSurvivors</option>
                                <option value="setSurvivorPin">setSurvivorPin</option>
                                <option value="resetMission">resetMission</option>
                                <option value="setSimulationRunning">setSimulationRunning</option>
                                <option value="getMissionBriefing">getMissionBriefing</option>
                                <option value="getSectorAssignments">getSectorAssignments ✦</option>
                            </optgroup>
                            <optgroup label="Swarm Intelligence">
                                <option value="getExplorationGradient">getExplorationGradient</option>
                                <option value="getUnassignedHotspots">getUnassignedHotspots</option>
                                <option value="getDroneAssignmentMap">getDroneAssignmentMap</option>
                            </optgroup>
                            <optgroup label="Orchestration">
                                <option value="validateAssignmentPlan">validateAssignmentPlan ✦</option>
                                <option value="assignHotspotBatch">assignHotspotBatch ✦</option>
                                <option value="getRecommendedActions">getRecommendedActions ✦</option>
                                <option value="getBatteryRiskMap">getBatteryRiskMap ✦</option>
                            </optgroup>
                        </select>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Parameters (JSON)</label>
                        <textarea
                            value={mcpToolParams}
                            onChange={(e) => setMcpToolParams(e.target.value)}
                            style={{
                                width: '100%',
                                height: 60,
                                padding: 8,
                                background: '#0a1520',
                                border: '1px solid #333',
                                borderRadius: 4,
                                color: '#fff',
                                fontFamily: 'monospace',
                                fontSize: 12,
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    <button
                        onClick={executeMcpTool}
                        disabled={!mcpConnected}
                        style={{
                            width: '100%',
                            padding: 10,
                            background: mcpConnected ? '#00ffcc' : '#333',
                            border: 'none',
                            borderRadius: 4,
                            color: mcpConnected ? '#000' : '#666',
                            fontWeight: 'bold',
                            cursor: mcpConnected ? 'pointer' : 'not-allowed',
                            marginBottom: 12
                        }}
                    >
                        Execute Tool
                    </button>

                    <div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Output</label>
                        <pre style={{
                            background: '#0a1520',
                            border: '1px solid #333',
                            borderRadius: 4,
                            padding: 8,
                            maxHeight: 300,
                            overflow: 'auto',
                            fontSize: 11,
                            color: '#0f0',
                            margin: 0
                        }}>
                            {mcpToolOutput || 'No output yet. Execute a tool to see results.'}
                        </pre>
                    </div>
                </div>
            )}

            {/* AI Orchestrator Chat Panel */}
            {chatOpen && (
                <div style={{
                    position: 'fixed',
                    bottom: 20,
                    right: 20,
                    width: 420,
                    height: 420,
                    background: 'rgba(5, 10, 16, 0.98)',
                    border: '1px solid #00ffcc',
                    borderRadius: 8,
                    padding: 12,
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 0 30px rgba(0, 255, 204, 0.2)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h3 style={{ margin: 0, color: '#00ffcc', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                            <MessageSquare size={16} /> Orchestrator Chat
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                onClick={runThinkNow}
                                disabled={!mcpConnected || chatSending}
                                style={{
                                    background: '#00ffcc',
                                    border: 'none',
                                    color: '#001018',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: !mcpConnected || chatSending ? 'not-allowed' : 'pointer',
                                    opacity: !mcpConnected || chatSending ? 0.5 : 1
                                }}
                            >
                                THINK NOW
                            </button>
                            <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        border: '1px solid #243444',
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                    }} ref={chatScrollRef}>
                        {chatMessages.map((m, i) => (
                            <div key={i} style={{
                                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '90%',
                                background: m.role === 'user' ? 'rgba(0,255,204,0.15)' : m.role === 'ai' ? 'rgba(77, 163, 255, 0.15)' : 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 6,
                                padding: '6px 8px',
                                fontSize: 12,
                                whiteSpace: 'pre-wrap'
                            }}>
                                {m.text}
                            </div>
                        ))}
                    </div>

                    <div style={{ fontSize: 10, color: '#7fa3b8', marginBottom: 8 }}>
                        AI auto-evaluates every ~3s while simulation is running. Click THINK NOW to force immediate decision.
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    sendChatMessage();
                                }
                            }}
                            placeholder={mcpConnected ? 'Ask AI...' : 'Connect MCP server first'}
                            disabled={!mcpConnected || chatSending}
                            style={{
                                flex: 1,
                                background: '#0a1520',
                                border: '1px solid #334455',
                                color: '#fff',
                                borderRadius: 6,
                                padding: '8px 10px',
                                fontSize: 12
                            }}
                        />
                        <button
                            onClick={sendChatMessage}
                            disabled={!mcpConnected || chatSending || !chatInput.trim()}
                            style={{
                                border: 'none',
                                borderRadius: 6,
                                padding: '8px 10px',
                                background: '#00ffcc',
                                color: '#001018',
                                cursor: !mcpConnected || chatSending || !chatInput.trim() ? 'not-allowed' : 'pointer',
                                opacity: !mcpConnected || chatSending || !chatInput.trim() ? 0.5 : 1
                            }}
                        >
                            <Send size={14} />
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default SimulationMapMCP;
