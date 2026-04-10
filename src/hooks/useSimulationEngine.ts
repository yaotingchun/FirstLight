import { useState, useEffect, useRef, useCallback } from 'react';
import { gridDataService, INITIAL_SENSORS } from '../services/gridDataService';
import { clusterZones, clusterCellsIntoZones, getZoneForCell } from '../utils/zoneClustering';
import type { SearchZone, GridCell } from '../utils/zoneClustering';
import { scoreZones } from '../utils/zoneScoring';
import { allocateDrones } from '../utils/zoneAllocator';
import type { DroneMission } from '../utils/zoneAllocator';
import { aStarPath, OBSTACLE_SET } from '../utils/swarmRouting';
import { createSearchMemory, recordCellScan } from '../utils/searchMemory';
import type { SearchMemory } from '../utils/searchMemory';
import {
    createGrid, createDrones, createSurvivors
} from '../utils/simulationSetup';
import {
    GRID_W, GRID_H, THRESHOLD_MICRO, THRESHOLD_FOUND, SIM_TICK_MS,
    ZONE_PIPELINE_INTERVAL, COMM_RANGE_DRONE,
    COMM_RANGE_RELAY, COMM_RANGE_BASE, RELAY_LOW_BATTERY_THRESHOLD,
    RELAY_TAKEOVER_MIN_BATTERY, RELAY_BASE_DOCK_EPSILON, RELAY_DEFAULT_TARGET,
    BASE_STATION
} from '../types/simulation';
import type { Sector, Drone, SwarmMessage, CommEdge, HiddenSurvivor, FoundPin, FailureEvent } from '../types/simulation';
import { isPointInPolygon, type Point } from '../utils/polygonUtils';

