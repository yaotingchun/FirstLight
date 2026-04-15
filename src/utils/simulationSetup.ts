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
                lastVisitedTick: 0,
                currentDrones: 0,
                confidence: 0,
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
        const numHotspots = Math.floor(Math.random() * 5) + 3; // 3 to 7
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
    const targetSectorCount = survivors ? survivors.length : (Math.floor(Math.random() * 5) + 3);
    for (const s of sorted) {
        if (selectedSectors.length >= targetSectorCount) break;
        const tooClose = selectedSectors.some(sel =>
            Math.sqrt(Math.pow(s.x - sel.x, 2) + Math.pow(s.y - sel.y, 2)) < MIN_DIST
        );
        if (!tooClose) {
            selectedSectors.push(s);
        }
    }

    // Assign each survivor's message-matched image to its grid cell
    if (survivors) {
        survivors.forEach(s => {
            if (s.info.img) {
                g[s.y][s.x].disasterImage = s.info.img;
            }
        });
    }

    // Scatter empty images around survivors that have images, to add noise
    if (survivors) {
        survivors.forEach(s => {
            for (let i = 0; i < 2; i++) {
                let dx, dy;
                do {
                    dx = Math.floor(Math.random() * 5) - 2;
                    dy = Math.floor(Math.random() * 5) - 2;
                } while (dx === 0 && dy === 0);
                const nx = Math.max(0, Math.min(GRID_W - 1, s.x + dx));
                const ny = Math.max(0, Math.min(GRID_H - 1, s.y + dy));
                if (!g[ny][nx].disasterImage) {
                    g[ny][nx].disasterImage = '/mock_images/empty.png';
                }
            }
        });
    }

    return g;
};

export const createDrones = (randomizeBattery: boolean = true): Drone[] => {
    const bx = BASE_STATION.x;
    const by = BASE_STATION.y;
    // Departure stagger: drones flying to distant targets leave first so all arrive roughly together.
    // Alpha/Beta  → upper corners (~18.6 cells away) → depart tick 0
    // RLY-Prime   → center      (~9 cells away)       → depart tick 15
    // Gamma/Delta → lower corners (~7.8 cells away)  → depart tick 25
    
    // Helper to randomize battery between 40 and 100
    const randomBattery = () => randomizeBattery ? Math.floor(40 + Math.random() * 61) : 100;

    return [
        { id: 'DRN-Alpha', x: bx, y: by, tx: 2, ty: 2, mode: 'Wide', battery: randomBattery(), targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] },
        { id: 'DRN-Beta', x: bx, y: by, tx: 17, ty: 2, mode: 'Wide', battery: randomBattery(), targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] },
        { id: 'RLY-Prime', x: bx, y: by, tx: GRID_W / 2, ty: GRID_H / 2, mode: 'Relay', battery: randomBattery(), targetSector: null, isConnected: true, memory: [], startTick: 15, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] },
        { id: 'RLY-Backup', x: bx, y: by, tx: bx, ty: by, mode: 'Charging', battery: 100, targetSector: null, isConnected: true, memory: [], startTick: 0, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] },
        { id: 'DRN-Gamma', x: bx, y: by, tx: 2, ty: 17, mode: 'Wide', battery: randomBattery(), targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] },
        { id: 'DRN-Delta', x: bx, y: by, tx: 17, ty: 17, mode: 'Wide', battery: randomBattery(), targetSector: null, isConnected: true, memory: [], startTick: 25, knownOtherDrones: {}, lockTarget: false, preventReassignment: false, lastScannedX: -1, lastScannedY: -1, path: [{ x: bx, y: by, tick: 0 }] }
    ];
};

// ── Message-to-Image Classification ──
const THERMAL_IMAGES = ['/mock_images/thermal1.png', '/mock_images/thermal2.png', '/mock_images/thermal3.png'];
const MEDICAL_IMAGES = ['/mock_images/medical1.png', '/mock_images/medical2.png'];
const DEBRIS_IMAGES  = ['/mock_images/debris1.png', '/mock_images/debris2.png'];

const pickRandom = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)];

