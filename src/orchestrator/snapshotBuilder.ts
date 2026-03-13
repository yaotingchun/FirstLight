/**
 *  snapshotBuilder.ts — Builds environment snapshots for the AI
 *
 *  Collects data from gridDataService, swarmRouting types, and heatmapService
 *  into a single EnvironmentSnapshot that gets serialised into the AI prompt.
 *
 *  KEY DESIGN: includes a pre-computed plain-text `summary` so the AI can
 *  quickly read drone counts, battery levels, and hotspots without parsing
 *  a huge JSON blob.
 */

import type {
    EnvironmentSnapshot,
    DroneSnapshot,
    HotspotInfo,
    TerrainSummary,
    SensorSummary,
    MissionObjective,
    SensorTrend,
    ZoneSnapshot,
    SwarmMetrics,
} from './types.js';
import type { SearchDrone } from '../utils/swarmRouting.js';
import type { GridWeightMap, SensorWeights, TerrainGrid, TerrainType } from '../services/gridDataService.js';

/**
 * Build a complete environment snapshot from current system state.
 *
 * @param weights       20×20 probability grid from gridDataService
 * @param terrain       20×20 terrain grid from gridDataService
 * @param sensors       Current sensor weight config
 * @param drones        Array of search drones from the simulation
 * @param tickNumber    Current simulation tick
 * @param topN          Number of top hotspots to include (default 10)
 */
