import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, FastForward, Target, Radio, Crosshair, RotateCcw, Activity, Hexagon, MapPin, X, Shield } from 'lucide-react';

const GRID_W = 20;
const GRID_H = 20;
const CELL_SIZE = 35; // Size of each grid square in pixels

// Sensor definitions for Adaptive Weighting
const SENSORS = {
    mobile: { base: 0.4, conf: 0.9, color: '#00ffcc' },
    thermal: { base: 0.3, conf: 0.6, color: '#ff4444' },
    sound: { base: 0.2, conf: 0.7, color: '#ffff00' },
    wifi: { base: 0.1, conf: 0.8, color: '#ff00ff' }
};

const getEffectiveWeight = (key: keyof typeof SENSORS) => SENSORS[key].base * SENSORS[key].conf;

const THRESHOLD_MICRO = 0.5;
const THRESHOLD_FOUND = 0.85;

// Types
type Sector = {
    x: number;
    y: number;
    prob: number;
    pheromone: number;
    terrain: string;
    scanned: boolean;
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
    savedTx?: number;
    savedTy?: number;
    knownOtherDrones: { [id: string]: { x: number, y: number, lastUpdate: number } };
};

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
    info: any;
};

// Utilities
// Haversine Distance (Using fake lat/lon mapping for the grid)
const getLatLon = (x: number, y: number) => ({
    lat: 1.5600 - (y * 0.001),
    lon: 103.6300 + (x * 0.001)
});

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Mock data generation
const createGrid = (): Sector[][] => {
    const g: Sector[][] = [];
    for (let y = 0; y < GRID_H; y++) {
        const row: Sector[] = [];
        for (let x = 0; x < GRID_W; x++) {
            const r = Math.random();
            let terrain = 'Open Field';
            if (r < 0.2) terrain = 'Road';
            else if (r < 0.4) terrain = 'Collapsed Area';
            else if (r < 0.5) terrain = 'Shelter';

            row.push({ x, y, prob: 0, pheromone: 0, terrain, scanned: false });
        }
        g.push(row);
    }
    return g;
};

const createDrones = (): Drone[] => {
    return [
        { id: 'DRN-ALPHA', x: 9, y: 9, tx: 2, ty: 2, mode: 'Wide', battery: 100, targetSector: null, knownOtherDrones: {} },
        { id: 'DRN-BETA', x: 10, y: 9, tx: 17, ty: 2, mode: 'Wide', battery: 95, targetSector: null, knownOtherDrones: {} },
        { id: 'DRN-GAMMA', x: 9, y: 10, tx: 2, ty: 17, mode: 'Wide', battery: 90, targetSector: null, knownOtherDrones: {} },
        { id: 'DRN-DELTA', x: 10, y: 10, tx: 17, ty: 17, mode: 'Wide', battery: 85, targetSector: null, knownOtherDrones: {} },
        { id: 'RLY-PRIME', x: 9.5, y: 9.5, tx: 9.5, ty: 9.5, mode: 'Relay', battery: 100, targetSector: null, knownOtherDrones: {} }
    ];
};

const createSurvivors = (): HiddenSurvivor[] => {
    return [
        { id: 'S1', x: 5, y: 5, found: false, info: { message: "Trapped under concrete. Leg injured.", battery: "12%" } },
        { id: 'S2', x: 15, y: 12, found: false, info: { message: "Safe but cannot exit building. 3 people here.", battery: "45%" } },
        { id: 'S3', x: 8, y: 18, found: false, info: { message: "Need water asap.", battery: "5%" } }
    ];
};

