/**
 *  chat.ts — Interactive Chat Mode for testing the AI Orchestrator
 *
 *  Lets you talk to the rescue AI in real-time:
 *    - Type messages to ask questions or give instructions
 *    - Use built-in commands to manipulate the simulation state
 *    - See exactly how the AI reasons and what actions it picks
 *
 *  Usage:  npm run orchestrator:chat
 *
 *  Commands:
 *    /tick                Run one AI decision tick on current state
 *    /status              Show current drone & grid status
 *    /drain <id> <pct>    Set a drone's battery  (e.g. /drain D3 15)
 *    /kill <id>           Deactivate a drone      (e.g. /kill D5)
 *    /hotspot <r> <c> <p> Inject a hotspot        (e.g. /hotspot 3 15 0.95)
 *    /reset               Reset simulation to fresh state
 *    /help                Show this help
 *    /exit                Quit
 *
 *  Or just type a free-form message — the AI will respond as the
 *  rescue commander, using the current environment as context.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { createChatModel } from './vertexClient.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { buildEnvironmentSnapshot } from './snapshotBuilder.js';
import { executeDecision } from './actionExecutor.js';
import {
    initializeSwarm,
    generateShiftedHeatmap,
    GRID_W,
    GRID_H,
    type SearchDrone,
} from '../utils/swarmRouting.js';
import { gridDataService, INITIAL_SENSORS, type TerrainGrid, type TerrainType } from '../services/gridDataService.js';
import type { MissionObjective, SensorTrend, TrendDirection } from './types.js';

// ── State ───────────────────────────────────────────────────────────────────
let heatmap = generateShiftedHeatmap();
let { drones } = initializeSwarm(heatmap);
let tickNumber = 0;
let latestVisionResult: string | undefined = undefined;
const scannedHotspots = new Set<string>(); // "r,c" to prevent redundant photos
let simulationRunning = false;
let autonomousMode = true; // AI will auto-tick when simulation is running
let lastAutoTickTime = 0;
const AUTO_TICK_INTERVAL_MS = 10000; // AI thinks every 10 seconds of sim time

let isLiveMode = true;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';

const objectives: MissionObjective[] = [];
const sensorHistory: any[] = []; // sliding window of sensor weights
const MAX_HISTORY = 5;

const terrainGrid: TerrainGrid = Array.from({ length: GRID_H }, () =>
    new Array<TerrainType>(GRID_W).fill('Open Field'),
);

// Backup for Live Mode toggling
let localDronesBackup: SearchDrone[] = [];
let localHeatmapBackup: number[][] = [];
let localTickBackup: number = 0;

// ── Gemini model (with chat history) ────────────────────────────────────────
const model = createChatModel(0.3);

type ChatMessage = { role: 'user' | 'model'; parts: { text: string }[] };
const chatHistory: ChatMessage[] = [];

const calculateSensorTrends = (): SensorTrend[] => {
    if (sensorHistory.length < 2) return [];
    
    const latest = sensorHistory[sensorHistory.length - 1];
    const previous = sensorHistory[sensorHistory.length - 2];
    
    return (Object.keys(latest) as (keyof typeof latest)[]).map(key => {
        const diff = latest[key].conf - previous[key].conf;
        let direction: TrendDirection = 'stable';
        if (diff > 0.05) direction = 'increasing';
        else if (diff < -0.05) direction = 'decreasing';
        
        return { sensor: key as any, direction };
    });
};

/**
 * Send a message to Gemini with the full chat history for context.
 * Optionally includes base64 image data for multimodal vision tasks.
 */
