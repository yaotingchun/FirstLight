import path from 'path';
import { fileURLToPath } from 'url';
import { VertexAI, type GenerativeModel, type Content } from '@google-cloud/vertexai';
import dotenv from 'dotenv';
import { droneStore, BASE_X, BASE_Y } from './droneStore.js';
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
    | { type: 'no_action'; reason: string }
    | { type: 'move_relay'; relayId: string; x: number; y: number; reason?: string }
    | { type: 'replace_relay'; relayId: string; reason?: string }
    | { type: 'broadcast_swarm'; command: 'RECRUIT' | 'MICRO_SCAN' | 'REDISTRIBUTE' | 'RTB_ALL'; targetArea?: { x: number; y: number; radius: number }; reason?: string };

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
        .map(c => {
            let label = 'unknown';
            if (c.disasterImage?.includes('survivor')) label = 'survivor_visually_confirmed';
            else if (c.disasterImage?.includes('thermal')) label = 'thermal_signature_confirmed';
            else if (c.disasterImage?.includes('empty')) label = 'nothing_found';
            return `${c.gridCell}(${c.x},${c.y}) finding=${label}`;
        })
        .join(', ');

    const droneSummary = drones
        .map(d => {
            const isReturning = d.position.x !== BASE_X && d.position.y !== BASE_Y && Math.round(d.target?.x ?? -1) === BASE_X && Math.round(d.target?.y ?? -1) === BASE_Y;
            return `${d.id}: pos=(${d.position.x},${d.position.y}) mode=${d.mode} battery=${d.battery.toFixed(1)}% active=${d.isActive}${isReturning ? ' <RETURNING>' : ''}`;
        })
        .join('\n');

    // Relay and network state
    const relayDrones = drones.filter(d => d.mode === 'Relay' && d.isActive);
    const disconnectedDrones = drones.filter(d => d.isActive && !d.isConnected && d.mode !== 'Relay');
    const networkTopology = droneStore.getNetworkTopology();
    const swarmKnowledge = droneStore.getSwarmKnowledge();

    const relaySummary = relayDrones.length > 0
        ? relayDrones.map(r => {
            const isReturning = r.position.x !== BASE_X && r.position.y !== BASE_Y && Math.round(r.target?.x ?? -1) === BASE_X && Math.round(r.target?.y ?? -1) === BASE_Y;
            return `${r.id}: pos=(${r.position.x.toFixed(1)},${r.position.y.toFixed(1)}) battery=${r.battery.toFixed(1)}%${isReturning ? ' <RETURNING>' : ''}`;
        }).join('\n')
        : '(no relay drones)';

    const networkHealth = networkTopology
        ? `chain=${networkTopology.relayChain.join('→')} connected=${networkTopology.connectedDrones.length} disconnected=${networkTopology.disconnectedDrones.length} buffered=${networkTopology.bufferedDataSize}B`
        : '(no topology data)';

    return [
        `tick=${stats.currentTick}`,
        `running=${stats.simulationRunning}`,
        `scanProgress=${stats.scanProgress.toFixed(1)}%`,
        `survivorsFound=${stats.survivorsFound}`,
        `highPriorityRemaining=${stats.highPriorityZonesRemaining}`,
        `avgBattery=${stats.averageBattery.toFixed(1)}%`,
        `meanProbabilityScanned=${stats.meanProbabilityScanned?.toFixed(3) || 0}`,
        `imageScannedCells=${grid.flat().filter(c => c.scanned && !!c.disasterImage).length}`,
        '',
        'DRONES:',
        droneSummary || '(none synced yet)',
        '',
        'RELAY NETWORK:',
        relaySummary,
        `Network: ${networkHealth}`,
        `Disconnected: ${disconnectedDrones.length > 0 ? disconnectedDrones.map(d => d.id).join(', ') : 'none'}`,
        '',
        `TOP HOTSPOTS: ${hotspots || '(none)'}`,
        `IMAGE SCAN CELLS: ${imageScanSummary || '(none)'}`,
        '',
        'SWARM KNOWLEDGE:',
        `exploredCells=${swarmKnowledge.exploredCells.length} hazards=${swarmKnowledge.detectedHazards.length} hotSignals=${swarmKnowledge.sensorDetections.filter(s => s.strength > 0.5).length}`,
    ].join('\n');
}

