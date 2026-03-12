import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Camera, Play, Pause, FastForward, RotateCcw, Target, Radio, Crosshair, Activity, Shield } from 'lucide-react';

mapboxgl.accessToken = "pk.eyJ1IjoieWFvdGluZ2NodW4iLCJhIjoiY21tZ2x1MW9yMGtlMDJ3b2ozaGNhd3ZnZyJ9.d5zcnqiWRPTcoYewN9d-YA";

// ── Map / Earthquake constants ──────────────────────────────────────
const EPICENTER = { lng: 103.7414, lat: 1.4927 };
const MAGNITUDE = 6.8;

const haversine = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const computeDamage = (lng: number, lat: number) => {
    const d = haversine(lng, lat, EPICENTER.lng, EPICENTER.lat);
    const intensity = MAGNITUDE / (d + 0.1);
    if (intensity > 4) return { level: 3, factor: 0.1 };
    if (intensity > 2) return { level: 2, factor: 0.4 };
    if (intensity > 1) return { level: 1, factor: 0.8 };
    return { level: 0, factor: 1.0 };
};

// ── Grid simulation constants (same as 2D sim) ─────────────────────
const GRID_W = 20;
const GRID_H = 20;

const INITIAL_SENSORS = {
    mobile: { base: 0.4, conf: 0.9, color: '#00ffcc' },
    thermal: { base: 0.3, conf: 0.6, color: '#ff4444' },
    sound: { base: 0.2, conf: 0.7, color: '#ffff00' },
    wifi: { base: 0.1, conf: 0.8, color: '#ff00ff' }
};

const THRESHOLD_MICRO = 0.30;
const THRESHOLD_FOUND = 0.75;

const COMM_RANGE_DRONE = 5;
const COMM_RANGE_RELAY = 10;
const COMM_RANGE_BASE = 12;

const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

// ── Grid ↔ LatLng mapping ───────────────────────────────────────────
// Each grid cell ≈ 50 m. Grid centre ≈ epicenter.
const CELL_DEG = 0.00045; // ~50 m
const GRID_ORIGIN_LNG = EPICENTER.lng - (GRID_W / 2) * CELL_DEG;
const GRID_ORIGIN_LAT = EPICENTER.lat + (GRID_H / 2) * CELL_DEG; // lat decreases downward

const gridToLngLat = (gx: number, gy: number): [number, number] => [
    GRID_ORIGIN_LNG + gx * CELL_DEG,
    GRID_ORIGIN_LAT - gy * CELL_DEG
];

// ── Simulation types (identical to 2D sim) ──────────────────────────
type Sector = {
    x: number; y: number; prob: number; pheromone: number;
    terrain: string; scanned: boolean; lastScanned: number;
};

type SimDrone = {
    id: string; x: number; y: number; tx: number; ty: number;
    mode: 'Wide' | 'Micro' | 'Relay' | 'Charging';
    battery: number; targetSector: Sector | null; isConnected: boolean;
    memory: string[]; savedTx?: number; savedTy?: number;
    knownOtherDrones: { [id: string]: { x: number; y: number; lastUpdate: number } };
};

type HiddenSurvivor = {
    id: string; x: number; y: number; found: boolean;
    info: { message: string; battery: string };
};

type FoundPin = { id: string; x: number; y: number; info: { message: string; battery: string } };

type CommEdge = { source: string; target: string; active: boolean };

// ── Factory helpers ─────────────────────────────────────────────────
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
            row.push({ x, y, prob: 0, pheromone: 0, terrain, scanned: false, lastScanned: 0 });
        }
        g.push(row);
    }
    return g;
};

const createDrones = (): SimDrone[] => [
    { id: 'DRN-Alpha', x: 9, y: 9, tx: 2, ty: 2, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], knownOtherDrones: {} },
    { id: 'DRN-Beta', x: 10, y: 9, tx: 17, ty: 2, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], knownOtherDrones: {} },
    { id: 'DRN-Gamma', x: 9, y: 10, tx: 2, ty: 17, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], knownOtherDrones: {} },
    { id: 'DRN-Delta', x: 10, y: 10, tx: 17, ty: 17, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], knownOtherDrones: {} },
    { id: 'RLY-Prime', x: 9.5, y: 9.5, tx: 9.5, ty: 9.5, mode: 'Relay', battery: 100, targetSector: null, isConnected: true, memory: [], knownOtherDrones: {} }
];

const createSurvivors = (): HiddenSurvivor[] => [
    { id: 'S1', x: 5, y: 5, found: false, info: { message: "Trapped under concrete. Leg injured.", battery: "12%" } },
    { id: 'S2', x: 15, y: 12, found: false, info: { message: "Safe but cannot exit building. 3 people here.", battery: "45%" } },
    { id: 'S3', x: 8, y: 18, found: false, info: { message: "Need water asap.", battery: "5%" } }
];

