import { gridDataService } from '../services/gridDataService';
import {
    GRID_W, GRID_H, BASE_STATION
} from '../types/simulation';
import type { Sector, Drone, HiddenSurvivor } from '../types/simulation';

export const createGrid = (survivors?: HiddenSurvivor[]): Sector[][] => {
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

    const sorted = [...allSectors].sort((a, b) => b.prob - a.prob);
    const selectedSectors: Sector[] = [];
    const MIN_DIST = 6;
    for (const s of sorted) {
        if (selectedSectors.length >= 3) break;
        const tooClose = selectedSectors.some(sel =>
            Math.sqrt(Math.pow(s.x - sel.x, 2) + Math.pow(s.y - sel.y, 2)) < MIN_DIST
        );
        if (!tooClose) {
            selectedSectors.push(s);
        }
    }

    if (selectedSectors.length >= 3) {
        // Only assign images strictly to the first two survivors. 
        // The third survivor grid will not have a direct image.
        g[selectedSectors[0].y][selectedSectors[0].x].disasterImage = '/mock_images/survivor.png';
        g[selectedSectors[1].y][selectedSectors[1].x].disasterImage = '/mock_images/thermal.png';

        // Scatter empty images ONLY around the survivor grids without a direct image
        selectedSectors.slice(2).forEach((s) => {
            // Place 2 empty images scattered around the third survivor
            for (let i = 0; i < 2; i++) {
                let dx, dy;
                do {
                    dx = Math.floor(Math.random() * 5) - 2; // -2 to 2
                    dy = Math.floor(Math.random() * 5) - 2; // -2 to 2
                } while (dx === 0 && dy === 0);
                const nx = Math.max(0, Math.min(GRID_W - 1, s.x + dx));
                const ny = Math.max(0, Math.min(GRID_H - 1, s.y + dy));
                
                // Only place empty.png on grids that don't already have an image
                if (!g[ny][nx].disasterImage) {
                    g[ny][nx].disasterImage = '/mock_images/empty.png';
                }
            }
        });
    }

    return g;
};

export const createDrones = (): Drone[] => {
    const bx = BASE_STATION.x;
    const by = BASE_STATION.y;
    // Departure stagger: drones flying to distant targets leave first so all arrive roughly together.
    // Alpha/Beta  → upper corners (~18.6 cells away) → depart tick 0
    // RLY-Prime   → center      (~9 cells away)       → depart tick 15
    // Gamma/Delta → lower corners (~7.8 cells away)  → depart tick 25
    return [
        { id: 'DRN-Alpha', x: bx, y: by, tx: 2, ty: 2, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {} },
        { id: 'DRN-Beta', x: bx, y: by, tx: 17, ty: 2, mode: 'Wide', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {} },
        { id: 'RLY-Prime', x: bx, y: by, tx: GRID_W / 2, ty: GRID_H / 2, mode: 'Relay', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 15, knownOtherDrones: {} },
        { id: 'RLY-Backup', x: bx, y: by, tx: bx, ty: by, mode: 'Charging', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {} },
        { id: 'DRN-Gamma', x: bx, y: by, tx: 2,  ty: 17, mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {} },
        { id: 'DRN-Delta', x: bx, y: by, tx: 17, ty: 17, mode: 'Wide',  battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {} }
    ];
};

export const createSurvivors = (grid?: Sector[][]): HiddenSurvivor[] => {
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
