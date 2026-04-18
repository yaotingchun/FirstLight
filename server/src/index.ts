/**
 * FirstLight MCP Server
 * 
 * Hybrid server:
 * - REST API for dashboard/state sync/manual calls
 * - MCP JSON-RPC endpoint for protocol-compliant tool clients
 * 
 * Endpoints:
 * - GET  /api/status          - Server status
 * - GET  /api/tools           - List all available tools
 * - POST /api/tools/:toolName - Execute a tool
 * - POST /api/mcp             - MCP JSON-RPC endpoint
 * - POST /mcp                 - MCP JSON-RPC endpoint (alias)
 * - GET  /api/commands        - Get pending commands (for frontend polling)
 * - POST /api/commands/:id/ack - Acknowledge command processed
 * - POST /api/state/sync      - Sync state from frontend
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { executeTool, listTools, getToolSchema } from './tools/index.js';
import { droneStore, sessionStores, DroneStore, storeContext } from './droneStore.js';
import { processOrchestratorChat, getOrchestratorRecords, clearOrchestratorRecords, appendOrchestratorRecord, ConnectivityChecker } from './orchestratorChat.js';
import { localAutonomy } from './simulation/localAutonomy.js';
import type { DroneStatus, SectorScanResult, CommLink, SurvivorInfo } from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;
const ORCHESTRATOR_THINK_INTERVAL_TICKS = parseInt(process.env.ORCHESTRATOR_THINK_INTERVAL_TICKS ?? '30', 10);
const MCP_PROTOCOL_VERSION = '2024-11-05';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
}

interface AnalyticsRecord {
    Test_ID: number;
    'Search_Duration(mm:ss)': number;
    'Repeat_Rate(%)': number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
    return typeof value === 'string' || typeof value === 'number' || value === null;
}

function sendJsonRpcResult(res: express.Response, id: JsonRpcId, result: unknown): void {
    res.json({
        jsonrpc: '2.0',
        id,
        result,
    });
}

function sendJsonRpcError(
    res: express.Response,
    id: JsonRpcId,
    code: number,
    message: string,
    data?: unknown
): void {
    const errorPayload: { code: number; message: string; data?: unknown } = { code, message };
    if (data !== undefined) {
        errorPayload.data = data;
    }

    res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: errorPayload,
    });
}

function getAutonomyAgentName(droneId: string): string {
    if (droneId.startsWith('RLY-')) return 'Agent Relay';
    if (droneId.includes('Alpha')) return 'Agent Alpha';
    if (droneId.includes('Beta')) return 'Agent Beta';
    if (droneId.includes('Gamma')) return 'Agent Gamma';
    if (droneId.includes('Delta')) return 'Agent Delta';
    return 'Agent';
}

const analyticsJsonPath = path.join(__dirname, '../../src/assets/performance_analytics.json');

async function readAnalyticsRecords(): Promise<AnalyticsRecord[]> {
    const content = await readFile(analyticsJsonPath, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
        throw new Error('Analytics JSON must be an array');
    }
    return parsed as AnalyticsRecord[];
}

function getNextTestId(records: AnalyticsRecord[]): number {
    const maxId = records.reduce((max, record) => {
        const raw = record.Test_ID;
        const id = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isFinite(id)) {
            return Math.max(max, id);
        }
        return max;
    }, 0);
    return maxId + 1;
}

const thinkLocks = new Map<string, { inFlight: boolean, lastTick: number }>();

async function runPeriodicOrchestratorThink(sessionId: string, tick: number): Promise<void> {
    if (!thinkLocks.has(sessionId)) thinkLocks.set(sessionId, { inFlight: false, lastTick: -1 });
    const lock = thinkLocks.get(sessionId)!;

    if (lock.inFlight || lock.lastTick === tick) {
        return;
    }

    lock.inFlight = true;
    lock.lastTick = tick;

    try {
        const mode = droneStore.getAiMode();
        const result = await processOrchestratorChat(
            'Periodic strategic review: evaluate global mission progress, battery posture, relay network health, hotspot coverage, and survivor search efficiency. Issue actions only if meaningful intervention is required; otherwise use no_action with a short reason.',
            mode
        );

        if (!result.success) {
            appendOrchestratorRecord(
                'error',
                `[ORCHESTRATOR_THINK] tick=${tick} failed: ${result.error ?? 'unknown error'}`
            );
        }
    } finally {
        lock.inFlight = false;
    }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && req.path !== '/mcp') {
        return next();
    }
    const sessionId = req.headers['x-session-id'] as string || 'default';
    if (!sessionStores.has(sessionId)) {
        console.log(`[Session] Creating new sandbox for session: ${sessionId}`);
        sessionStores.set(sessionId, new DroneStore());
    }
    const store = sessionStores.get(sessionId)!;
    storeContext.run(store, () => next());
});

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Server status
app.get('/api/status', (req, res) => {
    const sessionId = req.headers['x-session-id'] as string || 'default';
    const lock = thinkLocks.get(sessionId);
    res.json({
        status: 'online',
        version: '1.0.0',
        timestamp: Date.now(),
        simulationRunning: droneStore.isSimulationRunning(),
        currentTick: droneStore.getCurrentTick(),
        dronesOnline: droneStore.getAllDrones().filter(d => d.isActive).length,
        localAutonomyEnabled: localAutonomy.isEnabled(),
        orchestratorThinkInFlight: lock ? lock.inFlight : false,
    });
});

app.get('/api/autonomy/status', (req, res) => {
    res.json({
        success: true,
        enabled: localAutonomy.isEnabled(),
        timestamp: Date.now(),
    });
});

app.post('/api/autonomy/enabled', (req, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
        res.status(400).json({
            success: false,
            error: 'enabled (boolean) is required',
            timestamp: Date.now(),
        });
        return;
    }

    localAutonomy.setEnabled(enabled);
    res.json({
        success: true,
        enabled,
        timestamp: Date.now(),
    });
});

// List all tools
app.get('/api/tools', (req, res) => {
    const tools = listTools();
    res.json({
        success: true,
        tools,
        count: tools.length,
        modules: {
            drone: ['getDroneStatus', 'getAllDroneStatuses', 'setDroneTarget', 'setDroneMode', 'recallDroneToBase', 'killDrone'],
            scan: ['getSectorScanResult', 'getGridHeatmap', 'getScannedSectors', 'getSurroundingSectors'],
            communication: ['getCommNetworkStatus', 'getDisconnectedDrones', 'checkDroneConnectivity'],
            mission: ['getSwarmStatus', 'getMissionStats', 'getFoundSurvivors', 'setSurvivorPin', 'resetMission', 'setSimulationRunning', 'getMissionBriefing'],
            swarmIntel: ['getExplorationGradient', 'getUnassignedHotspots', 'getDroneAssignmentMap'],
            orchestration: ['validateAssignmentPlan', 'assignHotspotBatch', 'getRecommendedActions', 'getBatteryRiskMap']
        }
    });
});

// Get specific tool schema
app.get('/api/tools/:toolName', (req, res) => {
    const { toolName } = req.params;
    const schema = getToolSchema(toolName);
    
    if (!schema) {
        res.status(404).json({
            success: false,
            error: `Tool "${toolName}" not found`
        });
        return;
    }

    res.json({
        success: true,
        tool: schema
    });
});

// Execute a tool
app.post('/api/tools/:toolName', async (req, res) => {
    const { toolName } = req.params;
    const params = req.body || {};

    console.log(`[MCP] Executing tool: ${toolName}`, params);

    const result = await executeTool(toolName, params);
    
    res.json(result);
});

// MCP JSON-RPC endpoint (HTTP transport)
app.post(['/api/mcp', '/mcp'], async (req, res) => {
    const rpc = req.body as JsonRpcRequest;

    if (!isRecord(rpc)) {
        sendJsonRpcError(res, null, -32600, 'Invalid Request');
        return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(rpc, 'id');
    const idValue = hasId ? rpc.id : null;
    const id = isJsonRpcId(idValue) ? idValue : null;

    if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
        sendJsonRpcError(res, id, -32600, 'Invalid Request');
        return;
    }

    if (hasId && !isJsonRpcId(idValue)) {
        sendJsonRpcError(res, null, -32600, 'Invalid Request', 'id must be string, number, or null');
        return;
    }

    const isNotification = !hasId;

    try {
        switch (rpc.method) {
            case 'initialize': {
                const result = {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {
                        tools: {
                            listChanged: false,
                        },
                    },
                    serverInfo: {
                        name: 'firstlight-mcp-server',
                        version: '1.0.0',
                    },
                };

                if (isNotification) {
                    res.status(204).end();
                    return;
                }
                sendJsonRpcResult(res, id, result);
                return;
            }

            case 'notifications/initialized': {
                if (isNotification) {
                    res.status(204).end();
                    return;
                }
                sendJsonRpcResult(res, id, {});
                return;
            }

            case 'tools/list': {
                const tools = listTools().map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                }));

                if (isNotification) {
                    res.status(204).end();
                    return;
                }
                sendJsonRpcResult(res, id, { tools });
                return;
            }

            case 'tools/call': {
                if (!isRecord(rpc.params)) {
                    sendJsonRpcError(res, id, -32602, 'Invalid params', 'params must be an object');
                    return;
                }

                const name = rpc.params.name;
                if (typeof name !== 'string' || !name.trim()) {
                    sendJsonRpcError(res, id, -32602, 'Invalid params', 'params.name is required');
                    return;
                }

                const args = rpc.params.arguments;
                if (args !== undefined && !isRecord(args)) {
                    sendJsonRpcError(res, id, -32602, 'Invalid params', 'params.arguments must be an object');
                    return;
                }

                const toolResult = await executeTool(name, (args as Record<string, unknown> | undefined) ?? {});
                const normalized = isRecord(toolResult)
                    ? toolResult
                    : {
                        success: false,
                        error: 'Tool execution returned a non-object response',
                        timestamp: Date.now(),
                    };

                const success = normalized.success === true;
                const structuredContent = success
                    ? (normalized.data ?? normalized)
                    : normalized;
                const text = success
                    ? JSON.stringify(structuredContent, null, 2)
                    : String(normalized.error ?? 'Tool execution failed');

                const result = {
                    content: [
                        {
                            type: 'text',
                            text,
                        },
                    ],
                    structuredContent,
                    isError: !success,
                };

                if (isNotification) {
                    res.status(204).end();
                    return;
                }
                sendJsonRpcResult(res, id, result);
                return;
            }

            default: {
                if (isNotification) {
                    res.status(204).end();
                    return;
                }
                sendJsonRpcError(res, id, -32601, `Method not found: ${rpc.method}`);
                return;
            }
        }
    } catch (error) {
        if (isNotification) {
            res.status(204).end();
            return;
        }
        sendJsonRpcError(
            res,
            id,
            -32603,
            'Internal error',
            error instanceof Error ? error.message : String(error)
        );
    }
});

// Orchestrator chat endpoint (frontend AI chat)
app.post('/api/orchestrator/chat', async (req, res) => {
    const { message, mode } = req.body as { message?: string, mode?: 'online' | 'offline' | 'auto' };

    if (!message || !message.trim()) {
        res.status(400).json({
            success: false,
            error: 'message is required',
            timestamp: Date.now()
        });
        return;
    }

    // Persist mode if provided
    if (mode) {
        droneStore.setAiMode(mode);
    }

    const currentMode = mode || droneStore.getAiMode();
    const result = await processOrchestratorChat(message.trim(), currentMode);
    res.json(result);
});

// Provider status endpoint
app.get('/api/orchestrator/status', async (req, res) => {
    const [gemini, ollama] = await Promise.all([
        ConnectivityChecker.checkGemini(),
        ConnectivityChecker.checkOllama()
    ]);

    res.json({
        success: true,
        providers: {
            gemini: gemini ? 'online' : 'offline',
            ollama: ollama ? 'online' : 'offline'
        },
        currentMode: droneStore.getAiMode(),
        timestamp: Date.now()
    });
});

// Set orchestrator mode
app.post('/api/orchestrator/mode', (req, res) => {
    const { mode } = req.body as { mode: 'online' | 'offline' | 'auto' };
    
    if (!mode || !['online', 'offline', 'auto'].includes(mode)) {
        res.status(400).json({
            success: false,
            error: 'mode must be one of: online, offline, auto',
            timestamp: Date.now()
        });
        return;
    }

    droneStore.setAiMode(mode);
    
    res.json({
        success: true,
        mode,
        timestamp: Date.now()
    });
});

// Get orchestrator record feed for dashboard timeline
app.get('/api/orchestrator/records', (req, res) => {
    const rawLimit = req.query.limit;
    const limitParam = rawLimit === undefined ? undefined : Number.parseInt(String(rawLimit), 10);
    const records = getOrchestratorRecords(limitParam);

    res.json({
        success: true,
        records,
        count: records.length,
        timestamp: Date.now(),
    });
});

// Append a record to orchestrator timeline.
app.post('/api/orchestrator/records', (req, res) => {
    const { source, message, droneId } = req.body as {
        source?: 'system' | 'ai' | 'action' | 'error';
        message?: string;
        droneId?: string;
    };

    if (!source || !['system', 'ai', 'action', 'error'].includes(source)) {
        res.status(400).json({
            success: false,
            error: 'source is required and must be one of system|ai|action|error',
            timestamp: Date.now(),
        });
        return;
    }

    if (!message || !message.trim()) {
        res.status(400).json({
            success: false,
            error: 'message is required',
            timestamp: Date.now(),
        });
        return;
    }

    appendOrchestratorRecord(source, message.trim(), typeof droneId === 'string' ? droneId : undefined);

    res.json({
        success: true,
        timestamp: Date.now(),
    });
});

// Clear orchestrator record feed (used to reset timeline after page refresh)
app.delete('/api/orchestrator/records', (req, res) => {
    clearOrchestratorRecords();

    res.json({
        success: true,
        message: 'Orchestrator records cleared',
        timestamp: Date.now(),
    });
});

// Append a simulation analytics record to the JSON dataset.
app.post('/api/analytics/append', async (req, res) => {
    const { searchDurationMinutes, repeatRatePercent } = req.body as {
        searchDurationMinutes?: number;
        repeatRatePercent?: number;
    };

    if (typeof searchDurationMinutes !== 'number' || !Number.isFinite(searchDurationMinutes) || searchDurationMinutes < 0) {
        res.status(400).json({
            success: false,
            error: 'searchDurationMinutes must be a finite non-negative number',
            timestamp: Date.now(),
        });
        return;
    }

    if (typeof repeatRatePercent !== 'number' || !Number.isFinite(repeatRatePercent) || repeatRatePercent < 0) {
        res.status(400).json({
            success: false,
            error: 'repeatRatePercent must be a finite non-negative number',
            timestamp: Date.now(),
        });
        return;
    }

    try {
        const records = await readAnalyticsRecords();
        const normalizedRepeatRate = Math.min(100, repeatRatePercent) / 100;

        const newRecord: AnalyticsRecord = {
            Test_ID: getNextTestId(records),
            'Search_Duration(mm:ss)': searchDurationMinutes,
            'Repeat_Rate(%)': normalizedRepeatRate,
        };

        records.push(newRecord);
        await writeFile(analyticsJsonPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');

        res.json({
            success: true,
            record: newRecord,
            totalRecords: records.length,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to append analytics record: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now(),
        });
    }
});

// Get pending commands (for frontend polling)
app.get('/api/commands', (req, res) => {
    const commands = droneStore.getPendingCommands();
    res.json({
        success: true,
        commands,
        count: commands.length
    });
});

// Acknowledge command processed
app.post('/api/commands/:id/ack', (req, res) => {
    const { id } = req.params;
    droneStore.markCommandProcessed(id);
    res.json({
        success: true,
        message: `Command ${id} acknowledged`
    });
});

// Clear processed commands
app.delete('/api/commands/processed', (req, res) => {
    droneStore.clearProcessedCommands();
    res.json({
        success: true,
        message: 'Processed commands cleared'
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// STATE SYNC ENDPOINTS (Frontend -> Server)
// ═══════════════════════════════════════════════════════════════════════════

// Sync drone states from frontend
app.post('/api/state/drones', (req, res) => {
    const { drones } = req.body as { drones: DroneStatus[] };
    
    if (!Array.isArray(drones)) {
        res.status(400).json({
            success: false,
            error: 'drones must be an array'
        });
        return;
    }

    droneStore.updateDrones(drones);
    
    res.json({
        success: true,
        message: `Updated ${drones.length} drones`
    });
});

// Sync grid state from frontend
app.post('/api/state/grid', (req, res) => {
    const { grid } = req.body as { grid: SectorScanResult[][] };
    
    if (!Array.isArray(grid)) {
        res.status(400).json({
            success: false,
            error: 'grid must be a 2D array'
        });
        return;
    }

    droneStore.updateGrid(grid);
    
    res.json({
        success: true,
        message: 'Grid state updated'
    });
});

// Sync communication links from frontend
app.post('/api/state/comm', (req, res) => {
    const { links } = req.body as { links: CommLink[] };
    
    if (!Array.isArray(links)) {
        res.status(400).json({
            success: false,
            error: 'links must be an array'
        });
        return;
    }

    droneStore.updateCommLinks(links);
    
    res.json({
        success: true,
        message: `Updated ${links.length} comm links`
    });
});

// Report found survivor from frontend
app.post('/api/state/survivor', (req, res) => {
    const survivor = req.body as SurvivorInfo;
    
    droneStore.addFoundSurvivor(survivor);
    
    res.json({
        success: true,
        message: `Survivor ${survivor.id} added`
    });
});

// Sync tick from frontend
app.post('/api/state/tick', (req, res) => {
    const { tick, running } = req.body as { tick: number; running: boolean };
    
    droneStore.setTick(tick);
    droneStore.setRunning(running);

    const autonomy = localAutonomy.onTick(tick);
        autonomy.actions.forEach((action) => {
            const agentName = getAutonomyAgentName(action.droneId);
            appendOrchestratorRecord(
                'action',
                action.reason,
                agentName
            );
        });

    if (running && tick > 0 && tick % ORCHESTRATOR_THINK_INTERVAL_TICKS === 0) {
        const sessionId = req.headers['x-session-id'] as string || 'default';
        void runPeriodicOrchestratorThink(sessionId, tick);
    }
    
    res.json({
        success: true,
        tick,
        running,
        autonomy,
    });
});

// Reset state
app.post('/api/state/reset', (req, res) => {
    droneStore.reset();
    
    res.json({
        success: true,
        message: 'State reset'
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// FRONTEND STATIC BUNDLE SERVING (FOR MONOLITHIC DEPLOYMENT)
// ═══════════════════════════════════════════════════════════════════════════

// The monolithic container compiles the Vite app into the root /dist directory.
// The built server process runs from /server/dist. Therefore, we navigate up twice.
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath, {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Enable React Router SPA support by returning the index file for unknown non-API routes.
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                     FirstLight MCP Server                                  ║
║═══════════════════════════════════════════════════════════════════════════║
║  Status: Online                                                            ║
║  Port: ${PORT}                                                               ║
║                                                                            ║
║  Endpoints:                                                                ║
║    GET  /api/status              - Server status                           ║
║    GET  /api/tools               - List all MCP tools                      ║
║    POST /api/tools/:toolName     - Execute a tool                          ║
║    POST /api/mcp                 - MCP JSON-RPC endpoint                   ║
║    POST /mcp                     - MCP JSON-RPC endpoint (alias)           ║
║    GET  /api/commands            - Get pending commands                    ║
║                                                                            ║
║  State Sync (Frontend → Server):                                           ║
║    POST /api/state/drones        - Sync drone states                       ║
║    POST /api/state/grid          - Sync grid state                         ║
║    POST /api/state/tick          - Sync simulation tick                    ║
║                                                                            ║
║  Available Tool Modules:                                                   ║
║    • Drone (6 tools): Status, targeting, mode control                      ║
║    • Scan (4 tools): Sector queries, heatmap access                        ║
║    • Communication (3 tools): Network status, connectivity                 ║
║    • Mission (7 tools): Swarm status, mission control + run/pause          ║
║    • SwarmIntel (3 tools): Urgency, hotspot, assignment insights           ║
║    • Orchestration (4 tools): Plan validation + batch policy actions       ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
});

export default app;
