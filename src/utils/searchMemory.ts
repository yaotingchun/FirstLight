/**
 *  searchMemory.ts — Persistent search memory for the drone swarm
 *
 *  Tracks zone-level scan history, failure counts, and sustained signals
 *  to prevent repeated scanning and guide exploration decisions.
 */

// ── Search Memory Type ───────────────────────────────────────────────────────

export interface SearchMemory {
    /** zoneId → tick of most recent scan in that zone */
    recentlyScannedZones: Map<string, number>;
    /** zoneId → count of consecutive scans that found nothing */
    failedScanCounts: Map<string, number>;
    /** zoneId → sustained signal strength (decayed rolling average) */
    persistentSignals: Map<string, number>;
    /** cellKey "x,y" → tick of last scan (for repeat-scan detection) */
    scannedCells: Map<string, number>;
    /** Running count of total scans and repeat scans (for metrics) */
    totalScans: number;
    repeatScans: number;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export const createSearchMemory = (): SearchMemory => ({
    recentlyScannedZones: new Map(),
    failedScanCounts: new Map(),
    persistentSignals: new Map(),
    scannedCells: new Map(),
    totalScans: 0,
    repeatScans: 0,
});

// ── Configurable decay constants ─────────────────────────────────────────────

/** Ticks before a zone's recency penalty drops to ~50% */
export const RECENCY_HALF_LIFE = 30;

/** Ticks since last scan for a cell to be considered "fresh" (re-scan within this window counts as repeat) */
export const REPEAT_SCAN_WINDOW = 40;

/** Decay factor for persistent signals per recording */
export const SIGNAL_DECAY = 0.85;

// ── Memory Operations ────────────────────────────────────────────────────────

/**
 * Record that a cell was scanned. Updates both cell-level and zone-level memory.
 *
 * @param memory      Current search memory (mutated in-place)
 * @param zoneId      Zone containing the scanned cell
 * @param cellX       Cell x coordinate
 * @param cellY       Cell y coordinate
 * @param currentTick Current simulation tick
 * @param foundSignal Whether the scan detected a meaningful signal (prob > threshold)
 */
export const recordCellScan = (
    memory: SearchMemory,
    zoneId: string,
    cellX: number,
    cellY: number,
    currentTick: number,
    foundSignal: boolean,
): void => {
    const cellKey = `${cellX},${cellY}`;

    // Track repeat scans
    memory.totalScans++;
    const lastCellScan = memory.scannedCells.get(cellKey);
    if (lastCellScan !== undefined && (currentTick - lastCellScan) < REPEAT_SCAN_WINDOW) {
        memory.repeatScans++;
    }

    // Update cell-level
    memory.scannedCells.set(cellKey, currentTick);

    // Update zone-level
    memory.recentlyScannedZones.set(zoneId, currentTick);

    if (foundSignal) {
        // Reset failed count on positive signal
        memory.failedScanCounts.set(zoneId, 0);

        // Boost persistent signal (rolling average with decay)
        const existing = memory.persistentSignals.get(zoneId) ?? 0;
        memory.persistentSignals.set(zoneId, existing * SIGNAL_DECAY + (1 - SIGNAL_DECAY));
    } else {
        // Increment failed scan count
        const fails = memory.failedScanCounts.get(zoneId) ?? 0;
        memory.failedScanCounts.set(zoneId, fails + 1);

        // Decay persistent signal
        const existing = memory.persistentSignals.get(zoneId) ?? 0;
        if (existing > 0) {
            memory.persistentSignals.set(zoneId, existing * SIGNAL_DECAY);
        }
    }
};

/**
 * Get the recency penalty for a zone (0 = never scanned, 1 = just scanned).
 */
export const getRecencyPenalty = (
    memory: SearchMemory,
    zoneId: string,
    currentTick: number,
): number => {
    const lastScan = memory.recentlyScannedZones.get(zoneId);
    if (lastScan === undefined) return 0;
    const elapsed = currentTick - lastScan;
    return Math.exp(-elapsed / RECENCY_HALF_LIFE);
};

/**
 * Check whether a zone should be avoided due to exhaustion
 * (many consecutive failed scans and no persistent signals).
 */
export const shouldAvoidZone = (
    memory: SearchMemory,
    zoneId: string,
    failThreshold = 5,
): boolean => {
    const fails = memory.failedScanCounts.get(zoneId) ?? 0;
    const signal = memory.persistentSignals.get(zoneId) ?? 0;
    return fails >= failThreshold && signal < 0.1;
};

/**
 * Check whether a specific cell was recently scanned (within the repeat window).
 */
export const wasCellRecentlyScanned = (
    memory: SearchMemory,
    cellX: number,
    cellY: number,
    currentTick: number,
): boolean => {
    const lastScan = memory.scannedCells.get(`${cellX},${cellY}`);
    if (lastScan === undefined) return false;
    return (currentTick - lastScan) < REPEAT_SCAN_WINDOW;
};

/**
 * Get the repeated scan rate as a percentage (0–100).
 */
export const getRepeatScanRate = (memory: SearchMemory): number => {
    if (memory.totalScans === 0) return 0;
    return (memory.repeatScans / memory.totalScans) * 100;
};
