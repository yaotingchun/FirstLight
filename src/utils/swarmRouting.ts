/**
 *  swarmRouting.ts  —  SHARED ROUTING UTILITY
 *
 *  Drop this file into any page and import what you need:
 *
 *  ── CONSTANTS ──────────────────────────────────────────────────────────────
 *  BASE_X, BASE_Y            Grid coordinates of the home base
 *  MAX_RADIUS_GRID           Operational radius in grid units (≈ 1 km)
 *  COMM_RANGE_GRID           Drone-to-relay communication range (grid units)
 *  SAFE_DISTANCE_GRID        VO trigger distance between drones
 *
 *  ── TYPES ──────────────────────────────────────────────────────────────────
 *  DroneWithRegion           Minimum drone shape needed by all functions below
 *  GridPoint                 { x: number, y: number }
 *
 *  ── SECTOR ALLOCATION ──────────────────────────────────────────────────────
 *  recalculateRegionsByPriority()  ★ PRIMARY — heatmap-weighted sectors
 *  recalculateRegions()            Utility — equal 360°/N (kept for reference)
 *
 *  ── PATHFINDING ────────────────────────────────────────────────────────────
 *  aStarPath()               A* with sector-boundary + connectivity penalties
 *
 *  ── SCAN QUEUE BUILDERS ────────────────────────────────────────────────────
 *  buildPriorityQueue()      ★ PRIMARY — tier-boustrophedon by heatmap prob
 *  buildBoustrophedonQueue() Utility — row-by-row lawnmower (kept for reference)
 *
 *  ── COLLISION AVOIDANCE ────────────────────────────────────────────────────
 *  calculateVO()             Velocity Obstacle avoidance vector
 *
 *  ── MERGE CHECKLIST ────────────────────────────────────────────────────────
 *  1. Replace heatmap arg in buildPriorityQueue() and
 *     recalculateRegionsByPriority() with teammate's real number[][] data.
 *  2. Pass relayNodes (base + active drone positions) into aStarPath().
 *  3. Call recalculateRegionsByPriority() whenever a drone goes offline.
 *
 *  Quick import:
 *    import {
 *      recalculateRegionsByPriority,
 *      aStarPath, buildPriorityQueue,
 *      calculateVO, BASE_X, BASE_Y, MAX_RADIUS_GRID, COMM_RANGE_GRID,
 *      type DroneWithRegion, type GridPoint
 *    } from '../utils/swarmRouting';
 */

export const BASE_X = 10;
export const BASE_Y = 10;
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
    assignedAngleStart: number;
    assignedAngleEnd: number;
    battery: number;
};

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
    sectorStart?: number,   // drone's sector start angle (degrees)
    sectorEnd?: number,     // drone's sector end angle (degrees)
    sectorPenalty = 6,      // extra cost per out-of-sector step
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

    // Is a neighbour cell inside this drone's assigned angular sector?
    const inSector = (x: number, y: number): boolean => {
        if (sectorStart === undefined || sectorEnd === undefined) return true;
        if (x === BASE_X && y === BASE_Y) return true;
        let angle = Math.atan2(y - BASE_Y, x - BASE_X) * (180 / Math.PI) + 90;
        if (angle < 0) angle += 360;
        if (angle >= 360) angle -= 360;
        return sectorStart < sectorEnd
            ? angle >= sectorStart && angle < sectorEnd
            : angle >= sectorStart || angle < sectorEnd;
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
            const penalty = inSector(nx, ny) ? 0 : sectorPenalty;
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

/** Shared helper — returns true if (x,y) falls inside the drone's sector */
const cellInSector = (x: number, y: number, d: DroneWithRegion): boolean => {
    const dx = x - BASE_X, dy = y - BASE_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX_RADIUS_GRID || dist === 0) return false;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    if (angle >= 360) angle -= 360;
    return d.assignedAngleStart < d.assignedAngleEnd
        ? angle >= d.assignedAngleStart && angle < d.assignedAngleEnd
        : angle >= d.assignedAngleStart || angle < d.assignedAngleEnd;
};

