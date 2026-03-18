import { droneStore, BASE_X, BASE_Y, GRID_W, GRID_H } from '../droneStore.js';
import type { DroneStatus, SectorScanResult } from '../types.js';

type AutonomyAction = {
    droneId: string;
    type: 'RECALL_TO_BASE' | 'SET_TARGET' | 'SET_MODE' | 'REPLACE_RELAY' | 'MOVE_RELAY';
    reason: string;
};

export interface LocalAutonomyResult {
    enabled: boolean;
    tick: number;
    actions: AutonomyAction[];
}

type LastTarget = {
    x: number;
    y: number;
    tick: number;
};

const TARGET_REASSIGN_COOLDOWN_TICKS = 8;
const RELAY_REPOSITION_COOLDOWN_TICKS = 6;

class LocalAutonomyEngine {
    private enabled = true;
    private disconnectedStreak = new Map<string, number>();
    private lastTargetByDrone = new Map<string, LastTarget>();
    private lastRelayMoveTick = new Map<string, number>();
    private lastRelayReplaceTick = new Map<string, number>();

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    onTick(tick: number): LocalAutonomyResult {
        const actions: AutonomyAction[] = [];
        if (!this.enabled || !droneStore.isSimulationRunning()) {
            return { enabled: this.enabled, tick, actions };
        }

        const drones = droneStore.getAllDrones();
        const grid = droneStore.getGrid();

        this.updateConnectivityStreaks(drones);

        for (const drone of drones) {
            if (!drone.isActive) continue;

            if (drone.id.startsWith('RLY-')) {
                this.evaluateRelayDrone(drone, drones, tick, actions);
            } else {
                this.evaluateSearchDrone(drone, grid, tick, actions);
            }
        }

        return {
            enabled: this.enabled,
            tick,
            actions,
        };
    }

    private updateConnectivityStreaks(drones: DroneStatus[]): void {
        for (const drone of drones) {
            if (!drone.isActive || drone.mode === 'Charging') {
                this.disconnectedStreak.delete(drone.id);
                continue;
            }

            if (drone.isConnected) {
                this.disconnectedStreak.delete(drone.id);
            } else {
                const current = this.disconnectedStreak.get(drone.id) ?? 0;
                this.disconnectedStreak.set(drone.id, current + 1);
            }
        }
    }

    private evaluateSearchDrone(
        drone: DroneStatus,
        grid: SectorScanResult[][],
        tick: number,
        actions: AutonomyAction[],
    ): void {
        if (drone.mode === 'Charging') {
            return;
        }

        const recallThreshold = droneStore.getAutoRecallThreshold(drone.id) ?? 20;

        if (drone.battery <= recallThreshold && !this.isHeadingToBase(drone)) {
            droneStore.enqueueCommand('RECALL_TO_BASE', { droneId: drone.id });
            actions.push({
                droneId: drone.id,
                type: 'RECALL_TO_BASE',
                reason: `Battery is at ${drone.battery.toFixed(1)}%, which is under the ${recallThreshold}% safety threshold. Returning to base now.`,
            });
            return;
        }

        const disconnectedTicks = this.disconnectedStreak.get(drone.id) ?? 0;
        if (disconnectedTicks >= 5 && !this.isHeadingToBase(drone)) {
            const safeX = Math.round((drone.position.x + BASE_X) / 2);
            const safeY = Math.round((drone.position.y + BASE_Y) / 2);
            if (this.shouldIssueTarget(drone, safeX, safeY, tick)) {
                droneStore.enqueueCommand('SET_TARGET', {
                    droneId: drone.id,
                    targetX: safeX,
                    targetY: safeY,
                });
                actions.push({
                    droneId: drone.id,
                    type: 'SET_TARGET',
                    reason: `We have been disconnected for ${disconnectedTicks} ticks, so I am moving toward the base relay corridor to recover link quality.`,
                });
            }
            return;
        }

        if (!this.needsNewTask(drone)) {
            return;
        }

        const targetCell = this.findBestLocalTarget(drone, grid);
        if (!targetCell) {
            return;
        }

        const desiredMode: DroneStatus['mode'] = targetCell.probability >= 0.65 ? 'Micro' : 'Wide';
        if (desiredMode !== drone.mode) {
            droneStore.enqueueCommand('SET_MODE', {
                droneId: drone.id,
                mode: desiredMode,
            });
            actions.push({
                droneId: drone.id,
                type: 'SET_MODE',
                reason: `I am switching scan mode based on local target ${targetCell.gridCell} (estimated probability ${targetCell.probability.toFixed(2)}).`,
            });
        }

        if (this.shouldIssueTarget(drone, targetCell.x, targetCell.y, tick)) {
            droneStore.enqueueCommand('SET_TARGET', {
                droneId: drone.id,
                targetX: targetCell.x,
                targetY: targetCell.y,
            });
            actions.push({
                droneId: drone.id,
                type: 'SET_TARGET',
                reason: `Assigning myself to local hotspot ${targetCell.gridCell} as the next search objective.`,
            });
        }
    }

