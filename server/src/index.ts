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
import { executeTool, listTools, getToolSchema } from './tools/index.js';
import { droneStore } from './droneStore.js';
import { orchestratorEngine } from './simulation/orchestratorEngine.js';
import { processOrchestratorChat, getOrchestratorRecords, clearOrchestratorRecords } from './orchestratorChat.js';
import type { DroneStatus, SectorScanResult, CommLink, SurvivorInfo } from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Server status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        version: '1.0.0',
        timestamp: Date.now(),
        simulationRunning: droneStore.isSimulationRunning(),
        currentTick: droneStore.getCurrentTick(),
        dronesOnline: droneStore.getAllDrones().filter(d => d.isActive).length
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
// MULTI-AGENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Get multi-agent state (tasks, assignments, chat log)
app.get('/api/multiagent/state', (req, res) => {
    const state = droneStore.getMultiAgentState();
    res.json({
        success: true,
        state
    });
});

// Trigger multi-agent tick from frontend
app.post('/api/multiagent/tick', (req, res) => {
    const { tick, drones } = req.body as { tick: number; drones: DroneStatus[] };
    
    if (typeof tick !== 'number' || !Array.isArray(drones)) {
        res.status(400).json({ success: false, error: 'tick and drones array required' });
        return;
    }

    droneStore.checkRelaySwapStatus(drones);
    const newAssignments = orchestratorEngine.tick(tick, drones);

    res.json({
        success: true,
        assignments: newAssignments
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
    
    res.json({
        success: true,
        tick,
        running
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
║  Multi-Agent API:                                                          ║
║    GET  /api/multiagent/state    - Get multi-agent state                   ║
║    POST /api/multiagent/tick     - Trigger bidding round                   ║
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
