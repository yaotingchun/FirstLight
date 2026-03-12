/**
 *  swarmRouting.ts  —  SHARED ROUTING UTILITY
 *
 *  Drop this file into any page and import what you need:
 *
 *  ── CONSTANTS ──────────────────────────────────────────────────────────────
 *  BASE_X, BASE_Y            Grid coordinates of the home base
 *  GRID_W, GRID_H            Grid dimensions (20×20)
 *  GRID_CENTER               Centre point of the grid
 *  MAX_RADIUS_GRID           Operational radius in grid units (≈ 1 km)
 *  COMM_RANGE_GRID           Drone-to-relay communication range (grid units)
 *  SAFE_DISTANCE_GRID        VO trigger distance between drones
 *  DRONE_COUNT               Number of search drones
 *  DRONE_COLORS              Colour palette for search drones
 *  RELAY_COLOR               Colour for the relay drone
 *  OBSTACLES, OBSTACLE_SET   Grid obstacle positions
 *
 *  ── TYPES ──────────────────────────────────────────────────────────────────
 *  DroneWithRegion           Minimum drone shape needed by allocation functions
 *  SearchDrone               Full search-drone type (extends DroneWithRegion)
 *  RelayDrone                Relay drone type
 *  GridPoint                 { x: number, y: number }
 *  Region                    { xMin, xMax, yMin, yMax } rectangular bounds
 *  VOResult                  Velocity-obstacle result
 *
 *  ── REGION ALLOCATION ──────────────────────────────────────────────────────
 *  recalculateRegionsByPriority()  ★ PRIMARY — heatmap-weighted square regions (BSP)
 *  recalculateRegions()            Utility — equal-area grid partition
 *
 *  ── PATHFINDING ────────────────────────────────────────────────────────────
 *  aStarPath()               A* with region-boundary + connectivity penalties
 *
 *  ── SCAN QUEUE BUILDERS ────────────────────────────────────────────────────
 *  buildPriorityQueue()      ★ PRIMARY — tier-boustrophedon by heatmap prob
 *  buildBoustrophedonQueue() Utility — row-by-row lawnmower
 *  buildScanQueueForDrone()  Convenience wrapper with shared grid/obstacle config
 *  nextScanTarget()          Get next cell from a drone's scan queue
 *
 *  ── COLLISION AVOIDANCE ────────────────────────────────────────────────────
 *  calculateVO()             Velocity Obstacle avoidance vector
 *
 *  ── HEATMAP GENERATORS ────────────────────────────────────────────────────
 *  generateMockHeatmap()     Static mock heatmap with fixed hotspots
 *  generateShiftedHeatmap()  Randomised heatmap (simulates shifting predictions)
 *
 *  ── FACTORY FUNCTIONS ──────────────────────────────────────────────────────
 *  createInitialDrones()     Create N search drones at base
 *  createRelayDrone()        Create relay drone at base
 *
 *  ── SWARM LIFECYCLE ────────────────────────────────────────────────────────
 *  initializeSwarm()         Full init: allocate regions, build queues, create relay
 *  reallocateOnFailure()     Handle drone failure: reallocate + rebuild queues
 *
 *  Quick import:
 *    import {
 *      initializeSwarm, reallocateOnFailure, nextScanTarget,
 *      aStarPath, calculateVO, buildScanQueueForDrone,
 *      BASE_X, BASE_Y, GRID_W, GRID_H, GRID_CENTER,
 *      COMM_RANGE_GRID, DRONE_COUNT, OBSTACLE_SET,
 *      type SearchDrone, type RelayDrone, type GridPoint
 *    } from '../utils/swarmRouting';
 */

export const BASE_X = 10;
export const BASE_Y = 19;      // bottom center of grid
export const MAX_RADIUS_KM = 1.0;      // 1 km operational radius
export const MAX_RADIUS_GRID = 9;      // 9 grid units ≈ 1 km
export const COMM_RANGE_GRID = 9;      // drone-to-relay comm range (same as op. radius)
export const SAFE_DISTANCE_GRID = 1.5; // grid units before VO kicks in