// ── Component ───────────────────────────────────────────────────────
const DroneCam: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
    const scanSourceAdded = useRef(false);
    const [damageCalculated, setDamageCalculated] = useState(false);
    const [activeDrone, setActiveDrone] = useState('DRN-Alpha');

    // Simulation state refs (same pattern as 2D sim)
    const gridRef = useRef<Sector[][]>(createGrid());
    const dronesRef = useRef<SimDrone[]>(createDrones());
    const survivorsRef = useRef<HiddenSurvivor[]>(createSurvivors());
    const pinsRef = useRef<FoundPin[]>([]);
    const timeRef = useRef(0);
    const commLinksRef = useRef<CommEdge[]>([]);
    const sensorWeightsRef = useRef(JSON.parse(JSON.stringify(INITIAL_SENSORS)));
    const logsRef = useRef<{ time: number; msg: string; type: 'alert' | 'info' | 'success' }[]>([]);

    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [, setTickFlip] = useState(0);

    const addLog = useCallback((msg: string, type: 'alert' | 'info' | 'success') => {
        logsRef.current.unshift({ time: timeRef.current, msg, type });
        if (logsRef.current.length > 30) logsRef.current.pop();
    }, []);

    // ── Reset ───────────────────────────────────────────────────────
    const resetSim = useCallback(() => {
        setRunning(false);
        gridRef.current = createGrid();
        dronesRef.current = createDrones();
        survivorsRef.current = createSurvivors();
        pinsRef.current = [];
        commLinksRef.current = [];
        sensorWeightsRef.current = JSON.parse(JSON.stringify(INITIAL_SENSORS));
        logsRef.current = [];
        timeRef.current = 0;
        setTickFlip(f => f + 1);
    }, []);

    // ── Sensor helpers ──────────────────────────────────────────────
    const getEffectiveWeight = (key: keyof typeof INITIAL_SENSORS) => {
        const w = sensorWeightsRef.current[key];
        return w.base * w.conf;
    };

    const getSectorProbability = useCallback((x: number, y: number) => {
        const base_prob = 0.05 + (Math.random() * 0.1);
        let max_signal = 0;
        survivorsRef.current.forEach(s => {
            if (s.found) return;
            const dist = Math.abs(s.x - x) + Math.abs(s.y - y);
            if (dist === 0) max_signal = Math.max(max_signal, 0.9 + Math.random() * 0.1);
            else if (dist <= 2) max_signal = Math.max(max_signal, 0.5 + Math.random() * 0.3);
        });
        if (max_signal > 0) {
            const m = Math.random() * max_signal;
            const w = Math.random() * max_signal;
            const t = Math.random() * max_signal;
            const sn = Math.random() * max_signal;
            const score = getEffectiveWeight('mobile') * m + getEffectiveWeight('wifi') * w +
                getEffectiveWeight('thermal') * t + getEffectiveWeight('sound') * sn;
            const sumW = getEffectiveWeight('mobile') + getEffectiveWeight('wifi') +
                getEffectiveWeight('thermal') + getEffectiveWeight('sound');
            return score / sumW;
        }
        return base_prob;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── performTick — EXACT same scanning logic as 2D grid sim ──────
    const performTick = useCallback(() => {
        timeRef.current++;
        const grid = gridRef.current;
        const drones = dronesRef.current;
        const survivors = survivorsRef.current;

        // Markov chain: survivors may move
        if (timeRef.current % 50 === 0) {
            survivors.forEach(s => {
                if (s.found) return;
                if (Math.random() < 0.1) {
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    const valid = dirs.filter(d => s.x + d[0] >= 0 && s.x + d[0] < GRID_W && s.y + d[1] >= 0 && s.y + d[1] < GRID_H);
                    if (valid.length > 0) { const mv = valid[Math.floor(Math.random() * valid.length)]; s.x += mv[0]; s.y += mv[1]; }
                }
            });
        }

        // Mesh network position broadcast
        const COMMS_RANGE = 8;
        if (timeRef.current % 5 === 0) {
            drones.forEach(broadcaster => {
                drones.forEach(receiver => {
                    if (broadcaster.id !== receiver.id) {
                        const dist = Math.sqrt((broadcaster.x - receiver.x) ** 2 + (broadcaster.y - receiver.y) ** 2);
                        if (dist <= COMMS_RANGE || broadcaster.mode === 'Relay' || receiver.mode === 'Relay') {
                            receiver.knownOtherDrones[broadcaster.id] = { x: broadcaster.x, y: broadcaster.y, lastUpdate: timeRef.current };
                        }
                    }
                });
            });
        }

        // Communication mesh graph & BFS
        const nodes = [{ id: BASE_STATION.id, x: BASE_STATION.x, y: BASE_STATION.y, isConnected: true }, ...drones];
        const adj = new Map<string, string[]>();
        nodes.forEach(n => adj.set(n.id, []));
        commLinksRef.current = [];

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const n1 = nodes[i]; const n2 = nodes[j];
                const dist = Math.sqrt((n1.x - n2.x) ** 2 + (n1.y - n2.y) ** 2);
                let r1 = COMM_RANGE_DRONE; let r2 = COMM_RANGE_DRONE;
                if (n1.id === BASE_STATION.id) r1 = COMM_RANGE_BASE; else if ((n1 as SimDrone).mode === 'Relay') r1 = COMM_RANGE_RELAY;
                if (n2.id === BASE_STATION.id) r2 = COMM_RANGE_BASE; else if ((n2 as SimDrone).mode === 'Relay') r2 = COMM_RANGE_RELAY;
                if (dist <= Math.max(r1, r2)) {
                    adj.get(n1.id)!.push(n2.id); adj.get(n2.id)!.push(n1.id);
                    commLinksRef.current.push({ source: n1.id, target: n2.id, active: false });
                }
            }
        }

        const visited = new Set<string>(); const queue = [BASE_STATION.id]; const parent = new Map<string, string>();
        visited.add(BASE_STATION.id);
        while (queue.length > 0) { const curr = queue.shift()!; for (const nxt of adj.get(curr)!) { if (!visited.has(nxt)) { visited.add(nxt); queue.push(nxt); parent.set(nxt, curr); } } }

        let disconnectedCount = 0;
        drones.forEach(d => { d.isConnected = visited.has(d.id); if (!d.isConnected && d.mode !== 'Relay') disconnectedCount++; });

        // Smart relay coverage maximization
        const relayDrone = drones.find(d => d.mode === 'Relay');
        if (relayDrone && disconnectedCount > 0) {
            const disconnected = drones.filter(d => !d.isConnected && d.mode !== 'Relay');
            if (disconnected.length > 0) {
                let cx = 0, cy = 0; disconnected.forEach(d => { cx += d.x; cy += d.y; }); cx /= disconnected.length; cy /= disconnected.length;
                relayDrone.tx = (cx + BASE_STATION.x) / 2; relayDrone.ty = (cy + BASE_STATION.y) / 2;
            }
        } else if (relayDrone && disconnectedCount === 0) { relayDrone.tx = GRID_W / 2; relayDrone.ty = GRID_H / 2; }

        // Active comm-link highlighting
        if (Math.random() < 0.2 && drones.length > 0) {
            const connected = drones.filter(d => d.isConnected);
            if (connected.length > 0) {
                const sender = connected[Math.floor(Math.random() * connected.length)];
                let curr = sender.id;
                while (curr !== BASE_STATION.id && parent.has(curr)) {
                    const p = parent.get(curr)!;
                    const edge = commLinksRef.current.find(e => (e.source === curr && e.target === p) || (e.source === p && e.target === curr));
                    if (edge) edge.active = true; curr = p;
                }
            }
        }

        // ── Drone logic (identical to 2D sim) ──────────────────────
        const BASE_X = BASE_STATION.x; const BASE_Y = BASE_STATION.y;

        drones.forEach(d => {
            // Charging
            if (d.mode === 'Charging') {
                d.battery += 0.5;
                if (d.battery >= 100) {
                    d.battery = 100; d.mode = 'Wide';
                    let newTarget: { x: number; y: number } | null = null;
                    const highProb: Sector[] = [];
                    grid.forEach(row => row.forEach(sec => { if (sec.scanned && sec.prob > THRESHOLD_MICRO) highProb.push(sec); }));
                    for (const sec of highProb) {
                        if (!drones.some(o => o.id !== d.id && Math.round(o.tx) === sec.x && Math.round(o.ty) === sec.y)) { newTarget = { x: sec.x, y: sec.y }; break; }
                    }
                    if (newTarget) { d.tx = newTarget.x; d.ty = newTarget.y; d.mode = 'Micro'; addLog(`${d.id} charged. Intercepting hotspot.`, 'info'); }
                    else if (d.savedTx !== undefined && d.savedTy !== undefined) { d.tx = d.savedTx; d.ty = d.savedTy; addLog(`${d.id} charged. Resuming.`, 'info'); }
                    else {
                        let best: Sector | null = null; let mp = -1;
                        grid.forEach(row => row.forEach(sec => { if (!sec.scanned && sec.prob > mp && !drones.some(o => o.id !== d.id && Math.round(o.tx) === sec.x && Math.round(o.ty) === sec.y)) { mp = sec.prob; best = sec; } }));
                        if (best) { d.tx = (best as Sector).x; d.ty = (best as Sector).y; } else { d.tx = Math.floor(Math.random() * GRID_W); d.ty = Math.floor(Math.random() * GRID_H); }
                        addLog(`${d.id} charged. Patrol.`, 'info');
                    }
                    d.savedTx = undefined; d.savedTy = undefined;
                }
                return;
            }
            if (d.mode === 'Relay') { d.battery -= 0.01; return; }

            // Battery thresholds
            const distBase = Math.sqrt((BASE_X - d.x) ** 2 + (BASE_Y - d.y) ** 2);
            const batReq = distBase * 0.3;
            const critical = Math.max(5, batReq + 2);
            const low = Math.max(20, critical + 15);
            const distTargetBase = Math.sqrt((BASE_X - d.tx) ** 2 + (BASE_Y - d.ty) ** 2);

            // Hotspot handover
            if (d.battery < low && d.tx !== BASE_X && d.ty !== BASE_Y) {
                const sx = Math.max(0, Math.min(GRID_W - 1, Math.round(d.tx)));
                const sy = Math.max(0, Math.min(GRID_H - 1, Math.round(d.ty)));
                const myProb = grid[sy][sx].prob;
                if ((d.mode === 'Micro' || myProb > THRESHOLD_MICRO) && d.savedTx === undefined) {
                    let swap: SimDrone | null = null; let minD = Infinity;
                    for (const o of drones) {
                        const odb = Math.sqrt((BASE_X - o.x) ** 2 + (BASE_Y - o.y) ** 2);
                        const oLow = Math.max(20, Math.max(5, odb * 0.3 + 2) + 15);
                        if (o.id !== d.id && o.mode === 'Wide' && o.battery > oLow) {
                            const osx = Math.max(0, Math.min(GRID_W - 1, Math.round(o.tx)));
                            const osy = Math.max(0, Math.min(GRID_H - 1, Math.round(o.ty)));
                            if (myProb > grid[osy][osx].prob) { const dd = Math.sqrt((o.x - d.x) ** 2 + (o.y - d.y) ** 2); if (dd < minD) { minD = dd; swap = o; } }
                        }
                    }
                    if (swap) {
                        d.savedTx = swap.tx; d.savedTy = swap.ty;
                        addLog(`${d.id} hand-over to ${swap.id}.`, 'alert');
                        swap.tx = d.tx; swap.ty = d.ty; swap.mode = d.mode; d.mode = 'Wide';
                    }
                }
            }

            // Critical RTB
            if (d.battery < critical && d.tx !== BASE_X && d.ty !== BASE_Y) {
                if (d.savedTx === undefined) { d.savedTx = d.tx; d.savedTy = d.ty; }
                d.tx = BASE_X; d.ty = BASE_Y; addLog(`${d.id} RTB (${Math.floor(d.battery)}%).`, 'alert');
            } else if (d.battery < low && d.battery >= critical && distTargetBase > 4 && d.mode === 'Wide') {
                let bx = BASE_X, by = BASE_Y, found = false;
                for (let r = 1; r <= 4 && !found; r++) {
                    for (let i = 0; i < 20; i++) {
                        const tx = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + (Math.random() - 0.5) * r * 2)));
                        const ty = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + (Math.random() - 0.5) * r * 2)));
                        if (Math.sqrt((BASE_X - tx) ** 2 + (BASE_Y - ty) ** 2) <= 4 && !grid[ty][tx].scanned) { bx = tx; by = ty; found = true; break; }
                    }
                }
                if (!found) { const a = Math.random() * Math.PI * 2; const rr = Math.random() * 4; bx = Math.max(0, Math.min(GRID_W - 1, Math.round(BASE_X + Math.cos(a) * rr))); by = Math.max(0, Math.min(GRID_H - 1, Math.round(BASE_Y + Math.sin(a) * rr))); }
                if (d.savedTx === undefined) { d.savedTx = d.tx; d.savedTy = d.ty; }
                d.tx = bx; d.ty = by; addLog(`${d.id} low bat (${Math.floor(d.battery)}%). Near-base.`, 'info');
            }

            // Check arrival
            const distT = Math.sqrt((d.tx - d.x) ** 2 + (d.ty - d.y) ** 2);
            if (distT < 0.3) {
                if (d.tx === BASE_X && d.ty === BASE_Y && d.battery <= 50) { d.mode = 'Charging'; addLog(`${d.id} docked. Charging.`, 'info'); return; }
                const sx = Math.round(d.tx); const sy = Math.round(d.ty);
                const sector = grid[sy][sx];
                sector.scanned = true; sector.lastScanned = timeRef.current;
                const newProb = getSectorProbability(sx, sy);
                if (newProb > sector.prob) sector.pheromone += newProb;
                sector.prob = newProb;

                if (d.mode === 'Wide') {
                    if (newProb > THRESHOLD_MICRO && d.battery >= low) {
                        d.mode = 'Micro'; addLog(`${d.id} high signal [${sx},${sy}]. Micro-scan.`, 'alert');
                    } else {
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        let opts = dirs.map(dir => ({ x: sx + dir[0], y: sy + dir[1] })).filter(p => p.x >= 0 && p.x < GRID_W && p.y >= 0 && p.y < GRID_H);
                        const filt = opts.filter(o => !drones.some(oo => oo.id !== d.id && Math.round(oo.tx) === o.x && Math.round(oo.ty) === o.y));
                        if (filt.length > 0) opts = filt;
                        opts.sort((a, b) => (grid[b.y][b.x].pheromone + 0.1) * Math.random() - (grid[a.y][a.x].pheromone + 0.1) * Math.random());
                        d.tx = opts[0].x; d.ty = opts[0].y;
                    }
                } else if (d.mode === 'Micro') {
                    if (newProb > THRESHOLD_FOUND) {
                        const s = survivors.find(sv => sv.x === sx && sv.y === sy && !sv.found);
                        if (s) {
                            s.found = true;
                            for (let py = Math.max(0, sy - 3); py <= Math.min(GRID_H - 1, sy + 3); py++)
                                for (let px = Math.max(0, sx - 3); px <= Math.min(GRID_W - 1, sx + 3); px++) { grid[py][px].pheromone = 0; grid[py][px].prob = 0; }
                            d.memory.push(s.id);
                            const wts = sensorWeightsRef.current;
                            (Object.keys(wts) as Array<keyof typeof INITIAL_SENSORS>).forEach(k => { wts[k].conf = Math.min(1.0, wts[k].conf + 0.04); });
                            if (!pinsRef.current.find(p => p.id === s.id)) {
                                pinsRef.current.push({ id: s.id, x: sx, y: sy, info: s.info });
                                addLog(`${d.id} CONFIRMED Survivor ${s.id} at [${sx},${sy}]!`, 'success');
                            }
                            d.mode = 'Wide'; d.tx = Math.floor(Math.random() * GRID_W); d.ty = Math.floor(Math.random() * GRID_H);
                        }
                    }
                    if (d.mode === 'Micro' && (newProb < THRESHOLD_MICRO || d.battery < low)) d.mode = 'Wide';
                    if (d.mode === 'Micro') {
                        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [-1, 1], [1, -1]];
                        let vd = dirs.filter(dir => { const nx = sx + dir[0]; const ny = sy + dir[1]; return nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H; });
                        const fd = vd.filter(dir => !drones.some(o => o.id !== d.id && o.mode === 'Micro' && Math.round(o.tx) === sx + dir[0] && Math.round(o.ty) === sy + dir[1]));
                        if (fd.length > 0) vd = fd;
                        vd.sort((a, b) => grid[sy + b[1]][sx + b[0]].prob - grid[sy + a[1]][sx + a[0]].prob);
                        if (vd.length > 0) { const mv = vd[Math.floor(Math.random() * Math.min(2, vd.length))]; d.tx = sx + mv[0]; d.ty = sy + mv[1]; }
                    }
                }
            } else {
                // Movement with collision avoidance (identical to 2D sim)
                const moveSpeed = d.mode === 'Wide' ? 0.4 : 0.1;
                let totalMove = Math.min(moveSpeed, distT);
                let angle = Math.atan2(d.ty - d.y, d.tx - d.x);
                const SEP = d.mode === 'Wide' ? 3.0 : 2.0;
                let sepX = 0, sepY = 0, nc = 0;
                Object.entries(d.knownOtherDrones).forEach(([id, kp]) => {
                    if (id !== d.id && (timeRef.current - kp.lastUpdate) < 20) {
                        const dd = Math.sqrt((kp.x - d.x) ** 2 + (kp.y - d.y) ** 2);
                        if (dd < SEP && dd > 0.01) {
                            let ps = (SEP - dd); ps *= dd < 1.0 ? 4.0 : 2.0;
                            sepX += (d.x - kp.x) / dd * ps; sepY += (d.y - kp.y) / dd * ps; nc++;
                        }
                    }
                });
                if (nc > 0) {
                    sepX /= nc; sepY /= nc;
                    const tdx = Math.cos(angle) * moveSpeed; const tdy = Math.sin(angle) * moveSpeed;
                    const sm = Math.sqrt(sepX * sepX + sepY * sepY);
                    if (sm > 0) { const damp = Math.min(1, Math.max(0, (distT - 0.3) / 1.2)); const ms = moveSpeed * damp * 0.9; sepX = (sepX / sm) * ms; sepY = (sepY / sm) * ms; }
                    const fx = tdx + sepX; const fy = tdy + sepY;
                    angle = Math.atan2(fy, fx); totalMove = Math.min(moveSpeed, Math.sqrt(fx * fx + fy * fy));
                }
                d.x += Math.cos(angle) * totalMove; d.y += Math.sin(angle) * totalMove;
                d.x = Math.max(0, Math.min(GRID_W - 1, d.x)); d.y = Math.max(0, Math.min(GRID_H - 1, d.y));
                const sDrain = d.mode === 'Wide' ? 0.015 : 0.005;
                d.battery -= (sDrain + totalMove * 0.075);
            }
        });

        // Data sync
        drones.forEach(d => {
            if (d.isConnected && d.memory.length > 0) {
                d.memory.forEach(sId => {
                    if (!pinsRef.current.find(p => p.id === sId)) {
                        const s = survivors.find(sv => sv.id === sId);
                        if (s) pinsRef.current.push({ id: s.id, x: s.x, y: s.y, info: s.info });
                    }
                });
                d.memory = [];
            }
        });

        // Global swarm planner (Haversine priority)
        if (timeRef.current % 20 === 0) {
            const hp: Sector[] = []; grid.forEach(row => row.forEach(sec => { if (sec.scanned && sec.prob > THRESHOLD_MICRO) hp.push(sec); }));
            hp.forEach(sec => {
                let best: SimDrone | null = null; let md = Infinity;
                for (const d of drones) {
                    if (d.mode === 'Wide' && d.isConnected) { const dd = Math.sqrt((sec.x - d.x) ** 2 + (sec.y - d.y) ** 2); if (dd < md) { md = dd; best = d; } }
                }
                if (best && md > 0.1) { best.tx = sec.x; best.ty = sec.y; best.mode = 'Micro'; }
            });
        }

        // Pheromone evaporation
        grid.forEach(row => row.forEach(sec => { if (sec.pheromone > 0) sec.pheromone *= 0.99; }));

        setTickFlip(f => f + 1);
    }, [addLog, getSectorProbability]);

    // ── Simulation interval ─────────────────────────────────────────
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (running) interval = setInterval(performTick, 100 / speed);
        return () => clearInterval(interval);
    }, [running, speed, performTick]);

    // ── Handle drone switch ─────────────────────────────────────────
    const handleDroneSwitch = useCallback((droneId: string) => {
        setActiveDrone(droneId);
        const d = dronesRef.current.find(dd => dd.id === droneId);
        if (d && map.current) {
            const [lng, lat] = gridToLngLat(d.x, d.y);
            const zoom = d.mode === 'Micro' ? 19 : 17;
            map.current.easeTo({ center: [lng, lat], zoom, pitch: d.mode === 'Micro' ? 65 : 50, duration: 800 });
        }
    }, []);

    // ── Mapbox init ─────────────────────────────────────────────────
    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        const [cLng, cLat] = gridToLngLat(9, 9);
        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/satellite-v9',
            center: [cLng, cLat],
            zoom: 17,
            pitch: 50,
            bearing: -20,
            antialias: true
        }).on('error', e => console.error("Mapbox Error:", e));

        const currentMap = map.current;
        if (!currentMap) return;

        currentMap.on('load', () => {
            // 3D buildings
            currentMap.addLayer({
                id: "3d-buildings", source: "composite", "source-layer": "building",
                filter: ["==", "extrude", "true"], type: "fill-extrusion",
                paint: {
                    "fill-extrusion-color": ['case', ['==', ['feature-state', 'damageLevel'], 3], '#441111', ['==', ['feature-state', 'damageLevel'], 2], '#884422', ['==', ['feature-state', 'damageLevel'], 1], '#999966', '#aaaaaa'],
                    "fill-extrusion-height": ['*', ['get', 'height'], ['coalesce', ['feature-state', 'damageFactor'], 1.0]],
                    "fill-extrusion-base": ["get", "min_height"],
                    "fill-extrusion-opacity": 0.8
                }
            });

            // Epicenter
            currentMap.addSource('epicenter', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [EPICENTER.lng, EPICENTER.lat] } } });
            currentMap.addLayer({ id: 'epicenter-glow', type: 'circle', source: 'epicenter', paint: { 'circle-radius': 40, 'circle-color': '#ff4444', 'circle-opacity': 0.3, 'circle-blur': 1 } });
            currentMap.addLayer({ id: 'epicenter-dot', type: 'circle', source: 'epicenter', paint: { 'circle-radius': 8, 'circle-color': '#ff0000', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });

            // Scan coverage source (updated each frame)
            currentMap.addSource('scan-coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            currentMap.addLayer({
                id: 'scan-fill', type: 'fill', source: 'scan-coverage',
                paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] }
            }, 'epicenter-glow');

            // Survivor pins source
            currentMap.addSource('survivor-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            currentMap.addLayer({ id: 'survivor-glow', type: 'circle', source: 'survivor-pins', paint: { 'circle-radius': 14, 'circle-color': '#00ffcc', 'circle-opacity': 0.4, 'circle-blur': 0.6 } });
            currentMap.addLayer({ id: 'survivor-dot', type: 'circle', source: 'survivor-pins', paint: { 'circle-radius': 6, 'circle-color': '#00ffcc', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });

            // Comm links source
            currentMap.addSource('comm-links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            currentMap.addLayer({ id: 'comm-lines', type: 'line', source: 'comm-links', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'], 'line-dasharray': [4, 4] } });

            scanSourceAdded.current = true;

            // Building damage
            currentMap.on('idle', () => {
                if (damageCalculated) return;
                try {
                    const features = currentMap.queryRenderedFeatures({ layers: ['3d-buildings'] });
                    if (features.length > 0) {
                        const ids = new Set();
                        features.forEach(f => {
                            if (f.id && !ids.has(f.id)) {
                                ids.add(f.id);
                                let lng = EPICENTER.lng, lat = EPICENTER.lat;
                                if (f.geometry.type === 'Polygon') { lng = f.geometry.coordinates[0][0][0]; lat = f.geometry.coordinates[0][0][1]; }
                                const dmg = computeDamage(lng, lat);
                                currentMap.setFeatureState({ source: 'composite', sourceLayer: 'building', id: f.id }, { damageLevel: dmg.level, damageFactor: dmg.factor });
                            }
                        });
                        setDamageCalculated(true);
                    }
                } catch (_e) { /* tiles not loaded yet */ }
            });
        });

        return () => {
            Object.values(markersRef.current).forEach(m => m.remove());
            markersRef.current = {};
            if (currentMap) { currentMap.remove(); map.current = null; }
        };
    }, [damageCalculated]);

    // ── Per-frame map sync (markers, camera track, scan overlay) ────
    useEffect(() => {
        let animId: number;
        let bearing = -20;

        const frame = () => {
            const m = map.current;
            if (!m) { animId = requestAnimationFrame(frame); return; }

            const drones = dronesRef.current;

            // Update / create drone markers
            drones.forEach(d => {
                const [lng, lat] = gridToLngLat(d.x, d.y);
                if (!markersRef.current[d.id]) {
                    const el = document.createElement('div');
                    el.style.width = '18px'; el.style.height = '18px';
                    el.style.borderRadius = '50%'; el.style.border = '2px solid #fff';
                    el.style.boxShadow = '0 0 8px rgba(0,255,204,0.6)';
                    el.style.transition = 'background 0.3s';
                    markersRef.current[d.id] = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
                }
                const marker = markersRef.current[d.id];
                marker.setLngLat([lng, lat]);
                const el = marker.getElement();
                const col = !d.isConnected ? '#555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                el.style.background = col;
                el.style.boxShadow = `0 0 ${d.mode === 'Micro' ? 14 : 8}px ${col}`;
                el.style.width = d.mode === 'Micro' ? '14px' : '18px';
                el.style.height = d.mode === 'Micro' ? '14px' : '18px';
            });

            // Camera follows active drone
            const active = drones.find(dd => dd.id === activeDrone);
            if (active) {
                const [aLng, aLat] = gridToLngLat(active.x, active.y);
                bearing = (bearing + 0.08) % 360;
                const zoomLevel = active.mode === 'Micro' ? 19 : active.mode === 'Charging' ? 18 : 17;
                const pitch = active.mode === 'Micro' ? 65 : 50;
                m.setCenter([aLng, aLat]);
                m.setBearing(bearing);
                m.setZoom(m.getZoom() + (zoomLevel - m.getZoom()) * 0.05);
                m.setPitch(m.getPitch() + (pitch - m.getPitch()) * 0.05);
            }

            // Update scan coverage overlay
            if (scanSourceAdded.current) {
                const features: GeoJSON.Feature[] = [];
                gridRef.current.forEach((row, y) => row.forEach((cell, x) => {
                    if (!cell.scanned) return;
                    const [lng0, lat0] = gridToLngLat(x - 0.5, y - 0.5);
                    const [lng1, lat1] = gridToLngLat(x + 0.5, y + 0.5);
                    features.push({
                        type: 'Feature', properties: { color: `rgba(255,68,68,1)`, opacity: Math.min(0.5, cell.prob * 0.7) },
                        geometry: { type: 'Polygon', coordinates: [[[lng0, lat0], [lng1, lat0], [lng1, lat1], [lng0, lat1], [lng0, lat0]]] }
                    });
                }));
                (m.getSource('scan-coverage') as mapboxgl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features });

                // Survivor pins
                const pinFeats: GeoJSON.Feature[] = pinsRef.current.map(p => {
                    const [plng, plat] = gridToLngLat(p.x, p.y);
                    return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [plng, plat] } };
                });
                (m.getSource('survivor-pins') as mapboxgl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: pinFeats });

                // Comm links
                const linkFeats: GeoJSON.Feature[] = commLinksRef.current.map(link => {
                    const getCoord = (id: string): [number, number] => {
                        if (id === BASE_STATION.id) return gridToLngLat(BASE_STATION.x, BASE_STATION.y);
                        const dd = drones.find(dr => dr.id === id);
                        return dd ? gridToLngLat(dd.x, dd.y) : gridToLngLat(0, 0);
                    };
                    return {
                        type: 'Feature',
                        properties: { color: link.active ? '#ffff00' : '#33ffaa', width: link.active ? 3 : 1, opacity: link.active ? 0.8 : 0.25 },
                        geometry: { type: 'LineString', coordinates: [getCoord(link.source), getCoord(link.target)] }
                    };
                });
                (m.getSource('comm-links') as mapboxgl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: linkFeats });
            }

            animId = requestAnimationFrame(frame);
        };

        animId = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(animId);
    }, [activeDrone]);

    // ── Derived display values ──────────────────────────────────────
    const activeD = dronesRef.current.find(d => d.id === activeDrone);
    const activeLngLat = activeD ? gridToLngLat(activeD.x, activeD.y) : [EPICENTER.lng, EPICENTER.lat];
    const altitudeLabel = activeD ? (activeD.mode === 'Micro' ? '80M' : activeD.mode === 'Charging' ? '0M (DOCKED)' : '300M') : '—';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', paddingTop: '40px' }}>
            <header style={{ paddingLeft: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: '20px' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Camera size={24} /> DRONE CAM OPTICS
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; LIVE UPLINK — ADAPTIVE SCAN ACTIVE // TOWER BRIDGE REGION</p>
                </div>
                <div style={{ display: 'flex', gap: '10px', background: 'var(--panel-bg)', padding: '10px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <button onClick={() => setRunning(!running)} className="hud-btn" style={{ padding: '6px 14px', display: 'flex', gap: '6px', cursor: 'pointer' }}>
                        {running ? <Pause size={16} /> : <Play size={16} />} {running ? 'PAUSE' : 'START'}
                    </button>
                    <button onClick={() => setSpeed(s => s === 1 ? 5 : 1)} className={`hud-btn ${speed > 1 ? 'glow-text' : ''}`} style={{ padding: '6px 14px', display: 'flex', gap: '6px', cursor: 'pointer', borderColor: speed > 1 ? 'var(--accent-primary)' : '' }}>
                        <FastForward size={16} /> x{speed}
                    </button>
                    <button onClick={resetSim} className="hud-btn" style={{ padding: '6px 14px', display: 'flex', gap: '6px', cursor: 'pointer' }}>
                        <RotateCcw size={16} /> RESET
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 12px', borderLeft: '1px solid var(--panel-border)', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                        <Shield size={14} /> COLLISION AVOID
                    </div>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', background: 'var(--bg-color)', overflow: 'hidden' }}>
                <div className="drone-container">

                    {/* LEFT PANEL: 3D MAP */}
                    <div className="drone-view">
                        <div id="map" ref={mapContainer} style={{ width: '100%', height: '100%', background: '#000' }} />
                        <div className="drone-crt-lines" />
                        <div className="drone-hud-overlay" />
                        <div className="drone-telemetry">
                            {activeDrone} • {activeD ? activeD.mode : '—'} • LAT: {(activeLngLat as number[])[1].toFixed(4)} LON: {(activeLngLat as number[])[0].toFixed(4)} • ALT: {altitudeLabel} • BAT: {activeD ? Math.floor(activeD.battery) : 0}% • T:{timeRef.current}
                        </div>
                    </div>

                    {/* RIGHT PANEL: DRONE SELECT + STATUS + LOGS */}
                    <div className="drone-side-panel">
                        <div className="hud-panel flex-col" style={{ padding: '20px', gap: '16px' }}>
                            {/* Drone selector */}
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>SELECT ACTIVE ASSET</label>
                                <select className="drone-select" value={activeDrone} onChange={e => handleDroneSwitch(e.target.value)}>
                                    {dronesRef.current.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}
                                </select>
                            </div>

                            {/* Live drone roster */}
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>SWARM STATUS</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                                    {dronesRef.current.map(d => {
                                        const bc = d.battery > 50 ? '#00ffcc' : d.battery > 20 ? '#ffff00' : '#ff4444';
                                        const mc = !d.isConnected ? '#555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                                        return (
                                            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: d.id === activeDrone ? 'rgba(0,255,204,0.08)' : 'transparent', border: d.id === activeDrone ? '1px solid rgba(0,255,204,0.3)' : '1px solid transparent', cursor: 'pointer' }} onClick={() => handleDroneSwitch(d.id)}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {d.mode === 'Wide' ? <Target size={12} color="#00ffcc" /> : d.mode === 'Relay' ? <Radio size={12} color="#0077ff" /> : d.mode === 'Charging' ? <Activity size={12} color="#ffa500" /> : <Crosshair size={12} color="#ff4444" />}
                                                    <span>{d.id}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <span style={{ color: bc }}>{Math.floor(d.battery)}%</span>
                                                    <span style={{ color: mc, minWidth: 50, textAlign: 'right' }}>{!d.isConnected ? 'OFF' : d.mode}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Sensor weights */}
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>ADAPTIVE SENSORS</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {(Object.entries(sensorWeightsRef.current) as [keyof typeof INITIAL_SENSORS, { base: number; conf: number; color: string }][]).map(([key, data]) => {
                                        const fw = (data.base * data.conf).toFixed(2);
                                        return (
                                            <div key={key}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                                                    <span>{key}</span><span style={{ color: data.color }}>w={fw}</span>
                                                </div>
                                                <div style={{ width: '100%', height: '3px', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                                    <div style={{ width: `${(parseFloat(fw) / 0.4) * 100}%`, height: '100%', background: data.color }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Survivors found */}
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>SURVIVORS FOUND</label>
                                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: '#00ffcc' }}>{pinsRef.current.length} / {survivorsRef.current.length}</div>
                            </div>

                            {/* Algorithm log */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                                    <span>ALGORITHM LOG</span>
                                    {running && <span className="animate-pulse" style={{ color: '#00ffcc' }}>● LIVE</span>}
                                </label>
                                <div className="log-feed">
                                    {logsRef.current.map((log, idx) => (
                                        <div key={idx} className="log-entry">
                                            <span className="log-time" style={{ color: log.type === 'alert' ? '#ff4444' : log.type === 'success' ? '#00ffcc' : 'var(--text-secondary)' }}>[T-{log.time}]</span>
                                            <span className="log-msg" style={{ color: log.type === 'alert' ? '#ff4444' : log.type === 'success' ? '#00ffcc' : 'var(--text-primary)' }}>{log.msg}</span>
                                        </div>
                                    ))}
                                    {logsRef.current.length === 0 && (
                                        <div className="log-entry"><span className="log-msg" style={{ color: 'var(--text-secondary)' }}>Press START to begin scanning...</span></div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default DroneCam;
