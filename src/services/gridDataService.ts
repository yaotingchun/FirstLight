// gridDataService.ts - Shared Singleton for Tactical Grid Probabilities

export type GridWeightMap = number[][]; // 20x20 array

class GridDataService {
    private weights: GridWeightMap;
    private listeners: ((weights: GridWeightMap) => void)[] = [];

    constructor() {
        // Initialize with minimal probability (0.05)
        this.weights = Array.from({ length: 20 }, () => new Array(20).fill(0.05));
    }

    /** Update the entire grid and notify listeners */
    setWeights(newWeights: GridWeightMap) {
        this.weights = newWeights;
        this.notify();
    }

    /** Get current weights */
    getWeights(): GridWeightMap {
        return this.weights;
    }

    /** Subscribe to changes */
    subscribe(listener: (weights: GridWeightMap) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.weights));
    }
}

export const gridDataService = new GridDataService();