/** Minimal drone shape needed for region allocation.
 *  Your teammates' Drone type should extend this (or just add these fields). */
export type DroneWithRegion = {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    active: boolean;
    regionXMin: number;
    regionXMax: number;
    regionYMin: number;
    regionYMax: number;
    battery: number;
};

export type Region = { xMin: number; xMax: number; yMin: number; yMax: number };

// ─────────────────────────────────────────────────────────────────────────────
// A* PATHFINDING
// Finds the shortest walkable path on a discrete grid, navigating around obstacles.
// Returns an array of {x, y} waypoints from start to goal, or [] if no path found.
// ─────────────────────────────────────────────────────────────────────────────
export type GridPoint = { x: number; y: number };

type AStarNode = {
    x: number; y: number;
    g: number; h: number; f: number;
    parent: AStarNode | null;
};

const heuristic = (a: GridPoint, b: GridPoint) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const aStarPath = (
    start: GridPoint,
    goal: GridPoint,
    obstacles: Set<string>,
    gridW: number,
    gridH: number,
    regionBounds?: Region,  // drone's assigned rectangular region
    regionPenalty = 6,      // extra cost per out-of-region step
    // ── Connectivity-aware routing ────────────────────────────────────────────
    // relayNodes: positions of BASE + all other ACTIVE drones acting as relays.
    // Cells out of range of every relay get commPenalty added to g.
    // Pass an empty array (or omit) to disable this constraint.
    relayNodes: GridPoint[] = [],
    commPenalty = 15        // high penalty for going out of comms range
): GridPoint[] => {
    // Is cell (x,y) within COMM_RANGE_GRID of at least one relay node?
    const isConnected = (x: number, y: number): boolean => {
        if (relayNodes.length === 0) return true; // constraint disabled
        return relayNodes.some(r => {
            const d = Math.sqrt((x - r.x) ** 2 + (y - r.y) ** 2);
            return d <= COMM_RANGE_GRID;
        });
    };

    // Is a neighbour cell inside this drone's assigned rectangular region?
    const inRegion = (x: number, y: number): boolean => {
        if (!regionBounds) return true;
        return x >= regionBounds.xMin && x < regionBounds.xMax
            && y >= regionBounds.yMin && y < regionBounds.yMax;
    };
    const open: AStarNode[] = [];
    const closed = new Set<string>();

    const startNode: AStarNode = {
        x: Math.round(start.x), y: Math.round(start.y),
        g: 0, h: heuristic(start, goal), f: 0, parent: null
    };
    startNode.f = startNode.g + startNode.h;
    open.push(startNode);

    while (open.length > 0) {
        open.sort((a, b) => a.f - b.f);
        const current = open.shift()!;
        const currentKey = `${current.x},${current.y}`;

        if (current.x === Math.round(goal.x) && current.y === Math.round(goal.y)) {
            const path: GridPoint[] = [];
            let node: AStarNode | null = current;
            while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
            return path;
        }

        closed.add(currentKey);

        const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]];
        for (const [dx, dy] of dirs) {
            const nx = current.x + dx;
            const ny = current.y + dy;
            const nKey = `${nx},${ny}`;

            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            if (closed.has(nKey)) continue;
            if (obstacles.has(nKey)) continue;

            const moveCost = (dx !== 0 && dy !== 0 ? 1.414 : 1);
            const penalty = inRegion(nx, ny) ? 0 : regionPenalty;
            const connPenalty = isConnected(nx, ny) ? 0 : commPenalty;
            const g = current.g + moveCost + penalty + connPenalty;
            const h = heuristic({ x: nx, y: ny }, goal);
            const existing = open.find(n => n.x === nx && n.y === ny);

            if (existing) {
                if (g < existing.g) {
                    existing.g = g; existing.f = g + existing.h; existing.parent = current;
                }
            } else {
                open.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
            }
        }
    }
    return [];
};

