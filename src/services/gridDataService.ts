// gridDataService.ts - Shared Singleton for Tactical Grid Probabilities

export type GridWeightMap = number[][]; // 20x20 array

export type SensorWeights = {
    mobile: { base: number, conf: number, color: string },
    thermal: { base: number, conf: number, color: string },
    sound: { base: number, conf: number, color: string },
    wifi: { base: number, conf: number, color: string }
};

export const INITIAL_SENSORS: SensorWeights = {
    mobile: { base: 0.4, conf: 0.9, color: '#00ffcc' },
    thermal: { base: 0.3, conf: 0.6, color: '#ff4444' },
    sound: { base: 0.2, conf: 0.7, color: '#ffff00' },
    wifi: { base: 0.1, conf: 0.8, color: '#ff00ff' }
};

/**
 * Source priority — higher number = higher authority.
 * When a high-priority source is active, lower-priority writers are ignored.
 *   'prediction' (1) = Markov diffusion engine in MapSimulator
 *   'scan'       (2) = Live drone scanning in SimulationMap
 */
export type GridSource = 'prediction' | 'scan';
const SOURCE_PRIORITY: Record<GridSource, number> = { prediction: 1, scan: 2 };

/** Terrain types shared between Tactical Map and Swarm Sim */
export type TerrainType = 'Open Field' | 'Road' | 'Shelter' | 'Collapsed Area';
export type TerrainGrid = TerrainType[][];

import { fetchOSMFeatures } from '../utils/osmClient';

// ── OSM config (same constants as MapSimulator) ─────────────────────────────
const MAP_CENTER = { longitude: 101.6841, latitude: 3.1319 };
const BBOX_OFFSET = 0.009;
const GRID_CELLS = 20;
const DEG_STEP = (BBOX_OFFSET * 2) / GRID_CELLS;

/** Map OSM tags → terrain type */
const getTerrainFromTags = (tags: any): TerrainType => {
    if (!tags) return 'Open Field';
    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';
    const highway = tags.highway || '';

    if (['dormitory', 'residential', 'apartments', 'house', 'university',
         'college', 'library', 'commercial', 'office'].includes(building) ||
        ['clinic', 'hospital', 'restaurant', 'university', 'library'].includes(amenity)) {
        return 'Shelter';
    }
    if (['ruins', 'collapsed', 'damaged'].includes(building) ||
        building === 'yes') {
        return 'Collapsed Area';
    }
    if (highway || ['pitch', 'stadium', 'park'].includes(leisure) ||
        ['garage', 'roof'].includes(building)) {
        return 'Road';
    }
    return 'Open Field';
};

/** Map OSM tags → survivor probability weight */
const getProbabilityFromTags = (tags: any): number => {
    if (!tags) return 0.2;
    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';

    if (['dormitory', 'residential', 'apartments', 'house'].includes(building))
        return 0.8 + Math.random() * 0.2;
    if (['university', 'college', 'library', 'research_institute'].includes(building) ||
        ['university', 'library', 'research_institute'].includes(amenity))
        return 0.5 + Math.random() * 0.2;
    if (['commercial', 'office'].includes(building) ||
        ['clinic', 'hospital', 'restaurant'].includes(amenity))
        return 0.3 + Math.random() * 0.2;
    if (['pitch', 'stadium', 'park'].includes(leisure) ||
        ['garage', 'roof'].includes(building))
        return 0.05 + Math.random() * 0.15;
    return 0.2;
};

class GridDataService {
    private weights: GridWeightMap;
    private sensorWeights: SensorWeights;
    private terrainGrid: TerrainGrid;
    private terrainReady = false;
    private activeSource: GridSource | null = null;
    private listeners: ((weights: GridWeightMap, sensorWeights: SensorWeights) => void)[] = [];
    private terrainListeners: (() => void)[] = [];

    constructor() {
        this.weights = Array.from({ length: 20 }, () => new Array(20).fill(0.05));
        this.sensorWeights = JSON.parse(JSON.stringify(INITIAL_SENSORS));
        this.terrainGrid = Array.from({ length: 20 }, () => new Array<TerrainType>(20).fill('Open Field'));
        // Auto-fetch OSM terrain on startup
        this.fetchOSMTerrain();
    }

