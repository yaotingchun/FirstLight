// heatmapService.ts

export interface HeatmapCell {
    id: string;
    row: number;
    col: number;
    probability: number;
    scanned: boolean;
    buildingDensity: number;
    residentialFactor: number;
    roadAccess: number;
}

export type ScanResult = 'none' | 'thermal' | 'motion';

/**
 * Calculates the default survivor probability based on environmental features.
 */
export const calculateDefaultProbability = (buildingDensity: number, residentialFactor: number, roadAccess: number): number => {
    const rawProb = (0.5 * buildingDensity) + (0.3 * residentialFactor) + (0.2 * roadAccess);
    return Math.max(0, Math.min(1, rawProb)); // Clamp between 0 and 1
};

/**
 * Generates an NxN grid of HeatmapCells with randomized environmental factors.
 */
export const generateHeatmapGrid = (size: number): HeatmapCell[][] => {
    const grid: HeatmapCell[][] = [];

    for (let r = 0; r < size; r++) {
        const row: HeatmapCell[] = [];
        for (let c = 0; c < size; c++) {
            // Generate somewhat clustered pseudo-random factors for realism
            const buildingDensity = Math.random();
            const residentialFactor = Math.random() > 0.3 ? Math.random() : 0.1; // 70% chance of being residential
            
            // Assume central cross or edges might be roads
            let roadAccess = Math.random() * 0.5;
            if (r === Math.floor(size / 2) || c === Math.floor(size / 2)) {
                roadAccess = 0.8 + Math.random() * 0.2;
            }

            const probability = calculateDefaultProbability(buildingDensity, residentialFactor, roadAccess);

            row.push({
                id: `${r}-${c}`,
                row: r,
                col: c,
                probability,
                scanned: false,
                buildingDensity,
                residentialFactor,
                roadAccess
            });
        }
        grid.push(row);
    }
    return grid;
};

/**
 * Updates a cell's probability based on a simulated drone scan result.
 */
export const scanCell = (cell: HeatmapCell, result: ScanResult): HeatmapCell => {
    let p_new = cell.probability;

    switch (result) {
        case 'none':
            p_new = p_new * 0.5;
            break;
        case 'thermal':
            p_new = Math.min(p_new + 0.3, 1);
            break;
        case 'motion':
            p_new = Math.min(p_new + 0.2, 1);
            break;
    }

    return {
        ...cell,
        probability: p_new,
        scanned: true
    };
};