// ─────────────────────────────────────────────────────────────────────────────
// SCAN QUEUE BUILDERS
// Both return an ordered list of walkable grid cells inside the drone's sector.
// Import and use whichever suits the merge target page.
// ─────────────────────────────────────────────────────────────────────────────

/** Shared helper — returns true if (x,y) falls inside the drone's assigned square region */
const cellInRegion = (x: number, y: number, d: DroneWithRegion): boolean => {
    return x >= d.regionXMin && x < d.regionXMax && y >= d.regionYMin && y < d.regionYMax;
};

/**
 * BOUSTROPHEDON (Lawnmower) Queue
 * Visits every walkable cell in the region row-by-row, alternating direction.
 * Guarantees 100% coverage. Ignores probability — good for equal-region mode.
 *
 * Usage:   const queue = buildBoustrophedonQueue(drone, gridW, gridH, obstacles);
 */
export const buildBoustrophedonQueue = (
    drone: DroneWithRegion,
    gridW: number,
    gridH: number,
    obstacles: Set<string>
): GridPoint[] => {
    const rows: GridPoint[][] = [];
    for (let y = 0; y < gridH; y++) {
        const row: GridPoint[] = [];
        for (let x = 0; x < gridW; x++) {
            if (obstacles.has(`${x},${y}`)) continue;
            if (cellInRegion(x, y, drone)) row.push({ x, y });
        }
        if (row.length > 0) rows.push(row);
    }
    return rows.flatMap((row, i) => i % 2 === 0 ? row : [...row].reverse());
};

/**
 * HYBRID: Probability-Tier Boustrophedon Queue
 *
 * Combines probability priority WITH boustrophedon efficiency:
 *   1. Cells are bucketed into 3 tiers by probability:
 *        HIGH   (prob ≥ 0.6) → searched first
 *        MEDIUM (prob ≥ 0.2) → searched second
 *        LOW    (prob  < 0.2) → searched last
 *   2. Within each tier, cells are ordered using boustrophedon (row-by-row
 *      alternating direction) — minimises travel distance inside each zone.
 *
 * Result: drone sweeps the hotspot efficiently first, then fans out to
 * medium-probability areas, then covers low-probability zones last.
 * 100% coverage is still guaranteed.
 *
 * Falls back to plain boustrophedon if heatmap is all zeros.
 * When teammate provides real heatmap, pass it directly — same interface.
 *
 * Usage:   const queue = buildPriorityQueue(drone, heatmap, gridW, gridH, obstacles);
 */
export const buildPriorityQueue = (
    drone: DroneWithRegion,
    heatmap: number[][],
    gridW: number,
    gridH: number,
    obstacles: Set<string>,
    highThreshold = 0.6,   // tunable: cells above this → Tier 1
    medThreshold  = 0.2    // tunable: cells above this → Tier 2, below → Tier 3
): GridPoint[] => {
    // Bucket cells into 3 tiers — each tier stored as rows for boustrophedon
    const tiers: [Map<number, GridPoint[]>, Map<number, GridPoint[]>, Map<number, GridPoint[]>] = [
        new Map(), new Map(), new Map()   // tier 0 = HIGH, 1 = MEDIUM, 2 = LOW
    ];

    let hasRealData = false;

    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            if (obstacles.has(`${x},${y}`)) continue;
            if (!cellInRegion(x, y, drone)) continue;

            const prob = heatmap[y]?.[x] ?? 0;
            if (prob > 0.001) hasRealData = true;

            const tierIdx = prob >= highThreshold ? 0 : prob >= medThreshold ? 1 : 2;
            if (!tiers[tierIdx].has(y)) tiers[tierIdx].set(y, []);
            tiers[tierIdx].get(y)!.push({ x, y });
        }
    }

    if (!hasRealData) {
        // Heatmap is all zeros — fall back to pure boustrophedon
        return buildBoustrophedonQueue(drone, gridW, gridH, obstacles);
    }

    // For each tier, apply boustrophedon ordering within its rows
    const boustroph = (rowMap: Map<number, GridPoint[]>): GridPoint[] => {
        const sortedRows = [...rowMap.entries()].sort(([a], [b]) => a - b);
        return sortedRows.flatMap(([, row], i) => {
            const sorted = [...row].sort((a, b) => a.x - b.x);
            return i % 2 === 0 ? sorted : sorted.reverse();
        });
    };

    // Concatenate: HIGH tier boustrophedon → MEDIUM → LOW
    return [...boustroph(tiers[0]), ...boustroph(tiers[1]), ...boustroph(tiers[2])];
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. REGION ALLOCATION (Show on Map)
//    Divides the grid into equal-area rectangular sub-regions for active drones.
//    Triggers on drone failure → remaining drones cover the lost coverage area.
// ─────────────────────────────────────────────────────────────────────────────