const sendToGemini = async (userMessage: string, imageBase64?: string): Promise<string> => {
    // Always build a fresh snapshot so the AI has current state
    const snapshot = buildEnvironmentSnapshot(
        heatmap, terrainGrid, INITIAL_SENSORS, drones, tickNumber, 10, latestVisionResult, objectives, calculateSensorTrends(), simulationRunning
    );

    // Prepend the state summary to every message so Gemini never loses context
    const contextMessage = `=== CURRENT STATE SUMMARY ===
${snapshot.summary}

=== DRONE DETAILS ===
${snapshot.drones.map(d =>
    `${d.id}: pos=(${d.x},${d.y}) battery=${d.battery}% active=${d.active} region=[${d.assignedRegion.xMin}-${d.assignedRegion.xMax}, ${d.assignedRegion.yMin}-${d.assignedRegion.yMax}] scanRemaining=${d.scanQueueRemaining}`
).join('\n')}

=== OPERATOR MESSAGE ===
${userMessage}

Answer the operator's question using the state data above. Be precise with numbers.`;

    const parts: any[] = [{ text: contextMessage }];
    if (imageBase64) {
        parts.push({
            inlineData: {
                data: imageBase64,
                mimeType: "image/jpeg"
            }
        });
    }

    chatHistory.push({ role: 'user', parts });

    const result = await model.generateContent({
        systemInstruction: {
            role: 'system',
            parts: [{
                text: SYSTEM_PROMPT + `\n\nYou are in INTERACTIVE CHAT MODE. The operator may ask free-form questions. Answer conversationally but stay in character as the rescue AI commander. Use the STATE SUMMARY as your source of truth for all numbers. When the operator sends a tick snapshot, respond with the standard JSON action format. For questions, respond naturally in plain text.`
            }],
        },
        contents: chatHistory,
    });

    const reply = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '(no response)';
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    return reply;
};

const simulateDroneTick = (droneList: SearchDrone[]): SearchDrone[] => {
    return droneList.map(d => {
        if (!d.active) return d;

        // Recharge at base or drain battery slightly
        const isAtBase = d.x === 10 && d.y === 19; // BASE_X, BASE_Y
        const newBattery = isAtBase ? Math.min(100, d.battery + 5) : Math.max(0, d.battery - 0.3);
        
        if (newBattery <= 0) {
            return { ...d, battery: 0, active: false };
        }

        // Move along path if there is one
        if (d.path && d.path.length > 0 && d.pathIndex < d.path.length) {
            const next = d.path[d.pathIndex];
            return {
                ...d,
                x: next.x,
                y: next.y,
                pathIndex: d.pathIndex + 1,
                battery: newBattery,
            };
        }

        // If path exhausted, advance scan queue
        if (d.scanQueue && d.scanQueue.length > 0 && d.scanQueueIndex < d.scanQueue.length) {
            const nextTarget = d.scanQueue[d.scanQueueIndex];
            return {
                ...d,
                x: nextTarget.x,
                y: nextTarget.y,
                scanQueueIndex: d.scanQueueIndex + 1,
                battery: newBattery,
            };
        }

        return { ...d, battery: newBattery };
    });
};

/**
 * Fetch real-time state from the MCP server and sync the local state.
 * Returns true if successful.
 */
