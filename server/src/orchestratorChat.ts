import path from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { VertexAI, type GenerativeModel, type Content } from '@google-cloud/vertexai';
import dotenv from 'dotenv';
import axios from 'axios';
import { droneStore, BASE_X, BASE_Y } from './droneStore.js';
import { executeTool } from './tools/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_RECORDS_PATH = path.resolve(__dirname, '../../.local/orchestrator/orchestrator-records.json');

dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Reloaded to pick up OLLAMA_MODEL change

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

let regionBootstrapDone = false;

export interface OrchestratorRecord {
    timestamp: number;
    source: 'system' | 'ai' | 'action' | 'error';
    message: string;
    droneId?: string;
}

interface LLMProvider {
    sendMessage(message: string, history: any[], systemInstruction: string): Promise<string>;
}

class GeminiProvider implements LLMProvider {
    private model: GenerativeModel | null = null;

    private getModel(): GenerativeModel {
        if (this.model) return this.model;
        const project = process.env.GOOGLE_VERTEX_PROJECT;
        const location = process.env.GOOGLE_VERTEX_LOCATION;
        if (!project || !location) {
            throw new Error('Missing GOOGLE_VERTEX_PROJECT or GOOGLE_VERTEX_LOCATION in environment');
        }
        const vertexAI = new VertexAI({ project, location });
        this.model = vertexAI.getGenerativeModel({
            model: process.env.ORCHESTRATOR_MODEL ?? 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 4096,
            },
        });
        return this.model;
    }

    async sendMessage(message: string, history: Content[], systemInstruction: string): Promise<string> {
        const m = this.getModel();
        const chat = m.startChat({
            systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
            history: history,
        });
        const result = await chat.sendMessage(message);
        return result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '(no response)';
    }
}