/** Partition a grid into N approximately equal-area rectangles */
const equalGridPartition = (gridW: number, gridH: number, N: number): Region[] => {
    const cols = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / cols);
    const regions: Region[] = [];
    for (let r = 0; r < rows && regions.length < N; r++) {
        for (let c = 0; c < cols && regions.length < N; c++) {
            regions.push({
                xMin: Math.round(c * gridW / cols),
                xMax: Math.round((c + 1) * gridW / cols),
                yMin: Math.round(r * gridH / rows),
                yMax: Math.round((r + 1) * gridH / rows),
            });
        }
    }
    return regions;
};

export const recalculateRegions = <T extends DroneWithRegion>(
    drones: T[],
    gridW: number,
    gridH: number
): T[] => {
    const active = drones.filter(d => d.active);
    const N = active.length;
    if (N === 0) return drones;
    const regions = equalGridPartition(gridW, gridH, N);
    let i = 0;
    return drones.map(d => {
        if (!d.active) return d;
        const r = regions[i++];
        return { ...d, regionXMin: r.xMin, regionXMax: r.xMax, regionYMin: r.yMin, regionYMax: r.yMax };
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 1b. PRIORITY-WEIGHTED REGION ALLOCATION (Square BSP)
//     Recursively bisects the grid into rectangular sub-regions so that each
//     drone covers approximately equal probability mass from the heatmap.
//     High-probability areas get SMALLER regions (more focused scanning).
//
//     heatmap: 2D array [y][x] of probability values (0.0–1.0)
// ─────────────────────────────────────────────────────────────────────────────

/** BSP: recursively bisect the grid into N rectangles with equal probability mass */
const partitionGridByPriority = (
    heatmap: number[][],
    gridW: number,
    gridH: number,
    N: number
): Region[] => {
    const bisect = (region: Region, count: number, depth: number): Region[] => {
        if (count <= 1) return [region];
        const leftCount = Math.floor(count / 2);
        const rightCount = count - leftCount;
        const targetRatio = leftCount / count;

        const width = region.xMax - region.xMin;
        const height = region.yMax - region.yMin;
        // Prefer splitting the longer dimension for squarer sub-regions
        const splitHorizontal = height > width || (height === width && depth % 2 === 0);

        let totalProb = 0;
        for (let y = region.yMin; y < region.yMax; y++)
            for (let x = region.xMin; x < region.xMax; x++)
                totalProb += heatmap[y]?.[x] ?? 0;

        if (totalProb < 0.001) {
            // No probability data — split by area
            if (splitHorizontal) {
                const mid = Math.max(region.yMin + 1, Math.min(region.yMax - 1,
                    Math.round(region.yMin + height * targetRatio)));
                return [...bisect({ ...region, yMax: mid }, leftCount, depth + 1),
                        ...bisect({ ...region, yMin: mid }, rightCount, depth + 1)];
            } else {
                const mid = Math.max(region.xMin + 1, Math.min(region.xMax - 1,
                    Math.round(region.xMin + width * targetRatio)));
                return [...bisect({ ...region, xMax: mid }, leftCount, depth + 1),
                        ...bisect({ ...region, xMin: mid }, rightCount, depth + 1)];
            }
        }

        const targetProb = totalProb * targetRatio;
        let cumProb = 0;

        if (splitHorizontal) {
            let splitY = region.yMin + 1;
            for (let y = region.yMin; y < region.yMax; y++) {
                for (let x = region.xMin; x < region.xMax; x++)
                    cumProb += heatmap[y]?.[x] ?? 0;
                if (cumProb >= targetProb) { splitY = y + 1; break; }
            }
            splitY = Math.max(region.yMin + 1, Math.min(region.yMax - 1, splitY));
            return [...bisect({ ...region, yMax: splitY }, leftCount, depth + 1),
                    ...bisect({ ...region, yMin: splitY }, rightCount, depth + 1)];
        } else {
            let splitX = region.xMin + 1;
            for (let x = region.xMin; x < region.xMax; x++) {
                for (let y = region.yMin; y < region.yMax; y++)
                    cumProb += heatmap[y]?.[x] ?? 0;
                if (cumProb >= targetProb) { splitX = x + 1; break; }
            }
            splitX = Math.max(region.xMin + 1, Math.min(region.xMax - 1, splitX));
            return [...bisect({ ...region, xMax: splitX }, leftCount, depth + 1),
                    ...bisect({ ...region, xMin: splitX }, rightCount, depth + 1)];
        }
    };

    return bisect({ xMin: 0, xMax: gridW, yMin: 0, yMax: gridH }, N, 0);
};

export const recalculateRegionsByPriority = <T extends DroneWithRegion>(
    drones: T[],
    heatmap: number[][],
    gridW: number,
    gridH: number
): T[] => {
    const active = drones.filter(d => d.active);
    const N = active.length;
    if (N === 0) return drones;

    const regions = partitionGridByPriority(heatmap, gridW, gridH, N);

    let i = 0;
    return drones.map(d => {
        if (!d.active) return d;
        const r = regions[i++];
        return { ...d, regionXMin: r.xMin, regionXMax: r.xMax, regionYMin: r.yMin, regionYMax: r.yMax };
    });
};


/** Helper: get the CENTER coordinate of a drone's assigned rectangular region */
export const getRegionCenter = (d: DroneWithRegion) => ({
    x: (d.regionXMin + d.regionXMax) / 2,
    y: (d.regionYMin + d.regionYMax) / 2,
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. VELOCITY OBSTACLE (Action Log)
//    Detects if two drones are on a collision course and steers one away.
//    Returns adjusted velocity + a log message if avoidance was triggered.
// ─────────────────────────────────────────────────────────────────────────────
export type VOResult = {
    vx: number;
    vy: number;
    avoidanceTriggered: boolean;
    logMessage: string | null;
};

export const calculateVO = <T extends DroneWithRegion>(
    self: T,
    allDrones: T[],
    intendedVx: number,
    intendedVy: number,
    speed: number
): VOResult => {
    let vx = intendedVx;
    let vy = intendedVy;
    let avoidanceTriggered = false;
    let logMessage: string | null = null;

    for (const other of allDrones) {
        if (other.id === self.id || !other.active) continue;

        const dx = other.x - self.x;
        const dy = other.y - self.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < SAFE_DISTANCE_GRID && distance > 0) {
            // Steer perpendicular to avoid
            vx = -(dy / distance) * speed;
            vy = (dx / distance) * speed;
            avoidanceTriggered = true;
            logMessage = `[VO] ${self.id} avoiding ${other.id}`;
            break;
        }
    }

    return { vx, vy, avoidanceTriggered, logMessage };
};

// ─────────────────────────────────────────────────────────────────────────────
// GRID & OBSTACLE CONFIGURATION
// Shared grid dimensions and obstacle data used across all pages.
// ─────────────────────────────────────────────────────────────────────────────
export const GRID_W = 20;
export const GRID_H = 20;

export const OBSTACLES: GridPoint[] = [
    { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 },
    { x: 7, y: 8 }, { x: 7, y: 9 },
    { x: 12, y: 11 }, { x: 13, y: 11 }, { x: 14, y: 11 },
    { x: 14, y: 12 }, { x: 14, y: 13 },
    { x: 5, y: 13 }, { x: 6, y: 13 },
    { x: 15, y: 6 }, { x: 15, y: 7 },
];
export const OBSTACLE_SET = new Set(OBSTACLES.map(o => `${o.x},${o.y}`));

// ─────────────────────────────────────────────────────────────────────────────
// DRONE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
export const DRONE_COUNT = 8;
export const DRONE_COLORS = ['#00ffcc', '#ff00cc', '#ccccff', '#ffff00', '#ff8800', '#00aaff', '#ff4444', '#aaff00'];
export const RELAY_COLOR = '#ffffff';
export const GRID_CENTER: GridPoint = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };

// ─────────────────────────────────────────────────────────────────────────────
// EXTENDED DRONE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Full search-drone state including path, scan queue, and UI fields. */
export type SearchDrone = DroneWithRegion & {
    tx: number; ty: number; color: string;
    path: GridPoint[]; pathIndex: number;
    scanQueue: GridPoint[];
    scanQueueIndex: number;
    launchTick: number;
};

/** Relay drone — flies to grid centre and stays as a comm relay. */
export type RelayDrone = {
    id: string;
    x: number; y: number;
    vx: number; vy: number;
    active: boolean;
    color: string;
    path: GridPoint[]; pathIndex: number;
    arrived: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// HEATMAP GENERATORS (mock — swap with real data at merge time)
// ─────────────────────────────────────────────────────────────────────────────

/** Static mock heatmap with fixed hotspots — good for deterministic testing. */
export const generateMockHeatmap = (): number[][] => {
    const map = Array.from({ length: GRID_H }, () => new Array(GRID_W).fill(0.05));
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            const d1 = Math.sqrt((x - 15) ** 2 + (y - 3) ** 2);
            if (d1 <= 4) map[y][x] = Math.min(1, map[y][x] + 0.85 * (1 - d1 / 4));
            const d2 = Math.sqrt((x - 4) ** 2 + (y - 5) ** 2);
            if (d2 <= 3) map[y][x] = Math.min(1, map[y][x] + 0.5 * (1 - d2 / 3));
            const d3 = Math.sqrt((x - 10) ** 2 + (y - 10) ** 2);
            if (d3 <= 3) map[y][x] = Math.min(1, map[y][x] + 0.3 * (1 - d3 / 3));
        }
    }
    return map;
};

/** Randomised heatmap with 2–3 hotspots — simulates shifting predictions. */
export const generateShiftedHeatmap = (): number[][] => {
    const map = Array.from({ length: GRID_H }, () => new Array(GRID_W).fill(0.05));
    const hotspotCount = 2 + Math.floor(Math.random() * 2);
    for (let h = 0; h < hotspotCount; h++) {
        const cx = 2 + Math.floor(Math.random() * (GRID_W - 4));
        const cy = 1 + Math.floor(Math.random() * (GRID_H - 4));
        const spotRadius = 2 + Math.random() * 3;
        const intensity = 0.5 + Math.random() * 0.5;
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                if (d <= spotRadius) map[y][x] = Math.min(1, map[y][x] + intensity * (1 - d / spotRadius));
            }
        }
    }
    return map;
};

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Create N search drones — all spawned at base with initial grid partitions. */
export const createInitialDrones = (): SearchDrone[] => {
    const cols = Math.ceil(Math.sqrt(DRONE_COUNT));
    const rows = Math.ceil(DRONE_COUNT / cols);
    const cellW = GRID_W / cols;
    const cellH = GRID_H / rows;
    return Array.from({ length: DRONE_COUNT }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const xMin = Math.round(col * cellW);
        const xMax = Math.round((col + 1) * cellW);
        const yMin = Math.round(row * cellH);
        const yMax = Math.round((row + 1) * cellH);
        return {
            id: `D${i + 1}`,
            x: BASE_X,
            y: BASE_Y,
            vx: 0, vy: 0,
            tx: BASE_X, ty: BASE_Y,
            color: DRONE_COLORS[i % DRONE_COLORS.length],
            active: true,
            regionXMin: xMin, regionXMax: xMax,
            regionYMin: yMin, regionYMax: yMax,
            path: [], pathIndex: 0,
            scanQueue: [] as GridPoint[], scanQueueIndex: 0,
            launchTick: i * 12,
            battery: 100,
        };
    });
};

