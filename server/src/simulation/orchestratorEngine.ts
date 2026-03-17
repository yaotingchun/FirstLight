/**
 * OrchestratorEngine
 *
 * Deterministic execution engine for the multi-agent system.
 *
 * Responsibilities:
 *  - Store tasks (created by LLM via MCP)
 *  - Deduplicate tasks by proximity
 *  - Run bidding rounds
 *  - Manage assignments
 *  - Handle task expiry
 *  - System freeze during relay swap
 *
 * What this does NOT do:
 *  - Generate tasks (that's the LLM's job)
 *  - Move drones directly (that's the simulation engine)
 *  - Make strategic decisions (that's the LLM's job)
 */

import type {
    Task, TaskStatus, TaskType, Bid, Assignment, AgentChatMessage,
    DroneStatus, OrchestratorState,
} from '../types.js';
import { getOrCreateAgent } from './droneAgent.js';
import { pushOrchestratorRecord } from '../orchestratorChat.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimum grid distance between tasks of the same type (dedup radius) */
const DEDUP_RADIUS = 2;

/** Time-triggered bidding interval (ticks) */
const BIDDING_INTERVAL_TICKS = 8;

/** Default task TTL in ticks if expiresInTicks not specified */
const DEFAULT_TASK_TTL = 200;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function euclidean(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function makeMsgId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class OrchestratorEngine {
    private activeTasks: Task[] = [];
    private assignments: Assignment[] = [];
    private chatLog: AgentChatMessage[] = [];

    private taskCounter = 1;

    private generateTaskId(type: string): string {
        return `TSK-${String(this.taskCounter++).padStart(3, '0')}-${type}`;
    }

    private lastBiddingTick = -1;
    private isBiddingInProgress = false;
    private isSystemFrozen = false;

    // Track events for event-triggered bidding
    private pendingEvents: string[] = [];

    // ─── Task Management (called by LLM via MCP tools) ───────────────────────

    /**
     * Add a new task (from LLM). Rejects duplicates within DEDUP_RADIUS of same type.
     * Returns { task, deduplicated }.
     */
    addTask(
        type: TaskType,
        x: number,
        y: number,
        priority: number,
        createdAtTick: number,
        expiresInTicks: number = DEFAULT_TASK_TTL
    ): { task?: Task; deduplicated: boolean; reason?: string } {
        // Deduplication check
        const duplicate = this.activeTasks.find(t =>
            t.type === type &&
            t.status !== 'COMPLETED' &&
            t.status !== 'EXPIRED' &&
            euclidean(t.position.x, t.position.y, x, y) < DEDUP_RADIUS
        );

        if (duplicate) {
            return {
                deduplicated: true,
                reason: `Task ${duplicate.id} (${type}) already exists within ${DEDUP_RADIUS} cells`,
            };
        }

        const task: Task = {
            id: this.generateTaskId(type),
            type,
            position: { x, y },
            priority: Math.max(1, Math.min(10, priority)),
            createdAt: createdAtTick,
            expiresAt: expiresInTicks === -1 ? -1 : createdAtTick + expiresInTicks,
            status: 'PENDING',
        };

        this.activeTasks.push(task);
        this.emitEngineMessage(`📋 Task created: [${type}] @ (${x},${y}) priority=${task.priority} id=${task.id}`);
        this.triggerEvent('newTask');

        return { task, deduplicated: false };
    }

    /** Cancel/expire a task by ID (from LLM) */
    cancelTask(taskId: string): boolean {
        const task = this.activeTasks.find(t => t.id === taskId);
        if (!task) return false;

        task.status = 'EXPIRED';
        // Free any assigned drone
        this.assignments = this.assignments.filter(a => a.taskId !== taskId);
        const agent = task.assignedDroneId ? getOrCreateAgent(task.assignedDroneId) : null;
        if (agent) agent.clearTask();

        this.emitEngineMessage(`❌ Task cancelled: ${taskId}`);
        return true;
    }

    // ─── Bidding Round ────────────────────────────────────────────────────────

    /**
     * Full bidding round:
     * 1. Broadcast PENDING tasks to all drones
     * 2. Each drone bids (or not)
     * 3. Group by task, lowest cost wins
     * 4. Resolve conflicts (drone wins only one task)
     * 5. Apply assignments
     */
    runBiddingRound(drones: DroneStatus[]): Assignment[] {
        if (this.isSystemFrozen || this.isBiddingInProgress) return [];

        const pendingTasks = this.activeTasks.filter(t => t.status === 'PENDING');
        if (pendingTasks.length === 0 && this.activeTasks.filter(t => t.status === 'ASSIGNED').length === 0) {
            // All drones fall back to exploration
            return [];
        }

        this.isBiddingInProgress = true;
        const searchDrones = drones.filter(d =>
            d.isActive && !d.id.startsWith('RLY-') && d.mode !== 'Charging'
        );

        // Collect bids from all search drones
        const allBids: Bid[] = [];
        for (const droneStatus of searchDrones) {
            const agent = getOrCreateAgent(droneStatus.id);
            const bid = agent.evaluateTasks(droneStatus, this.activeTasks);
            if (bid) allBids.push(bid);
        }

        // Group bids by taskId — pick the lowest cost for each task
        const taskWinners = new Map<string, Bid>();
        for (const bid of allBids) {
            const existing = taskWinners.get(bid.taskId);
            if (!existing || bid.cost < existing.cost) {
                taskWinners.set(bid.taskId, bid);
            }
        }

        // Conflict resolution — each drone can only hold ONE task
        // If a drone wins multiple tasks, assign it only its best (lowest cost) one
        const droneAssignedTask = new Map<string, { taskId: string; cost: number }>();
        for (const [taskId, bid] of taskWinners) {
            const existing = droneAssignedTask.get(bid.droneId);
            if (!existing || bid.cost < existing.cost) {
                droneAssignedTask.set(bid.droneId, { taskId, cost: bid.cost });
            }
        }

        // Rebuild: only the winner-drone's chosen task survives per drone
        const finalWinners = new Map<string, Bid>();
        for (const [droneId, { taskId }] of droneAssignedTask) {
            const bid = taskWinners.get(taskId);
            if (bid && bid.droneId === droneId) {
                finalWinners.set(taskId, bid);
            }
        }

        // Apply assignments
        const newAssignments: Assignment[] = [];
        const currentTick = Date.now(); // used as tick proxy here; real tick passed in tick()

        for (const [taskId, bid] of finalWinners) {
            const task = this.activeTasks.find(t => t.id === taskId);
            if (!task) continue;

            const droneStatus = searchDrones.find(d => d.id === bid.droneId);
            if (!droneStatus) continue;

            const agent = getOrCreateAgent(bid.droneId);

            // Hysteresis check — only switch if improvement meets threshold
            const currentTask = this.activeTasks.find(t => t.id === agent.currentTaskId);
            if (agent.currentTaskId && agent.currentTaskId !== taskId) {
                if (!agent.shouldSwitchTask(droneStatus, bid.cost, currentTask)) {
                    continue; // keep current assignment
                }
                // Free old task back to PENDING if it exists
                const oldTask = this.activeTasks.find(t => t.id === agent.currentTaskId);
                if (oldTask && oldTask.status === 'ASSIGNED') {
                    oldTask.status = 'PENDING';
                    oldTask.assignedDroneId = undefined;
                }
            }

            // Assign
            task.status = 'ASSIGNED';
            task.assignedDroneId = bid.droneId;
            agent.acceptAssignment(task, droneStatus);
            this.appendDroneMessage(bid.droneId, `Assigned to ${task.type} task ${task.id} at (${task.position.x},${task.position.y}). Commencing travel.`);

            // Update assignments list
            this.assignments = this.assignments.filter(a => a.droneId !== bid.droneId);
            const assignment: Assignment = { droneId: bid.droneId, taskId, assignedAt: currentTick };
            this.assignments.push(assignment);
            newAssignments.push(assignment);
        }

        if (newAssignments.length > 0) {
            this.emitEngineMessage(
                `🎯 Bidding complete: ${newAssignments.length} assignment(s) — ` +
                newAssignments.map(a => `${a.droneId}→${a.taskId}`).join(', ')
            );
        }

        this.isBiddingInProgress = false;
        return newAssignments;
    }

    // ─── Task Lifecycle ───────────────────────────────────────────────────────

    /** Mark a task as IN_PROGRESS (called when drone starts moving toward it) */
    markTaskInProgress(taskId: string): void {
        const task = this.activeTasks.find(t => t.id === taskId);
        if (task && task.status === 'ASSIGNED') {
            task.status = 'IN_PROGRESS';
            if (task.assignedDroneId) {
                this.appendDroneMessage(task.assignedDroneId, `Arrived at ${task.type} task location ${task.id}. Activity initiated.`);
            }
        }
    }

    /** Mark a task as COMPLETED and free the drone */
    markTaskCompleted(taskId: string, currentTick: number): void {
        const task = this.activeTasks.find(t => t.id === taskId);
        if (!task) return;

        task.status = 'COMPLETED';
        task.completedAt = currentTick;
        if (task.assignedDroneId) {
            getOrCreateAgent(task.assignedDroneId).clearTask();
            this.appendDroneMessage(task.assignedDroneId, `Completed ${task.type} task ${task.id}.`);
        }
        this.assignments = this.assignments.filter(a => a.taskId !== taskId);
        this.emitEngineMessage(`✅ Task completed: [${task.type}] @ (${task.position.x},${task.position.y}) by ${task.assignedDroneId}`);
        this.triggerEvent('taskCompleted');
    }

    /**
     * Expire tasks whose expiresAt < currentTick.
     * Also clears drone assignments for expired tasks.
     */
    expireTasks(currentTick: number): void {
        for (const task of this.activeTasks) {
            if (
                task.expiresAt !== -1 &&
                task.expiresAt < currentTick &&
                task.status !== 'COMPLETED' &&
                task.status !== 'EXPIRED'
            ) {
                task.status = 'EXPIRED';
                if (task.assignedDroneId) {
                    const agent = getOrCreateAgent(task.assignedDroneId);
                    agent.clearTask();
                    this.appendDroneMessage(task.assignedDroneId, `Task ${task.id} expired. Standing by for new assignment.`);
                }
                this.assignments = this.assignments.filter(a => a.taskId !== task.id);
            }
        }
    }

    // ─── Trigger Logic ────────────────────────────────────────────────────────

    /** Signal an event that may trigger a bidding round */
    triggerEvent(type: string): void {
        this.pendingEvents.push(type);
    }

    private shouldTriggerRound(currentTick: number): boolean {
        if (this.isSystemFrozen || this.isBiddingInProgress) return false;

        // Event trigger
        if (this.pendingEvents.length > 0) {
            this.pendingEvents = [];
            return true;
        }

        // Time trigger
        if (currentTick - this.lastBiddingTick >= BIDDING_INTERVAL_TICKS) {
            return true;
        }

        return false;
    }

    // ─── Main Tick ────────────────────────────────────────────────────────────

    /**
     * Called every simulation tick.
     * 1. Expire stale tasks
     * 2. Check trigger → run bidding if needed
     * 3. Return new assignments (if any)
     */
    tick(currentTick: number, drones: DroneStatus[]): Assignment[] {
        this.expireTasks(currentTick);

        if (!this.shouldTriggerRound(currentTick)) return [];

        this.lastBiddingTick = currentTick;
        return this.runBiddingRound(drones);
    }

    // ─── Relay Swap Freeze ────────────────────────────────────────────────────

    /** Freeze the system during relay swap — prevents race conditions */
    freezeSystem(): void {
        this.isSystemFrozen = true;
        this.emitEngineMessage('⏸ System frozen for relay swap');
    }

    /** Unfreeze after relay swap completes */
    unfreezeSystem(): void {
        this.isSystemFrozen = false;
        this.emitEngineMessage('▶ System resumed after relay swap');
    }

    // ─── State Snapshot ───────────────────────────────────────────────────────

    getActiveTasks(): Task[] {
        return this.activeTasks.filter(
            t => t.status !== 'COMPLETED' && t.status !== 'EXPIRED'
        );
    }

    getAllTasks(): Task[] {
        return [...this.activeTasks];
    }

    getAssignments(): Assignment[] {
        return [...this.assignments];
    }

    getChatLog(limit?: number): AgentChatMessage[] {
        if (limit) return this.chatLog.slice(-limit);
        return [...this.chatLog];
    }

    getIsSystemFrozen(): boolean {
        return this.isSystemFrozen;
    }

    getIsBiddingPaused(): boolean {
        return this.isBiddingInProgress || this.isSystemFrozen;
    }

    /** Export full state (for relay transfer) */
    exportState(): OrchestratorState {
        return {
            activeTasks: [...this.activeTasks],
            assignments: [...this.assignments],
            lastBiddingTick: this.lastBiddingTick,
            chatLog: [...this.chatLog],
        };
    }

    /** Import state (relay takeover) */
    importState(state: OrchestratorState): void {
        this.activeTasks = state.activeTasks;
        this.assignments = state.assignments;
        this.lastBiddingTick = state.lastBiddingTick;
        this.chatLog = state.chatLog;
        this.emitEngineMessage('🔄 Orchestrator state imported (relay handoff)');
    }

    /** Reset all state (on mission reset) */
    reset(): void {
        this.activeTasks = [];
        this.assignments = [];
        this.chatLog = [];
        this.lastBiddingTick = -1;
        this.isBiddingInProgress = false;
        this.isSystemFrozen = false;
        this.pendingEvents = [];
    }

    // ─── Chat Log ─────────────────────────────────────────────────────────────

    appendDroneMessage(droneId: string, text: string): void {
        this.chatLog.push({
            id: makeMsgId(),
            role: droneId,
            text,
            timestamp: Date.now(),
            source: 'drone',
        });
        if (this.chatLog.length > 200) this.chatLog.shift();
        
        pushOrchestratorRecord({
            timestamp: Date.now(),
            source: 'action',
            message: `[${droneId}] ${text}`
        });
    }

    appendUserMessage(text: string): void {
        this.chatLog.push({
            id: makeMsgId(),
            role: 'USER',
            text,
            timestamp: Date.now(),
            source: 'user',
        });
        if (this.chatLog.length > 200) this.chatLog.shift();
        
        pushOrchestratorRecord({
            timestamp: Date.now(),
            source: 'action',
            message: `[USER] ${text}`
        });
    }

    appendLLMMessage(text: string): void {
        this.chatLog.push({
            id: makeMsgId(),
            role: 'ORCHESTRATOR',
            text,
            timestamp: Date.now(),
            source: 'llm',
        });
        if (this.chatLog.length > 200) this.chatLog.shift();
    }

    private emitEngineMessage(text: string): void {
        this.chatLog.push({
            id: makeMsgId(),
            role: 'ORCHESTRATOR',
            text,
            timestamp: Date.now(),
            source: 'engine',
        });
        if (this.chatLog.length > 200) this.chatLog.shift();
        
        pushOrchestratorRecord({
            timestamp: Date.now(),
            source: 'system',
            message: text
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const orchestratorEngine = new OrchestratorEngine();
