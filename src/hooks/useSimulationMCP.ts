import { useState, useEffect, useRef, useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import * as mcpClient from '../services/mcpClient';
import type { Sector, Drone, FoundPin, OrchestratorChatMessage } from '../types/simulation';
import { BASE_STATION, GRID_W, GRID_H } from '../types/simulation';
import type { SensorWeights } from '../services/gridDataService';

export const useSimulationMCP = (
    timeRef: MutableRefObject<number>,
    running: boolean,
    setRunning: Dispatch<SetStateAction<boolean>>,
    dronesRef: MutableRefObject<Drone[]>,
    gridRef: MutableRefObject<Sector[][]>,
    pinsRef: MutableRefObject<FoundPin[]>,
    autoRecallThresholdsRef: MutableRefObject<Map<string, number>>,
    relayTakeoverTargetRef: MutableRefObject<{ x: number, y: number }>,
    sensorWeightsRef: MutableRefObject<SensorWeights>,
    metricsRef: MutableRefObject<any>,
    resetSim: () => void,
    aiBusyRef: MutableRefObject<boolean>,
    survivorsRef: MutableRefObject<any[]>,
    searchArea: Array<{ x: number; y: number }>,
    selectedCells: Array<{ x: number; y: number }>,
    missionOverride: boolean,
    timeLimit: number,
    useTimeLimit: boolean
) => {
    const [mcpConnected, setMcpConnected] = useState(false);
    const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
    const [mcpToolOutput, setMcpToolOutput] = useState<string>('');
    const [mcpSelectedTool, setMcpSelectedTool] = useState<string>('getSwarmStatus');
    const [mcpToolParams, setMcpToolParams] = useState<string>('{}');
    const [chatOpen, setChatOpen] = useState(false);

    // Chat UI state
    const [chatPos, setChatPos] = useState({ x: 0, y: 0 });
    const chatDragRef = useRef({ isDragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
    const [chatSize, setChatSize] = useState({ width: 420, height: 420 });
    const chatResizeRef = useRef({ isResizing: false, startWidth: 0, startHeight: 0, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });
    const [chatInput, setChatInput] = useState('');
    const [chatSending, setChatSending] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const processMcpCommandsRef = useRef<() => Promise<void>>(async () => { });
    const syncedSurvivorIdsRef = useRef<Set<string>>(new Set());
    const bootstrappedServerStateRef = useRef(false);
    const [chatMessages, setChatMessages] = useState<OrchestratorChatMessage[]>([]);

    useEffect(() => {
        if (!chatOpen) return;
        const el = chatScrollRef.current;
        if (!el) return;
        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    }, [chatMessages, chatOpen]);

    useEffect(() => {
        const checkConnection = async () => {
            const status = await mcpClient.getServerStatus();
            setMcpConnected(!!status);
        };
        checkConnection();
        const interval = setInterval(checkConnection, 5000);
        return () => clearInterval(interval);
    }, []);

    const executeMcpTool = async () => {
        try {
            const params = JSON.parse(mcpToolParams);
            const result = await mcpClient.executeTool(mcpSelectedTool, params);
            setMcpToolOutput(JSON.stringify(result, null, 2));
        } catch (error) {
            setMcpToolOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const runOrchestratorPrompt = useCallback(async (message: string, source: 'user' | 'auto' = 'user') => {
        const trimmed = message.trim();
        if (!trimmed || aiBusyRef.current) return;

        aiBusyRef.current = true;
        setChatSending(true);

        if (source === 'user') {
            setChatMessages(prev => [...prev, { role: 'user', text: trimmed }]);
        } else {
            setChatMessages(prev => [...prev, { role: 'system', text: 'Auto-think: AI is evaluating current swarm state...' }]);
        }

        const result = await mcpClient.orchestratorChat(trimmed);

        if (!result.success) {
            setChatMessages(prev => [...prev, { role: 'system', text: `Error: ${result.error ?? 'Unknown error'}` }]);
            setChatSending(false);
            aiBusyRef.current = false;
            return;
        }

        const decision = result.decision;
        if (decision) {
            const actions = (decision.actions ?? []).filter(a => a.type !== 'no_action');
            const normalizedReasoning = decision.reasoning
                .replace(/\b[Tt]he user has requested\b/g, 'Mission context indicates')
                .replace(/\b[Tt]he user requested\b/g, 'Mission context indicates')
                .replace(/\b[Ii] will\b/g, 'AI will');

            const actionSummary = actions
                .map((a) => {
                    const type = String(a.type ?? 'unknown');
                    if (type === 'move_drone') {
                        return `${type}(${String(a.droneId ?? '?')} -> ${String(a.x ?? '?')},${String(a.y ?? '?')})`;
                    }
                    if (type === 'set_drone_mode') {
                        return `${type}(${String(a.droneId ?? '?')} -> ${String(a.mode ?? '?')})`;
                    }
                    if (type === 'recall_drone') {
                        return `${type}(${String(a.droneId ?? '?')})`;
                    }
                    if (type === 'move_relay') {
                        return `${type}(${String(a.relayId ?? '?')} -> ${String(a.x ?? '?')},${String(a.y ?? '?')})`;
                    }
                    if (type === 'replace_relay') {
                        return `${type}(${String(a.relayId ?? '?')})`;
                    }
                    if (type === 'broadcast_swarm') {
                        return `${type}(${String(a.command ?? '?')})`;
                    }
                    if (type === 'deploy_team') {
                        return `${type}(${String(a.x ?? '?')},${String(a.y ?? '?')})`;
                    }
                    if (type === 'set_simulation_state') {
                        return `${type}(${String(a.running ?? '?')})`;
                    }
                    return type;
                })
                .join('\n- ');

            const logMessage = [
                `[TICK: ${String(timeRef.current).padStart(4, '0')}]`,
                `PRIORITY: ${(decision.priority ?? 'medium').toUpperCase()}`,
                `ANALYSIS: ${normalizedReasoning}`,
                ...(actions.length > 0 ? [`COMMANDS:\n- ${actionSummary}`] : [])
            ].join('\n');

            setChatMessages(prev => {
                const cleaned = prev.filter(m => !m.text.startsWith('Auto-think:'));
                return [
                    ...cleaned,
                    {
                        role: 'ai',
                        text: logMessage
                    }
                ];
            });
        } else {
            const replyText = result.reply;
            if (replyText) {
                setChatMessages(prev => {
                    const cleaned = prev.filter(m => !m.text.startsWith('Auto-think:'));
                    return [...cleaned, { role: 'ai', text: replyText }];
                });
            }
        }

        const executionLog = result.executionLog;
        if (executionLog && executionLog.length > 0) {
            setChatMessages(prev => [...prev, { role: 'system', text: `Executed: ${executionLog.join(' | ')}` }]);
        }

        // Apply queued MCP commands immediately after AI response.
        // This avoids waiting for connection polling to flip mcpConnected.
        await processMcpCommandsRef.current();

        setChatSending(false);
        aiBusyRef.current = false;
    }, [aiBusyRef]);

    const sendChatMessage = useCallback(async () => {
        const message = chatInput.trim();
        if (!message || chatSending) return;
        setChatInput('');
        await runOrchestratorPrompt(message, 'user');
    }, [chatInput, chatSending, runOrchestratorPrompt]);

    const runThinkNow = useCallback(async () => {
        await runOrchestratorPrompt(
            'Evaluate current swarm state. Recall any drone with battery below 20% immediately. Then assign remaining drones to improve search coverage. Output JSON actions only.',
            'auto'
        );
    }, [runOrchestratorPrompt]);

    const syncToMcp = useCallback(async (forceMcpConnected = false) => {
        if (!mcpConnected && !forceMcpConnected) return;

        const drones = dronesRef.current;
        const grid = gridRef.current;
        const hasActiveCustomArea = missionOverride && searchArea.length >= 3 && selectedCells.length > 0;
        const selectedCellKeySet = new Set(selectedCells.map(c => `${c.x},${c.y}`));

        const droneStates: mcpClient.DroneStateForSync[] = drones.map(d => ({
            id: d.id,
            position: {
                x: d.x,
                y: d.y,
                gridCell: String.fromCharCode(65 + Math.floor(d.x)) + (Math.floor(d.y) + 1)
            },
            target: d.tx !== undefined ? {
                x: d.tx,
                y: d.ty,
                gridCell: String.fromCharCode(65 + Math.floor(d.tx)) + (Math.floor(d.ty) + 1)
            } : null,
            mode: d.mode,
            battery: d.battery,
            isConnected: d.isConnected,
            isActive: d.mode !== 'Charging' || d.battery > 0,
            assignedRegion: null
        }));

        await mcpClient.syncDroneStates(droneStates);
        await mcpClient.syncTick(timeRef.current, running);

        const gridState = grid.map(row => row.map(s => {
            const inCustomArea = !hasActiveCustomArea || selectedCellKeySet.has(`${s.x},${s.y}`);

            return {
                gridCell: String.fromCharCode(65 + s.x) + (s.y + 1),
                x: s.x,
                y: s.y,
                probability: inCustomArea ? s.prob : 0,
                pheromone: inCustomArea ? s.pheromone : 0,
                terrain: s.terrain,
                scanned: inCustomArea ? s.scanned : true,
                lastScannedTick: s.lastScanned,
                disasterImage: s.disasterImage,
                signals: s.signals
            };
        }));
        await mcpClient.syncGridState(gridState);

        // Ensure survivor discoveries made by the simulation are reflected in MCP mission stats.
        for (const pin of pinsRef.current) {
            if (syncedSurvivorIdsRef.current.has(pin.id)) continue;

            const synced = await mcpClient.syncSurvivor({
                id: pin.id,
                x: pin.x,
                y: pin.y,
                droneId: 'SYSTEM',
                message: pin.info?.message || 'Survivor confirmed',
                tick: timeRef.current,
            });

            if (synced) {
                syncedSurvivorIdsRef.current.add(pin.id);
            }
        }

        if (mcpConnected) {
            const totalScannedCells = grid.reduce((sum, row) => sum + row.filter(sec => sec.scanned).length, 0);
            const areaScannedCells = selectedCells.reduce((sum, cell) => sum + (grid[cell.y]?.[cell.x]?.scanned ? 1 : 0), 0);
            const maskedTotalUniqueScans = hasActiveCustomArea ? areaScannedCells : totalScannedCells;
            const maskedGridSize = hasActiveCustomArea ? selectedCells.length : GRID_W * GRID_H;

            await mcpClient.executeTool('updateMissionStats', {
                totalUniqueScans: maskedTotalUniqueScans,
                gridSize: maskedGridSize,
                missionTimeSec: metricsRef.current.missionTimeSec,
                averageZoneCoverage: metricsRef.current.averageZoneCoverage,
                meanProbabilityScanned: metricsRef.current.meanProbabilityScanned,
                repeatedScanRate: metricsRef.current.repeatedScanRate,
                sensorWeights: sensorWeightsRef.current,
                totalEstimatedSurvivors: survivorsRef.current.length,
                missionTimeLimit: useTimeLimit ? timeLimit : null
            });
        }
    }, [mcpConnected, running, dronesRef, gridRef, sensorWeightsRef, metricsRef, timeRef, survivorsRef, missionOverride, searchArea, selectedCells, timeLimit, useTimeLimit]);

    const processMcpCommands = useCallback(async () => {
        const commands = await mcpClient.getPendingCommands();
        for (const cmd of commands) {
            if (cmd.processed) continue;

            const drones = dronesRef.current;
            const grid = gridRef.current;

            switch (cmd.type) {
                case 'SET_TARGET': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        drone.tx = cmd.params.targetX as number;
                        drone.ty = cmd.params.targetY as number;
                    }
                    break;
                }
                case 'SET_MODE': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        const newMode = cmd.params.mode as Drone['mode'];
                        if (drone.id.startsWith('RLY-')) {
                            if (newMode !== 'Relay' && newMode !== 'Charging') {
                                break;
                            }
                        } else {
                            if (newMode === 'Relay') {
                                break;
                            }
                        }

                        if (newMode === 'Micro') {
                            const distToTarget = Math.sqrt(Math.pow(drone.tx - drone.x, 2) + Math.pow(drone.ty - drone.y, 2));
                            if (distToTarget > 2.0) {
                                console.log(`[SIM] Deferring Micro mode for ${drone.id} due to distance: ${distToTarget.toFixed(1)}`);
                                drone.mode = 'Wide';
                                break;
                            }
                        }

                        drone.mode = newMode;
                    }
                    break;
                }
                case 'RECALL_TO_BASE': {
                    const drone = drones.find(d => d.id === cmd.params.droneId);
                    if (drone) {
                        drone.tx = BASE_STATION.x;
                        drone.ty = BASE_STATION.y;
                        drone.savedTx = undefined;
                        drone.savedTy = undefined;
                        drone.lockTarget = false;
                        drone.preventReassignment = false;
                        if (drone.mode !== 'Relay') {
                            drone.mode = 'Wide';
                        }
                    }
                    break;
                }
                case 'KILL_DRONE': {
                    const droneIndex = drones.findIndex(d => d.id === cmd.params.droneId);
                    if (droneIndex >= 0) {
                        drones.splice(droneIndex, 1);
                    }
                    break;
                }
                case 'RESET_MISSION': {
                    resetSim();
                    syncedSurvivorIdsRef.current.clear();
                    break;
                }
                case 'SET_SIMULATION_STATE': {
                    const shouldRun = cmd.params.running as boolean;
                    setRunning(shouldRun);
                    break;
                }
                case 'REPLACE_RELAY': {
                    const { oldRelayId, newRelayId, targetX, targetY } = cmd.params;
                    const oldRelay = drones.find(d => d.id === oldRelayId);
                    const newRelay = drones.find(d => d.id === newRelayId);

                    if (oldRelay && newRelay) {
                        relayTakeoverTargetRef.current = {
                            x: targetX as number,
                            y: targetY as number,
                        };
                        newRelay.mode = 'Relay';
                        newRelay.tx = targetX as number;
                        newRelay.ty = targetY as number;

                        oldRelay.tx = BASE_STATION.x;
                        oldRelay.ty = BASE_STATION.y;
                    }
                    break;
                }
                case 'SET_SURVIVOR_PIN': {
                    const sx = cmd.params.x as number;
                    const sy = cmd.params.y as number;
                    const sdroneId = cmd.params.droneId as string;
                    const smessage = (cmd.params.message as string) || 'Survivor confirmed by MCP';
                    const pinId = `MCP-${Date.now()}`;
                    if (!pinsRef.current.find(p => p.x === sx && p.y === sy)) {
                        if (sy >= 0 && sy < 20 && sx >= 0 && sx < 20) {
                            grid[sy][sx].scanned = true;
                            grid[sy][sx].lastScanned = timeRef.current;
                        }

                        pinsRef.current.push({
                            id: pinId,
                            x: sx,
                            y: sy,
                            info: { message: smessage, battery: 'unknown' }
                        });
                        const synced = await mcpClient.syncSurvivor({ id: pinId, x: sx, y: sy, droneId: sdroneId, message: smessage, tick: timeRef.current });
                        if (synced) {
                            syncedSurvivorIdsRef.current.add(pinId);
                        }
                    }
                    break;
                }
                case 'SET_AUTO_RECALL': {
                    const targetDroneId = cmd.params.droneId as string;
                    const threshold = cmd.params.batteryThreshold as number;
                    const normalized = Math.max(5, Math.min(95, Number.isFinite(threshold) ? threshold : 30));
                    autoRecallThresholdsRef.current.set(targetDroneId, normalized);
                    break;
                }
                case 'MOVE_RELAY': {
                    const relayId = cmd.params.relayId as string;
                    const x = cmd.params.x as number;
                    const y = cmd.params.y as number;
                    const drone = drones.find(d => d.id === relayId);
                    if (drone && drone.id.startsWith('RLY-')) {
                        // Strict: Do NOT deploy a charging relay via MOVE_RELAY.
                        // Charging relays only deploy via REPLACE_RELAY.
                        if (drone.mode === 'Relay') {
                            drone.tx = x;
                            drone.ty = y;
                            relayTakeoverTargetRef.current = { x, y };
                        }
                    }
                    break;
                }
                case 'BROADCAST_SWARM': {
                    const command = cmd.params.command as string;
                    const reachableDrones = cmd.params.reachableDrones as string[] || [];

                    if (command === 'RTB_ALL') {
                        reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Relay') {
                                d.tx = BASE_STATION.x;
                                d.ty = BASE_STATION.y;
                            }
                        });
                    } else if (command === 'MICRO_SCAN' && cmd.params.targetArea) {
                        const { x, y, radius } = cmd.params.targetArea as any;
                        reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Relay' && d.mode !== 'Charging') {
                                const dist = Math.sqrt(Math.pow(d.x - x, 2) + Math.pow(d.y - y, 2));
                                if (dist <= radius) {
                                    d.mode = 'Micro';
                                    d.tx = x;
                                    d.ty = y;
                                }
                            }
                        });
                    } else if (command === 'RECRUIT' && cmd.params.targetArea) {
                        const { x, y } = cmd.params.targetArea as any;
                        reachableDrones.forEach(id => {
                            const d = drones.find(dr => dr.id === id);
                            if (d && d.mode !== 'Charging' && d.mode !== 'Relay') {
                                d.tx = x;
                                d.ty = y;
                            }
                        });
                    }
                    break;
                }
            }

            await mcpClient.acknowledgeCommand(cmd.id);
        }
    }, [dronesRef, gridRef, pinsRef, resetSim, setRunning, autoRecallThresholdsRef, relayTakeoverTargetRef, timeRef]);

    useEffect(() => {
        processMcpCommandsRef.current = processMcpCommands;
    }, [processMcpCommands]);

    // Keep consuming queued MCP commands even when the simulation is paused.
    // This allows AI-issued set_simulation_state(true) to take effect immediately.
    useEffect(() => {
        const commandPoll = setInterval(() => {
            processMcpCommands();
        }, 250);

        return () => clearInterval(commandPoll);
    }, [processMcpCommands]);

    useEffect(() => {
        if (!mcpConnected || bootstrappedServerStateRef.current) return;

        bootstrappedServerStateRef.current = true;

        void (async () => {
            // Clear stale in-memory server runtime state from previous browser sessions.
            await mcpClient.resetServerState();
            await mcpClient.clearOrchestratorRecords();
            syncedSurvivorIdsRef.current.clear();
            await syncToMcp(true);
        })();
    }, [mcpConnected, syncToMcp]);

    useEffect(() => {
        if (!mcpConnected) return;

        const syncInterval = setInterval(() => {
            if (!running) {
                syncToMcp();
            }
        }, 5000);

        return () => clearInterval(syncInterval);
    }, [mcpConnected, running, syncToMcp]);

    useEffect(() => {
        if (!mcpConnected) return;

        const pollInterval = setInterval(() => {
            processMcpCommands();
        }, 500);

        return () => clearInterval(pollInterval);
    }, [mcpConnected, processMcpCommands]);

    return {
        mcpConnected,
        mcpPanelOpen,
        setMcpPanelOpen,
        mcpToolOutput,
        mcpSelectedTool, setMcpSelectedTool,
        mcpToolParams, setMcpToolParams,
        executeMcpTool,

        chatOpen, setChatOpen,
        chatPos, setChatPos,
        chatDragRef,
        chatSize, setChatSize,
        chatResizeRef,
        chatInput, setChatInput,
        chatSending,
        chatMessages, setChatMessages,
        chatScrollRef,
        sendChatMessage,
        runThinkNow,
        runOrchestratorPrompt,

        syncToMcp,
        processMcpCommands
    };
};
