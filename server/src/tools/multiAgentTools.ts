/**
 * Multi-Agent MCP Tools
 *
 * Tools that the LLM orchestrator calls to interact with the multi-agent system.
 * These are the ONLY ways the LLM may create/cancel tasks.
 *
 * LLM does NOT call setDroneTarget or setDroneMode directly.
 */

import { droneStore } from '../droneStore.js';
import { orchestratorEngine } from '../simulation/orchestratorEngine.js';
import type {
    CreateTaskParams, CreateTaskResult, CancelTaskParams,
    GetActiveTasksResult, Task, MCPToolResult,
} from '../types.js';

// ─── createTask ─────────────────────────────────────────────────────────────

export async function createTask(
    params: CreateTaskParams
): Promise<MCPToolResult<CreateTaskResult>> {
    const { type, x, y, priority, expiresInTicks } = params;

    // Validate position
    const { GRID_W, GRID_H } = await import('../droneStore.js');
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) {
        return {
            success: false,
            error: `Position (${x},${y}) is outside the grid (${GRID_W}x${GRID_H})`,
            timestamp: Date.now(),
        };
    }

    if (!['HOTSPOT', 'SCAN', 'CONFIRM'].includes(type)) {
        return {
            success: false,
            error: `Invalid task type: ${type}. Must be HOTSPOT, SCAN, or CONFIRM`,
            timestamp: Date.now(),
        };
    }

    const currentTick = droneStore.getCurrentTick();
    const result = orchestratorEngine.addTask(type, x, y, priority, currentTick, expiresInTicks);

    return {
        success: true,
        data: {
            task: result.task,
            deduplicated: result.deduplicated,
            reason: result.reason,
        },
        timestamp: Date.now(),
    };
}

// ─── cancelTask ─────────────────────────────────────────────────────────────

export async function cancelTask(
    params: CancelTaskParams
): Promise<MCPToolResult<{ cancelled: boolean }>> {
    const { taskId } = params;
    const cancelled = orchestratorEngine.cancelTask(taskId);

    return {
        success: true,
        data: { cancelled },
        timestamp: Date.now(),
    };
}

// ─── getActiveTasks ─────────────────────────────────────────────────────────

export async function getActiveTasks(): Promise<MCPToolResult<GetActiveTasksResult>> {
    const tasks = orchestratorEngine.getActiveTasks();

    return {
        success: true,
        data: {
            tasks,
            totalActive: tasks.length,
            pending: tasks.filter(t => t.status === 'PENDING').length,
            assigned: tasks.filter(t => t.status === 'ASSIGNED').length,
            inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
        },
        timestamp: Date.now(),
    };
}

// ─── getTaskAssignments ──────────────────────────────────────────────────────

export async function getTaskAssignments(): Promise<MCPToolResult<{
    assignments: Array<{ droneId: string; taskId: string; taskType: string; position: { x: number; y: number } }>;
    totalAssignments: number;
}>> {
    const assignments = orchestratorEngine.getAssignments();
    const tasks = orchestratorEngine.getAllTasks();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const enriched = assignments.map(a => {
        const task = taskMap.get(a.taskId);
        return {
            droneId: a.droneId,
            taskId: a.taskId,
            taskType: task?.type ?? 'UNKNOWN',
            position: task?.position ?? { x: 0, y: 0 },
        };
    });

    return {
        success: true,
        data: {
            assignments: enriched,
            totalAssignments: enriched.length,
        },
        timestamp: Date.now(),
    };
}

// ─── getMultiAgentState ──────────────────────────────────────────────────────

export async function getMultiAgentState(): Promise<MCPToolResult<{
    tasks: Task[];
    assignments: Array<{ droneId: string; taskId: string }>;
    orchestratorDroneId: string | null;
    isBiddingPaused: boolean;
    isSystemFrozen: boolean;
    chatLogPreview: string[];
}>> {
    const state = droneStore.getMultiAgentState();

    return {
        success: true,
        data: {
            tasks: state.activeTasks,
            assignments: state.assignments,
            orchestratorDroneId: state.orchestratorDroneId,
            isBiddingPaused: state.isBiddingPaused,
            isSystemFrozen: state.isSystemFrozen,
            chatLogPreview: state.chatLog.slice(-10).map(m => `[${m.role}] ${m.text}`),
        },
        timestamp: Date.now(),
    };
}
