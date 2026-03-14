import path from 'path';
import { fileURLToPath } from 'url';
import { VertexAI, type GenerativeModel, type Content } from '@google-cloud/vertexai';
import dotenv from 'dotenv';
import { droneStore } from './droneStore.js';
import { executeTool } from './tools/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Ensure relative credential paths are resolved from the root
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, '../../', process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

type ChatAction =
    | { type: 'move_drone'; droneId: string; x: number; y: number; reason?: string }
    | { type: 'set_drone_mode'; droneId: string; mode: 'Wide' | 'Micro' | 'Relay' | 'Charging'; reason?: string }
    | { type: 'recall_drone'; droneId: string; reason?: string }
    | { type: 'deploy_team'; x: number; y: number; droneId?: string; reason?: string }
    | { type: 'set_simulation_state'; running: boolean; reason?: string }
    | { type: 'reset_simulation'; reason?: string }
    | { type: 'no_action'; reason: string };

interface ParsedDecision {
    reasoning: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    actions: ChatAction[];
}

interface RegionPlan {
    droneId: string;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    targetX: number;
    targetY: number;
}

let model: GenerativeModel | null = null;
let regionBootstrapDone = false;

// Conversation history for stateful multi-turn chat (role: 'user' | 'model')
const MAX_HISTORY_TURNS = 20; // 10 user + 10 model messages
let chatHistory: Content[] = [];

function trimHistory(): void {
    if (chatHistory.length > MAX_HISTORY_TURNS) {
        chatHistory = chatHistory.slice(chatHistory.length - MAX_HISTORY_TURNS);
    }
}

function clearChatHistory(): void {
    chatHistory = [];
}

function getModel(): GenerativeModel {
    if (model) return model;

    const project = process.env.GOOGLE_VERTEX_PROJECT;
    const location = process.env.GOOGLE_VERTEX_LOCATION;

    if (!project || !location) {
        throw new Error('Missing GOOGLE_VERTEX_PROJECT or GOOGLE_VERTEX_LOCATION in environment');
    }

    const vertexAI = new VertexAI({ project, location });
    model = vertexAI.getGenerativeModel({
        model: process.env.ORCHESTRATOR_MODEL ?? 'gemini-2.5-flash',
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
        },
    });

    return model;
}

function buildStateSummary(): string {
    const stats = droneStore.getMissionStats();
    const drones = droneStore.getAllDrones();
    const grid = droneStore.getGrid();
    const hotspots = droneStore.getGrid()
        .flat()
        .filter(c => !c.scanned)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 8)
        .map(c => `${c.gridCell}(${c.x},${c.y}) p=${c.probability.toFixed(2)}`)
        .join(', ');

    const imageScans = grid
        .flat()
        .filter(c => c.scanned && !!c.disasterImage)
        .sort((a, b) => b.lastScannedTick - a.lastScannedTick)
        .slice(0, 8);

    const imageScanSummary = imageScans
        .map(c => `${c.gridCell}(${c.x},${c.y}) img=${c.disasterImage}`)
        .join(', ');

    const droneSummary = drones
        .map(d => `${d.id}: pos=(${d.position.x},${d.position.y}) mode=${d.mode} battery=${d.battery.toFixed(1)}% active=${d.isActive}`)
        .join('\n');

    return [
        `tick=${stats.currentTick}`,
        `running=${stats.simulationRunning}`,
        `scanProgress=${stats.scanProgress.toFixed(1)}%`,
        `survivorsFound=${stats.survivorsFound}`,
        `highPriorityRemaining=${stats.highPriorityZonesRemaining}`,
        `avgBattery=${stats.averageBattery.toFixed(1)}%`,
        `imageScannedCells=${grid.flat().filter(c => c.scanned && !!c.disasterImage).length}`,
        '',
        'DRONES:',
        droneSummary || '(none synced yet)',
        '',
        `TOP HOTSPOTS: ${hotspots || '(none)'}`,
        `IMAGE SCAN CELLS: ${imageScanSummary || '(none)'}`,
    ].join('\n');
}