const getDetectionImage = (message: string): string => {
    // Special override: Level 2 pathways message always gets debris3
    if (message.includes('LEVEL 2') && message.includes('ASCENT/DESCENT')) {
        return '/mock_images/debris3.png';
    }
    // Special override: Multiple survivors from thermal always gets thermal2
    if (message.includes('MULTIPLE THERMAL SIGNATURES')) {
        return '/mock_images/thermal2.png';
    }
    // Thermal keywords
    if (/THERMAL|TEMP|OXYGEN|HEAT/i.test(message)) {
        return pickRandom(THERMAL_IMAGES);
    }
    // Medical keywords
    if (/MEDICAL|DEHYDRATION|INFANT|ELDERLY|TRAUMA/i.test(message)) {
        return pickRandom(MEDICAL_IMAGES);
    }
    // Default: debris
    return pickRandom(DEBRIS_IMAGES);
};

export const createSurvivors = (grid?: Sector[][]): HiddenSurvivor[] => {
    const messages = [
        "TARGET ISOLATED UNDER STRUCTURAL DEBRIS. LOWER LIMB TRAUMA DETECTED.",
        "TARGET SECURE. EGRESS ROUTES BLOCKED BY OBSTRUCTIONS.",
        "TARGET DETECTED. SEVERE DEHYDRATION INDICATORS PRESENT.",
        "ELDERLY TARGET LOCATED. CRITICAL MEDICAL INTERVENTION REQUIRED.",
        "VITAL SIGNS UNSTABLE. ACCELERATED MEDICAL EXTRACTION RECOMMENDED.",
        "TARGET ISOLATED ON LEVEL 2. ASCENT/DESCENT PATHWAYS COMPROMISED.",
        "TARGET DETECTED. OXYGEN DEPLETION IMMINENT. URGENT EXTRACTION.",
        "BIOLOGICAL THERMAL SIGNATURE ACQUIRED. TARGET LOCATED ALIVE.",
        "MULTIPLE THERMAL SIGNATURES DETECTED. IMMEDIATE EXFIL REQUIRED.",
        "TARGETS LOCATED. AMBIENT TEMP SUB-OPTIMAL. THERMAL INSULATION NEEDED.",
        "TARGETS ISOLATED BY DEBRIS. NO ACUTE TRAUMA DETECTED."
    ];

    // Shuffle the messages so they don't repeat in one simulation
    const shuffledMessages = [...messages].sort(() => Math.random() - 0.5);

    if (grid) {
        const allSectors = grid.flat();
        // Sort by probability but enforce spreading
        const sorted = [...allSectors].sort((a, b) => b.prob - a.prob);
        const selected: Sector[] = [];
        const MIN_DIST = 6; // Enforce at least 6 cells distance between survivors
        const numSurvivors = Math.floor(Math.random() * 5) + 3; // 3 to 7

        for (const s of sorted) {
            if (selected.length >= numSurvivors) break;
            const tooClose = selected.some(sel =>
                Math.sqrt(Math.pow(s.x - sel.x, 2) + Math.pow(s.y - sel.y, 2)) < MIN_DIST
            );
            if (!tooClose) {
                selected.push(s);
            }
        }

        return selected.map((s, i) => {
            const message = shuffledMessages[i % shuffledMessages.length];
            const img = getDetectionImage(message);
            return {
                id: `S${i + 1}`,
                x: s.x,
                y: s.y,
                found: false,
                info: { message, battery: `${Math.floor(Math.random() * 50 + 5)}%`, img }
            };
        });
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
    const fallbackNumSurvivors = Math.floor(Math.random() * 5) + 3; // 3 to 7
    for (const c of candidates) {
        if (selectedPoints.length >= fallbackNumSurvivors) break;
        const tooClose = selectedPoints.some(p => Math.sqrt(Math.pow(c.x - p.x, 2) + Math.pow(c.y - p.y, 2)) < 6);
        if (!tooClose) selectedPoints.push(c);
    }

    return selectedPoints.map((p, i) => {
        const message = shuffledMessages[i % shuffledMessages.length];
        const img = getDetectionImage(message);
        return {
            id: `S${i + 1}`,
            x: p.x,
            y: p.y,
            found: false,
            info: { message, battery: "45%", img }
        };
    });
};