const syncSwarmState = async (): Promise<boolean> => {
    try {
        const [swarmRes, gridRes, statsRes] = await Promise.all([
            fetch(`${MCP_SERVER_URL}/api/tools/getSwarmStatus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }),
            fetch(`${MCP_SERVER_URL}/api/tools/getGridHeatmap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }),
            fetch(`${MCP_SERVER_URL}/api/tools/getMissionStats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
        ]);

        const swarmData: any = await swarmRes.json();
        const gridData: any = await gridRes.json();
        const statsData: any = await statsRes.json();
        
        if (swarmData.success && swarmData.data) {
            drones = swarmData.data.drones.map((d: any) => ({
                id: d.id,
                x: d.position.x,
                y: d.position.y,
                battery: d.battery,
                active: d.isActive,
                mode: d.mode,
                regionXMin: d.assignedRegion?.xMin ?? 0,
                regionXMax: d.assignedRegion?.xMax ?? 19,
                regionYMin: d.assignedRegion?.yMin ?? 0,
                regionYMax: d.assignedRegion?.yMax ?? 19,
                path: [],
                pathIndex: 0,
                scanQueue: [],
                scanQueueIndex: 0
            }));
        }

        if (gridData.success && gridData.data) {
            heatmap = gridData.data.cells;
        }

        if (statsData.success && statsData.data) {
            tickNumber = statsData.data.currentTick;
            simulationRunning = statsData.data.simulationRunning;
        }

        if (drones.length === 0) {
            console.log(red('⚠ Warning: No drones found in live simulation!'));
            console.log(yellow('  👉 Ensure you have the React Dashboard open at http://localhost:3000'));
            console.log(yellow('  👉 Check if "MCP ONLINE" is visible in the top header of the dashboard.'));
        }

        return true;
    } catch (err) {
        console.log(red(`❌ Live Sync Failed: ${err}`));
        return false;
    }
};

/**
 * Build and send a tick — same as the orchestrator but in chat context.
 */
const runTickInChat = async (): Promise<void> => {
    tickNumber++;

    if (isLiveMode) {
        console.log(cyan('\n🌐 Live Mode: Syncing with MCP server...'));
        const success = await syncSwarmState();
        if (!success) {
            console.log(red('❌ Sync Failure: Cannot proceed with tick without live data.'));
            console.log(yellow('  👉 Check if MCP server and Dashboard are running.'));
            return;
        }
        console.log(green('✔ State synced with live simulation.'));
    } else {
        // Advanced users can still use local mode via /live toggle
        drones = simulateDroneTick(drones as SearchDrone[]);
    }

    // Update sensor history for trend analysis
    sensorHistory.push({ ...INITIAL_SENSORS });
    if (sensorHistory.length > MAX_HISTORY) sensorHistory.shift();

    const snapshot = buildEnvironmentSnapshot(
        heatmap, terrainGrid, INITIAL_SENSORS, drones, tickNumber, 10, latestVisionResult, objectives, calculateSensorTrends(), simulationRunning
    );

    const userPrompt = buildUserPrompt(snapshot);
    console.log(dim(`\n📡 Sending environment snapshot (tick #${tickNumber}) to Gemini...\n`));

    const reply = await sendToGemini(userPrompt);
    printAIResponse(reply);
    await processAIResponse(reply);
};

/**
 * Attempt to parse an AI response as JSON and execute any actions.
 */
const processAIResponse = async (reply: string) => {
    try {
        let cleaned = reply.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        const decision = JSON.parse(cleaned);
        
        if (decision.actions && Array.isArray(decision.actions)) {
            const { result, drones: updatedDrones } = await executeDecision(decision, drones as SearchDrone[], heatmap, isLiveMode);
            drones = updatedDrones;
            
            console.log(`\n[Executor] Executed: ${result.executed}, Skipped: ${result.skipped}`);
            for (const line of result.log) {
                console.log(`  ${line}`);
            }

            // Handle Photo Analysis 
            if (result.imageCaptureRequests && result.imageCaptureRequests.length > 0) {
                for (const req of result.imageCaptureRequests) {
                    console.log(cyan(`\n📷 Processing image capture for ${req.droneId} at (${req.x}, ${req.y})...`));
                    try {
                        const prob = heatmap[req.x]?.[req.y] ?? 0;
                        let imgName = 'empty.png';
                        
                        // Smart selection: if prob is high, show the survivor. 
                        const cellKey = `${req.x},${req.y}`;
                        if (scannedHotspots.has(cellKey)) {
                            console.log(dim(`ℹ Skipping capture at (${req.x},${req.y}) — already analyzed.`));
                            continue;
                        }
                        scannedHotspots.add(cellKey);

                        if (prob > 0.8) {
                            imgName = Math.random() > 0.5 ? 'survivor.png' : 'survivor_rubble_1773370032174.png';
                        } else if (prob > 0.5) {
                            imgName = Math.random() > 0.5 ? 'thermal.png' : 'thermal_survivor_1773370074579.png';
                        }

                        const imgPath = path.resolve('mock_images', imgName);
                        if (!fs.existsSync(imgPath)) {
                            throw new Error(`Image file not found: ${imgName}`);
                        }

                        const imgData = fs.readFileSync(imgPath).toString('base64');
                        const prompt = `Critically analyze this image just captured by drone ${req.droneId} at hotspot (${req.x}, ${req.y}) where probability of survivor is ${prob.toFixed(3)}. Does it contain any human survivors or thermal signatures? Briefly report your findings, and if there is a survivor, you must immediately output a deploy_team JSON action.`;
                        
                        console.log(dim(`📡 Sending ${imgName} (prob=${prob.toFixed(2)}) to Gemini Vision model for analysis...\n`));
                        const visionReply = await sendToGemini(prompt, imgData);
                        printAIResponse(visionReply);
                        
                        // Store the result for context in follow-up questions
                        latestVisionResult = `[Drone ${req.droneId} at (${req.x},${req.y})] ${visionReply}`;

                        // If the vision analysis resulted in a follow-up action (e.g. deploy_team)
                        await processAIResponse(visionReply);
                    } catch (err) {
                        console.log(red(`❌ Failed to process drone photo: ${err}`));
                    }
                }
            }
        }
    } catch (e) {
        // If it's not JSON, it might just be the AI chatting, ignore parsing errors
    }
};

// ── Display helpers ─────────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const printAIResponse = (text: string) => {
    console.log(`\n${cyan('🤖 FirstLight AI:')}`);
    
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
        const json = JSON.parse(cleaned);
        if (json.reasoning) {
            console.log(`${bold('Reasoning:')}`);
            // Format reasoning: replace literal \n and clean up whitespace
            const formattedReasoning = json.reasoning.replace(/\\n/g, '\n').trim();
            console.log(dim(formattedReasoning));
        }
        
        if (json.actions && Array.isArray(json.actions)) {
            console.log(`\n${bold('Actions:')} [Priority: ${json.priority?.toUpperCase() || 'MEDIUM'}]`);
            for (const a of json.actions) {
                const detail = a.type === 'move_drone' ? ` → (${a.x},${a.y})` : '';
                const reason = a.reason ? ` — ${a.reason}` : '';
                console.log(`  ${green('✔')} ${bold(a.type)}${detail}${reason}`);
            }
        }
    } catch (e) {
        // Not JSON or failed to parse, just print as-is
        console.log(text.replace(/\\n/g, '\n'));
    }
    console.log('');
};

const printStatus = () => {
    console.log(`\n${bold('═══ Current State ═══')} ${isLiveMode ? green('[LIVE LINK ACTIVE]') : yellow('[LOCAL SIM MODE]')}`);
    if (isLiveMode) {
        console.log(dim('  (Live data from React Dashboard)'));
    }
    console.log(`Tick: ${tickNumber}  |  Grid: ${GRID_W}×${GRID_H}`);
    console.log(`\n${bold('Drones:')}`);
    for (const d of drones) {
        const batteryColor = d.battery > 50 ? green : d.battery > 20 ? yellow : red;
        const status = d.active ? green('ACTIVE') : red('OFFLINE');
        console.log(
            `  ${d.id}: pos=(${d.x},${d.y}) battery=${batteryColor(d.battery.toFixed(1) + '%')} ${status} region=[${d.regionXMin}-${d.regionXMax}, ${d.regionYMin}-${d.regionYMax}]`
        );
    }

    // Top 5 hotspots
    const cells: { r: number; c: number; p: number }[] = [];
    for (let r = 0; r < GRID_H; r++) {
        for (let c = 0; c < GRID_W; c++) {
            cells.push({ r, c, p: heatmap[r]?.[c] ?? 0 });
        }
    }
    cells.sort((a, b) => b.p - a.p);
    console.log(`\n${bold('Top 5 Hotspots:')}`);
    for (const h of cells.slice(0, 5)) {
        const color = h.p >= 0.7 ? red : h.p >= 0.4 ? yellow : green;
        console.log(`  Cell (${h.r},${h.c}) -> ${color(h.p.toFixed(3))}`);
    }
    console.log('');
};

const printHelp = () => {
    console.log(`
${bold('Commands:')}
  ${green('/live')}                Toggle Live Link to React Dashboard
  ${green('/auto')}                Toggle autonomous AI mode (AI ticks follow dashboard button)
  ${green('/tick')}                Run one AI decision cycle
  ${green('/status')}              Show drone fleet & hotspot summary
  ${green('/drain')} ${dim('<id> <pct>')}    Set drone battery  ${dim('e.g. /drain D3 15')}
  ${green('/kill')} ${dim('<id>')}           Deactivate a drone  ${dim('e.g. /kill D5')}
  ${green('/hotspot')} ${dim('<r> <c> <p>')} Inject a hotspot    ${dim('e.g. /hotspot 3 15 0.95')}
  ${green('/reset')}               Reset simulation
  ${green('/help')}                Show this help
  ${green('/exit')}                Quit

  ${dim('Or type any message to chat with the AI directly.')}
`);
};

// ── Command handlers ────────────────────────────────────────────────────────
const handleCommand = async (input: string): Promise<boolean> => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
        case '/live':
            if (!isLiveMode) {
                // Enabling Live Mode: Backup local state
                localDronesBackup = [...drones as SearchDrone[]];
                localHeatmapBackup = heatmap.map(row => [...row]);
                localTickBackup = tickNumber;

                isLiveMode = true;
                console.log(green('🔌 Live Link Enabled. AI will now read from and control your React Dashboard!'));
                console.log(dim('  (Synchronizing drone IDs with Dashboard...)'));
                await syncSwarmState();
            } else {
                // Disabling Live Mode: Restore local state
                isLiveMode = false;
                drones = localDronesBackup;
                heatmap = localHeatmapBackup;
                tickNumber = localTickBackup;
                console.log(yellow('🔌 Live Link Disabled. Reverting to local simulation state.'));
            }
            printStatus();
            return true;

        case '/tick':
            await runTickInChat();
            return true;

        case '/auto':
            autonomousMode = !autonomousMode;
            console.log(autonomousMode 
                ? green('🤖 Autonomous Mode ENABLED. AI will automatically tick when simulation is running.') 
                : yellow('🤖 Autonomous Mode DISABLED. You must manually type /tick.'));
            return true;

        case '/status':
            printStatus();
            return true;

        case '/drain': {
            const id = parts[1]?.toUpperCase();
            const pct = parseFloat(parts[2]);
            const drone = drones.find(d => d.id === id);
            if (!drone || isNaN(pct)) {
                console.log(red('Usage: /drain <droneId> <batteryPercent>  e.g. /drain D3 15'));
                return true;
            }
            drone.battery = Math.max(0, Math.min(100, pct));
            if (drone.battery === 0) drone.active = false;
            console.log(yellow(`⚡ ${drone.id} battery set to ${drone.battery}%${drone.active ? '' : ' — OFFLINE'}`));
            return true;
        }

        case '/kill': {
            const id = parts[1]?.toUpperCase();
            const drone = drones.find(d => d.id === id);
            if (!drone) {
                console.log(red('Usage: /kill <droneId>  e.g. /kill D5'));
                return true;
            }
            drone.active = false;
            console.log(red(`💥 ${drone.id} deactivated`));
            return true;
        }

        case '/hotspot': {
            const r = parseInt(parts[1]);
            const c = parseInt(parts[2]);
            const p = parseFloat(parts[3]);
            if (isNaN(r) || isNaN(c) || isNaN(p) || r < 0 || r >= GRID_H || c < 0 || c >= GRID_W) {
                console.log(red('Usage: /hotspot <row> <col> <probability>  e.g. /hotspot 3 15 0.95'));
                return true;
            }
            heatmap[r][c] = Math.max(0, Math.min(1, p));
            console.log(yellow(`🔥 Hotspot injected at (${r},${c}) with probability ${heatmap[r][c].toFixed(3)}`));
            return true;
        }

        case '/objective': {
            const priority = (['low', 'medium', 'high', 'critical'].includes(parts[parts.length - 1]) 
                ? parts.pop() 
                : 'medium') as any;
            const desc = parts.slice(1).join(' ');
            if (!desc) {
                console.log(red('Usage: /objective <description> [priority]  e.g. /objective "Find hiker" high'));
                return true;
            }
            objectives.push({
                id: `OBJ-${objectives.length + 1}`,
                description: desc,
                priority,
                status: 'active'
            });
            console.log(cyan(`🎯 Objective added: [${priority.toUpperCase()}] ${desc}`));
            return true;
        }

        case '/reset':
            heatmap = generateShiftedHeatmap();
            ({ drones } = initializeSwarm(heatmap));
            tickNumber = 0;
            chatHistory.length = 0;
            console.log(green('🔄 Simulation reset — fresh heatmap, drones at base, chat cleared.'));
            return true;

        case '/help':
            printHelp();
            return true;

        case '/exit':
        case '/quit':
            console.log(dim('Goodbye! 👋'));
            process.exit(0);

        default:
            return false; // not a command — treat as chat message
    }
};