class OllamaProvider implements LLMProvider {
    async sendMessage(message: string, history: Content[], systemInstruction: string): Promise<string> {
        let baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        
        const model = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';

        // Convert Gemini-style history to OpenAI/Ollama-style messages
        const ollamaHistory = [
            { role: 'system', content: systemInstruction },
            ...history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: h.parts[0].text
            })),
            { role: 'user', content: message }
        ];

        try {
            const response = await axios.post(`${baseUrl}/api/chat`, {
                model: model,
                messages: ollamaHistory,
                stream: false,
                options: {
                    temperature: 0.3,
                }
            });
            return response.data.message.content;
        } catch (error: any) {
            // Fallback for older Ollama versions that don't support /api/chat
            if (error.response?.status === 404) {
                console.log(`[Ollama] /api/chat not found, falling back to legacy /api/generate for model ${model}`);
                const legacyPrompt = `System: ${systemInstruction}\n\n` + 
                    history.map(h => `${h.role === 'model' ? 'Assistant' : 'User'}: ${h.parts[0].text}`).join('\n') + 
                    `\nUser: ${message}`;
                
                const response = await axios.post(`${baseUrl}/api/generate`, {
                    model: model,
                    prompt: legacyPrompt,
                    stream: false,
                    options: { temperature: 0.3 }
                });
                return response.data.response;
            }

            console.error('Ollama request failed:', error);
            throw new Error(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export const ConnectivityChecker = {
    async checkGemini(): Promise<boolean> {
        // Fast credential check
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.GOOGLE_VERTEX_PROJECT) {
            console.log('[Connectivity] Gemini: Offline (Missing credentials)');
            return false;
        }
        
        try {
            // Active probe: Verify we can actually reach Google services
            await axios.get('https://www.googleapis.com/generate_204', { timeout: 2000 });
            return true; 
        } catch (error) {
            console.log(`[Connectivity] Gemini: Offline (Network probe failed: ${error instanceof Error ? error.message : 'timeout'})`);
            return false;
        }
    },
    async checkOllama(): Promise<boolean> {
        const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
        try {
            await axios.get(`${baseUrl}/api/tags`, { timeout: 1500 });
            return true;
        } catch {
            return false;
        }
    }
};

const geminiProvider = new GeminiProvider();
const ollamaProvider = new OllamaProvider();

async function getProvider(mode: 'online' | 'offline' | 'auto'): Promise<{ provider: LLMProvider, activeMode: 'online' | 'offline' }> {
    // Mode preference check
    const modePref = mode ?? process.env.DEFAULT_ORCHESTRATOR_MODE ?? 'auto';

    // Online mode: Skip Ollama entirely
    if (modePref === 'online') {
        const isOnline = await ConnectivityChecker.checkGemini();
        if (!isOnline) throw new Error('Gemini credentials missing or invalid. Check GOOGLE_APPLICATION_CREDENTIALS.');
        return { provider: geminiProvider, activeMode: 'online' };
    }

    // Offline mode: Skip Gemini entirely
    if (modePref === 'offline') {
        const isOllamaAvailable = await ConnectivityChecker.checkOllama();
        if (!isOllamaAvailable) throw new Error('Ollama service unreachable at ' + (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'));
        return { provider: ollamaProvider, activeMode: 'offline' };
    }

    // Auto mode: Detect and prioritize Gemini
    const isOnline = await ConnectivityChecker.checkGemini();
    if (isOnline) {
        return { provider: geminiProvider, activeMode: 'online' };
    }
    
    const isOllamaAvailable = await ConnectivityChecker.checkOllama();
    if (isOllamaAvailable) {
        return { provider: ollamaProvider, activeMode: 'offline' };
    }

    throw new Error('No LLM provider available (Gemini offline and Ollama unreachable)');
}

const stateProxy = {
    get orchestratorRecords(): OrchestratorRecord[] { return droneStore.chatState.records; },
    set orchestratorRecords(v: OrchestratorRecord[]) { droneStore.chatState.records = v; },
    get chatHistory(): Content[] { return droneStore.chatState.history; },
    set chatHistory(v: Content[]) { droneStore.chatState.history = v; }
};

let persistRecordsPromise: Promise<void> = Promise.resolve();

function loadPersistedOrchestratorRecords(): OrchestratorRecord[] {
    try {
        if (!existsSync(ORCHESTRATOR_RECORDS_PATH)) {
            return [];
        }

        const raw = readFileSync(ORCHESTRATOR_RECORDS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((item): item is OrchestratorRecord => {
            return (
                !!item &&
                typeof item === 'object' &&
                typeof item.timestamp === 'number' &&
                typeof item.message === 'string' &&
                (item.source === 'system' || item.source === 'ai' || item.source === 'action' || item.source === 'error')
            );
        });
    } catch (error) {
        console.error('Failed to load persisted orchestrator records', error);
        return [];
    }
}

function persistOrchestratorRecords(): void {
    // Disabled in Sandbox mode to prevent concurrent file corruption across isolated user sessions.
}

function pushOrchestratorRecord(record: OrchestratorRecord): void {
    stateProxy.orchestratorRecords.push(record);
    persistOrchestratorRecords();
}

export function appendOrchestratorRecord(source: OrchestratorRecord['source'], message: string, droneId?: string): void {
    pushOrchestratorRecord({
        timestamp: Date.now(),
        source,
        message,
        droneId,
    });
}

function normalizeReasoning(reasoning: string): string {
    return reasoning
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function getOrchestratorRecords(limit?: number): OrchestratorRecord[] {
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
        return stateProxy.orchestratorRecords.slice(-Math.floor(limit));
    }

    return [...stateProxy.orchestratorRecords];
}

export function clearOrchestratorRecords(): void {
    stateProxy.orchestratorRecords = [];
    persistOrchestratorRecords();
}

mkdirSync(path.dirname(ORCHESTRATOR_RECORDS_PATH), { recursive: true });
// Legacy disk records load omitted to prevent cross-contamination in sandboxes

const MAX_HISTORY_TURNS = 20;

function trimHistory(): void {
    if (stateProxy.chatHistory.length > MAX_HISTORY_TURNS) {
        stateProxy.chatHistory = stateProxy.chatHistory.slice(stateProxy.chatHistory.length - MAX_HISTORY_TURNS);
    }
}

function clearChatHistory(): void {
    stateProxy.chatHistory = [];
}

function buildStateSummary(): string {
    const stats = droneStore.getMissionStats();
    const drones = droneStore.getAllDrones();
    const grid = droneStore.getGrid();

    const hotspots = grid
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

    const isReturningToBase = (drone: typeof drones[number]): boolean => {
        if (drone.mode === 'Charging') return false;

        const targetIsBase =
            Math.round(drone.target?.x ?? -1) === BASE_X &&
            Math.round(drone.target?.y ?? -1) === BASE_Y;

        if (!targetIsBase) return false;

        const distToBase = Math.sqrt(
            Math.pow(drone.position.x - BASE_X, 2) +
            Math.pow(drone.position.y - BASE_Y, 2)
        );

        return distToBase > 0.35;
    };

    const droneSummary = drones
        .map(d => {
            const isReturning = isReturningToBase(d);
            return `${d.id}: pos=(${d.position.x},${d.position.y}) mode=${d.mode} battery=${d.battery.toFixed(1)}% active=${d.isActive}${isReturning ? ' <RETURNING>' : ''}`;
        })
        .join('\n');

    // Relay and network state
    const relayDrones = drones.filter(d => d.id.startsWith('RLY-') && d.isActive);
    const disconnectedDrones = drones.filter(d => d.isActive && !d.isConnected && d.mode !== 'Relay');
    const networkTopology = droneStore.getNetworkTopology();
    const swarmKnowledge = droneStore.getSwarmKnowledge();

    const relayReturning = relayDrones.filter(r => isReturningToBase(r));
    const relayField = relayDrones.find(r => r.mode === 'Relay' && !isReturningToBase(r));
    const relayStandby = relayDrones.find(r => r.id !== relayField?.id && r.mode === 'Charging');

    const relaySummary = relayDrones.length > 0
        ? relayDrones.map(r => {
            const isReturning = isReturningToBase(r);
            return `${r.id}: pos=(${r.position.x.toFixed(1)},${r.position.y.toFixed(1)}) mode=${r.mode} battery=${r.battery.toFixed(1)}%${isReturning ? ' <RETURNING>' : ''}`;
        }).join('\n')
        : '(no relay drones)';

    const relayRoleSummary = [
        `fieldRelay=${relayField ? relayField.id : 'none'}`,
        `standbyRelay=${relayStandby ? relayStandby.id : 'none'}`,
        `returningRelays=${relayReturning.length > 0 ? relayReturning.map(r => r.id).join(',') : 'none'}`,
        'handoff=autonomous',
    ].join(' ');

    const networkHealth = networkTopology
        ? `chain=${networkTopology.relayChain.join('→')} connected=${networkTopology.connectedDrones.length} disconnected=${networkTopology.disconnectedDrones.length} buffered=${networkTopology.bufferedDataSize}B`
        : '(no topology data)';

    return [
        `tick=${stats.currentTick}`,
        `running=${stats.simulationRunning}`,
        `scanProgress=${stats.scanProgress.toFixed(1)}%`,
        `microScanOnly=${droneStore.isMicroScanOnly()}`,
        `survivorsFound=${stats.survivorsFound}`,
        `avgBattery=${stats.averageBattery.toFixed(1)}%`,
        `meanProbabilityScanned=${stats.meanProbabilityScanned?.toFixed(3) || 0}`,
        `imageScannedCells=${grid.flat().filter(c => c.scanned && !!c.disasterImage).length}`,
        `missionTimeRemaining=${stats.missionTimeRemaining !== null ? stats.missionTimeRemaining + 's' : 'N/A'} (Limit: ${stats.missionTimeLimit !== null ? stats.missionTimeLimit + 's' : 'none'})`,
        '',
        'DRONES:',
        droneSummary || '(none synced yet)',
        '',
        'RELAY NETWORK:',
        relaySummary,
        `RelayRoles: ${relayRoleSummary}`,
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
        let reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';

        // Fallback: If no <Thinking> tags, try to take everything before the <Action> block
        if (!reasoning) {
            const actionStartIndex = raw.toLowerCase().indexOf('<action>');
            if (actionStartIndex !== -1) {
                reasoning = raw.substring(0, actionStartIndex).trim();
            } else if (!raw.toLowerCase().includes('</action>')) {
                // If NO tags at all, the whole thing might be reasoning
                reasoning = raw.trim();
            }
        }

        // Clean stray tags from reasoning if they were captured by the fallback
        if (reasoning) {
            reasoning = reasoning
                .replace(/<\/?thinking>/gi, '')
                .replace(/<\/?action>/gi, '')
                .trim();
        }

        // Extract the <Action> block
        const actionMatch = raw.match(/<Action>\s*([\s\S]*?)\s*<\/Action>/i);
        const actions: ChatAction[] = [];

        if (actionMatch && actionMatch[1]) {
            // Process each line in the action block
            const actionLines = actionMatch[1].split('\n').filter(line => line.trim().length > 0);

            for (const line of actionLines) {
                const text = line.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');

                // Extremely simple "function call" parser for the action list
                // e.g., move_drone("DRN-Alpha", 5, 5) or set_drone_mode("DRN-Beta", "Wide")

                if (text.startsWith('move_drone')) {
                    const match = text.match(/move_drone\s*\(\s*(['"]?)([^'",]+)\1\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
                    if (match) actions.push({ type: 'move_drone', droneId: match[2], x: parseFloat(match[3]), y: parseFloat(match[4]) });
                } else if (text.startsWith('set_drone_mode')) {
                    const match = text.match(/set_drone_mode\s*\(\s*(['"]?)([^'",]+)\1\s*,\s*(['"]?)([^'",]+)\3/i);
                    if (match) actions.push({ type: 'set_drone_mode', droneId: match[2], mode: match[4] as 'Wide' | 'Micro' | 'Relay' | 'Charging' });
                } else if (text.startsWith('recall_drone')) {
                    const match = text.match(/recall_drone\s*\(\s*(['"]?)([^'",()]+)\1/i);
                    if (match) actions.push({ type: 'recall_drone', droneId: match[2] });
                } else if (text.startsWith('move_relay')) {
                    const match = text.match(/move_relay\s*\(\s*(['"]?)([^'",]+)\1\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
                    if (match) actions.push({ type: 'move_relay', relayId: match[2], x: parseFloat(match[3]), y: parseFloat(match[4]) });
                } else if (text.startsWith('replace_relay')) {
                    const match = text.match(/replace_relay\s*\(\s*(['"]?)([^'",)]+)\1/i);
                    if (match) actions.push({ type: 'replace_relay', relayId: match[2] });
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

async function executeRegionBootstrap(): Promise<{ decision: ParsedDecision; executionLog: LogEntry[] }> {
    const plans = buildRegionPlans();
    const executionLog: LogEntry[] = [];
    const actions: ChatAction[] = [];

    // Ensure simulation is running so assigned drones actually move.
    await executeTool('setSimulationRunning', { running: true });
    executionLog.push({ message: 'setSimulationRunning(true)' });

    for (const plan of plans) {
        await executeTool('setDroneMode', { droneId: plan.droneId, mode: 'Wide' });
        await executeTool('setDroneTarget', {
            droneId: plan.droneId,
            targetX: plan.targetX,
            targetY: plan.targetY,
        });

        executionLog.push({
            message: `region_assign(${plan.droneId}: x[${plan.xMin}-${plan.xMax}] y[${plan.yMin}-${plan.yMax}] -> target ${plan.targetX},${plan.targetY})`,
            droneId: plan.droneId,
        });

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

interface LogEntry {
    message: string;
    droneId?: string;
}

async function executeActions(actions: ChatAction[]): Promise<LogEntry[]> {
    const logs: LogEntry[] = [];

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'move_drone': {
                    await executeTool('setDroneTarget', {
                        droneId: action.droneId,
                        targetX: action.x,
                        targetY: action.y,
                    });
                    logs.push({ message: `setDroneTarget(${action.droneId} -> ${action.x},${action.y})`, droneId: action.droneId });
                    break;
                }
                case 'set_drone_mode': {
                    await executeTool('setDroneMode', {
                        droneId: action.droneId,
                        mode: action.mode,
                    });
                    logs.push({ message: `setDroneMode(${action.droneId} -> ${action.mode})`, droneId: action.droneId });
                    break;
                }
                case 'recall_drone': {
                    await executeTool('recallDroneToBase', { droneId: action.droneId });
                    logs.push({ message: `recallDroneToBase(${action.droneId})`, droneId: action.droneId });
                    break;
                }
                case 'deploy_team': {
                    await executeTool('setSurvivorPin', {
                        x: action.x,
                        y: action.y,
                        droneId: action.droneId ?? 'AI_AGENT',
                        message: action.reason ?? 'Potential survivor confirmation',
                    });
                    logs.push({ message: `setSurvivorPin(${action.x},${action.y})`, droneId: action.droneId });
                    break;
                }
                case 'set_simulation_state': {
                    await executeTool('setSimulationRunning', { running: action.running });
                    logs.push({ message: `setSimulationRunning(${action.running})` });
                    break;
                }
                case 'reset_simulation': {
                    await executeTool('resetMission', {});
                    logs.push({ message: 'resetMission()' });
                    break;
                }
                case 'no_action': {
                    // Silent
                    break;
                }
                case 'move_relay': {
                    const result = (await executeTool('moveRelayDrone', {
                        relayId: action.relayId,
                        x: action.x,
                        y: action.y,
                    })) as { success: boolean };
                    logs.push({
                        message: `[AI ORCHESTRATOR] moveRelayDrone(${action.relayId},${action.x},${action.y}) → ${result.success ? 'Repositioned' : 'FAILED'}`,
                        droneId: action.relayId,
                    });
                    break;
                }
                case 'replace_relay': {
                    const result = (await executeTool('replaceRelayDrone', {
                        relayId: action.relayId,
                    })) as { success: boolean; data?: { newRelayId: string } };
                    logs.push({
                        message: `[AI ORCHESTRATOR] replaceRelayDrone(${action.relayId}) → ${result.success ? `Replaced with ${result.data?.newRelayId}` : 'FAILED'}`,
                        droneId: action.relayId,
                    });
                    break;
                }
                case 'broadcast_swarm': {
                    const result = (await executeTool('broadcastSwarmCommand', {
                        command: action.command,
                        targetArea: action.targetArea,
                    })) as { success: boolean; data?: { reachableDrones: string[] } };
                    logs.push({
                        message: `[AI ORCHESTRATOR] broadcastSwarmCommand(${action.command}) → ${result.success ? `Broadcast to ${result.data?.reachableDrones?.length ?? 0} drones` : 'FAILED'}`,
                    });
                    break;
                }
                default:
                    logs.push({ message: `unsupported action: ${(action as { type: string }).type}` });
            }
        } catch (error) {
            logs.push({ message: `error on ${action.type}: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    return logs;
}

function isHeadingToBase(drone: { mode: string; target?: { x: number; y: number } | null; position: { x: number; y: number } }): boolean {
    if (drone.mode === 'Charging') return false;

    const targetIsBase =
        Math.round(drone.target?.x ?? -1) === BASE_X &&
        Math.round(drone.target?.y ?? -1) === BASE_Y;

    if (!targetIsBase) return false;

    const distToBase = Math.sqrt(
        Math.pow(drone.position.x - BASE_X, 2) +
        Math.pow(drone.position.y - BASE_Y, 2)
    );

    return distToBase > 0.35;
}

function applyRelaySafetyFallback(actions: ChatAction[]): ChatAction[] {
    const hydratedActions = [...actions];
    const drones = droneStore.getAllDrones().filter(d => d.isActive && d.id.startsWith('RLY-'));

    for (const relay of drones) {
        if (relay.mode === 'Charging') continue;
        if (relay.battery >= 25) continue;

        const alreadyRecalled = hydratedActions.some(
            (a) => a.type === 'recall_drone' && a.droneId === relay.id
        );
        if (alreadyRecalled) continue;

        const relayAtBase =
            Math.sqrt(
                Math.pow(relay.position.x - BASE_X, 2) +
                Math.pow(relay.position.y - BASE_Y, 2)
            ) <= 0.35;

        if (relayAtBase || isHeadingToBase(relay)) continue;

        hydratedActions.push({
            type: 'recall_drone',
            droneId: relay.id,
            reason: `Safety override: ${relay.id} battery ${relay.battery.toFixed(1)}% is below relay threshold`,
        });
    }

    return hydratedActions;
}

export async function processOrchestratorChat(message: string, mode: 'online' | 'offline' | 'auto' = 'auto'): Promise<{
    success: boolean;
    reply?: string;
    decision?: ParsedDecision;
    executionLog?: string[];
    error?: string;
    timestamp: number;
    activeMode?: 'online' | 'offline';
}> {
    try {
        const missionStats = droneStore.getMissionStats();
        if (missionStats.currentTick === 0 && missionStats.scanProgress < 1) {
            regionBootstrapDone = false;
            clearChatHistory();
        }

        if (!regionBootstrapDone && shouldBootstrapRegions(message)) {
            const { decision, executionLog } = await executeRegionBootstrap();
            pushOrchestratorRecord({
                timestamp: Date.now(),
                source: 'system',
                message: 'Autonomous region bootstrap engaged.',
            });
            pushOrchestratorRecord({
                timestamp: Date.now(),
                source: 'ai',
                message: normalizeReasoning(decision.reasoning),
                droneId: 'ORCHESTRATOR',
            });
            executionLog.forEach((entry) => {
                pushOrchestratorRecord({
                    timestamp: Date.now(),
                    source: 'action',
                    message: entry.message,
                    droneId: entry.droneId,
                });
            });
            return {
                success: true,
                reply: JSON.stringify(decision),
                decision,
                executionLog: executionLog.map(e => e.message),
                timestamp: Date.now(),
            };
        }

        const { provider, activeMode } = await getProvider(mode);
        const stateSummary = buildStateSummary();

        const systemPrompt = `You are FirstLight rescue orchestrator AI.

You MUST ALWAYS respond using the following strict format consisting of a <Thinking> block followed by an <Action> block. DO NOT omit these tags.

<Thinking>
- Output your internal analysis here. Evaluate zones, coverage, drone states, and explicit visual analysis of captured images.
</Thinking>

<Action>
- List your chosen actions exactly using these function names, ONE PER LINE:
move_drone("DRN-ID", x, y)
set_drone_mode("DRN-ID", "Wide" | "Micro" | "Relay" | "Charging")
recall_drone("DRN-ID")
deploy_team("TeamName", x, y)
move_relay("RLY-ID", x, y)
replace_relay("RLY-ID")
broadcast_swarm("RECRUIT" | "MICRO_SCAN" | "REDISTRIBUTE" | "RTB_ALL")
set_simulation_state(true|false)
reset_simulation()
no_action()
</Action>

Critical rules:
- Reasoning voice must be autonomous. Never write phrases like "the user requested" or "user has requested". Base decisions on mission state and telemetry only.
- Provide explicit percentages: When discussing scan progress, state the exact percentage (e.g., "Scan Progress: 9.5%") instead of using vague phrases like "very low" or "moderate".
- Survivors reporting policy: never reference "expected", "estimated", or "target" survivor counts. Mention only confirmed survivors found and actionable search status.
- Natural phrasing for findings: Never literally mention "img=" or "finding=" or quote image paths. Use natural language: "A survivor has been confirmed at C13(2,12)" or "A thermal signature was detected at B4".
- Never invent drone IDs; use only synced drones from state.
- Every action line must use full function syntax with required parameters (e.g., replace_relay("RLY-Prime"), not just replace_relay).
- BATTERY CRITICAL (below 10% or negative): immediately emit recall_drone for that drone. This is the highest priority.
- BATTERY LOW (below 20%): emit recall_drone unless the drone is already heading to base.
- AUTONOMOUS CONNECTIVITY (No Manual Bridging): Do NOT manually issue move_relay to bridge communication gaps or reconnect drones. The Field Relay uses autonomous centroid logic to maintain link quality, and search drones autonomously return to base if disconnected for too long.
- RELAY BATTERY LOW (below 25%): emit replace_relay immediately, UNLESS it is <RETURNING>.
- STANDBY RELAY (Strict Reservation): The standbyRelay is reserved EXCLUSIVELY for the replace_relay action. NEVER use move_relay or set_drone_mode on a standby/Charging relay. Relay handoff is otherwise AUTONOMOUS. If RelayRoles shows a valid field relay and another relay is <RETURNING> or Charging at base, DO NOT issue replace_relay; describe it as autonomous handoff in progress.
- MODE LOCK (Strict Role Separation): 
    1. NEVER use set_drone_mode on 'RLY-' drones to change them to 'Wide' or 'Micro'. Relay drones stay in Relay/Charging.
    2. NEVER use set_drone_mode on search drones ('DRN-Alpha','DRN-Beta','DRN-Gamma','DRN-Delta') to change them to 'Relay'. Search drones stay in Wide/Micro/Charging.
- MICRO SCAN ONLY: If \`microScanOnly=true\` in STATE, do NOT issue any \`set_drone_mode\` to 'Wide'. The simulation local autonomy engine strictly enforces 'Micro' mode for search drones.
- MISSION COMPLETION RULES:
  1. If scanProgress < 100%, continue searching normally.
  2. If scanProgress >= 100% and ANY drone is still in "Micro" mode, wait and let them finish (no_action, or move them closer to signals). DO NOT recall them.
  3. If scanProgress >= 100% and NO drones are in "Micro" mode, check positions. If any drone is NOT at base (dist > 1 from 10,19), issue \`recall_drone\` ONLY for those drones.
  4. If scanProgress >= 100% and ALL drones are safe at base (near 10,19 or battery=100 or mode=Charging), issue \`set_simulation_state\` with \`"running": false\` to successfully end the mission.
- EMERGENCY SEARCH RULES (Apply ONLY if missionTimeLimit is NOT null):
  1. If missionTimeLimit is null: ignore these rules and focus on systematic coverage.
  2. TREAT AS EMERGENCY: The time budget indicates a life-critical emergency. Maximize drone functionality and sensor coverage at all costs.
  3. NO RTB ON TIMEOUT: Search drones are NOT required to return to base when missionTimeRemaining reaches 0. They must continue their assigned tasks (searching or micro-scanning) to maximize discovery until the mission is manually stopped or battery is CRITICAL (< 10%).
  4. If missionTimeRemaining < 60s: ACCELERATE. Prioritize highest probability zones (p > 0.6) and ignore low-priority areas. Switch search drones to 'Wide' mode to cover vast areas quickly if they aren't already on a signal.
  5. If missionTimeRemaining < 20s: FINAL PUSH. Prioritize any remaining hotspots (p > 0.8) regardless of distance. Keep drones in 'Micro' mode if they have a signal to ensure detection. DO NOT issue recall_drone unless battery is < 10%.
- Use no_action only when the simulation is paused and there is nothing to do, or all drones are already optimally placed.`;

        const userPrompt = `STATE:\n${stateSummary}\n\nUSER:\n${message}`;

        const reply = await provider.sendMessage(userPrompt, stateProxy.chatHistory, systemPrompt);

        // Persist this turn into history
        stateProxy.chatHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
        stateProxy.chatHistory.push({ role: 'model', parts: [{ text: reply }] });
        trimHistory();
        const decision = parseDecision(reply);

        if (!decision) {
            pushOrchestratorRecord({
                timestamp: Date.now(),
                source: 'ai',
                message: normalizeReasoning(reply) || '(no response)',
            });
            return {
                success: true,
                reply,
                timestamp: Date.now(),
                activeMode
            };
        }

        const safeActions = applyRelaySafetyFallback(decision.actions);
        const safeDecision: ParsedDecision = {
            ...decision,
            actions: safeActions,
        };

        const executionLog = await executeActions(safeActions);

        pushOrchestratorRecord({
            timestamp: Date.now(),
            source: 'ai',
            message: normalizeReasoning(decision.reasoning),
            droneId: 'ORCHESTRATOR',
        });
        executionLog.forEach((entry) => {
            pushOrchestratorRecord({
                timestamp: Date.now(),
                source: 'action',
                message: entry.message,
                droneId: entry.droneId,
            });
        });

        if (safeActions.some(a => a.type === 'reset_simulation')) {
            regionBootstrapDone = false;
            clearChatHistory();
            pushOrchestratorRecord({
                timestamp: Date.now(),
                source: 'system',
                message: 'Mission reset detected. Conversation context cleared.',
            });
        }

        return {
            success: true,
            reply,
            decision: safeDecision,
            executionLog: executionLog.map(e => e.message),
            timestamp: Date.now(),
            activeMode
        };
    } catch (error) {
        pushOrchestratorRecord({
            timestamp: Date.now(),
            source: 'error',
            message: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
        };
    }
}