    private evaluateRelayDrone(
        relay: DroneStatus,
        drones: DroneStatus[],
        tick: number,
        actions: AutonomyAction[],
    ): void {
        if (relay.mode === 'Charging') {
            return;
        }

        if (relay.battery <= 25 && !this.isHeadingToBase(relay)) {
            const lastReplaceTick = this.lastRelayReplaceTick.get(relay.id) ?? -9999;
            if (tick - lastReplaceTick >= RELAY_REPOSITION_COOLDOWN_TICKS) {
                const standbyRelay = drones.find((d) =>
                    d.id !== relay.id &&
                    d.id.startsWith('RLY-') &&
                    d.isActive &&
                    d.mode === 'Charging' &&
                    d.battery >= 50,
                );

                if (standbyRelay) {
                    droneStore.enqueueCommand('REPLACE_RELAY', {
                        oldRelayId: relay.id,
                        newRelayId: standbyRelay.id,
                        targetX: relay.position.x,
                        targetY: relay.position.y,
                    });
                    this.lastRelayReplaceTick.set(relay.id, tick);
                    actions.push({
                        droneId: relay.id,
                        type: 'REPLACE_RELAY',
                        reason: `Relay battery is down to ${relay.battery.toFixed(1)}%, so I am handing this position off to ${standbyRelay.id}.`,
                    });
                    return;
                }

                droneStore.enqueueCommand('RECALL_TO_BASE', { droneId: relay.id });
                this.lastRelayReplaceTick.set(relay.id, tick);
                actions.push({
                    droneId: relay.id,
                    type: 'RECALL_TO_BASE',
                    reason: `Relay battery is at ${relay.battery.toFixed(1)}% and no standby relay is available, so I am returning to base.`,
                });
                return;
            }
        }

        const disconnected = drones.filter((d) => !d.id.startsWith('RLY-') && d.isActive && !d.isConnected);
        if (disconnected.length === 0) {
            return;
        }

        const lastMoveTick = this.lastRelayMoveTick.get(relay.id) ?? -9999;
        if (tick - lastMoveTick < RELAY_REPOSITION_COOLDOWN_TICKS) {
            return;
        }

        const centroid = disconnected.reduce(
            (acc, d) => {
                acc.x += d.position.x;
                acc.y += d.position.y;
                return acc;
            },
            { x: 0, y: 0 },
        );

        const avgX = centroid.x / disconnected.length;
        const avgY = centroid.y / disconnected.length;
        const relayX = this.clamp(Math.round((avgX + BASE_X) / 2), 0, GRID_W - 1);
        const relayY = this.clamp(Math.round((avgY + BASE_Y) / 2), 0, GRID_H - 1);

        if (!this.shouldIssueTarget(relay, relayX, relayY, tick)) {
            return;
        }

        droneStore.enqueueCommand('MOVE_RELAY', {
            relayId: relay.id,
            x: relayX,
            y: relayY,
        });
        this.lastRelayMoveTick.set(relay.id, tick);
        actions.push({
            droneId: relay.id,
            type: 'MOVE_RELAY',
            reason: `Repositioning now to help reconnect ${disconnected.length} disconnected search drone(s).`,
        });
    }

    private needsNewTask(drone: DroneStatus): boolean {
        if (!drone.target) return true;

        const distToTarget = this.distance(
            drone.position.x,
            drone.position.y,
            drone.target.x,
            drone.target.y,
        );

        return distToTarget <= 0.6;
    }

    private findBestLocalTarget(drone: DroneStatus, grid: SectorScanResult[][]): SectorScanResult | null {
        const region = drone.assignedRegion;
        const radius = 6;

        let best: SectorScanResult | null = null;

        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                const cell = grid[y]?.[x];
                if (!cell || cell.scanned) continue;

                if (region) {
                    const inRegion = x >= region.xMin && x <= region.xMax && y >= region.yMin && y <= region.yMax;
                    if (!inRegion) continue;
                } else {
                    const d = this.distance(drone.position.x, drone.position.y, x, y);
                    if (d > radius) continue;
                }

                const dist = this.distance(drone.position.x, drone.position.y, x, y);
                const score = cell.probability * 1.6 + (1 - Math.min(dist / 10, 1)) * 0.4 - cell.pheromone * 0.3;
                if (!best) {
                    best = cell;
                    continue;
                }

                const bestDist = this.distance(drone.position.x, drone.position.y, best.x, best.y);
                const bestScore = best.probability * 1.6 + (1 - Math.min(bestDist / 10, 1)) * 0.4 - best.pheromone * 0.3;
                if (score > bestScore) {
                    best = cell;
                }
            }
        }

        return best;
    }

    private shouldIssueTarget(drone: DroneStatus, x: number, y: number, tick: number): boolean {
        const last = this.lastTargetByDrone.get(drone.id);

        if (last) {
            const sameTarget = Math.round(last.x) === Math.round(x) && Math.round(last.y) === Math.round(y);
            const withinCooldown = tick - last.tick < TARGET_REASSIGN_COOLDOWN_TICKS;
            if (sameTarget || withinCooldown) {
                return false;
            }
        }

        this.lastTargetByDrone.set(drone.id, { x, y, tick });
        return true;
    }

    private isHeadingToBase(drone: DroneStatus): boolean {
        if (!drone.target) return false;

        const targetIsBase = Math.round(drone.target.x) === BASE_X && Math.round(drone.target.y) === BASE_Y;
        if (!targetIsBase) return false;

        return this.distance(drone.position.x, drone.position.y, BASE_X, BASE_Y) > 0.5;
    }

    private distance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}

export const localAutonomy = new LocalAutonomyEngine();