/** Create the relay drone at base position. */
export const createRelayDrone = (): RelayDrone => ({
    id: 'R1', x: BASE_X, y: BASE_Y, vx: 0, vy: 0,
    active: true, color: RELAY_COLOR, path: [], pathIndex: 0, arrived: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN QUEUE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Get the next target from a drone's scan queue. Wraps around when exhausted. */
export const nextScanTarget = (d: SearchDrone): { target: GridPoint; newIndex: number } => {
    if (d.scanQueue.length === 0) return { target: { x: BASE_X, y: BASE_Y }, newIndex: 0 };
    const idx = d.scanQueueIndex % d.scanQueue.length;
    return { target: d.scanQueue[idx], newIndex: idx + 1 };
};

/** Convenience: build a priority scan queue for a drone using shared grid & obstacle config. */
export const buildScanQueueForDrone = (d: SearchDrone, heatmap: number[][]): GridPoint[] =>
    buildPriorityQueue(d, heatmap, GRID_W, GRID_H, OBSTACLE_SET);

// ─────────────────────────────────────────────────────────────────────────────
// SWARM LIFECYCLE
// Pure functions for initialising the swarm and handling drone failures.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise the full swarm: allocate regions, build scan queues, create relay.
 * Call this on simulation reset with a freshly generated heatmap.
 */
export const initializeSwarm = (heatmap: number[][]): { drones: SearchDrone[]; relay: RelayDrone } => {
    const initial = createInitialDrones();
    const allocated = recalculateRegionsByPriority(initial, heatmap, GRID_W, GRID_H) as SearchDrone[];
    let launchIdx = 0;
    const drones = allocated.map(d => {
        if (!d.active) return d;
        const regionCenter: GridPoint = {
            x: Math.round((d.regionXMin + d.regionXMax) / 2),
            y: Math.round((d.regionYMin + d.regionYMax) / 2),
        };
        const spawned: SearchDrone = {
            ...d, x: BASE_X, y: BASE_Y,
            path: [], pathIndex: 0,
            scanQueue: [] as GridPoint[], scanQueueIndex: 0,
            launchTick: launchIdx++ * 12,
        };
        const priorityScan = buildPriorityQueue(spawned, heatmap, GRID_W, GRID_H, OBSTACLE_SET);
        spawned.scanQueue = [regionCenter, ...priorityScan];
        return spawned;
    });
    return { drones, relay: createRelayDrone() };
};

/**
 * Handle drone failure: deactivate it, reallocate regions, rebuild scan queues.
 * Returns the updated drones array — pass directly to setDrones().
 */
export const reallocateOnFailure = (
    drones: SearchDrone[],
    failedId: string,
    heatmap: number[][],
): SearchDrone[] => {
    const updated = drones.map(d => d.id === failedId ? { ...d, active: false } : d);
    const reallocated = recalculateRegionsByPriority(updated, heatmap, GRID_W, GRID_H) as SearchDrone[];
    return reallocated.map(d => {
        if (!d.active) return d;
        const regionCenter: GridPoint = {
            x: Math.round((d.regionXMin + d.regionXMax) / 2),
            y: Math.round((d.regionYMin + d.regionYMax) / 2),
        };
        const newScanQueue = [regionCenter, ...buildPriorityQueue(d, heatmap, GRID_W, GRID_H, OBSTACLE_SET)];
        return { ...d, path: [], pathIndex: 0, scanQueue: newScanQueue, scanQueueIndex: 0 };
    });
};
