import { useState, useEffect, useRef, useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import * as mcpClient from '../services/mcpClient';
import type { Sector, Drone, FoundPin, AgentChatMessage, MultiAgentState } from '../types/simulation';
import { BASE_STATION } from '../types/simulation';

export const useSimulationMCP = (
    timeRef: MutableRefObject<number>,
    running: boolean,
    setRunning: Dispatch<SetStateAction<boolean>>,
    dronesRef: MutableRefObject<Drone[]>,
    gridRef: MutableRefObject<Sector[][]>,
    pinsRef: MutableRefObject<FoundPin[]>,
    autoRecallThresholdsRef: MutableRefObject<Map<string, number>>,
    relayTakeoverTargetRef: MutableRefObject<{ x: number, y: number }>,
    metricsRef: MutableRefObject<any>,
    resetSim: () => void,
    aiBusyRef: MutableRefObject<boolean>
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
    const [multiAgentState, setMultiAgentState] = useState<MultiAgentState | null>(null);
    const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([
        { id: 'start', role: 'system', text: 'AI chat ready. Ask status or issue commands (e.g. "move DRN-Alpha to 5,8"). Use THINK NOW to force one AI decision cycle.', timestamp: Date.now(), source: 'system' }
    ]);

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

        if (source === 'auto') {
            setChatMessages(prev => [...prev, { id: `auto-${Date.now()}`, role: 'system', text: 'Auto-think: AI is evaluating current swarm state...', timestamp: Date.now(), source: 'system' }]);
        }

        const result = await mcpClient.orchestratorChat(trimmed);

        if (!result.success) {
            setChatMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'system', text: `Error: ${result.error ?? 'Unknown error'}`, timestamp: Date.now(), source: 'system' }]);
        }

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

        const gridState = grid.map(row => row.map(s => ({
            gridCell: String.fromCharCode(65 + s.x) + (s.y + 1),
            x: s.x,
            y: s.y,
            probability: s.prob,
            pheromone: s.pheromone,
            terrain: s.terrain,
            scanned: s.scanned,
            lastScannedTick: s.lastScanned,
            disasterImage: s.disasterImage,
            signals: s.signals
        })));
        await mcpClient.syncGridState(gridState);

        if (mcpConnected) {
            await mcpClient.executeTool('updateMissionStats', {
                totalUniqueScans: metricsRef.current.totalUniqueScans,
                gridSize: 400,
                missionTimeSec: metricsRef.current.missionTimeSec,
                averageZoneCoverage: metricsRef.current.averageZoneCoverage,
                meanProbabilityScanned: metricsRef.current.meanProbabilityScanned,
                repeatedScanRate: metricsRef.current.repeatedScanRate
            });

            const agentState = await mcpClient.getMultiAgentState();
            if (agentState) {
                setMultiAgentState(agentState);
                if (!aiBusyRef.current) {
                    setChatMessages(agentState.chatLog);
                }
            }
        }
    }, [mcpConnected, running, dronesRef, gridRef, metricsRef, timeRef, aiBusyRef]);

    const triggerMultiagentTick = useCallback(async () => {
        if (!mcpConnected) return;
        const drones = dronesRef.current.map(d => ({
            id: d.id,
            position: { x: d.x, y: d.y, gridCell: '' },
            target: d.tx !== undefined ? { x: d.tx, y: d.ty, gridCell: '' } : null,
            mode: d.mode,
            battery: d.battery,
            isConnected: d.isConnected,
            isActive: d.mode !== 'Charging' || d.battery > 0,
            assignedRegion: null
        }));
        await mcpClient.multiagentTick(timeRef.current, drones);
    }, [mcpConnected, dronesRef, timeRef]);

    const processMcpCommands = useCallback(async () => {
        if (!mcpConnected) return;

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
                        pinsRef.current.push({
                            id: pinId,
                            x: sx,
                            y: sy,
                            info: { message: smessage, battery: 'unknown' }
                        });
                        for (let py = Math.max(0, sy - 3); py <= Math.min(20 - 1, sy + 3); py++) {
                            for (let px = Math.max(0, sx - 3); px <= Math.min(20 - 1, sx + 3); px++) {
                                grid[py][px].pheromone = 0;
                                grid[py][px].prob = 0;
                            }
                        }
                        mcpClient.syncSurvivor({ id: pinId, x: sx, y: sy, droneId: sdroneId, message: smessage, tick: timeRef.current });
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
                        if (drone.mode === 'Charging') {
                            drone.mode = 'Relay';
                        }
                        drone.tx = x;
                        drone.ty = y;
                        relayTakeoverTargetRef.current = { x, y };
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
    }, [mcpConnected, dronesRef, gridRef, pinsRef, resetSim, setRunning, autoRecallThresholdsRef, relayTakeoverTargetRef, timeRef]);

    useEffect(() => {
        if (mcpConnected) {
            syncToMcp(true);
        }
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
        multiAgentState,
        chatScrollRef,
        sendChatMessage,
        runThinkNow,
        runOrchestratorPrompt,
        triggerMultiagentTick,

        syncToMcp,
        processMcpCommands
    };
};