function parseDecision(raw: string): ParsedDecision | null {
    try {
        // Extract the <Thinking> block
        const thinkingMatch = raw.match(/<Thinking>\s*([\s\S]*?)\s*<\/Thinking>/i);
        const reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';

        // Extract the <Action> block
        const actionMatch = raw.match(/<Action>\s*([\s\S]*?)\s*<\/Action>/i);
        const actions: ChatAction[] = [];

        if (actionMatch && actionMatch[1]) {
            // Process each line in the action block
            const actionLines = actionMatch[1].split('\n').filter(line => line.trim().length > 0);

            for (const line of actionLines) {
                const text = line.trim();

                // Extremely simple "function call" parser for the action list
                // e.g., move_drone("DRN-Alpha", 5, 5) or set_drone_mode("DRN-Beta", "Wide")

                if (text.startsWith('move_drone')) {
                    const match = text.match(/move_drone\s*\(\s*(['"]?)([^'",]+)\1\s*,\s*(\d+)\s*,\s*(\d+)/i);
                    if (match) actions.push({ type: 'move_drone', droneId: match[2], x: parseInt(match[3], 10), y: parseInt(match[4], 10) });
                } else if (text.startsWith('set_drone_mode')) {
                    const match = text.match(/set_drone_mode\s*\(\s*(['"]?)([^'",]+)\1\s*,\s*(['"]?)([^'",]+)\3/i);
                    if (match) actions.push({ type: 'set_drone_mode', droneId: match[2], mode: match[4] as 'Wide' | 'Micro' | 'Relay' | 'Charging' });
                } else if (text.startsWith('recall_drone')) {
                    const match = text.match(/recall_drone\s*\(\s*(['"]?)([^'",()]+)\1/i);
                    if (match) actions.push({ type: 'recall_drone', droneId: match[2] });
                } else if (text.startsWith('deploy_team')) {
                    const match = text.match(/deploy_team\s*\(\s*(['"]?)([^'",]*)\1\s*,\s*(\d+)\s*,\s*(\d+)/i);
                    // Handle case where team string might be omitted
                    if (match) actions.push({ type: 'deploy_team', x: parseInt(match[3] || '0', 10), y: parseInt(match[4] || '0', 10) });
                    else {
                        const simpleMatch = text.match(/deploy_team\s*\(\s*(\d+)\s*,\s*(\d+)/i);
                        if (simpleMatch) actions.push({ type: 'deploy_team', x: parseInt(simpleMatch[1], 10), y: parseInt(simpleMatch[2], 10) });
                    }
                } else if (text.startsWith('set_simulation_state')) {
                    const match = text.match(/set_simulation_state\s*\(\s*(true|false)/i);
                    if (match) actions.push({ type: 'set_simulation_state', running: match[1].toLowerCase() === 'true' });
                } else if (text.startsWith('reset_simulation')) {
                    actions.push({ type: 'reset_simulation' });
                } else if (text.startsWith('no_action')) {
                    actions.push({ type: 'no_action', reason: 'No action needed' });
                }
            }
        }

        // We should always return a ParsedDecision so the frontend formats it properly.
        // Even if there are no actions, the reasoning is valuable.
        if (actions.length === 0 && !reasoning) return null;

        return {
            reasoning: reasoning || 'No explicit <Thinking> block found.',
            actions,
        };
    } catch (e) {
        console.error('Failed to parse AI action decision', e);
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
                case 'move_relay': {
                    const result = await executeTool('moveRelayDrone', {
                        relayId: action.relayId,
                        x: action.x,
                        y: action.y,
                    });
                    const res = result as { success: boolean };
                    logs.push(`[AI ORCHESTRATOR] moveRelayDrone({relayId:${action.relayId},x:${action.x},y:${action.y}}) → ${res.success ? 'Repositioned' : 'FAILED'}${action.reason ? ` | reason: ${action.reason}` : ''}`);
                    break;
                }
                case 'replace_relay': {
                    const result = await executeTool('replaceRelayDrone', {
                        relayId: action.relayId,
                    });
                    const res = result as { success: boolean; data?: { newRelayId: string } };
                    logs.push(`[AI ORCHESTRATOR] replaceRelayDrone({relayId:${action.relayId}}) → ${res.success ? `Replaced with ${res.data?.newRelayId}` : 'FAILED'}${action.reason ? ` | reason: ${action.reason}` : ''}`);
                    break;
                }
                case 'broadcast_swarm': {
                    const result = await executeTool('broadcastSwarmCommand', {
                        command: action.command,
                        targetArea: action.targetArea,
                    });
                    const res = result as { success: boolean; data?: { reachableDrones: string[] } };
                    logs.push(`[AI ORCHESTRATOR] broadcastSwarmCommand({command:${action.command}}) → ${res.success ? `Broadcast to ${res.data?.reachableDrones?.length ?? 0} drones` : 'FAILED'}${action.reason ? ` | reason: ${action.reason}` : ''}`);
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

        const systemPrompt = `You are FirstLight rescue orchestrator AI.

You MUST respond using the following strict format consisting of a <Thinking> block followed by an <Action> block.

<Thinking>
- Output your internal analysis here. Evaluate zones, coverage, drone states, and explicit visual analysis of captured images.
</Thinking>

<Action>
- List your chosen actions exactly using these function names, ONE PER LINE:
move_drone("DRN-ID", x, y)
set_drone_mode("DRN-ID", "Wide" | "Micro" | "Relay" | "Charging")
recall_drone("DRN-ID")
deploy_team("TeamName", x, y)
set_simulation_state(true|false)
reset_simulation()
no_action()
</Action>

Critical rules:
- Provide explicit percentages: When discussing scan progress, state the exact percentage (e.g., "Scan Progress: 9.5%") instead of using vague phrases like "very low" or "moderate".
- Natural phrasing for findings: Never literally mention "img=" or "finding=" or quote image paths. Use natural language: "A survivor has been confirmed at C13(2,12)" or "A thermal signature was detected at B4".
- Never invent drone IDs; use only synced drones from state.
- BATTERY CRITICAL (below 10% or negative): immediately emit recall_drone for that drone. This is the highest priority.
- BATTERY LOW (below 20%): emit recall_drone unless the drone is already heading to base.
- DISCONNECTED DRONES: if disconnected drones > 0, emit move_relay to bridge communication gap.
- RELAY BATTERY LOW (below 25%): emit replace_relay immediately, UNLESS it is <RETURNING>.
- MODE LOCK (Strict Role Separation): 
    1. NEVER use set_drone_mode on 'RLY-' drones to change them to 'Wide' or 'Micro'. Relay drones stay in Relay/Charging.
    2. NEVER use set_drone_mode on search drones ('D1'-'D8') to change them to 'Relay'. Search drones stay in Wide/Micro/Charging.
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
