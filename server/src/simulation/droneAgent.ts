/**
 * DroneAgent
 *
 * Deterministic autonomous agent for each search drone.
 * - Evaluates tasks and produces bids
 * - Implements hysteresis to prevent task oscillation
 * - Falls back to exploration when no tasks exist
 *
 * No LLM. Synchronous. Fast.
 */

import type { Task, Bid, DroneStatus } from '../types.js';
import { BASE_X, BASE_Y } from '../droneStore.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimum cost improvement required to switch tasks in WIDE mode */
export const SWITCH_THRESHOLD = 2.0;

/** Higher threshold for MICRO mode — discourage switching mid-scan */
export const MICRO_SWITCH_THRESHOLD = 4.0;

/** Cost multiplier applied when battery is below this level */
const BATTERY_LOW_THRESHOLD = 30;

/** Battery % at which drone is considered near-critical for RTB */
const BATTERY_CRITICAL_THRESHOLD = 15;

/** Weight for priority in cost function (higher priority = lower cost) */
const PRIORITY_BOOST_SCALE = 2.0;

/** Distance at which a task is considered close to "nearly complete" */
const NEAR_COMPLETE_DISTANCE = 0.8;

// ═══════════════════════════════════════════════════════════════════════════
// COST FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

function euclidean(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Compute bid cost for a drone-task pair.
 *
 *   cost = distanceToTask + batteryPenalty + workloadPenalty - priorityBoost
 *
 * Lower cost = better candidate.
 */
export function computeBidCost(
    drone: DroneStatus,
    task: Task,
    currentTaskId: string | null
): number {
    const dist = euclidean(drone.position.x, drone.position.y, task.position.x, task.position.y);

    // Battery penalty — increases sharply as battery drops
    let batteryPenalty = 0;
    if (drone.battery < BATTERY_LOW_THRESHOLD) {
        batteryPenalty = (BATTERY_LOW_THRESHOLD - drone.battery) * 0.5;
    }
    if (drone.battery < BATTERY_CRITICAL_THRESHOLD) {
        // Critical: effectively disqualify from new tasks
        batteryPenalty += 50;
    }

    // Workload penalty — small cost if drone is already on a different task
    const workloadPenalty = (currentTaskId !== null && currentTaskId !== task.id) ? 1.5 : 0;

    // Priority boost — higher priority reduces cost
    const priorityBoost = (task.priority / 10) * PRIORITY_BOOST_SCALE;

    return dist + batteryPenalty + workloadPenalty - priorityBoost;
}

// ═══════════════════════════════════════════════════════════════════════════
// DRONE AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class DroneAgent {
    readonly id: string;

    /** ID of the task this drone is currently assigned */
    currentTaskId: string | null = null;

    /** Cached cost of the current task (for hysteresis comparison) */
    currentTaskCost: number = Infinity;

    constructor(id: string) {
        this.id = id;
    }

    /**
     * Evaluate all available tasks and return the best bid, or null if none qualify.
     *
     * Only bids on:
     * - PENDING tasks
     * - OR the drone's own currently assigned task (to re-confirm)
     */
    evaluateTasks(drone: DroneStatus, tasks: Task[]): Bid | null {
        if (drone.battery < BATTERY_CRITICAL_THRESHOLD) {
            // Critical battery — refuse all tasks, head to base
            return null;
        }

        const biddableTasks = tasks.filter(t =>
            t.status === 'PENDING' || t.id === this.currentTaskId
        );

        if (biddableTasks.length === 0) return null;

        let bestBid: Bid | null = null;
        let bestCost = Infinity;

        for (const task of biddableTasks) {
            const cost = computeBidCost(drone, task, this.currentTaskId);
            if (cost < bestCost) {
                bestCost = cost;
                bestBid = { droneId: this.id, taskId: task.id, cost };
            }
        }

        return bestBid;
    }

    /**
     * Decide whether to switch from current task to a new one.
     * Implements hysteresis: only switch if improvement exceeds threshold.
     *
     * Higher threshold applies when:
     * - drone is in MICRO mode (mid-confirmation scan)
     * - drone is close to completing current task
     */
    shouldSwitchTask(
        drone: DroneStatus,
        newCost: number,
        currentTask: Task | undefined
    ): boolean {
        if (this.currentTaskId === null) return true;

        const threshold =
            drone.mode === 'Micro'
                ? MICRO_SWITCH_THRESHOLD
                : this.isNearTaskCompletion(drone, currentTask)
                    ? MICRO_SWITCH_THRESHOLD
                    : SWITCH_THRESHOLD;

        return newCost < this.currentTaskCost - threshold;
    }

    private isNearTaskCompletion(drone: DroneStatus, task: Task | undefined): boolean {
        if (!task) return false;
        const dist = euclidean(drone.position.x, drone.position.y, task.position.x, task.position.y);
        return dist < NEAR_COMPLETE_DISTANCE;
    }

    /**
     * Apply a task assignment to this agent.
     * Updates internal state to track the new task.
     */
    acceptAssignment(task: Task, drone: DroneStatus): void {
        const cost = computeBidCost(drone, task, this.currentTaskId);
        this.currentTaskId = task.id;
        this.currentTaskCost = cost;
    }

    /**
     * Clear current task (completed, expired, or cancelled).
     */
    clearTask(): void {
        this.currentTaskId = null;
        this.currentTaskCost = Infinity;
    }

    /**
     * Generate a short status message for the group chat.
     */
    generateChatMessage(drone: DroneStatus, task: Task | null): string {
        if (!task) {
            const dist = euclidean(drone.position.x, drone.position.y, BASE_X, BASE_Y);
            if (drone.battery < BATTERY_LOW_THRESHOLD) {
                return `⚡ Battery ${drone.battery.toFixed(0)}% — returning to base`;
            }
            return `🔍 Exploring — no active task (pos ${drone.position.x.toFixed(1)},${drone.position.y.toFixed(1)})`;
        }

        const dist = euclidean(drone.position.x, drone.position.y, task.position.x, task.position.y);
        const emoji = task.type === 'HOTSPOT' ? '🔥' : task.type === 'CONFIRM' ? '✅' : '📡';
        return `${emoji} ${task.type} @ (${task.position.x},${task.position.y}) — dist ${dist.toFixed(1)} | batt ${drone.battery.toFixed(0)}%`;
    }

    /**
     * Check if this drone should fall back to exploration mode.
     * Called when activeTasks.length === 0.
     */
    shouldFallbackExplore(): boolean {
        return this.currentTaskId === null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY — maps droneId → DroneAgent instance
// ═══════════════════════════════════════════════════════════════════════════

const agentRegistry = new Map<string, DroneAgent>();

export function getOrCreateAgent(droneId: string): DroneAgent {
    if (!agentRegistry.has(droneId)) {
        agentRegistry.set(droneId, new DroneAgent(droneId));
    }
    return agentRegistry.get(droneId)!;
}

export function clearAgentRegistry(): void {
    agentRegistry.clear();
}

export function getAllAgents(): DroneAgent[] {
    return Array.from(agentRegistry.values());
}