/**
 * BOUSTROPHEDON (Lawnmower) Queue
 * Visits every walkable cell in the sector row-by-row, alternating direction.
 * Guarantees 100% coverage. Ignores probability — good for equal-sector mode.
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
            if (cellInSector(x, y, drone)) row.push({ x, y });
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
            if (!cellInSector(x, y, drone)) continue;

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
//    Divides 360° into equal angular slices based on number of active drones.
//    Triggers on drone failure → remaining drones cover the lost coverage area.
// ─────────────────────────────────────────────────────────────────────────────
export const recalculateRegions = <T extends DroneWithRegion>(drones: T[]): T[] => {
    const active = drones.filter(d => d.active);
    const sliceSize = active.length > 0 ? 360 / active.length : 360;
    let i = 0;
    return drones.map(d => {
        if (!d.active) return d;
        const start = i * sliceSize;
        const end = start + sliceSize;
        i++;
        return { ...d, assignedAngleStart: start, assignedAngleEnd: end };
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 1b. PRIORITY-WEIGHTED REGION ALLOCATION
//     Resizes sector angles proportional to the probability mass in each direction.
//     Drones covering high-probability areas get a LARGER angle slice.
//     When teammate provides real heatmap, pass it as `heatmap` — same interface.
//
//     heatmap: 2D array [y][x] of probability values (0.0–1.0)
// ─────────────────────────────────────────────────────────────────────────────
export const recalculateRegionsByPriority = <T extends DroneWithRegion>(
    drones: T[],
    heatmap: number[][],
    gridW: number,
    gridH: number
): T[] => {
    const active = drones.filter(d => d.active);
    const N = active.length;
    if (N === 0) return drones;

    // Step 1: Build a 360-bin angular probability histogram
    // For each non-obstacle cell, accumulate its probability into the angle bin it falls in
    const BINS = 360;
    const angularProb = new Array(BINS).fill(0);

    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const prob = heatmap[y]?.[x] ?? 0;
            if (prob <= 0) continue;
            const dx = x - BASE_X;
            const dy = y - BASE_Y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > MAX_RADIUS_GRID || dist === 0) continue;

            // Convert to 0–360° (north = 0°, clockwise)
            let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // shift so north=0
            if (angle < 0) angle += 360;
            if (angle >= 360) angle -= 360;
            const bin = Math.floor(angle) % BINS;
            angularProb[bin] += prob;
        }
    }

    // Step 2: Compute cumulative probability
    const total = angularProb.reduce((s, v) => s + v, 0);

    // If heatmap is all zeros, fall back to equal sectors
    if (total === 0) return recalculateRegions(drones);

    // Step 3: Find N cut points that divide total probability equally
    const targetPerDrone = total / N;
    const cutAngles: number[] = [0]; // always start at 0°
    let cumSum = 0;
    let cutCount = 0;

    for (let b = 0; b < BINS && cutCount < N - 1; b++) {
        cumSum += angularProb[b];
        if (cumSum >= targetPerDrone * (cutCount + 1)) {
            cutAngles.push(b + 1);
            cutCount++;
        }
    }
    cutAngles.push(360); // close the last sector

    // Step 4: Assign computed sector angles to active drones
    let i = 0;
    return drones.map(d => {
        if (!d.active) return d;
        const start = cutAngles[i];
        const end = cutAngles[i + 1];
        i++;
        return { ...d, assignedAngleStart: start, assignedAngleEnd: end };
    });
};


/** Helper: get the CENTER coordinate of a drone's assigned sector */
export const getSectorCenter = (d: DroneWithRegion, radiusGrid: number = MAX_RADIUS_GRID) => {
    const midAngle = ((d.assignedAngleStart + d.assignedAngleEnd) / 2) * Math.PI / 180;
    return {
        x: BASE_X + Math.cos(midAngle - Math.PI / 2) * (radiusGrid * 0.6),
        y: BASE_Y + Math.sin(midAngle - Math.PI / 2) * (radiusGrid * 0.6),
    };
};

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
