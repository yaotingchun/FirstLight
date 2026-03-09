import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, FastForward, Target, Radio, Crosshair, RotateCcw, Activity, Hexagon, MapPin, X } from 'lucide-react';

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
    mode: 'Wide' | 'Micro' | 'Relay';
    battery: number;
    targetSector: Sector | null;
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
        { id: 'DRN-Alpha', x: 9, y: 9, tx: 2, ty: 2, mode: 'Wide', battery: 100, targetSector: null },
        { id: 'DRN-Beta', x: 10, y: 9, tx: 17, ty: 2, mode: 'Wide', battery: 100, targetSector: null },
        { id: 'DRN-Gamma', x: 9, y: 10, tx: 2, ty: 17, mode: 'Wide', battery: 100, targetSector: null },
        { id: 'DRN-Delta', x: 10, y: 10, tx: 17, ty: 17, mode: 'Wide', battery: 100, targetSector: null },
        { id: 'RLY-Prime', x: 9.5, y: 9.5, tx: 9.5, ty: 9.5, mode: 'Relay', battery: 100, targetSector: null }
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
const SimulationMap: React.FC = () => {
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(1);

    // Sim State Refs (to avoid React render loop lag, but we will force render for UI updates)
    const gridRef = useRef<Sector[][]>(createGrid());
    const dronesRef = useRef<Drone[]>(createDrones());
    const survivorsRef = useRef<HiddenSurvivor[]>(createSurvivors());
    const pinsRef = useRef<FoundPin[]>([]);
    const timeRef = useRef<number>(0);
    const [, setTickFlip] = useState(0); // Forcing re-render
    const [selectedPin, setSelectedPin] = useState<FoundPin | null>(null);

    const resetSim = () => {
        setRunning(false);
        gridRef.current = createGrid();
        dronesRef.current = createDrones();
        survivorsRef.current = createSurvivors();
        pinsRef.current = [];
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

            // Normalize sum of effective weights
            const sumWeights = getEffectiveWeight('mobile') + getEffectiveWeight('wifi') + getEffectiveWeight('thermal') + getEffectiveWeight('sound');
            return score / sumWeights;
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

        // 2. Drone Logic
        drones.forEach(d => {
            if (d.mode === 'Relay') {
                d.battery -= 0.01;
                return;
            }

            // Check if we reached target
            const distToTarget = Math.sqrt(Math.pow(d.tx - d.x, 2) + Math.pow(d.ty - d.y, 2));

            if (distToTarget < 0.1) {
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
                    if (newProb > THRESHOLD_MICRO) {
                        // Switch to Micro-Scan (Exploitation)
                        d.mode = 'Micro';
                    } else {
                        // Ant Colony Routing: Pick a nearby sector based on pheromones
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        const options = dirs
                            .map(dir => ({ x: sx + dir[0], y: sy + dir[1] }))
                            .filter(pos => pos.x >= 0 && pos.x < GRID_W && pos.y >= 0 && pos.y < GRID_H);

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
                            }

                            // Send far away
                            d.mode = 'Wide';
                            d.tx = Math.floor(Math.random() * GRID_W);
                            d.ty = Math.floor(Math.random() * GRID_H);
                        }
                    }

                    // After micro scan, usually switch back to wide unless still hot
                    if (d.mode === 'Micro' && newProb < THRESHOLD_MICRO) {
                        d.mode = 'Wide';
                    }

                    // Micro moves very slowly to adjacent
                    if (d.mode === 'Micro') {
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                        const validDirs = dirs.filter(dir => {
                            const nx = sx + dir[0]; const ny = sy + dir[1];
                            return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H;
                        });
                        if (validDirs.length > 0) {
                            const move = validDirs[Math.floor(Math.random() * validDirs.length)];
                            d.tx = sx + move[0];
                            d.ty = sy + move[1];
                        }
                    }
                }
            } else {
                // Move towards target
                const moveSpeed = d.mode === 'Wide' ? 0.4 : 0.1;
                const totalMove = Math.min(moveSpeed, distToTarget);
                const angle = Math.atan2(d.ty - d.y, d.tx - d.x);
                d.x += Math.cos(angle) * totalMove;
                d.y += Math.sin(angle) * totalMove;
                d.battery -= 0.05;
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
                                <circle r="4" fill={d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : '#ff4444'} />
                                <polygon points="0,-6 6,4 -6,4" fill={d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : '#ff4444'} />
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
                            {dronesRef.current.map((d, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {d.mode === 'Wide' ? <Target size={14} color="#00ffcc" /> : d.mode === 'Relay' ? <Radio size={14} color="#0077ff" /> : <Crosshair size={14} color="#ff4444" />}
                                        {d.id}
                                    </div>
                                    <div style={{ color: d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Relay' ? '#0077ff' : '#ff4444' }}>{d.mode}</div>
                                </div>
                            ))}
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
                            <div className="hud-text" style={{ fontSize: '0.65rem', color: 'var(--text-primary)', opacity: 0.7, height: '100px', overflowY: 'hidden' }}>
                                <div>&gt; Sys initialized. Using Haversine pathfinding.</div>
                                <div>&gt; ACO Exploration mode active.</div>
                                {timeRef.current > 0 && <div>&gt; Prob calculation threshold w=(Wi*R).</div>}
                                {timeRef.current > 50 && <div>&gt; Markov prediction matrix updated.</div>}
                                {pinsRef.current.map((p, idx) => (
                                    <div key={idx} style={{ color: '#00ffcc' }}>&gt; Survivor {p.id} confirmed at {p.x},{p.y}</div>
                                ))}
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

export default SimulationMap;