export const useSimulationEngine = (
    onFailureEventTriggered: (eventPayload: { type: string; droneId: string }) => void,
    onSimRunningToggle: (nextRunning: boolean, tick: number) => void
) => {
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [randomizeBattery, setRandomizeBatteryState] = useState(true);
    const [microScanOnly, setMicroScanOnly] = useState(false);
    const [, setTickFlip] = useState(0);
    const [selectedPin, setSelectedPin] = useState<FoundPin | null>(null);
    const [showSensors, setShowSensors] = useState(false);
    const [showTrails, setShowTrails] = useState(false);
    const [selectedTrailDroneId, setSelectedTrailDroneId] = useState<string | 'all'>('all');
    const [showActualMap, setShowActualMap] = useState(false);
    const [timeLimit, setTimeLimit] = useState<number>(300);
    const [useTimeLimit, setUseTimeLimit] = useState<boolean>(true);
    const [centerLocation, setCenterLocation] = useState<{ lat: number; lng: number }>({ lat: 3.1319, lng: 101.6841 });
    const [searchArea, setSearchAreaState] = useState<Point[]>([]);
    const searchAreaRef = useRef<Point[]>([]);
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [selectedCells, setSelectedCells] = useState<Point[]>([]);
    const selectedCellsRef = useRef<Point[]>([]);
    const [missionOverride, setMissionOverrideState] = useState(false);
    const missionOverrideRef = useRef(false);
    const [searchScanActive, setSearchScanActiveState] = useState(false);
    const searchScanActiveRef = useRef(false);

    const initialSurvivors = createSurvivors();
    const gridRef = useRef<Sector[][]>(createGrid(initialSurvivors));
    const dronesRef = useRef<Drone[]>(createDrones());
    const survivorsRef = useRef<HiddenSurvivor[]>(initialSurvivors);
    const pinsRef = useRef<FoundPin[]>([]);
    const timeRef = useRef<number>(0);
    const commLinksRef = useRef<CommEdge[]>([]);
    const swarmMessagesRef = useRef<SwarmMessage[]>([]);
    const sensorWeightsRef = useRef(gridDataService.getSensorWeights());

    const autoRecallThresholdsRef = useRef<Map<string, number>>(new Map());
    const failureEventsRef = useRef<FailureEvent[]>([]);
    const aiDisconnectedRef = useRef<Set<string>>(new Set());
    const aiReconnectAttemptTickRef = useRef<Map<string, number>>(new Map());
    const aiReconnectedUntilTickRef = useRef<Map<string, number>>(new Map());
    const relayTakeoverTargetRef = useRef<{ x: number; y: number }>({ ...RELAY_DEFAULT_TARGET });
    const relaySwapCooldownUntilTickRef = useRef<number>(0);
    const lastFieldRelayIdRef = useRef<string>('RLY-Prime');
    const lastRelayDecisionSignatureRef = useRef<string>('');
    const lastRelayDecisionTickRef = useRef<number>(-9999);
    const microScanOnlyRef = useRef<boolean>(false);

    const missionReturnTriggeredRef = useRef(false);
    const missionStopHandledRef = useRef(false);
    const missionConclusionPromptedRef = useRef(false);

    const zonesRef = useRef<SearchZone[]>([]);
    const searchMemoryRef = useRef<SearchMemory>(createSearchMemory());
    const aiBusyRef = useRef(false);
    const activeMissionsRef = useRef<DroneMission[]>([]);
    const metricsRef = useRef({
        repeatedScanRate: 0,
        averageZoneCoverage: 0,
        missionTimeSec: 0,
        meanProbabilityScanned: 0,
        totalScans: 0,
        totalUniqueScans: 0,
        totalRepeatScans: 0,
        uniqueProbSum: 0,
    });

    const setSearchArea = useCallback((area: Point[]) => {
        setSearchAreaState(area);
        searchAreaRef.current = area;
    }, []);

    const setSelectedCellsFromArea = useCallback((cells: Point[]) => {
        setSelectedCells(cells);
        selectedCellsRef.current = cells;
    }, []);

    const setMissionOverride = useCallback((val: boolean) => {
        setMissionOverrideState(val);
        missionOverrideRef.current = val;
        missionConclusionPromptedRef.current = false;
    }, []);

    const setSearchScanActive = useCallback((val: boolean) => {
        setSearchScanActiveState(val);
        searchScanActiveRef.current = val;
    }, []);

    useEffect(() => {
        if (searchAreaRef.current.length < 3) {
            setSelectedCellsFromArea([]);
            return;
        }

        const cells: Point[] = [];
        const grid = gridRef.current;
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                if (isPointInPolygon(x, y, searchAreaRef.current)) {
                    if (grid[y]?.[x]) cells.push({ x, y });
                }
            }
        }
        setSelectedCellsFromArea(cells);
    }, [searchArea]);

    const triggerFailureEvent = useCallback((droneId: string) => {
        if (aiDisconnectedRef.current.has(droneId)) return;

        const event: FailureEvent = {
            type: 'DRONE_CONNECTION_LOST',
            droneId,
            tick: timeRef.current,
        };

        failureEventsRef.current.push(event);

        const eventPayload = { type: 'DRONE_CONNECTION_LOST', droneId };
        onFailureEventTriggered(eventPayload);
        setTickFlip(f => f + 1);
    }, [onFailureEventTriggered]);

    const setRandomizeBattery = useCallback((val: boolean) => {
        setRandomizeBatteryState(val);
        if (!running) {
            dronesRef.current = createDrones(val);
            setTickFlip(f => f + 1);
        }
    }, [running]);

    const toggleRunning = useCallback(() => {
        const nextRunning = !running;
        setRunning(nextRunning);
        onSimRunningToggle(nextRunning, timeRef.current);
    }, [running, onSimRunningToggle]);

    const toggleMicroScanOnly = useCallback((val: boolean) => {
        setMicroScanOnly(val);
        microScanOnlyRef.current = val;
    }, []);

    useEffect(() => {
        if (gridDataService.isTerrainReady()) {
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

    const finalizeDiscovery = useCallback((survivorId: string, droneId: string, sx: number, sy: number) => {
        const survivors = survivorsRef.current;
        const grid = gridRef.current;
        const survivor = survivors.find(s => s.id === survivorId && !s.found);
        if (!survivor) return;

        if (sy >= 0 && sy < GRID_H && sx >= 0 && sx < GRID_W) {
            grid[sy][sx].scanned = true;
            grid[sy][sx].lastScanned = timeRef.current;
        }

        survivor.found = true;

        const drone = dronesRef.current.find(d => d.id === droneId);
        if (drone) {
            drone.memory.push(survivor.id);

            const weights = sensorWeightsRef.current;
            (Object.keys(weights) as Array<keyof typeof INITIAL_SENSORS>).forEach(k => {
                weights[k].conf = Math.min(1.0, weights[k].conf + 0.04);
            });
            gridDataService.setSensorWeights({ ...weights });

            if (drone.isConnected) {
                swarmMessagesRef.current.push({
                    id: Math.random().toString(36).substring(2, 9),
                    sender: drone.id,
                    time: timeRef.current,
                    type: 'HIGH_SIGNAL',
                    payload: { survivorId: survivor.id }
                });
            }

            if (drone.path.length > 0) {
                drone.path[drone.path.length - 1].scanned = true;
            }

            drone.mode = 'Wide';
            drone.tx = Math.floor(GRID_W / 2);
            drone.ty = Math.floor(GRID_H / 2);
            drone.lockTarget = false;
            drone.preventReassignment = false;
        }

        if (!pinsRef.current.find(p => p.id === survivor.id)) {
            pinsRef.current.push({ id: survivor.id, x: sx, y: sy, info: survivor.info });
        }
    }, []);

    const resetSim = () => {
        setRunning(false);
        gridDataService.releaseSource();
        const newSurvivors = createSurvivors();
        const newGrid = createGrid(newSurvivors);
        gridRef.current = newGrid;
        dronesRef.current = createDrones(randomizeBattery);
        survivorsRef.current = newSurvivors;
        pinsRef.current = [];
        commLinksRef.current = [];
        swarmMessagesRef.current = [];
        sensorWeightsRef.current = JSON.parse(JSON.stringify(INITIAL_SENSORS));
        gridDataService.setSensorWeights(sensorWeightsRef.current);
        timeRef.current = 0;

        missionReturnTriggeredRef.current = false;
        missionStopHandledRef.current = false;
        missionConclusionPromptedRef.current = false;
        autoRecallThresholdsRef.current.clear();
        failureEventsRef.current = [];
        aiDisconnectedRef.current.clear();
        aiReconnectAttemptTickRef.current.clear();
        aiReconnectedUntilTickRef.current.clear();
        relayTakeoverTargetRef.current = { ...RELAY_DEFAULT_TARGET };
        relaySwapCooldownUntilTickRef.current = 0;
        lastFieldRelayIdRef.current = 'RLY-Prime';
        lastRelayDecisionSignatureRef.current = '';
        lastRelayDecisionTickRef.current = -9999;
        searchAreaRef.current = [];
        setSearchAreaState([]);
        setSelectedCellsFromArea([]);
        setMissionOverride(false);
        setSearchScanActive(false);

        zonesRef.current = [];
        searchMemoryRef.current = createSearchMemory();
        activeMissionsRef.current = [];
        metricsRef.current = {
            repeatedScanRate: 0,
            averageZoneCoverage: 0,
            missionTimeSec: 0,
            meanProbabilityScanned: 0,
            totalScans: 0,
            totalUniqueScans: 0,
            totalRepeatScans: 0,
            uniqueProbSum: 0,
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

    const performTickCore = useCallback((onMcpSyncRequest: () => void, onMcpCommandProcessRequest: () => void, onRelaySwapDecisionMade: (preferredId: string, msg: string) => void) => {
        timeRef.current++;
        aiReconnectedUntilTickRef.current.forEach((untilTick, droneId) => {
            if (untilTick <= timeRef.current) aiReconnectedUntilTickRef.current.delete(droneId);
        });
        const grid = gridRef.current;
        const drones = dronesRef.current;
        const survivors = survivorsRef.current;
        const messages = swarmMessagesRef.current;

        if (messages.length > 5) swarmMessagesRef.current = messages.slice(messages.length - 5);

        const setDroneTarget = (drone: Drone, tx: number, ty: number) => {
            const oldX = Math.round(drone.tx);
            const oldY = Math.round(drone.ty);
            if (grid[oldY] && grid[oldY][oldX]) {
                grid[oldY][oldX].currentDrones = Math.max(0, grid[oldY][oldX].currentDrones - 1);
            }
            drone.tx = tx;
            drone.ty = ty;
            const newX = Math.round(tx);
            const newY = Math.round(ty);
            if (grid[newY] && grid[newY][newX]) {
                grid[newY][newX].currentDrones++;
            }
        };

        const addMessage = (droneId: string, type: 'HIGH_SIGNAL' | 'REQUEST_ASSIST' | 'MAP_SHARE', payload: Record<string, unknown>) => {
            swarmMessagesRef.current.push({
                id: Math.random().toString(36).substring(2, 9),
                sender: droneId,
                time: timeRef.current,
                type,
                payload
            });
        };

        const hasActiveSearchArea = missionOverrideRef.current && searchAreaRef.current.length >= 3;
        const isInsideActiveSearchArea = (x: number, y: number): boolean => {
            if (!hasActiveSearchArea) return true;
            return isPointInPolygon(Math.round(x), Math.round(y), searchAreaRef.current);
        };

        const findNearestAreaCellToPoint = (x: number, y: number): Point | null => {
            if (!hasActiveSearchArea || selectedCellsRef.current.length === 0) return null;

            const sorted = [...selectedCellsRef.current].sort((a, b) => {
                const da = Math.hypot(a.x - x, a.y - y);
                const db = Math.hypot(b.x - x, b.y - y);
                return da - db;
            });

            return sorted[0] ?? null;
        };

        const findNearestCellInsideSearchArea = (drone: Drone): Point | null => {
            if (!hasActiveSearchArea || selectedCellsRef.current.length === 0) return null;

            const sorted = [...selectedCellsRef.current].sort((a, b) => {
                const da = Math.hypot(a.x - drone.x, a.y - drone.y);
                const db = Math.hypot(b.x - drone.x, b.y - drone.y);
                return da - db;
            });

            for (const cell of sorted) {
                const path = aStarPath(
                    { x: Math.round(drone.x), y: Math.round(drone.y) },
                    { x: cell.x, y: cell.y },
                    OBSTACLE_SET,
                    GRID_W,
                    GRID_H,
                    undefined,
                    6,
                    [],
                    15,
                    searchAreaRef.current,
                );
                if (path.length > 0) return cell;
            }

            const centroid = selectedCellsRef.current.reduce(
                (acc, cell) => ({ x: acc.x + cell.x, y: acc.y + cell.y }),
                { x: 0, y: 0 }
            );
            const avg = {
                x: Math.round(centroid.x / selectedCellsRef.current.length),
                y: Math.round(centroid.y / selectedCellsRef.current.length),
            };
            const centroidCell = gridRef.current[avg.y]?.[avg.x];
            return centroidCell ? { x: centroidCell.x, y: centroidCell.y } : sorted[0] ?? null;
        };

        const getAreaCoverage = (): number => {
            if (!missionOverrideRef.current || selectedCellsRef.current.length === 0) {
                return totalCells > 0 ? (scannedCells / totalCells) * 100 : 0;
            }
            const scannedInside = selectedCellsRef.current.filter(c => grid[c.y]?.[c.x]?.scanned).length;
            return (scannedInside / selectedCellsRef.current.length) * 100;
        };

        const totalCells = GRID_W * GRID_H;
        const scannedCells = grid.reduce((sum, row) => sum + row.filter(sec => sec.scanned).length, 0);
        const scanProgress = totalCells > 0 ? (scannedCells / totalCells) * 100 : 0;

        const selectedAreaSurvivors = survivors.filter(s => missionOverrideRef.current && searchAreaRef.current.length >= 3 && isPointInPolygon(s.x, s.y, searchAreaRef.current));
        const remainingAreaSurvivors = selectedAreaSurvivors.filter(s => !s.found);
        const areaCoverage = getAreaCoverage();

        // Sync mission coverage metric in real-time
        metricsRef.current.averageZoneCoverage = areaCoverage;

        const allSurvivorsFound = survivors.length > 0 && survivors.every(s => s.found);
        const areaMissionComplete = missionOverrideRef.current
            ? selectedCellsRef.current.length > 0 && areaCoverage >= 100 && remainingAreaSurvivors.length === 0
            : false;
        const missionComplete = allSurvivorsFound && scanProgress >= 100;

        if (!missionOverrideRef.current && scanProgress >= 100 && !allSurvivorsFound) {
            const unresolved = survivors.filter(s => !s.found);

            unresolved.forEach(s => {
                grid[s.y][s.x].prob = Math.max(grid[s.y][s.x].prob, THRESHOLD_MICRO + 0.25);
                grid[s.y][s.x].pheromone = Math.max(grid[s.y][s.x].pheromone, 0.9);
            });

            const reserved = new Set<string>();
            unresolved.forEach(s => {
                const nearest = drones
                    .filter(d =>
                        d.mode !== 'Relay' &&
                        d.mode !== 'Charging' &&
                        !aiDisconnectedRef.current.has(d.id) &&
                        !reserved.has(d.id)
                    )
                    .sort((a, b) => {
                        const da = Math.sqrt(Math.pow(a.x - s.x, 2) + Math.pow(a.y - s.y, 2));
                        const db = Math.sqrt(Math.pow(b.x - s.x, 2) + Math.pow(b.y - s.y, 2));
                        return da - db;
                    })[0];

                if (nearest) {
                    setDroneTarget(nearest, s.x, s.y);
                    nearest.mode = 'Micro';
                    reserved.add(nearest.id);
                }
            });
        }

        if (areaMissionComplete && !missionConclusionPromptedRef.current) {
            missionConclusionPromptedRef.current = true;

            missionReturnTriggeredRef.current = true;
            drones.forEach(d => {
                setDroneTarget(d, BASE_STATION.x, BASE_STATION.y);
                if (d.mode !== 'Relay') d.mode = 'Wide';
                d.lockTarget = false;
                d.preventReassignment = false;
            });
        }

        if (areaMissionComplete && missionReturnTriggeredRef.current && !missionStopHandledRef.current) {
            const allAtBase = drones.every(d => Math.sqrt(Math.pow(d.x - BASE_STATION.x, 2) + Math.pow(d.y - BASE_STATION.y, 2)) < 0.5);
            const allCharging = drones.every(d => d.mode === 'Charging' || d.id.startsWith('RLY-'));
            
            if (allAtBase && allCharging) {
                missionStopHandledRef.current = true;
                setMissionOverride(false);
                setSearchScanActive(false);
                setRunning(false);
            }
        }

        if (missionComplete && !missionReturnTriggeredRef.current) {
            missionReturnTriggeredRef.current = true;
            drones.forEach(d => {
                setDroneTarget(d, BASE_STATION.x, BASE_STATION.y);
                if (d.mode !== 'Relay') d.mode = 'Wide';
            });
        }

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

        const suppressRelayOperations =
            missionReturnTriggeredRef.current ||
            missionComplete ||
            areaMissionComplete ||
            scanProgress >= 100;

        const activeRelay = drones.find(d => d.mode === 'Relay' && (d.tx !== BASE_STATION.x || d.ty !== BASE_STATION.y));
        if (!suppressRelayOperations && activeRelay && disconnectedCount > 0) {
            const disconnected = drones.filter(d => !d.isConnected && d.mode !== 'Relay' && d.mode !== 'Charging');
            if (disconnected.length > 0) {
                let cx = 0, cy = 0;
                disconnected.forEach(d => { cx += d.x; cy += d.y; });
                cx /= disconnected.length;
                cy /= disconnected.length;
                activeRelay.tx = (cx + BASE_STATION.x) / 2;
                activeRelay.ty = (cy + BASE_STATION.y) / 2;
            }
        } else if (!suppressRelayOperations && activeRelay && disconnectedCount === 0) {
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

        const BASE_X = BASE_STATION.x;
        const BASE_Y = BASE_STATION.y;

        const relayDrones = drones.filter(d => d.id.startsWith('RLY-'));
        const isNearBase = (drone: Drone) => Math.sqrt(Math.pow(drone.x - BASE_X, 2) + Math.pow(drone.y - BASE_Y, 2)) <= RELAY_BASE_DOCK_EPSILON;
        const isReturningToBase = (drone: Drone) =>
            drone.mode === 'Relay' &&
            Math.sqrt(Math.pow(drone.tx - BASE_X, 2) + Math.pow(drone.ty - BASE_Y, 2)) <= 0.35;
        const isFieldRelay = (drone: Drone) => drone.mode === 'Relay' && !isReturningToBase(drone);

        const activeFieldRelay = relayDrones.find(isFieldRelay);
        if (activeFieldRelay) {
            relayTakeoverTargetRef.current = { x: activeFieldRelay.tx, y: activeFieldRelay.ty };
            lastFieldRelayIdRef.current = activeFieldRelay.id;
        }

            const shouldEmitRelayDecision = (signature: string): boolean => {
                const RELAY_DECISION_DEBOUNCE_TICKS = 80;
                const sameDecision = lastRelayDecisionSignatureRef.current === signature;
                const inDebounceWindow = (timeRef.current - lastRelayDecisionTickRef.current) < RELAY_DECISION_DEBOUNCE_TICKS;

                if (sameDecision && inDebounceWindow) {
                    return false;
                }

                lastRelayDecisionSignatureRef.current = signature;
                lastRelayDecisionTickRef.current = timeRef.current;
                return true;
            };

        if (!suppressRelayOperations && timeRef.current >= relaySwapCooldownUntilTickRef.current) {
            const outgoingRelay = relayDrones.find(d => isFieldRelay(d) && d.battery <= RELAY_LOW_BATTERY_THRESHOLD);

            if (outgoingRelay) {
                const standbyRelay = relayDrones.find(d =>
                    d.id !== outgoingRelay.id &&
                    d.mode === 'Charging' &&
                    d.battery >= RELAY_TAKEOVER_MIN_BATTERY &&
                    isNearBase(d)
                );

                if (standbyRelay) {
                    const takeoverTarget = { x: outgoingRelay.tx, y: outgoingRelay.ty };
                    relayTakeoverTargetRef.current = takeoverTarget;
                    relaySwapCooldownUntilTickRef.current = timeRef.current + 20;

                    const decisionSignature = [
                        'relay_handoff',
                        outgoingRelay.id,
                        standbyRelay.id,
                        Math.round(takeoverTarget.x * 10),
                        Math.round(takeoverTarget.y * 10),
                    ].join(':');

                    if (shouldEmitRelayDecision(decisionSignature)) {
                        onRelaySwapDecisionMade(
                            '',
                            `Relay handoff decision required. ${outgoingRelay.id} battery is ${outgoingRelay.battery.toFixed(1)}% (<= ${RELAY_LOW_BATTERY_THRESHOLD}%) at target (${takeoverTarget.x.toFixed(1)}, ${takeoverTarget.y.toFixed(1)}). ${standbyRelay.id} is ready at base with ${standbyRelay.battery.toFixed(1)}% battery. Decide now: replace relay if needed, otherwise no_action with reason.`
                        );
                    }
                }
            }
        }

        if (!suppressRelayOperations && !relayDrones.some(isFieldRelay) && timeRef.current >= relaySwapCooldownUntilTickRef.current) {
            const readyRelays = relayDrones.filter(d =>
                d.mode === 'Charging' &&
                d.battery >= RELAY_TAKEOVER_MIN_BATTERY &&
                isNearBase(d)
            );

            if (readyRelays.length > 0) {
                const preferred = readyRelays.find(r => r.id !== lastFieldRelayIdRef.current) ?? readyRelays[0];
                relaySwapCooldownUntilTickRef.current = timeRef.current + 20;

                const decisionSignature = [
                    'relay_deploy',
                    preferred.id,
                    Math.round(relayTakeoverTargetRef.current.x * 10),
                    Math.round(relayTakeoverTargetRef.current.y * 10),
                ].join(':');

                if (shouldEmitRelayDecision(decisionSignature)) {
                    onRelaySwapDecisionMade(
                        preferred.id,
                        `Relay coverage decision required. No active field relay is currently deployed. ${preferred.id} is ready at base (${preferred.battery.toFixed(1)}% battery). Preferred relay target is (${relayTakeoverTargetRef.current.x.toFixed(1)}, ${relayTakeoverTargetRef.current.y.toFixed(1)}). Decide whether to deploy this relay to restore coverage or no_action with reason.`
                    );
                }
            }
        }

        drones.forEach(d => {
            if (d.startTick !== undefined && timeRef.current < d.startTick) return;

            const isAiDisconnected = aiDisconnectedRef.current.has(d.id);

            if (isAiDisconnected) {
                d.isConnected = false;
                d.tx = d.x;
                d.ty = d.y;
                d.targetSector = null;
                d.mode = d.mode === 'Charging' ? 'Charging' : 'Wide';
                return;
            }

            if (missionComplete) {
                d.savedTx = undefined;
                d.savedTy = undefined;
                d.tx = BASE_X;
                d.ty = BASE_Y;
            }

            const headingToBase =
                Math.round(d.tx) === BASE_STATION.x &&
                Math.round(d.ty) === BASE_STATION.y;

            if (hasActiveSearchArea && !missionReturnTriggeredRef.current && !headingToBase && d.mode !== 'Relay' && d.mode !== 'Charging') {
                const droneOutsideArea = !isInsideActiveSearchArea(d.x, d.y);
                if (droneOutsideArea) {
                    const areaTarget = findNearestCellInsideSearchArea(d);
                    if (areaTarget) {
                        setDroneTarget(d, areaTarget.x, areaTarget.y);
                        d.lockTarget = false;
                        d.preventReassignment = false;
                    }
                }
            }

            if (d.mode === 'Charging') {
                d.battery = Math.min(100, d.battery + 0.5);
                if (d.battery >= 100) {
                    if (d.id.startsWith('RLY')) {
                        return;
                    }

                    if (missionReturnTriggeredRef.current || missionComplete || areaMissionComplete || scanProgress >= 100) {
                        d.battery = 100;
                        d.mode = 'Charging';
                        d.tx = BASE_X;
                        d.ty = BASE_Y;
                        d.savedTx = undefined;
                        d.savedTy = undefined;
                        d.lockTarget = false;
                        d.preventReassignment = true;
                        return;
                    }

                    d.battery = 100;
                    d.mode = 'Wide';
                    d.preventReassignment = false;

                    let targetAssigned = false;

                    if (microScanOnlyRef.current) {
                        let bestSector: Sector | null = null;
                        let minScore = Infinity;

                        grid.forEach(row => row.forEach(sec => {
                            if (!isInsideActiveSearchArea(sec.x, sec.y)) return;
                            const isSurvivor = pinsRef.current.some(p => p.x === sec.x && p.y === sec.y);
                            if (!sec.scanned && !isSurvivor) {
                                const isOccupied = drones.some(other => other.id !== d.id && Math.round(other.tx) === sec.x && Math.round(other.ty) === sec.y);
                                if (!isOccupied) {
                                    const dist = Math.sqrt(Math.pow(sec.x - d.x, 2) + Math.pow(sec.y - d.y, 2));
                                    const score = dist + (sec.y * 0.1) + (sec.x * 0.01);
                                    if (score < minScore) {
                                        minScore = score;
                                        bestSector = sec;
                                    }
                                }
                            }
                        }));

                        if (bestSector !== null) {
                            d.tx = (bestSector as Sector).x;
                            d.ty = (bestSector as Sector).y;
                            targetAssigned = true;
                        }
                    } else {
                        const highProbSectors: Sector[] = [];
                        grid.forEach(row => row.forEach(sec => {
                            if (!isInsideActiveSearchArea(sec.x, sec.y)) return;
                            if (sec.scanned && sec.prob > THRESHOLD_MICRO) highProbSectors.push(sec);
                        }));

                        for (const sec of highProbSectors) {
                            const isOccupied = drones.some(other => other.id !== d.id && Math.round(other.tx) === sec.x && Math.round(other.ty) === sec.y);
                            if (!isOccupied) {
                                d.tx = sec.x;
                                d.ty = sec.y;
                                targetAssigned = true;
                                break;
                            }
                        }

                        if (!targetAssigned && zonesRef.current.length > 0) {
                            const availZone = zonesRef.current.find(z =>
                                z.unscannedCount > 0 &&
                                z.assignedDroneIds.length < 2 &&
                                isInsideActiveSearchArea(z.centroid.x, z.centroid.y)
                            );
                            if (availZone) {
                                d.tx = availZone.centroid.x;
                                d.ty = availZone.centroid.y;
                                targetAssigned = true;
                            }
                        }

                        if (!targetAssigned) {
                            let bestSector: Sector | null = null;
                            let maxProb = -1;
                            grid.forEach(row => row.forEach(sec => {
                                if (!isInsideActiveSearchArea(sec.x, sec.y)) return;
                                const isSurvivor = pinsRef.current.some(p => p.x === sec.x && p.y === sec.y);
                                if (!sec.scanned && sec.prob > maxProb && !isSurvivor) {
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
                                targetAssigned = true;
                            }
                        }
                    }

                    if (targetAssigned) {
                        const distToT = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));
                        d.mode = distToT < 1.5 ? 'Micro' : 'Wide';
                    } else if (d.savedTx !== undefined && d.savedTy !== undefined) {
                        d.tx = d.savedTx;
                        d.ty = d.savedTy;
                    } else {
                        d.tx = BASE_X;
                        d.ty = BASE_Y;
                    }

                    d.savedTx = undefined;
                    d.savedTy = undefined;
                }
                return;
            }

            if (d.mode === 'Relay') {
                d.battery = Math.max(0, d.battery - 0.035);
                const relayDistToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));

                if (relayDistToTarget < 0.3 && d.tx === BASE_X && d.ty === BASE_Y) {
                    d.x = BASE_X;
                    d.y = BASE_Y;
                    d.mode = 'Charging';
                } else if (relayDistToTarget >= 0.3) {
                    const relaySpeed = 0.225;
                    const relayAngle = Math.atan2(d.ty - d.y, d.tx - d.x);
                    d.x += Math.cos(relayAngle) * Math.min(relaySpeed, relayDistToTarget);
                    d.y += Math.sin(relayAngle) * Math.min(relaySpeed, relayDistToTarget);
                    d.x = Math.max(0, Math.min(GRID_W - 1, d.x));
                    d.y = Math.max(0, Math.min(GRID_H - 1, d.y));
                }

                // Breadcrumb Path Recording for Relay
                const lastRelayPath = d.path[d.path.length - 1];
                if (!lastRelayPath || Math.abs(lastRelayPath.x - d.x) > 0.15 || Math.abs(lastRelayPath.y - d.y) > 0.15) {
                    d.path.push({ x: d.x, y: d.y, tick: timeRef.current });
                    if (d.path.length > 5000) {
                        d.path.shift();
                    }
                }

                return;
            }

            const mcpRecallThreshold = autoRecallThresholdsRef.current.get(d.id);
            if (mcpRecallThreshold !== undefined && d.battery <= mcpRecallThreshold) {
                if (d.tx !== BASE_STATION.x || d.ty !== BASE_STATION.y) {
                    if (d.savedTx === undefined) {
                        d.savedTx = d.tx;
                        d.savedTy = d.ty;
                    }
                    d.tx = BASE_STATION.x;
                    d.ty = BASE_STATION.y;
                }
            }

            const distToBase = Math.sqrt(Math.pow(BASE_X - d.x, 2) + Math.pow(BASE_Y - d.y, 2));
            const batteryReqForReturn = distToBase * 0.3;
            const criticalBattery = Math.max(5, batteryReqForReturn + 2);
            const lowBattery = Math.max(20, criticalBattery + 15);
            const distTargetToBase = Math.sqrt(Math.pow(BASE_X - d.tx, 2) + Math.pow(BASE_Y - d.ty, 2));

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
                        if (d.isConnected) addMessage(d.id, 'REQUEST_ASSIST', { handoverTo: (swapDrone as Drone).id });

                        (swapDrone as Drone).tx = d.tx;
                        (swapDrone as Drone).ty = d.ty;
                        (swapDrone as Drone).mode = d.mode;

                        d.mode = 'Wide';
                    }
                }
            }

            if (d.battery < criticalBattery && d.tx !== BASE_X && d.ty !== BASE_Y) {
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }
                d.tx = BASE_X;
                d.ty = BASE_Y;
            }
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
                    bestX = BASE_X;
                    bestY = BASE_Y;
                }
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }
                d.tx = bestX;
                d.ty = bestY;
            }

            const distToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));
            const sx = Math.max(0, Math.min(GRID_W - 1, Math.round(d.x)));
            const sy = Math.max(0, Math.min(GRID_H - 1, Math.round(d.y)));
            const sector = grid[sy][sx];
            const isNewCell = sx !== d.lastScannedX || sy !== d.lastScannedY;
            const isPeriodicMicroScan = d.mode === 'Micro' && timeRef.current % 10 === 0;

            // ── Opportunistic Scanning (Phase 12) ───────────────────────
            if ((d.mode as string) !== 'Charging' && (isNewCell || isPeriodicMicroScan)) {
                // Surgical Skip: if this EXACT cell is a Pin, only scan if it was UNSCANNED
                const isPinned = pinsRef.current.some(p => Math.round(p.x) === sx && Math.round(p.y) === sy);
                const insideSearchAreaNow = isInsideActiveSearchArea(sx, sy);
                const shouldScan = insideSearchAreaNow && !(isPinned && sector.scanned && d.mode !== 'Micro');

                if (shouldScan) {
                    d.lastScannedX = sx;
                    d.lastScannedY = sy;

                    const isFirstScan = !sector.scanned;
                    sector.scanned = true;
                    sector.lastScanned = timeRef.current;

                    const jitter = (Math.random() * 0.04) - 0.02;
                    const rawProb = Math.max(0, Math.min(1.0, getSectorProbability(sx, sy) + jitter));
                    let newProb = rawProb;
                    const survivorAtSector = survivors.find(s => s.x === sx && s.y === sy && !s.found);

                    if (!isPinned && survivorAtSector && rawProb >= THRESHOLD_FOUND) {
                        newProb = 0.79 + (Math.floor(Math.random() * 8) / 100);
                    }

                    const zone = getZoneForCell(zonesRef.current, sx, sy);
                    if (zone && (isFirstScan || d.mode === 'Wide' || d.mode === 'Micro')) {
                        recordCellScan(
                            searchMemoryRef.current, zone.zoneId,
                            sx, sy, timeRef.current, newProb > THRESHOLD_MICRO
                        );
                    }

                    if (isFirstScan) {
                        metricsRef.current.totalUniqueScans++;
                        metricsRef.current.uniqueProbSum += newProb;
                    }
                    sector.scanned = true;
                    sector.lastScanned = timeRef.current;
                    sector.prob = newProb;
                    sector.lastVisitedTick = timeRef.current;

                    if (newProb > 0.2) {
                        sector.confidence = Math.min(1.0, sector.confidence + newProb * 0.15);
                    } else if (newProb < 0.1) {
                        sector.confidence = 0;
                    }

                    sector.pheromone = 1.0;

                    // Mode switching based on signal
                    if (d.mode === 'Wide' && newProb > THRESHOLD_MICRO && d.battery >= lowBattery && !d.id.startsWith('RLY-')) {
                        d.mode = 'Micro';
                        d.lockTarget = true;
                        d.preventReassignment = true;
                        // Important: stay here to verify!
                        setDroneTarget(d, sx, sy);
                        if (d.isConnected) addMessage(d.id, 'REQUEST_ASSIST', { sector: `[${sx},${sy}]` });
                    }

                    // Discovery check
                    if (sector.confidence >= THRESHOLD_FOUND) {
                        if (survivorAtSector) {
                            finalizeDiscovery(survivorAtSector.id, d.id, sx, sy);
                        } else {
                            sector.confidence = 0;
                            sector.prob *= 0.5;
                            d.mode = 'Wide';
                            d.lockTarget = false;
                            d.preventReassignment = false;
                        }
                    }

                    // ── Sync Dashboard Metrics ──────────────────────────────
                    metricsRef.current.totalScans = searchMemoryRef.current.totalScans;
                    metricsRef.current.totalRepeatScans = searchMemoryRef.current.repeatScans;
                    metricsRef.current.repeatedScanRate = (metricsRef.current.totalScans > 0)
                        ? (metricsRef.current.totalRepeatScans / metricsRef.current.totalScans) * 100 : 0;
                    metricsRef.current.meanProbabilityScanned = (metricsRef.current.totalUniqueScans > 0)
                        ? (metricsRef.current.uniqueProbSum / metricsRef.current.totalUniqueScans)
                        : 0;
                }
            }

            // ── Target Arrival / Routing Logic ────────────────────────
            if (distToTarget < 0.5) {
                if (d.tx === BASE_X && d.ty === BASE_Y) {
                    if (d.battery <= 50 || missionComplete || missionReturnTriggeredRef.current || scanProgress >= 100) {
                        d.mode = 'Charging';
                        return;
                    }
                }

                if (d.mode === 'Wide') {
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                    let options = dirs
                        .map(dir => ({ x: sx + dir[0], y: sy + dir[1] }))
                        .filter(pos => pos.x >= 0 && pos.x < GRID_W && pos.y >= 0 && pos.y < GRID_H)
                        .filter(pos => isInsideActiveSearchArea(pos.x, pos.y))
                        .filter(pos => {
                            const s = grid[pos.y][pos.x];
                            const isPinned = pinsRef.current.some(p => Math.abs(p.x - pos.x) <= 1.5 && Math.abs(p.y - pos.y) <= 1.5);
                            if (isPinned) return false;
                            const isHighProbHotspot = s.prob > 0.6 && (timeRef.current - s.lastVisitedTick) > 10;
                            const isNotOvercrowded = s.currentDrones < 2;
                            return (!s.scanned || isHighProbHotspot) && isNotOvercrowded;
                        });

                    const filtered = options.filter(opt => {
                        return !drones.some(other => other.id !== d.id && Math.round(other.tx) === opt.x && Math.round(other.ty) === opt.y);
                    });
                    if (filtered.length > 0) options = filtered;

                    if (options.length > 0) {
                        options.sort((a, b) => {
                            const cellA = grid[a.y][a.x];
                            const cellB = grid[b.y][b.x];
                            const unscannedBonusA = cellA.scanned ? 0 : 0.5;
                            const unscannedBonusB = cellB.scanned ? 0 : 0.5;
                            const scoreA = cellA.prob + unscannedBonusA + (cellA.pheromone * 0.1);
                            const scoreB = cellB.prob + unscannedBonusB + (cellB.pheromone * 0.1);
                            return scoreB - scoreA;
                        });
                        setDroneTarget(d, options[0].x, options[0].y);
                    } else if (zonesRef.current.length > 0) {
                        const availZone = zonesRef.current.find(z =>
                            z.unscannedCount > 0 &&
                            z.assignedDroneIds.length < 2 &&
                            isInsideActiveSearchArea(z.centroid.x, z.centroid.y)
                        );
                        if (availZone) {
                            setDroneTarget(d, availZone.centroid.x, availZone.centroid.y);
                        }
                    }
                }

                if (d.mode === 'Micro') {
                    const jitterProb = Math.max(0, Math.min(1.0, getSectorProbability(sx, sy)));
                    if (jitterProb < THRESHOLD_MICRO || d.battery < lowBattery) {
                        d.mode = 'Wide';
                        d.lockTarget = false;
                        d.preventReassignment = false;
                    } else {
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        let validDirs = dirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H && isInsideActiveSearchArea(nx, ny);
                        });

                        const filteredDirs = validDirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return !drones.some(other => other.id !== d.id && other.mode === 'Micro' && Math.round(other.tx) === nx && Math.round(other.ty) === ny);
                        });
                        if (filteredDirs.length > 0) validDirs = filteredDirs;

                        validDirs.sort((a, b) => {
                            const probA = grid[sy + a[1]][sx + a[0]].prob;
                            const probB = grid[sy + b[1]][sx + b[0]].prob;
                            const noiseA = Math.random() * 0.02;
                            const noiseB = Math.random() * 0.02;
                            return (probB + noiseB) - (probA + noiseA);
                        });

                        if (validDirs.length > 0) {
                            const move = validDirs[0];
                            setDroneTarget(d, sx + move[0], sy + move[1]);
                        }
                    }
                }
            } else {
                // ── Physical Movement Logic ─────────────────────────
                const moveSpeed = d.mode === 'Wide' ? 0.3 : 0.075;
                let totalMove = Math.min(moveSpeed, distToTarget);
                let angle = Math.atan2(d.ty - d.y, d.tx - d.x);

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
                    totalMove = Math.min(totalMove, Math.sqrt(finalDx * finalDx + finalDy * finalDy));
                }

                d.x += Math.cos(angle) * totalMove;
                d.y += Math.sin(angle) * totalMove;

                d.x = Math.max(0, Math.min(GRID_W - 1, d.x));
                d.y = Math.max(0, Math.min(GRID_H - 1, d.y));

                const sensorDrain = d.mode === 'Wide' ? 0.015 : 0.005;
                const movementDrain = totalMove * 0.075;
                d.battery -= (sensorDrain + movementDrain);

                // Breadcrumb Path Recording
                const last = d.path[d.path.length - 1];
                if (!last || Math.abs(last.x - d.x) > 0.15 || Math.abs(last.y - d.y) > 0.15) {
                    d.path.push({ x: d.x, y: d.y, tick: timeRef.current });
                    if (d.path.length > 5000) {
                        d.path.shift();
                    }
                }
            }
        });

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

        // Force Micro Mode if microScanOnly is active globally
        if (microScanOnlyRef.current) {
            drones.forEach(d => {
                if (!d.id.startsWith('RLY-') && d.mode !== 'Charging') {
                    d.mode = 'Micro';
                    d.preventReassignment = true; 
                }
            });
        }

        if (timeRef.current > 0 && timeRef.current % 100 === 0) {
            const connected = drones.filter(d => d.isConnected && d.mode !== 'Relay');
            if (connected.length > 0) {
                addMessage(connected[Math.floor(Math.random() * connected.length)].id, 'MAP_SHARE', { bytes: 1420 });
            }
        }

        if (!missionReturnTriggeredRef.current && !areaMissionComplete && timeRef.current % ZONE_PIPELINE_INTERVAL === 0 && timeRef.current > 0) {
            const gridCells: GridCell[][] = grid.map(row =>
                row.map(sec => ({
                    x: sec.x,
                    y: sec.y,
                    prob: sec.prob,
                    pheromone: sec.pheromone,
                    scanned: sec.scanned,
                    lastScanned: sec.lastScanned,
                    lastVisitedTick: sec.lastVisitedTick,
                    signals: sec.signals,
                }))
            );

            const focusedGridCells = selectedCellsRef.current
                .map(p => grid[p.y]?.[p.x])
                .filter((cell): cell is Sector => Boolean(cell));

            const zones = missionOverrideRef.current && focusedGridCells.length >= 3
                ? clusterCellsIntoZones(focusedGridCells, GRID_W, GRID_H, 4)
                : clusterZones(gridCells, GRID_W, GRID_H, 4);
            const scoredZones = scoreZones(zones, searchMemoryRef.current, timeRef.current, pinsRef.current);
            const zonesToUse = missionOverrideRef.current && searchAreaRef.current.length >= 3
                ? scoredZones
                    .filter(z => isPointInPolygon(z.centroid.x, z.centroid.y, searchAreaRef.current))
                    .filter(z => z.unscannedCount > 0)
                : scoredZones;
            zonesRef.current = zonesToUse;

            const allocatable = drones
                .filter(d =>
                    d.mode !== 'Relay' &&
                    d.mode !== 'Charging' &&
                    !aiDisconnectedRef.current.has(d.id)
                )
                .map(d => ({ id: d.id, x: d.x, y: d.y, battery: d.battery, mode: d.mode }));

            const missions = allocateDrones(allocatable, zonesToUse, searchMemoryRef.current, timeRef.current, pinsRef.current);
            activeMissionsRef.current = missions;

            for (const mission of missions) {
                const drone = drones.find(d => d.id === mission.droneId);
                if (!drone) continue;
                if (aiDisconnectedRef.current.has(drone.id)) continue;

                // Skip reassignment if drone is heading to base to charge (low battery)
                const headingToBase =
                    Math.round(drone.tx) === BASE_STATION.x &&
                    Math.round(drone.ty) === BASE_STATION.y;

                const distToBase = Math.sqrt(Math.pow(BASE_STATION.x - drone.x, 2) + Math.pow(BASE_STATION.y - drone.y, 2));
                const criticalBattery = Math.max(5, distToBase * 0.3 + 2);
                const lowBattery = Math.max(20, criticalBattery + 15);
                const isLowBattery = drone.battery < lowBattery;

                if (headingToBase && isLowBattery) {
                    drone.preventReassignment = true;
                    continue;
                }

                let targetX = mission.targetX;
                let targetY = mission.targetY;

                if (hasActiveSearchArea) {
                    const missionInside = isInsideActiveSearchArea(mission.targetX, mission.targetY);
                    const customAreaTarget = missionInside
                        ? { x: Math.round(mission.targetX), y: Math.round(mission.targetY) }
                        : (findNearestAreaCellToPoint(mission.targetX, mission.targetY) ?? findNearestCellInsideSearchArea(drone));

                    if (!customAreaTarget) continue;

                    targetX = customAreaTarget.x;
                    targetY = customAreaTarget.y;
                }

                if (drone.battery < lowBattery) continue;

                const distToTarget = Math.sqrt(Math.pow(drone.tx - drone.x, 2) + Math.pow(drone.ty - drone.y, 2));

                const isDivertable = distToTarget < 0.5 || drone.mode === 'Wide' || distToTarget > 3.0;

                if (isDivertable && !drone.preventReassignment) {
                    setDroneTarget(drone, targetX, targetY);

                    const distToNewTarget = Math.sqrt(Math.pow(drone.tx - drone.x, 2) + Math.pow(drone.ty - drone.y, 2));

                    if (mission.action === 'micro_scan') {
                        if (distToNewTarget < 1.5) {
                            drone.mode = 'Micro';
                            drone.lockTarget = true;
                            drone.preventReassignment = true;
                        } else {
                            drone.mode = 'Wide';
                            drone.lockTarget = false;
                            drone.preventReassignment = false;
                        }
                    } else {
                        drone.mode = 'Wide';
                        drone.lockTarget = false;
                        drone.preventReassignment = false;
                    }
                }
            }

            metricsRef.current.missionTimeSec = timeRef.current * (SIM_TICK_MS / 1000);
        }

        if (missionComplete && !missionStopHandledRef.current) {
            const allAtBase = drones.every(d => Math.sqrt(Math.pow(d.x - BASE_STATION.x, 2) + Math.pow(d.y - BASE_STATION.y, 2)) < 0.5);
            if (allAtBase) {
                missionStopHandledRef.current = true;
                setRunning(false);
            }
        }

        grid.forEach(row => row.forEach(sec => {
            if (sec.pheromone > 0) sec.pheromone *= 0.95; // Increased decay for better dynamics
        }));

        if (timeRef.current % 5 === 0) {
            const existing = gridDataService.getWeights();
            const weightGrid: number[][] = Array.from({ length: GRID_H }, (_, y) =>
                Array.from({ length: GRID_W }, (_, x) =>
                    grid[y][x].scanned ? grid[y][x].prob : (existing[y]?.[x] ?? 0.05)
                )
            );
            gridDataService.setWeights(weightGrid, 'scan');
        }

        // Call the MCP Sync/Process callbacks passed from useSimulationMCP via the main component loop
        if (timeRef.current % 10 === 0) {
            onMcpSyncRequest();
        }

        if (timeRef.current % 5 === 0) {
            onMcpCommandProcessRequest();
        }

        setTickFlip(f => f + 1);
    }, [finalizeDiscovery]);

    return {
        // State
        running, setRunning,
        speed, setSpeed,
        selectedPin, setSelectedPin,
        showSensors, setShowSensors,
        showTrails, setShowTrails,
        selectedTrailDroneId, setSelectedTrailDroneId,
        randomizeBattery, setRandomizeBattery,
        showActualMap, setShowActualMap,
        timeLimit, setTimeLimit,
        useTimeLimit, setUseTimeLimit,
        searchArea,
        setSearchArea,
        isDrawingMode,
        setIsDrawingMode,
        selectedCells,
        missionOverride,
        setMissionOverride,
        searchScanActive,
        setSearchScanActive,

        // Refs
        gridRef,
        dronesRef,
        survivorsRef,
        pinsRef,
        timeRef,
        commLinksRef,
        swarmMessagesRef,
        sensorWeightsRef,
        autoRecallThresholdsRef,
        failureEventsRef,
        aiDisconnectedRef,
        aiReconnectAttemptTickRef,
        aiReconnectedUntilTickRef,
        relayTakeoverTargetRef,
        relaySwapCooldownUntilTickRef,
        lastFieldRelayIdRef,
        zonesRef,
        searchMemoryRef,
        activeMissionsRef,
        metricsRef,
        aiBusyRef,

        // Handlers
        toggleRunning,
        resetSim,
        triggerFailureEvent,
        getSectorProbability,
        performTickCore,
        microScanOnly,
        toggleMicroScanOnly,
        centerLocation,
        setCenterLocation
    };
};
