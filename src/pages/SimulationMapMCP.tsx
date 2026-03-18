import React, { useRef, useCallback } from 'react';
import { Play, Pause, FileText } from 'lucide-react';

import { useSharedSimulation } from '../context/SimulationContext';
import { useSimulationMCP } from '../hooks/useSimulationMCP';
import { SimulationGrid } from '../components/SimulationMap/SimulationGrid';
import { SimulationDashboard } from '../components/SimulationMap/SimulationDashboard';
import { MCPChatPanel } from '../components/SimulationMap/MCPChatPanel';

const SimulationMapMCP: React.FC = () => {
    const aiBusyRef = useRef(false);

    const {
        running, setRunning,
        speed,
        selectedPin, setSelectedPin,
        showSensors,
        showTrails, setShowTrails,
        selectedTrailDroneId,
        setSelectedTrailDroneId,
        gridRef, dronesRef, survivorsRef, pinsRef,
        timeRef, commLinksRef, sensorWeightsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef,
        aiDisconnectedRef, aiReconnectedUntilTickRef,
        metricsRef,
        toggleRunning, resetSim,
        getSectorProbability, performTickCore
    } = useSharedSimulation();

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
        chatMessages,
        chatScrollRef,

        syncToMcp,
        processMcpCommands,
        runOrchestratorPrompt
    } = useSimulationMCP(
        timeRef, running, setRunning, dronesRef, gridRef, pinsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef, sensorWeightsRef, metricsRef,
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
                        MULTI-RES SWARM SIMULATION
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; ADAPTIVE SEARCH & SURVIVOR DETECTION</p>
                </div>

                <div style={{ display: 'flex', gap: '12px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <button onClick={toggleRunning} className="hud-btn" style={{ padding: '8px 16px', display: 'flex', gap: '8px', cursor: 'pointer' }}>
                        {running ? <Pause size={18} /> : <Play size={18} />} {running ? 'PAUSE' : 'START SCAN'}
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
                        <FileText size={18} /> MISSION LOG
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
                    setShowTrails={setShowTrails}
                    selectedTrailDroneId={selectedTrailDroneId}
                    setSelectedTrailDroneId={setSelectedTrailDroneId}
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
                running={running}
                onStartSimulation={() => {
                    if (!running) toggleRunning();
                }}
            />

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default SimulationMapMCP;