// ── Main REPL ───────────────────────────────────────────────────────────────
const main = async () => {
    console.log('');
    console.log(bold('┌─────────────────────────────────────────────────────┐'));
    console.log(`${bold('│')}  🚁  ${cyan('FirstLight AI — Interactive Chat Mode')}          ${bold('│')}`);
    console.log(`${bold('│')}  Powered by Google Vertex AI (Gemini)               ${bold('│')}`);
    console.log(`${bold('│')}  Project: ${process.env.GOOGLE_VERTEX_PROJECT || 'firstlight-490016'}              ${bold('│')}`);
    console.log(bold('├─────────────────────────────────────────────────────┤'));
    console.log(`${bold('│')}  Type a message to chat with the rescue AI.         ${bold('│')}`);
    console.log(`${bold('│')}  Type ${green('/help')} for commands.   Type ${green('/exit')} to quit. ${bold('│')}`);
    console.log(bold('└─────────────────────────────────────────────────────┘'));
    console.log('');

    console.log(dim('Initializing grid mapping service...'));

    gridDataService.onTerrainReady(() => {
        // Refresh local heatmap with OSM data
        heatmap = gridDataService.getWeights();
        // Re-init swarm with fresh heatmap
        ({ drones } = initializeSwarm(heatmap));
        // Initial sync for Live Mode
        if (isLiveMode) {
            console.log(dim('Synchronizing with MCP server on startup...'));
            syncSwarmState().then(() => {
                printStatus();
            });
        } else {
            printStatus();
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${bold('You >')} `,
        });

        rl.prompt();

        rl.on('line', async (line: string) => {
            const input = line.trim();
            if (!input) { rl.prompt(); return; }

            try {
                if (input.startsWith('/')) {
                    const handled = await handleCommand(input);
                    if (!handled) {
                        console.log(red(`Unknown command: ${input}. Type /help for commands.`));
                    }
                } else {
                    // Free-form chat with AI
                    console.log(dim('\n📡 Sending to Gemini...\n'));
                    const reply = await sendToGemini(input);
                    printAIResponse(reply);
                    await processAIResponse(reply);
                }
            } catch (err) {
                console.error(red(`\n❌ Error: ${err}`));
            }

            rl.prompt();
        });

        // Background loop for sync and autonomous ticks
        setInterval(async () => {
            if (isLiveMode) {
                const prevRunning = simulationRunning;
                await syncSwarmState();
                
                // If just started or is running and enough time passed
                const now = Date.now();
                if (autonomousMode && simulationRunning) {
                    if (!prevRunning || (now - lastAutoTickTime > AUTO_TICK_INTERVAL_MS)) {
                        console.log(cyan('\n[Auto] Dashboard is RUNNING. Triggering autonomous decision...'));
                        lastAutoTickTime = now;
                        await runTickInChat();
                        rl.prompt();
                    }
                }
            }
        }, 2000);

        rl.on('close', () => {
            console.log(dim('\nGoodbye! 👋'));
            process.exit(0);
        });
    });
};

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
