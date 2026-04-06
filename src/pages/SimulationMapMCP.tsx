import React, { useCallback } from 'react';
import { Play, Pause, FileText, Globe } from 'lucide-react';

import { useSharedSimulation } from '../context/SimulationContext';
import { useSimulationMCP } from '../hooks/useSimulationMCP';
import { SimulationGrid } from '../components/SimulationMap/SimulationGrid';
import { SimulationDashboard } from '../components/SimulationMap/SimulationDashboard';
import { MCPChatPanel } from '../components/SimulationMap/MCPChatPanel';
import * as mcpClient from '../services/mcpClient';

const SimulationMapMCP: React.FC = () => {
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
        getSectorProbability, performTickCore,
        randomizeBattery, setRandomizeBattery,
        showActualMap, setShowActualMap,
        timeLimit, setTimeLimit,
        useTimeLimit, setUseTimeLimit,
        aiBusyRef,
        microScanOnly, toggleMicroScanOnly
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
        chatMessages, setChatMessages,
        chatScrollRef,

        syncToMcp,
        processMcpCommands,
        runOrchestratorPrompt
    } = useSimulationMCP(
        timeRef, running, setRunning, dronesRef, gridRef, pinsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef, sensorWeightsRef, metricsRef,
        resetSim, aiBusyRef, survivorsRef, timeLimit, useTimeLimit
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
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#020608', height: '100%', gap: '8px', color: 'var(--text-primary)', padding: '24px 20px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
            <header style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0, margin: 0 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#00ffcc', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'monospace', textShadow: '0 0 10px rgba(0, 255, 204, 0.4)' }}>
                        MULTI-RES SWARM SIMULATION
                    </h2>
                    <div style={{ color: '#6b8a8b', letterSpacing: '1px', fontSize: '0.75rem', marginTop: '6px', fontFamily: 'monospace' }}>
                        [ADAPTIVE SEARCH & SURVIVOR DETECTION]
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg)', padding: '6px 12px', border: '1px solid var(--panel-border)', borderRadius: '4px', marginBottom: '4px', alignItems: 'center' }}>
                    {/* Time Budget Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '12px', borderRight: '1px solid rgba(255, 255, 255, 0.1)', marginRight: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                                type="checkbox"
                                id="use-time-limit"
                                checked={useTimeLimit}
                                onChange={(e) => setUseTimeLimit(e.target.checked)}
                                disabled={running}
                                style={{ cursor: 'pointer', accentColor: '#00ffcc' }}
                            />
                            <label htmlFor="use-time-limit" style={{ fontSize: '0.65rem', color: useTimeLimit ? '#00ffcc' : '#6b8a8b', cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                TIME BUDGET
                            </label>
                        </div>

                        {useTimeLimit && (
                            <div style={{ position: 'relative', width: '80px' }}>
                                <input
                                    type="number"
                                    value={timeLimit}
                                    onChange={(e) => setTimeLimit(parseInt(e.target.value) || 0)}
                                    disabled={running}
                                    style={{
                                        width: '100%',
                                        background: 'rgba(0,0,0,0.4)',
                                        border: '1px solid rgba(0, 255, 204, 0.3)',
                                        color: '#00ffcc',
                                        padding: '4px 8px',
                                        fontSize: '0.75rem',
                                        fontFamily: 'monospace',
                                        outline: 'none',
                                        textAlign: 'right'
                                    }}
                                />
                                <span style={{ position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.5rem', color: '#6b8a8b' }}>SEC</span>
                            </div>
                        )}
                    </div>

                    <button onClick={toggleRunning} className="hud-btn" style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                        {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'PAUSE' : 'START SCAN'}
                    </button>
                    <button
                        onClick={() => setShowActualMap(!showActualMap)}
                        className={`hud-btn ${showActualMap ? 'glow-text' : ''}`}
                        style={{
                            padding: '6px 12px',
                            fontSize: '0.75rem',
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderColor: showActualMap ? 'var(--accent-primary)' : ''
                        }}
                    >
                        <Globe size={14} /> {showActualMap ? 'GRID VIEW' : 'MAP VIEW'}
                    </button>
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`hud-btn ${chatOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '6px 12px',
                            fontSize: '0.75rem',
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderColor: chatOpen ? 'var(--accent-primary)' : ''
                        }}
                    >
                        <FileText size={14} /> MISSION LOG
                    </button>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '12px' }}>
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
                    showActualMap={showActualMap}
                />

                <SimulationDashboard
                    drones={dronesRef.current}
                    time={timeRef.current}
                    aiDisconnectedRef={aiDisconnectedRef}
                    aiReconnectedUntilTickRef={aiReconnectedUntilTickRef}
                    metrics={metricsRef.current}
                    sensorWeights={sensorWeightsRef.current}
                    randomizeBattery={randomizeBattery}
                    setRandomizeBattery={setRandomizeBattery}
                    running={running}
                    microScanOnly={microScanOnly}
                    onToggleMicroScanOnly={() => {
                        const nextState = !microScanOnly;
                        toggleMicroScanOnly(nextState);
                        setChatMessages(prev => [...prev, { role: 'system', text: `[OVERRIDE] Micro Scan Only mode ${nextState ? 'ENABLED' : 'DISABLED'} by operator.` }]);
                        // Send command to MCP server
                        mcpClient.mcpTools.setMicroScanOnly(nextState).catch(err => {
                            console.error('Failed to set microScanOnly:', err);
                            // Revert on failure
                            toggleMicroScanOnly(!nextState);
                        });
                    }}
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
