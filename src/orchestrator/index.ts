/**
 *  index.ts — FirstLight AI Orchestrator Entry Point
 *
 *  Runs a tick-based loop that:
 *    1. Gathers environment state (grid, terrain, sensors, drones)
 *    2. Builds a snapshot for the AI
 *    3. Sends it to Gemini via Vertex AI
 *    4. Executes the AI's decisions against the simulation
 *
 *  Usage:
 *    npx tsx src/orchestrator/index.ts              # run one tick
 *    npx tsx src/orchestrator/index.ts --loop       # continuous loop
 *    npx tsx src/orchestrator/index.ts --loop 10    # run 10 ticks
 */

import dotenv from 'dotenv';
dotenv.config();

import { decideActions } from './agent.js';
import { buildEnvironmentSnapshot } from './snapshotBuilder.js';
import { executeDecision } from './actionExecutor.js';
import type { EnvironmentSnapshot } from './types.js';

// ── Import simulation modules ───────────────────────────────────────────────
import {
    initializeSwarm,
    generateShiftedHeatmap,
    GRID_W,
    GRID_H,
    type SearchDrone,
} from '../utils/swarmRouting.js';
import {
    INITIAL_SENSORS,
    type GridWeightMap,
    type TerrainGrid,
    type TerrainType,
} from '../services/gridDataService.js';

// ── Configuration ───────────────────────────────────────────────────────────
const TICK_INTERVAL = parseInt(process.env.ORCHESTRATOR_TICK_INTERVAL_MS ?? '5000', 10);
const args = process.argv.slice(2);
const isLoop = args.includes('--loop');
const maxTicks = (() => {
    const idx = args.indexOf('--loop');
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
        return parseInt(args[idx + 1], 10);
    }
    return Infinity;
})();

// ── Simulation state ────────────────────────────────────────────────────────
let heatmap: number[][] = generateShiftedHeatmap();
let { drones } = initializeSwarm(heatmap);
let tickNumber = 0;

// Build a mock terrain grid (in production this comes from gridDataService OSM)
const terrainGrid: TerrainGrid = Array.from({ length: GRID_H }, () =>
    new Array<TerrainType>(GRID_W).fill('Open Field'),
);

// Convert heatmap to GridWeightMap format
const getWeights = (): GridWeightMap => heatmap;

// ── Simulate drone movement (advance each drone one step along its path) ────
const simulateDroneTick = (droneList: SearchDrone[]): SearchDrone[] => {
    return droneList.map(d => {
        if (!d.active) return d;

        // Recharge at base or drain battery slightly each tick
        const isAtBase = d.x === 10 && d.y === 19; // BASE_X, BASE_Y
        const newBattery = isAtBase ? Math.min(100, d.battery + 20) : Math.max(0, d.battery - 0.3);
        
        if (newBattery <= 0) {
            return { ...d, battery: 0, active: false };
        }

        // Move along path if there is one
        if (d.path.length > 0 && d.pathIndex < d.path.length) {
            const next = d.path[d.pathIndex];
            return {
                ...d,
                x: next.x,
                y: next.y,
                pathIndex: d.pathIndex + 1,
                battery: newBattery,
            };
        }

        // If path exhausted, advance scan queue
        if (d.scanQueue.length > 0 && d.scanQueueIndex < d.scanQueue.length) {
            const nextTarget = d.scanQueue[d.scanQueueIndex];
            return {
                ...d,
                x: nextTarget.x,
                y: nextTarget.y,
                scanQueueIndex: d.scanQueueIndex + 1,
                battery: newBattery,
            };
        }

        return { ...d, battery: newBattery };
    });
};

// ── Single orchestrator tick ────────────────────────────────────────────────
const runTick = async (): Promise<void> => {
    tickNumber++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FirstLight AI Orchestrator — Tick #${tickNumber}`);
    console.log(`${'═'.repeat(60)}`);

    // 1. Advance simulation
    drones = simulateDroneTick(drones);

    // 2. Build snapshot for AI
    const snapshot: EnvironmentSnapshot = buildEnvironmentSnapshot(
        getWeights(),
        terrainGrid,
        INITIAL_SENSORS,
        drones,
        tickNumber,
    );

    // 3. Ask AI for decisions
    const decision = await decideActions(snapshot);

    // 4. Execute decisions
    const { drones: updatedDrones, result } = await executeDecision(decision, drones, heatmap);
    drones = updatedDrones;

    // 5. Log execution results
    console.log(`\n[Executor] Executed: ${result.executed}, Skipped: ${result.skipped}`);
    for (const line of result.log) {
        console.log(`  ${line}`);
    }

    // 6. Every 10 ticks, shift the heatmap (simulate changing conditions)
    if (tickNumber % 10 === 0) {
        console.log(`\n[Sim] Heatmap shifted — simulating changing conditions`);
        heatmap = generateShiftedHeatmap();
    }
};

// ── Main ────────────────────────────────────────────────────────────────────
const main = async () => {
    console.log('┌─────────────────────────────────────────────────┐');
    console.log('│  🚁  FirstLight AI Orchestrator                 │');
    console.log('│  Powered by Google Vertex AI (Gemini)           │');
    console.log('├─────────────────────────────────────────────────┤');
    console.log(`│  Project:  ${process.env.GOOGLE_VERTEX_PROJECT}`);
    console.log(`│  Location: ${process.env.GOOGLE_VERTEX_LOCATION}`);
    console.log(`│  Model:    ${process.env.ORCHESTRATOR_MODEL ?? 'gemini-2.0-flash'}`);
    console.log(`│  Mode:     ${isLoop ? `loop (${maxTicks === Infinity ? '∞' : maxTicks} ticks, ${TICK_INTERVAL}ms interval)` : 'single tick'}`);
    console.log('└─────────────────────────────────────────────────┘');

    if (!isLoop) {
        // Single tick mode
        await runTick();
        console.log('\n✅ Single tick complete. Use --loop for continuous mode.');
        return;
    }

    // Loop mode
    let currentTick = 0;
    while (currentTick < maxTicks) {
        await runTick();
        currentTick++;

        if (currentTick < maxTicks) {
            console.log(`\n⏳ Next tick in ${TICK_INTERVAL / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, TICK_INTERVAL));
        }
    }

    console.log(`\n✅ Completed ${currentTick} ticks.`);
};

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