// Component
const SimulationMapDuplicate: React.FC = () => {
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(1);

    // Sim State Refs (to avoid React render loop lag, but we will force render for UI updates)
    const gridRef = useRef<Sector[][]>(createGrid());
    const dronesRef = useRef<Drone[]>(createDrones());
    const survivorsRef = useRef<HiddenSurvivor[]>(createSurvivors());
    const pinsRef = useRef<FoundPin[]>([]);
    const timeRef = useRef<number>(0);
    const logsRef = useRef<{ time: number, msg: string, type: 'alert' | 'info' | 'success' }[]>([]);
    const [, setTickFlip] = useState(0); // Forcing re-render
    const [selectedPin, setSelectedPin] = useState<FoundPin | null>(null);

    const resetSim = () => {
        setRunning(false);
        gridRef.current = createGrid();
        dronesRef.current = createDrones();
        survivorsRef.current = createSurvivors();
        pinsRef.current = [];
        logsRef.current = [];
        timeRef.current = 0;
        setSelectedPin(null);
        setTickFlip(f => f + 1);
    };

    const getSectorProbability = (x: number, y: number) => {
        // True probability depends on proximity to hidden survivors
        let base_prob = 0.05 + (Math.random() * 0.1);
        let max_signal = 0;

        survivorsRef.current.forEach(s => {
            if (s.found) return;
            const dist = Math.abs(s.x - x) + Math.abs(s.y - y); // Manhattan
            if (dist === 0) {
                // Actual survivor cell! Produce strong signals
                max_signal = Math.max(max_signal, 0.9 + Math.random() * 0.1);
            } else if (dist <= 2) {
                // Secondary area
                max_signal = Math.max(max_signal, 0.5 + Math.random() * 0.3);
            }
        });

        if (max_signal > 0) {
            // Apply adaptive sensors formula
            // We pretend the drone reads these signals and calculates score
            const m = Math.random() * max_signal;
            const w = Math.random() * max_signal;
            const t = Math.random() * max_signal;
            const sn = Math.random() * max_signal;

            const score = getEffectiveWeight('mobile') * m +
                getEffectiveWeight('wifi') * w +
                getEffectiveWeight('thermal') * t +
                getEffectiveWeight('sound') * sn;

            // Normalize sum of effective weights (no artificial booster, making it realistic/difficult)
            const sumWeights = getEffectiveWeight('mobile') + getEffectiveWeight('wifi') + getEffectiveWeight('thermal') + getEffectiveWeight('sound');
            return (score / sumWeights);
        }

        return base_prob;
    };

    const performTick = useCallback(() => {
        timeRef.current++;
        let grid = gridRef.current;
        let drones = dronesRef.current;
        let survivors = survivorsRef.current;

        // 1. Prediction / Markov Chain: Hidden survivors might move
        // Every 50 ticks, chance to move
        if (timeRef.current % 50 === 0) {
            survivors.forEach(s => {
                if (s.found) return;
                const r = Math.random();
                // 10% chance to move to adjacent cell based on terrain probabilities
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

        // 1.5 Mesh Network Position Broadcast
        // Every 5 ticks, drones broadcast their exact position
        // Other drones only receive it if they are within COMMS_RANGE
        const COMMS_RANGE = 8;
        if (timeRef.current % 5 === 0) {
            drones.forEach(broadcaster => {
                drones.forEach(receiver => {
                    if (broadcaster.id !== receiver.id) {
                        const distToOther = Math.sqrt(Math.pow(broadcaster.x - receiver.x, 2) + Math.pow(broadcaster.y - receiver.y, 2));
                        // Check if in communication range and not in a dead zone (e.g. collapsed area might reduce signal)
                        // For simplicity, we just use a hard range limit here
                        if (distToOther <= COMMS_RANGE || broadcaster.mode === 'Relay' || receiver.mode === 'Relay') {
                            // Update receiver's knowledge of broadcaster's position
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

        // 2. Drone Logic
        // Base Station location for charging
        const BASE_X = 9.5;
        const BASE_Y = 9.5;

        drones.forEach(d => {
            if (d.mode === 'Charging') {
                d.battery += 0.5; // Recharges fast in simulation
                if (d.battery >= 100) {
                    d.battery = 100;
                    d.mode = 'Wide';

                    // Check for unassigned hotspots first
                    let newTarget: { x: number, y: number } | null = null;
                    const highProbSectors: Sector[] = [];
                    gridRef.current.forEach(row => row.forEach(sec => {
                        if (sec.scanned && sec.prob > THRESHOLD_MICRO) highProbSectors.push(sec);
                    }));

                    // Find if any high prob sector is NOT targeted by another drone
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
                        logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} fully charged. Intercepting unassigned hotspot.`, type: 'info' });
                    } else if (d.savedTx !== undefined && d.savedTy !== undefined) {
                        d.tx = d.savedTx;
                        d.ty = d.savedTy;
                        logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} fully charged. Resuming previous task.`, type: 'info' });
                    } else {
                        // Find the highest probability unscanned sector on the map
                        let bestSector: Sector | null = null;
                        let maxProb = -1;

                        gridRef.current.forEach(row => row.forEach(sec => {
                            if (!sec.scanned && sec.prob > maxProb) {
                                // Make sure no one else is heading there!
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
                            logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} fully charged. Assigned highest probability search block.`, type: 'info' });
                        } else {
                            // Fallback if the whole map is scanned somehow
                            d.tx = Math.floor(Math.random() * GRID_W);
                            d.ty = Math.floor(Math.random() * GRID_H);
                            logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} fully charged. Starting random patrol.`, type: 'info' });
                        }
                    }

                    d.savedTx = undefined;
                    d.savedTy = undefined;
                    if (logsRef.current.length > 20) logsRef.current.pop();
                }
                return; // Can't move while charging
            }

            if (d.mode === 'Relay') {
                // Relays are plugged into the base station and don't drain
                d.battery = 100;
                return;
            }

            // Static battery drain relies on movement logic later in the loop

            const distToBase = Math.sqrt(Math.pow(BASE_X - d.x, 2) + Math.pow(BASE_Y - d.y, 2));
            const batteryReqForReturn = distToBase * 0.3; // safe margin for return journey
            const criticalBattery = Math.max(5, batteryReqForReturn + 2); // threshold to force RTB
            const lowBattery = Math.max(20, criticalBattery + 15); // threshold to stay near base
            const distTargetToBase = Math.sqrt(Math.pow(BASE_X - d.tx, 2) + Math.pow(BASE_Y - d.ty, 2));

            // 1. Task Handover Check (Applies for both low battery and critical battery)
            if (d.battery < lowBattery && d.tx !== BASE_X && d.ty !== BASE_Y) {
                const mySectorX = Math.max(0, Math.min(GRID_W - 1, Math.round(d.tx)));
                const mySectorY = Math.max(0, Math.min(GRID_H - 1, Math.round(d.ty)));
                const myProb = grid[mySectorY][mySectorX].prob;

                // Only consider swap if we are currently holding a hotspot and haven't already saved a task
                if ((d.mode === 'Micro' || myProb > THRESHOLD_MICRO) && d.savedTx === undefined) {
                    let swapDrone: any = null;
                    let minDist = Infinity;
                    drones.forEach(other => {
                        // Calculate the other drone's specific low battery threshold
                        const otherDistToBase = Math.sqrt(Math.pow(BASE_X - other.x, 2) + Math.pow(BASE_Y - other.y, 2));
                        const otherLowBatteryThreshold = Math.max(20, Math.max(5, otherDistToBase * 0.3 + 2) + 15);

                        // Only swap with healthy Wide-mode drones that are NOT already in their low-battery near-base patrol
                        if (other.id !== d.id && other.mode === 'Wide' && other.battery > otherLowBatteryThreshold) {
                            const otherSectorX = Math.max(0, Math.min(GRID_W - 1, Math.round(other.tx)));
                            const otherSectorY = Math.max(0, Math.min(GRID_H - 1, Math.round(other.ty)));
                            const otherProb = grid[otherSectorY][otherSectorX].prob;
                            // Only swap if our hotspot has a higher survival rate than their current target
                            if (myProb > otherProb) {
                                const dist = Math.sqrt(Math.pow(other.x - d.x, 2) + Math.pow(other.y - d.y, 2));
                                if (dist < minDist) {
                                    minDist = dist;
                                    swapDrone = other;
                                }
                            }
                        }
                    });

                    if (swapDrone) {
                        // Handover!
                        d.savedTx = swapDrone.tx;
                        d.savedTy = swapDrone.ty;
                        logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} low power. Handing over hotspot to ${swapDrone.id}.`, type: 'alert' });

                        swapDrone.tx = d.tx;
                        swapDrone.ty = d.ty;
                        swapDrone.mode = d.mode; // Copy the Micro mode to resume scanning

                        // Break current mode so we don't trigger this again on the same tick
                        d.mode = 'Wide';
                        if (logsRef.current.length > 20) logsRef.current.pop();
                    }
                }
            }

            // 2. RTB or Near Base assignments
            // Trigger RTB if battery drops below critical threshold
            if (d.battery < criticalBattery && d.tx !== BASE_X && d.ty !== BASE_Y) {
                // Save current target if we haven't already (e.g. from a handover)
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }

                d.tx = BASE_X;
                d.ty = BASE_Y;
                logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} adaptive RTB initiated (${Math.floor(d.battery)}%).`, type: 'alert' });
                if (logsRef.current.length > 20) logsRef.current.pop();
            }
            // Adaptive Low Battery: Assign to unsearched area near base
            else if (d.battery < lowBattery && d.battery >= criticalBattery && distTargetToBase > 4 && d.mode === 'Wide') {
                // Find an unsearched or low-scanned sector near base (radius 4)
                let bestX = BASE_X; let bestY = BASE_Y;
                let found = false;
                for (let r = 1; r <= 4; r++) {
                    for (let i = 0; i < 20; i++) {
                        const testX = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + (Math.random() - 0.5) * r * 2)));
                        const testY = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + (Math.random() - 0.5) * r * 2)));

                        // Enforce strictly that the new target is within radius 4 of base
                        const distToNewTarget = Math.sqrt(Math.pow(BASE_X - testX, 2) + Math.pow(BASE_Y - testY, 2));
                        if (distToNewTarget <= 4 && !grid[testY][testX].scanned) {
                            bestX = testX; bestY = testY; found = true; break;
                        }
                    }
                    if (found) break;
                }

                // If all cells near base are already scanned, just pick a random patrol spot near base
                if (!found) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = Math.random() * 4;
                    bestX = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + Math.cos(angle) * r)));
                    bestY = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + Math.sin(angle) * r)));
                }

                // Save current target if needed
                if (d.savedTx === undefined) {
                    d.savedTx = d.tx;
                    d.savedTy = d.ty;
                }

                d.tx = bestX;
                d.ty = bestY;
                logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} low battery (${Math.floor(d.battery)}%). Reassigning near base.`, type: 'info' });
                if (logsRef.current.length > 20) logsRef.current.pop();
            }

            // Check if we reached target
            const distToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));

            if (distToTarget < 0.3) {
                // Are we returning to base?
                if (d.tx === BASE_X && d.ty === BASE_Y && d.battery <= 50) {
                    d.mode = 'Charging';
                    logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} docked at Base. Charging...`, type: 'info' });
                    if (logsRef.current.length > 20) logsRef.current.pop();
                    return;
                }
                // At target! Scan and assign new
                const sx = Math.round(d.tx);
                const sy = Math.round(d.ty);
                const sector = grid[sy][sx];

                sector.scanned = true;
                const newProb = getSectorProbability(sx, sy);

                // Update probability and pheromone (Swarm Intelligence)
                const oldProb = sector.prob;
                sector.prob = newProb;
                if (newProb > oldProb) {
                    sector.pheromone += newProb; // Increase attr
                }

                // Check Micro vs Wide
                if (d.mode === 'Wide') {
                    // Only switch to Micro if we have enough battery to actually do the job
                    if (newProb > THRESHOLD_MICRO && d.battery >= lowBattery) {
                        // Switch to Micro-Scan (Exploitation)
                        d.mode = 'Micro';
                    } else {
                        // Ant Colony Routing: Pick a nearby sector based on pheromones
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        let options = dirs
                            .map(dir => ({ x: sx + dir[0], y: sy + dir[1] }))
                            .filter(pos => pos.x >= 0 && pos.x < GRID_W && pos.y >= 0 && pos.y < GRID_H);

                        // Avoid choosing a cell that another drone is already targeting or occupying recently
                        options = options.filter(opt => {
                            const isOccupied = drones.some(other =>
                                other.id !== d.id &&
                                (Math.round(other.tx) === opt.x && Math.round(other.ty) === opt.y)
                            );
                            return !isOccupied;
                        });

                        // If all options are occupied, just pick any valid neighbor to keep moving
                        if (options.length === 0) {
                            options = dirs
                                .map(dir => ({ x: sx + dir[0], y: sy + dir[1] }))
                                .filter(pos => pos.x >= 0 && pos.x < GRID_W && pos.y >= 0 && pos.y < GRID_H);
                        }

                        // Favor high pheromone but add randomness for exploration
                        // Sort by (pheromone * random)
                        options.sort((a, b) => {
                            const scoreA = (grid[a.y][a.x].pheromone + 0.1) * Math.random();
                            const scoreB = (grid[b.y][b.x].pheromone + 0.1) * Math.random();
                            return scoreB - scoreA;
                        });

                        d.tx = options[0].x;
                        d.ty = options[0].y;
                    }
                } else if (d.mode === 'Micro') {
                    if (newProb > THRESHOLD_FOUND) {
                        // Found a survivor!
                        const s = survivors.find(s => s.x === sx && s.y === sy && !s.found);
                        if (s) {
                            s.found = true;
                            // Clear pheromone footprint so drones leave
                            for (let py = Math.max(0, sy - 3); py <= Math.min(GRID_H - 1, sy + 3); py++) {
                                for (let px = Math.max(0, sx - 3); px <= Math.min(GRID_W - 1, sx + 3); px++) {
                                    grid[py][px].pheromone = 0;
                                    grid[py][px].prob = 0;
                                }
                            }

                            if (!pinsRef.current.find(p => p.id === s.id)) {
                                pinsRef.current.push({
                                    id: s.id,
                                    x: sx,
                                    y: sy,
                                    info: s.info
                                });
                                logsRef.current.unshift({ time: timeRef.current, msg: `${d.id} confirmed Survivor ${s.id} at [${sx},${sy}]`, type: 'success' });
                                if (logsRef.current.length > 20) logsRef.current.pop();
                            }

                            // Send far away
                            d.mode = 'Wide';
                            d.tx = Math.floor(Math.random() * GRID_W);
                            d.ty = Math.floor(Math.random() * GRID_H);
                        }
                    }

                    // After micro scan, usually switch back to wide unless still hot
                    // Also immediately abort Micro mode if we hit Low Battery so we can fall back to the RTB logic
                    if (d.mode === 'Micro' && (newProb < THRESHOLD_MICRO || d.battery < lowBattery)) {
                        d.mode = 'Wide';
                    }

                    // Micro moves very slowly to adjacent
                    if (d.mode === 'Micro') {
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];

                        // Find neighbors with high probability to spread around the hotspot
                        let validDirs = dirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H;
                        });

                        // Filter out cells that other micro-drones are currently targeting
                        validDirs = validDirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            const isOccupied = drones.some(other =>
                                other.id !== d.id && other.mode === 'Micro' &&
                                Math.round(other.tx) === nx && Math.round(other.ty) === ny
                            );
                            return !isOccupied;
                        });

                        // If all adjacent cells are occupied by other micro drones, randomly pick one to maintain movement
                        if (validDirs.length === 0) {
                            validDirs = dirs.filter(dir => {
                                const nx = sx + dir[0]; const ny = sy + dir[1];
                                return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H;
                            });
                        }

                        // Prefer moving to cells that have higher probabilities (climbing the gradient)
                        validDirs.sort((a, b) => {
                            const probA = grid[sy + a[1]][sx + a[0]].prob;
                            const probB = grid[sy + b[1]][sx + b[0]].prob;
                            return probB - probA;
                        });

                        if (validDirs.length > 0) {
                            // Pick from top 2 choices to allow spreading but still follow signals
                            const move = validDirs[Math.floor(Math.random() * Math.min(2, validDirs.length))];
                            d.tx = sx + move[0];
                            d.ty = sy + move[1];
                        }
                    }
                }
            } else {
                // Move towards target
                const moveSpeed = d.mode === 'Wide' ? 0.4 : 0.1;
                let totalMove = Math.min(moveSpeed, distToTarget);
                let angle = Math.atan2(d.ty - d.y, d.tx - d.x);

                // Separation Force (Collision Avoidance based on Mesh Network knowledge)
                // We increase the required separation distance to force them further apart to prevent overlap
                const SEPARATION_DIST = d.mode === 'Wide' ? 3.0 : 2.0; // Bubble size
                let sepX = 0;
                let sepY = 0;
                let neighbors = 0;

                // Only consider drones that we know about from the mesh network
                Object.entries(d.knownOtherDrones).forEach(([id, knownPos]) => {
                    // Ignore data that is too old (e.g. older than 20 ticks) since the drone might have moved away
                    if (id !== d.id && (timeRef.current - knownPos.lastUpdate) < 20) {
                        const distToOther = Math.sqrt(Math.pow(knownPos.x - d.x, 2) + Math.pow(knownPos.y - d.y, 2));
                        if (distToOther < SEPARATION_DIST && distToOther > 0.01) {
                            // "I see a drone inside my safety bubble based on the last broadcast!"
                            let pushStrength = (SEPARATION_DIST - distToOther);
                            if (distToOther < 1.0) pushStrength *= 4.0; // Emergency repulse
                            else pushStrength *= 2.0; // Stronger normal repulse

                            sepX += (d.x - knownPos.x) / distToOther * pushStrength;
                            sepY += (d.y - knownPos.y) / distToOther * pushStrength;
                            neighbors++;
                        }
                    }
                });

                if (neighbors > 0) {
                    sepX /= neighbors;
                    sepY /= neighbors;

                    // Blend target direction with separation direction. 
                    const targetDx = Math.cos(angle) * moveSpeed;
                    const targetDy = Math.sin(angle) * moveSpeed;

                    // Limit the separation force so it deflects rather than completely pushing back
                    const sepMag = Math.sqrt(sepX * sepX + sepY * sepY);
                    if (sepMag > 0) {
                        // Dampen when we get close to the target so we can actually investigate hotspots together
                        // At distance 0.3, damping is 0 (ignore collision). At distance 1.5+, damping is 1 (full collision)
                        const damp = Math.min(1, Math.max(0, (distToTarget - 0.3) / 1.2));

                        // We cap the MAX power of a separation bounce to exactly the drone's speed, 
                        // so it can never be "thrown" backwards violently across the map, only slid sideways
                        const maxSep = moveSpeed * damp * 0.9;
                        sepX = (sepX / sepMag) * maxSep;
                        sepY = (sepY / sepMag) * maxSep;
                    }

                    // Final vector is target + deflection
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

                // Battery Drain based on distance moved + sensor usage
                // Flying further takes more energy. Wide mode uses more energy per tick for sensors
                const sensorDrain = d.mode === 'Wide' ? 0.015 : 0.005; // Halved from original
                const movementDrain = totalMove * 0.075; // Halved from original
                d.battery -= (sensorDrain + movementDrain);
            }
        });

        // 3. Global Swarm Planner (Haversine Priority Assignment)
        // If a sector has high prob but no drone is near, assign the closest Wide-scan drone
        // We do this every 20 ticks
        if (timeRef.current % 20 === 0) {
            const highProbSectors: Sector[] = [];
            grid.forEach(row => row.forEach(sec => {
                if (sec.scanned && sec.prob > THRESHOLD_MICRO) highProbSectors.push(sec);
            }));

            highProbSectors.forEach(sec => {
                // Find nearest wide drone
                const loc1 = getLatLon(sec.x, sec.y);
                let bestDrone: Drone | null = null;
                let min_dist = Infinity;

                for (const d of drones) {
                    if (d.mode === 'Wide') {
                        const loc2 = getLatLon(d.x, d.y);
                        const dist = haversineDistance(loc1.lat, loc1.lon, loc2.lat, loc2.lon);
                        if (dist < min_dist) {
                            min_dist = dist;
                            bestDrone = d;
                        }
                    }
                }

                if (bestDrone && min_dist > 0.1) { // Only redirect if not already there
                    bestDrone.tx = sec.x;
                    bestDrone.ty = sec.y;
                    bestDrone.mode = 'Micro';
                }
            });
        }

        // Evaporate pheromones slowly
        grid.forEach(row => row.forEach(sec => {
            if (sec.pheromone > 0) sec.pheromone *= 0.99;
        }));

        setTickFlip(f => f + 1);
    }, []);

    useEffect(() => {
        let interval: any;
        if (running) {
            interval = setInterval(performTick, 100 / speed);
        }
        return () => clearInterval(interval);
    }, [running, speed, performTick]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', color: 'var(--text-primary)' }}>
            <header style={{ padding: '24px', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Hexagon /> MULTI-RES SWARM SIMULATION
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; ADAPTIVE SEARCH & SURVIVOR DETECTION</p>
                </div>

                <div style={{ display: 'flex', gap: '12px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <button onClick={() => setRunning(!running)} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        {running ? <Pause size={18} /> : <Play size={18} />} {running ? 'PAUSE' : 'START SCAN'}
                    </button>
                    <button onClick={() => setSpeed(s => s === 1 ? 5 : 1)} className={`hud-btn ${speed > 1 ? 'glow-text' : ''}`} style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer', borderColor: speed > 1 ? 'var(--accent-primary)' : '' }}>
                        <FastForward size={18} /> x{speed}
                    </button>
                    <button onClick={resetSim} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        <RotateCcw size={18} /> RESET
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', borderLeft: '1px solid var(--panel-border)', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                        <Shield size={16} /> COLLISION AVOIDANCE ACTIVE
                    </div>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '24px', margin: '0 24px 24px 24px' }}>
                {/* Main Simulator Map */}
                <div className="hud-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

                    <svg width={GRID_W * CELL_SIZE} height={GRID_H * CELL_SIZE} style={{ border: '1px dashed rgba(0,255,204,0.2)', backgroundColor: '#050a10' }}>
                        {/* Grid & Heatmap */}
                        {gridRef.current.map((row, y) =>
                            row.map((cell, x) => (
                                <rect
                                    key={`cell-${x}-${y}`}
                                    x={x * CELL_SIZE}
                                    y={y * CELL_SIZE}
                                    width={CELL_SIZE}
                                    height={CELL_SIZE}
                                    fill={cell.scanned ? `rgba(255, 68, 68, ${cell.prob * 0.8})` : 'transparent'}
                                    stroke="rgba(0, 255, 204, 0.05)"
                                    strokeWidth="1"
                                />
                            ))
                        )}

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

                        {/* Mesh Network Lines */}
                        {dronesRef.current.map(d => (
                            <g key={`mesh-${d.id}`}>
                                {Object.entries(d.knownOtherDrones).map(([otherId, knownPos]) => {
                                    // If we heard from them recently (within 20 ticks, so they aren't "lost"), always draw the faint connection line.
                                    if (timeRef.current - knownPos.lastUpdate < 20) {
                                        const otherDrone = dronesRef.current.find(od => od.id === otherId);
                                        if (otherDrone) {
                                            const isPinging = (timeRef.current - knownPos.lastUpdate <= 1);
                                            return (
                                                <g key={`link-group-${d.id}-${otherId}`}>
                                                    {/* Background dim trace line ALWAYS visible while connected */}
                                                    <line
                                                        x1={otherDrone.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y1={otherDrone.y * CELL_SIZE + CELL_SIZE / 2}
                                                        x2={d.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y2={d.y * CELL_SIZE + CELL_SIZE / 2}
                                                        strokeWidth="1"
                                                        className="mesh-link-base"
                                                    />
                                                    {/* Foreground animated data packet ONLY visible during ping */}
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

                        {/* Drones */}
                        {dronesRef.current.map(d => (
                            <g key={d.id} transform={`translate(${d.x * CELL_SIZE + CELL_SIZE / 2}, ${d.y * CELL_SIZE + CELL_SIZE / 2})`}>
                                {/* Scan Radius Indicator */}
                                {d.mode !== 'Relay' && (
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
                                <circle r="4" fill={d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444'} />
                                <polygon points="0,-6 6,4 -6,4" fill={d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444'} />

                                {/* Label background and text */}
                                <rect x="-18" y="-22" width="36" height="12" fill="rgba(0,0,0,0.7)" rx="2" />
                                <text x="0" y="-14" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="var(--font-mono)">
                                    {d.id}
                                </text>

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

                    {/* Overlay Info / Floating Legend */}
                    <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid var(--panel-border)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', backdropFilter: 'blur(4px)' }}>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>MAP LEGEND</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #00ffcc' }}></div> Wide-Scan Mode</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ff4444' }}></div> Micro-Scan Mode</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #0077ff' }}></div> Relay Drone</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00ffcc' }}><MapPin size={12} /> Confirmed Survivor</div>
                        </div>
                    </div>

                    {/* Survivor Pin Popup (Using DOM Overlay over React, positioned absolute) */}
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
                                            {d.mode === 'Wide' ? <Target size={14} color="#00ffcc" /> : d.mode === 'Relay' ? <Radio size={14} color="#0077ff" /> : <Crosshair size={14} color="#ff4444" />}
                                            {d.id}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ color: batColor, fontSize: '0.7rem' }}>{Math.floor(d.battery)}%</div>
                                            <div style={{ color: d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Charging' ? '#ffa500' : '#ff4444', minWidth: '55px', textAlign: 'right' }}>{d.mode}</div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div className="hud-panel" style={{ padding: '16px', flex: 1 }}>
                        <h4 className="hud-text" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Radio size={18} /> ADAPTIVE SENSORS
                        </h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {Object.entries(SENSORS).map(([key, data]) => {
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

                        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>ALGORITHM LOG</div>
                            <div className="hud-text" style={{ fontSize: '0.65rem', color: 'var(--text-primary)', opacity: 0.7, height: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {logsRef.current.map((log, idx) => (
                                    <div key={idx} style={{
                                        color: log.type === 'alert' ? '#ff4444' : log.type === 'success' ? '#00ffcc' : 'var(--text-secondary)'
                                    }}>
                                        <span style={{ opacity: 0.5 }}>[{log.time}]</span> &gt; {log.msg}
                                    </div>
                                ))}
                                {logsRef.current.length === 0 && (
                                    <>
                                        <div>&gt; Sys initialized. Using Haversine pathfinding.</div>
                                        <div>&gt; ACO Exploration mode active.</div>
                                        <div>&gt; Waiting for events...</div>
                                    </>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default SimulationMapDuplicate;