function parseDecision(raw: string): ParsedDecision | null {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned) as ParsedDecision;
        if (!Array.isArray(parsed.actions)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function shouldBootstrapRegions(message: string): boolean {
    const text = message.toLowerCase();
    return (
        text.includes('start mission') ||
        text.includes('start scan') ||
        text.includes('distribute region') ||
        text.includes('assign region') ||
        text.includes('analyze the latest swarm state')
    );
}

function buildRegionPlans(): RegionPlan[] {
    const drones = droneStore
        .getAllDrones()
        .filter(d => d.isActive && d.mode !== 'Relay' && d.mode !== 'Charging')
        .sort((a, b) => a.id.localeCompare(b.id));

    if (drones.length === 0) return [];

    const totalWidth = 20;
    const yMin = 0;
    const yMax = 19;

    return drones.map((d, i) => {
        const xMin = Math.floor((i * totalWidth) / drones.length);
        const xMax = Math.floor(((i + 1) * totalWidth) / drones.length) - 1;
        const targetX = Math.round((xMin + xMax) / 2);
        const targetY = Math.round((yMin + yMax) / 2);
        return {
            droneId: d.id,
            xMin,
            xMax,
            yMin,
            yMax,
            targetX,
            targetY,
        };
    });
}

async function executeRegionBootstrap(): Promise<{ decision: ParsedDecision; executionLog: string[] }> {
    const plans = buildRegionPlans();
    const executionLog: string[] = [];
    const actions: ChatAction[] = [];

    // Ensure simulation is running so assigned drones actually move.
    await executeTool('setSimulationRunning', { running: true });
    executionLog.push('setSimulationRunning(true)');

    for (const plan of plans) {
        await executeTool('setDroneMode', { droneId: plan.droneId, mode: 'Wide' });
        await executeTool('setDroneTarget', {
            droneId: plan.droneId,
            targetX: plan.targetX,
            targetY: plan.targetY,
        });

        executionLog.push(
            `region_assign(${plan.droneId}: x[${plan.xMin}-${plan.xMax}] y[${plan.yMin}-${plan.yMax}] -> target ${plan.targetX},${plan.targetY})`
        );

        actions.push({
            type: 'set_drone_mode',
            droneId: plan.droneId,
            mode: 'Wide',
            reason: `Assigned region x[${plan.xMin}-${plan.xMax}] y[${plan.yMin}-${plan.yMax}]`,
        });
        actions.push({
            type: 'move_drone',
            droneId: plan.droneId,
            x: plan.targetX,
            y: plan.targetY,
            reason: `Move to center of assigned region x[${plan.xMin}-${plan.xMax}] y[${plan.yMin}-${plan.yMax}]`,
        });
    }

    regionBootstrapDone = true;

    return {
        decision: {
            reasoning:
                'Phase 1 complete: grid divided into vertical regions, each active search drone assigned one region, then dispatched to the center for initial scan entry.',
            priority: 'high',
            actions,
        },
        executionLog,
    };
}

async function executeActions(actions: ChatAction[]): Promise<string[]> {
    const logs: string[] = [];

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'move_drone': {
                    await executeTool('setDroneTarget', {
                        droneId: action.droneId,
                        targetX: action.x,
                        targetY: action.y,
                    });
                    logs.push(`setDroneTarget(${action.droneId} -> ${action.x},${action.y})`);
                    break;
                }
                case 'set_drone_mode': {
                    await executeTool('setDroneMode', {
                        droneId: action.droneId,
                        mode: action.mode,
                    });
                    logs.push(`setDroneMode(${action.droneId} -> ${action.mode})`);
                    break;
                }
                case 'recall_drone': {
                    await executeTool('recallDroneToBase', { droneId: action.droneId });
                    logs.push(`recallDroneToBase(${action.droneId})`);
                    break;
                }
                case 'deploy_team': {
                    await executeTool('setSurvivorPin', {
                        x: action.x,
                        y: action.y,
                        droneId: action.droneId ?? 'AI_AGENT',
                        message: action.reason ?? 'Potential survivor confirmation',
                    });
                    logs.push(`setSurvivorPin(${action.x},${action.y})`);
                    break;
                }
                case 'set_simulation_state': {
                    await executeTool('setSimulationRunning', { running: action.running });
                    logs.push(`setSimulationRunning(${action.running})`);
                    break;
                }
                case 'reset_simulation': {
                    await executeTool('resetMission', {});
                    logs.push('resetMission()');
                    break;
                }
                case 'no_action': {
                    logs.push(`no_action: ${action.reason}`);
                    break;
                }
                default:
                    logs.push(`unsupported action: ${(action as { type: string }).type}`);
            }
        } catch (error) {
            logs.push(`error on ${action.type}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return logs;
}

export async function processOrchestratorChat(message: string): Promise<{
    success: boolean;
    reply?: string;
    decision?: ParsedDecision;
    executionLog?: string[];
    error?: string;
    timestamp: number;
}> {
    try {
        const missionStats = droneStore.getMissionStats();
        if (missionStats.currentTick === 0 && missionStats.scanProgress < 1) {
            regionBootstrapDone = false;
            clearChatHistory();
        }

        if (!regionBootstrapDone && shouldBootstrapRegions(message)) {
            const { decision, executionLog } = await executeRegionBootstrap();
            return {
                success: true,
                reply: JSON.stringify(decision),
                decision,
                executionLog,
                timestamp: Date.now(),
            };
        }

        const m = getModel();
        const stateSummary = buildStateSummary();

        const systemPrompt = `You are FirstLight rescue orchestrator AI. You ALWAYS respond with ONLY a JSON object matching the schema below — never plain text.

JSON schema (output this and nothing else):
{
  "reasoning": string,
  "priority": "low"|"medium"|"high"|"critical",
  "actions": [
    {"type":"move_drone","droneId":string,"x":number,"y":number,"reason":string?},
    {"type":"set_drone_mode","droneId":string,"mode":"Wide"|"Micro"|"Relay"|"Charging","reason":string?},
    {"type":"recall_drone","droneId":string,"reason":string?},
    {"type":"deploy_team","x":number,"y":number,"droneId":string?,"reason":string?},
    {"type":"set_simulation_state","running":boolean,"reason":string?},
    {"type":"reset_simulation","reason":string?},
    {"type":"no_action","reason":string}
  ]
}

Critical rules:
- ALWAYS output valid JSON only. Never output plain text.
- Never invent drone IDs; use only synced drones from state.
- Keep reasoning concise (2-3 sentences max) to leave room for actions.
- BATTERY CRITICAL (below 10% or negative): immediately emit recall_drone for that drone. This is the highest priority.
- BATTERY LOW (below 20%): emit recall_drone unless the drone is already heading to base.
- Use no_action only when the simulation is paused or all drones are already optimally placed.`;

        const userPrompt = `STATE:\n${stateSummary}\n\nUSER:\n${message}`;

        const chat = m.startChat({
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            history: chatHistory,
        });

        const result = await chat.sendMessage(userPrompt);
        const reply = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '(no response)';

        // Persist this turn into history
        chatHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
        chatHistory.push({ role: 'model', parts: [{ text: reply }] });
        trimHistory();
        const decision = parseDecision(reply);

        if (!decision) {
            return {
                success: true,
                reply,
                timestamp: Date.now(),
            };
        }

        const executionLog = await executeActions(decision.actions);

        if (decision.actions.some(a => a.type === 'reset_simulation')) {
            regionBootstrapDone = false;
            clearChatHistory();
        }

        return {
            success: true,
            reply,
            decision,
            executionLog,
            timestamp: Date.now(),
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
        };
    }
}