export const buildEnvironmentSnapshot = (
    weights: GridWeightMap,
    terrain: TerrainGrid,
    sensors: SensorWeights,
    drones: SearchDrone[],
    tickNumber: number,
    topN = 10,
    latestVisionResult?: string,
    objectives: MissionObjective[] = [],
    sensorTrends: SensorTrend[] = [],
    simulationRunning = false,
    zoneSnapshots?: ZoneSnapshot[],
    metrics?: SwarmMetrics,
): EnvironmentSnapshot => {

    const gridSize = weights.length;
    const totalCells = gridSize * gridSize;

    // ── Flatten grid into cell list for analysis ────────────────────────────
    const allCells: { row: number; col: number; prob: number }[] = [];
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            allCells.push({ row: r, col: c, prob: weights[r]?.[c] ?? 0 });
        }
    }

    const totalProb = allCells.reduce((s, c) => s + c.prob, 0);
    const avgProb = totalCells > 0 ? totalProb / totalCells : 0;

    // ── Determine scanned cells (cells already visited by any drone) ────────
    const scannedPositions = new Set<string>();
    for (const d of drones) {
        if (d.scanQueueIndex > 0 && d.scanQueue.length > 0) {
            for (let i = 0; i < Math.min(d.scanQueueIndex, d.scanQueue.length); i++) {
                const pt = d.scanQueue[i];
                scannedPositions.add(`${pt.y}-${pt.x}`); // row-col
            }
        }
    }
    const scannedCells = scannedPositions.size;

    // ── Top hotspots ────────────────────────────────────────────────────────
    const hotspots: HotspotInfo[] = allCells
        .sort((a, b) => b.prob - a.prob)
        .slice(0, topN)
        .map(c => ({
            cellId: `${c.row}-${c.col}`,
            row: c.row,
            col: c.col,
            probability: Math.round(c.prob * 1000) / 1000,
            scanned: scannedPositions.has(`${c.row}-${c.col}`),
        }));

    // ── Top unscanned specific cells ─────────────────────────────────────────
    const unscannedHotspots = allCells
        .filter(c => !scannedPositions.has(`${c.row}-${c.col}`))
        .sort((a, b) => b.prob - a.prob)
        .slice(0, 5)
        .map(c => ({
            row: c.row,
            col: c.col,
            probability: Math.round(c.prob * 1000) / 1000,
        }));

    // ── Terrain summary ─────────────────────────────────────────────────────
    const terrainCounts: Record<TerrainType, number> = {
        'Open Field': 0, 'Road': 0, 'Shelter': 0, 'Collapsed Area': 0,
    };
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            const t = terrain[r]?.[c] ?? 'Open Field';
            terrainCounts[t]++;
        }
    }
    const terrainSummary: TerrainSummary = {
        shelterCells: terrainCounts['Shelter'],
        collapsedCells: terrainCounts['Collapsed Area'],
        roadCells: terrainCounts['Road'],
        openFieldCells: terrainCounts['Open Field'],
    };

    // ── Sensor summary ──────────────────────────────────────────────────────
    const sensorSummary: SensorSummary = {
        mobile: { confidence: sensors.mobile.conf, active: sensors.mobile.conf > 0.5 },
        thermal: { confidence: sensors.thermal.conf, active: sensors.thermal.conf > 0.5 },
        sound: { confidence: sensors.sound.conf, active: sensors.sound.conf > 0.5 },
        wifi: { confidence: sensors.wifi.conf, active: sensors.wifi.conf > 0.5 },
    };

    // ── Drone snapshots ─────────────────────────────────────────────────────
    const droneSnapshots: DroneSnapshot[] = drones.map(d => ({
        id: d.id,
        x: d.x,
        y: d.y,
        battery: Math.round(d.battery),
        active: d.active,
        assignedRegion: {
            xMin: d.regionXMin,
            xMax: d.regionXMax,
            yMin: d.regionYMin,
            yMax: d.regionYMax,
        },
        scanQueueRemaining: Math.max(0, d.scanQueue.length - d.scanQueueIndex),
    }));

    const activeDronesList = drones.filter(d => d.active);
    const inactiveDronesList = drones.filter(d => !d.active);
    const lowBatteryDrones = activeDronesList.filter(d => d.battery < 20);
    const batteryAvg = activeDronesList.length > 0
        ? activeDronesList.reduce((s, d) => s + d.battery, 0) / activeDronesList.length
        : 0;

    // ── Build plain-text summary (the AI reads this FIRST) ──────────────────
    const summary = [
        `TICK: ${tickNumber}`,
        `GRID: ${gridSize}x${gridSize} (${totalCells} cells total)`,
        `SCANNED: ${scannedCells}/${totalCells} (${Math.round(scannedCells / totalCells * 100)}%)`,
        `AVERAGE PROBABILITY: ${(Math.round(avgProb * 1000) / 1000)}`,
        `SIMULATION STATE: ${simulationRunning ? 'RUNNING (AI Loop Active)' : 'PAUSED'}`,
        ``,
        `DRONE FLEET: ${drones.length} drones total`,
        `  Active: ${activeDronesList.length} drones — ${activeDronesList.map(d => `${d.id}(battery=${Math.round(d.battery)}%)`).join(', ')}`,
        `  Inactive: ${inactiveDronesList.length} drones${inactiveDronesList.length > 0 ? ` — ${inactiveDronesList.map(d => d.id).join(', ')}` : ''}`,
        `  Low battery (<20%): ${lowBatteryDrones.length}${lowBatteryDrones.length > 0 ? ` — ${lowBatteryDrones.map(d => `${d.id}(${Math.round(d.battery)}%)`).join(', ')}` : ''}`,
        `  Average battery: ${Math.round(batteryAvg)}%`,
        ``,
        `TOP ${hotspots.length} HOTSPOTS:`,
        ...hotspots.map((h, i) => `  ${i + 1}. Cell (${h.row},${h.col}) prob=${h.probability}${h.scanned ? ' [SCANNED]' : ' [UNSCANNED]'}`),
        ``,
        `TOP 5 HIGHEST-PROBABILITY UNSCANNED CELLS:`,
        ...(unscannedHotspots.length > 0 
            ? unscannedHotspots.map((h, i) => `  ${i + 1}. Cell (${h.row},${h.col}) prob=${h.probability}`)
            : [`  (All cells currently scanned)`]),
        ``,
        `TERRAIN: ${terrainSummary.shelterCells} shelters, ${terrainSummary.collapsedCells} collapsed, ${terrainSummary.roadCells} roads, ${terrainSummary.openFieldCells} open fields`,
        `SENSORS: mobile(conf=${sensors.mobile.conf}) thermal(conf=${sensors.thermal.conf}) sound(conf=${sensors.sound.conf}) wifi(conf=${sensors.wifi.conf})`,
        sensorTrends.length > 0 ? `SENSOR TRENDS: ${sensorTrends.map(t => `${t.sensor}=${t.direction}`).join(', ')}` : '',
        latestVisionResult ? `\nLATEST PHOTO ANALYSIS: ${latestVisionResult}` : '',
        ``,
        // ── Zone summaries ────────────────────────────────────────────────────
        ...(zoneSnapshots && zoneSnapshots.length > 0 ? [
            `TOP ZONES (by score):`,
            ...zoneSnapshots.slice(0, 8).map((z, i) =>
                `  ${i + 1}. ${z.zoneId} score=${z.zoneScore.toFixed(2)} prob=${z.probabilityScore.toFixed(2)} peak=${z.maxProbability.toFixed(2)} unscanned=${z.unscannedCells}/${z.totalCells} drones=${z.assignedDroneCount} recency=${z.recencyPenalty.toFixed(2)} centroid=(${z.centroidX},${z.centroidY})`
            ),
            ``,
        ] : []),
        // ── Metrics ───────────────────────────────────────────────────────────
        ...(metrics ? [
            `SWARM METRICS:`,
            `  repeatScanRate=${metrics.repeatedScanRate.toFixed(1)}% zoneCoverage=${metrics.averageZoneCoverage.toFixed(1)}% idleTime=${metrics.droneIdleTime} meanProbScanned=${metrics.meanProbabilityScanned.toFixed(3)} totalScans=${metrics.totalScans}`,
            ``,
        ] : []),
        `MISSION OBJECTIVES:`,
        ...(objectives.length > 0
            ? objectives.map(o => `  - [${o.priority.toUpperCase()}] ${o.description} (${o.status})`)
            : [`  - (No specific objectives set)`]),
    ].join('\n');

    return {
        summary,
        timestamp: new Date().toISOString(),
        gridSize,
        totalCells,
        scannedCells,
        unscannedCells: totalCells - scannedCells,
        averageProbability: Math.round(avgProb * 1000) / 1000,
        hotspots,
        terrain: terrainSummary,
        sensors: sensorSummary,
        drones: droneSnapshots,
        activeDrones: activeDronesList.length,
        inactiveDrones: drones.length - activeDronesList.length,
        overallBatteryAvg: Math.round(batteryAvg * 10) / 10,
        tickNumber,
        latestVisionResult,
        objectives,
        sensorTrends,
        simulationRunning,
        zoneSnapshots,
        metrics,
    };
};
