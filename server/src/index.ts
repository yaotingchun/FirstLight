/**
 * FirstLight MCP Server
 * 
 * HTTP API server that exposes MCP tools for manual function calling.
 * This allows the frontend to invoke tools via button clicks while
 * an AI orchestration layer is being developed.
 * 
 * Endpoints:
 * - GET  /api/status          - Server status
 * - GET  /api/tools           - List all available tools
 * - POST /api/tools/:toolName - Execute a tool
 * - GET  /api/commands        - Get pending commands (for frontend polling)
 * - POST /api/commands/:id/ack - Acknowledge command processed
 * - POST /api/state/sync      - Sync state from frontend
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { executeTool, listTools, getToolSchema } from './tools/index.js';
import { droneStore, sessionStores, DroneStore, storeContext } from './droneStore.js';
import { processOrchestratorChat, getOrchestratorRecords, clearOrchestratorRecords, appendOrchestratorRecord } from './orchestratorChat.js';
import { localAutonomy } from './simulation/localAutonomy.js';
import type { DroneStatus, SectorScanResult, CommLink, SurvivorInfo } from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;
const ORCHESTRATOR_THINK_INTERVAL_TICKS = parseInt(process.env.ORCHESTRATOR_THINK_INTERVAL_TICKS ?? '30', 10);

function getAutonomyAgentName(droneId: string): string {
    if (droneId.startsWith('RLY-')) return 'Agent Relay';
    if (droneId.includes('Alpha')) return 'Agent Alpha';
    if (droneId.includes('Beta')) return 'Agent Beta';
    if (droneId.includes('Gamma')) return 'Agent Gamma';
    if (droneId.includes('Delta')) return 'Agent Delta';
    return 'Agent';
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
        const result = await processOrchestratorChat(
            'Periodic strategic review: evaluate global mission progress, battery posture, relay network health, hotspot coverage, and survivor search efficiency. Issue actions only if meaningful intervention is required; otherwise use no_action with a short reason.'
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
    if (!req.path.startsWith('/api')) {
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

// Orchestrator chat endpoint (frontend AI chat)
app.post('/api/orchestrator/chat', async (req, res) => {
    const { message } = req.body as { message?: string };

    if (!message || !message.trim()) {
        res.status(400).json({
            success: false,
            error: 'message is required',
            timestamp: Date.now()
        });
        return;
    }

    const result = await processOrchestratorChat(message.trim());
    res.json(result);
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
