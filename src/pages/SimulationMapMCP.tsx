import React, { useRef, useCallback } from 'react';
import { Hexagon, Play, Pause, FastForward, RotateCcw, Activity, Wifi, WifiOff, MessageSquare } from 'lucide-react';

import { useSimulationEngine } from '../hooks/useSimulationEngine';
import { useSimulationMCP } from '../hooks/useSimulationMCP';
import { SimulationGrid } from '../components/SimulationMap/SimulationGrid';
import { SimulationDashboard } from '../components/SimulationMap/SimulationDashboard';
import { MCPChatPanel } from '../components/SimulationMap/MCPChatPanel';

const SimulationMapMCP: React.FC = () => {
    const aiBusyRef = useRef(false);

    const {
        running, setRunning,
        speed, setSpeed,
        selectedPin, setSelectedPin,
        showSensors, setShowSensors,
        showTrails, setShowTrails,
        selectedTrailDroneId, setSelectedTrailDroneId,
        gridRef, dronesRef, survivorsRef, pinsRef,
        timeRef, commLinksRef, sensorWeightsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef,
        aiDisconnectedRef, aiReconnectedUntilTickRef,
        metricsRef,
        toggleRunning, resetSim,
        getSectorProbability, performTickCore
    } = useSimulationEngine(
        (eventPayload: { type: string; droneId: string }) => {
            // handle failure event triggered
            console.log("Failure triggered for", eventPayload.droneId);
        },
        () => {
            // handle play pause
        }
    );

    const {
        mcpConnected,
        mcpPanelOpen, setMcpPanelOpen,
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
        chatMessages,
        chatScrollRef,
        sendChatMessage,
        runThinkNow,

        syncToMcp,
        processMcpCommands,
        runOrchestratorPrompt
    } = useSimulationMCP(
        timeRef, running, setRunning, dronesRef, gridRef, pinsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef, metricsRef,
        resetSim, aiBusyRef
    );

    // The core tick loop wrapped to pass the MCP sync functions
    const performTick = useCallback(() => {
        performTickCore(syncToMcp, processMcpCommands, (preferredId: string, msg: string) => {
            void preferredId;
            runOrchestratorPrompt(msg, 'auto');
        });
    }, [performTickCore, syncToMcp, processMcpCommands, runOrchestratorPrompt]);

    // Rebind interval to use performTick 
    React.useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (running) {
            interval = setInterval(performTick, 100 / speed); // SIM_TICK_MS is 100 
        }
        return () => clearInterval(interval);
    }, [running, speed, performTick]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px', color: 'var(--text-primary)' }}>
            <header style={{ padding: '16px', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Hexagon /> MULTI-RES SWARM SIMULATION
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; ADAPTIVE SEARCH & SURVIVOR DETECTION</p>
                </div>

                <div style={{ display: 'flex', gap: '12px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <button onClick={toggleRunning} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        {running ? <Pause size={18} /> : <Play size={18} />} {running ? 'PAUSE' : 'START SCAN'}
                    </button>
                    <button onClick={() => setSpeed(s => s === 1 ? 5 : 1)} className={`hud-btn ${speed > 1 ? 'glow-text' : ''}`} style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer', borderColor: speed > 1 ? 'var(--accent-primary)' : '' }}>
                        <FastForward size={18} /> x{speed}
                    </button>
                    <button onClick={() => setShowSensors(!showSensors)} className={`hud-btn ${showSensors ? 'glow-text' : ''}`} style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer', borderColor: showSensors ? 'var(--accent-primary)' : '' }}>
                        <Activity size={18} /> {showSensors ? 'SENSORS' : 'SENSORS'}
                    </button>
                    <div style={{ display: 'flex', gap: '0', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
                        <button 
                            onClick={() => setShowTrails(!showTrails)} 
                            className={`hud-btn ${showTrails ? 'glow-text' : ''}`} 
                            style={{ 
                                padding: '8px 16px', 
                                border: 'none', 
                                borderRight: '1px solid var(--panel-border)',
                                display: 'flex', 
                                gap: '8px', 
                                cursor: 'pointer',
                                background: 'transparent',
                                color: showTrails ? 'var(--accent-primary)' : 'var(--text-primary)'
                            }}
                        >
                            <Activity size={18} style={{ transform: 'rotate(90deg)' }} /> TRAILS
                        </button>
                        <select 
                            value={selectedTrailDroneId} 
                            onChange={(e) => setSelectedTrailDroneId(e.target.value)}
                            style={{ 
                                background: 'transparent', 
                                color: 'var(--text-primary)', // Ensure main text is visible
                                border: 'none', 
                                padding: '0 8px', 
                                cursor: 'pointer',
                                outline: 'none',
                                fontSize: '0.8rem',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            <option value="all" style={{ background: 'var(--panel-bg)', color: 'var(--text-primary)' }}>ALL</option>
                            {dronesRef.current.map(d => (
                                <option key={d.id} value={d.id} style={{ background: 'var(--panel-bg)', color: 'var(--text-primary)' }}>{d.id.replace('DRN-', '')}</option>
                            ))}
                        </select>
                    </div>
                    <button onClick={resetSim} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        <RotateCcw size={18} /> RESET
                    </button>
                    <button
                        onClick={() => setMcpPanelOpen(!mcpPanelOpen)}
                        className={`hud-btn ${mcpPanelOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '8px 16px',
                            display: 'flex',
                            gap: '8px',
                            cursor: 'pointer',
                            borderColor: mcpPanelOpen ? 'var(--accent-primary)' : '',
                            marginLeft: '8px'
                        }}
                    >
                        {mcpConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
                        MCP {mcpConnected ? 'ONLINE' : 'OFFLINE'}
                    </button>
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`hud-btn ${chatOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '8px 16px',
                            display: 'flex',
                            gap: '8px',
                            cursor: 'pointer',
                            borderColor: chatOpen ? 'var(--accent-primary)' : ''
                        }}
                    >
                        <MessageSquare size={18} /> AI CHAT
                    </button>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '12px', margin: '0 12px 12px 12px' }}>
                <SimulationGrid
                    grid={gridRef.current}
                    drones={dronesRef.current}
                    commLinks={commLinksRef.current}
                    survivors={survivorsRef.current}
                    pins={pinsRef.current}
                    selectedPin={selectedPin}
                    setSelectedPin={setSelectedPin}
                    showSensors={showSensors}
                    showTrails={showTrails}
                    selectedTrailDroneId={selectedTrailDroneId}
                    getSectorProbability={getSectorProbability}
                    time={timeRef.current}
                    aiDisconnectedRef={aiDisconnectedRef}
                    aiReconnectedUntilTickRef={aiReconnectedUntilTickRef}
                />

                <SimulationDashboard
                    drones={dronesRef.current}
                    time={timeRef.current}
                    aiDisconnectedRef={aiDisconnectedRef}
                    aiReconnectedUntilTickRef={aiReconnectedUntilTickRef}
                    metrics={metricsRef.current}
                    sensorWeights={sensorWeightsRef.current}
                />
            </div>

            <MCPChatPanel
                mcpConnected={mcpConnected}
                mcpPanelOpen={mcpPanelOpen}
                setMcpPanelOpen={setMcpPanelOpen}
                mcpSelectedTool={mcpSelectedTool}
                setMcpSelectedTool={setMcpSelectedTool}
                mcpToolParams={mcpToolParams}
                setMcpToolParams={setMcpToolParams}
                executeMcpTool={executeMcpTool}
                mcpToolOutput={mcpToolOutput}

                chatOpen={chatOpen}
                setChatOpen={setChatOpen}
                chatPos={chatPos}
                setChatPos={setChatPos}
                chatSize={chatSize}
                setChatSize={setChatSize}
                chatDragRef={chatDragRef}
                chatResizeRef={chatResizeRef}
                chatScrollRef={chatScrollRef}
                chatMessages={chatMessages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatSending={chatSending}
                sendChatMessage={sendChatMessage}
                runThinkNow={runThinkNow}
            />

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default SimulationMapMCP;