    // ── OSM Terrain Fetch (runs once at startup) ────────────────────────────
    private async fetchOSMTerrain() {
        try {
            const bbox = `${(MAP_CENTER.latitude - BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.longitude - BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.latitude + BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.longitude + BBOX_OFFSET).toFixed(4)}`;
            
            // Use the robust mirror-rotating client
            const points = await fetchOSMFeatures(bbox);

            const terrain: TerrainGrid = Array.from({ length: 20 }, () =>
                new Array<TerrainType>(20).fill('Open Field')
            );
            const probWeights: GridWeightMap = Array.from({ length: 20 }, () =>
                new Array(20).fill(0.05)
            );

            const startLat = MAP_CENTER.latitude - BBOX_OFFSET;
            const startLon = MAP_CENTER.longitude - BBOX_OFFSET;

            for (let r = 0; r < GRID_CELLS; r++) {
                for (let c = 0; c < GRID_CELLS; c++) {
                    const latMin = startLat + r * DEG_STEP;
                    const lonMin = startLon + c * DEG_STEP;

                    const inside = points.filter(p =>
                        p.center.lat >= latMin && p.center.lat < latMin + DEG_STEP &&
                        p.center.lon >= lonMin && p.center.lon < lonMin + DEG_STEP
                    );

                    // Row mapping: r=0 is south (bottom), grid index 0 = top
                    const gridRow = GRID_CELLS - 1 - r;

                    if (inside.length > 0) {
                        // Terrain: pick dominant type
                        const counts: Record<TerrainType, number> = {
                            'Open Field': 0, 'Road': 0, 'Shelter': 0, 'Collapsed Area': 0
                        };
                        inside.forEach(p => { 
                            const type = getTerrainFromTags(p.tags);
                            counts[type]++; 
                        });
                        const best = (Object.entries(counts) as [TerrainType, number][])
                            .sort((a, b) => b[1] - a[1])[0][0];
                        terrain[gridRow][c] = best;

                        // Probability: average weight
                        probWeights[gridRow][c] = inside.reduce(
                            (sum, p) => sum + getProbabilityFromTags(p.tags), 0
                        ) / inside.length;
                    }
                }
            }

            this.terrainGrid = terrain;
            this.terrainReady = true;
            // Set initial prediction weights from OSM (won't overwrite scan)
            this.setWeights(probWeights, 'prediction');
            // Notify terrain subscribers
            this.terrainListeners.forEach(fn => fn());
            console.log('[GridDataService] OSM terrain loaded — terrain & weights ready.');
        } catch (err) {
            console.warn('[GridDataService] OSM terrain fetch failed, using fallback.', err);
        }
    }

    /** Set the 20×20 terrain grid */
    setTerrainGrid(grid: TerrainGrid) { this.terrainGrid = grid; this.terrainReady = true; }

    /** Get the current terrain grid */
    getTerrainGrid(): TerrainGrid { return this.terrainGrid; }

    /** Whether OSM terrain has loaded */
    isTerrainReady(): boolean { return this.terrainReady; }

    /** Subscribe to terrain becoming ready (fires once) */
    onTerrainReady(fn: () => void) {
        if (this.terrainReady) { fn(); return; }
        this.terrainListeners.push(fn);
    }

    /** Claim write authority — lower-priority sources will be blocked. */
    claimSource(source: GridSource) { this.activeSource = source; }

    /** Release write authority — any source may write again. */
    releaseSource() { this.activeSource = null; }

    /** Get the current active source (for UI / debug). */
    getActiveSource(): GridSource | null { return this.activeSource; }

    /** Update the entire grid and notify listeners.
     *  If a source is provided and a higher-priority source is active, the write is silently skipped. */
    setWeights(newWeights: GridWeightMap, source?: GridSource) {
        if (source && this.activeSource &&
            SOURCE_PRIORITY[source] < SOURCE_PRIORITY[this.activeSource]) {
            return; // blocked — a higher-priority source owns the grid
        }
        this.weights = newWeights;
        this.notify();
    }

    setSensorWeights(newSensorWeights: SensorWeights) {
        this.sensorWeights = newSensorWeights;
        this.notify();
    }

    /** Get current weights */
    getWeights(): GridWeightMap {
        return this.weights;
    }

    getSensorWeights(): SensorWeights {
        return this.sensorWeights;
    }

    /** Subscribe to changes */
    subscribe(listener: (weights: GridWeightMap, sensorWeights: SensorWeights) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.weights, this.sensorWeights));
    }
}

export const gridDataService = new GridDataService();
