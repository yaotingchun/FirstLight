import React, { useCallback } from 'react';
import { Play, Pause, FileText, Globe, Settings } from 'lucide-react';

import { useSharedSimulation } from '../context/SimulationContext';
import { useSimulationMCP } from '../hooks/useSimulationMCP';
import { SimulationGrid } from '../components/SimulationMap/SimulationGrid';
import { SimulationDashboard } from '../components/SimulationMap/SimulationDashboard';
import { SimulationSettings } from '../components/SimulationMap/SimulationSettings';
import { MCPChatPanel } from '../components/SimulationMap/MCPChatPanel';
import { PersistentCameraEngine } from '../components/SimulationMap/PersistentCameraEngine';
import { DroneCameraStrip } from '../components/SimulationMap/DroneCameraStrip';
import * as mcpClient from '../services/mcpClient';
import { isPointInPolygon } from '../utils/polygonUtils';

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
        microScanOnly, toggleMicroScanOnly,
        centerLocation, setCenterLocation,
        searchArea, setSearchArea,
        selectedCells,
        isDrawingMode, setIsDrawingMode,
        searchScanActive, setSearchScanActive,
        missionOverride,
        setMissionOverride
    } = useSharedSimulation();

    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [cameraCanvases, setCameraCanvases] = React.useState<Record<string, HTMLCanvasElement>>({});

    const countCellsInArea = React.useCallback((area: { x: number; y: number }[]) => {
        if (!area || area.length < 3) return 0;
        let count = 0;
        for (let y = 0; y < 20; y++) {
            for (let x = 0; x < 20; x++) {
                if (isPointInPolygon(x, y, area)) count++;
            }
        }
        return count;
    }, []);


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
        chatScrollRef,

        syncToMcp,
        processMcpCommands,
        runOrchestratorPrompt,

        aiMode, setAiMode,
        providerStatus
    } = useSimulationMCP(
        timeRef, running, setRunning, dronesRef, gridRef, pinsRef,
        autoRecallThresholdsRef, relayTakeoverTargetRef, sensorWeightsRef, metricsRef,
        resetSim, aiBusyRef, survivorsRef, searchArea, selectedCells, missionOverride, timeLimit, useTimeLimit
    );

    const appendOverrideRecord = React.useCallback(async (message: string) => {
        await mcpClient.appendOrchestratorRecord({
            source: 'system',
            droneId: 'ORCHESTRATOR',
            message,
        });
    }, []);

    const engageCustomAreaOverride = React.useCallback(async () => {
        if ((searchArea?.length || 0) <= 2 || searchScanActive) return;

        setSearchScanActive(true);
        setMissionOverride(true);

        const cellCount = countCellsInArea(searchArea || []);
        const overrideMessage =
            `[OVERRIDE] CUSTOM SEARCH AREA ENGAGED.\n` +
            `Area defined with ${searchArea.length} boundary points covering ~${cellCount} grid cells.\n` +
            `All drones recalibrating to prioritize search within designated zone.\n` +
            `${microScanOnly ? 'BLANKET MICRO SCAN is ACTIVE within the custom area.' : 'Standard adaptive scanning within the custom area.'}`;

        await appendOverrideRecord(overrideMessage);

        await runOrchestratorPrompt(
            'Operator override acknowledged: custom search area is now active. Reallocate all available drones inside the selected boundary and emit concrete per-drone actions for immediate execution.',
            'auto'
        );
    }, [
        appendOverrideRecord,
        countCellsInArea,
        microScanOnly,
        runOrchestratorPrompt,
        searchArea,
        searchScanActive,
        setMissionOverride,
        setSearchScanActive,
    ]);

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
                        [ADAPTIVE SEARCH &amp; SURVIVOR DETECTION]
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg)', padding: '6px 12px', border: '1px solid var(--panel-border)', borderRadius: '4px', marginBottom: '4px', alignItems: 'center' }}>
                    <button onClick={() => {
                        if (!running) {
                            void engageCustomAreaOverride();
                            toggleRunning();
                        } else {
                            toggleRunning();
                        }
                    }} className="hud-btn" style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
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
                    <button
                        onClick={() => setSettingsOpen(!settingsOpen)}
                        className={`hud-btn ${settingsOpen ? 'glow-text' : ''}`}
                        style={{
                            padding: '6px 12px',
                            fontSize: '0.75rem',
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderColor: settingsOpen ? 'var(--accent-primary)' : ''
                        }}
                    >
                        <Settings size={14} /> CONFIG
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
                    searchArea={searchArea}
                    isDrawingMode={isDrawingMode}
                    searchScanActive={searchScanActive}
                    onFinishDrawing={(area) => {
                        setSearchArea(area);
                        setIsDrawingMode(false);
                    }}
                />

                <SimulationDashboard
                    drones={dronesRef.current}
                    time={timeRef.current}
                    aiDisconnectedRef={aiDisconnectedRef}
                    aiReconnectedUntilTickRef={aiReconnectedUntilTickRef}
                    metrics={metricsRef.current}
                    sensorWeights={sensorWeightsRef.current}
                    running={running}
                />

                <DroneCameraStrip 
                    drones={dronesRef.current.filter(d => !d.id.startsWith('RLY-'))}
                    canvases={cameraCanvases}
                    time={timeRef.current}
                    centerLocation={centerLocation}
                />
            </div>

            <PersistentCameraEngine 
                drones={dronesRef.current.filter(d => !d.id.startsWith('RLY-'))}
                commLinks={commLinksRef.current}
                centerLocation={centerLocation}
                onCanvasesReady={setCameraCanvases}
            />

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
                running={running}
                aiMode={aiMode}
                setAiMode={setAiMode}
                providerStatus={providerStatus}
                onStartSimulation={() => {
                    if (!running) {
                        void engageCustomAreaOverride();
                        toggleRunning();
                    }
                }}
            />

            <SimulationSettings
                isOpen={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                running={running}
                microScanOnly={microScanOnly}
                onToggleMicroScanOnly={() => {
                    const nextState = !microScanOnly;
                    toggleMicroScanOnly(nextState);
                    void appendOverrideRecord(`[OVERRIDE] Micro Scan Only mode ${nextState ? 'ENABLED' : 'DISABLED'} by operator.`);
                    mcpClient.mcpTools.setMicroScanOnly(nextState).catch(err => {
                        console.error('Failed to set microScanOnly:', err);
                        toggleMicroScanOnly(!nextState);
                    });
                }}
                isDrawingMode={isDrawingMode}
                onToggleDrawingMode={() => {
                    const nextState = !isDrawingMode;
                    setIsDrawingMode(nextState);
                    if (nextState) {
                        setSearchArea([]);
                        setSearchScanActive(false);
                        setMissionOverride(false);
                    }
                }}
                searchAreaDrawn={(searchArea?.length || 0) > 2}
                onClearSearchArea={() => {
                    setSearchArea([]);
                    setIsDrawingMode(false);
                    setSearchScanActive(false);
                    setMissionOverride(false);
                    void appendOverrideRecord('[OVERRIDE] CUSTOM SEARCH AREA CLEARED. RESUMING GLOBAL SEARCH.');
                }}
                centerLocation={centerLocation}
                setCenterLocation={setCenterLocation}
                useTimeLimit={useTimeLimit}
                setUseTimeLimit={setUseTimeLimit}
                timeLimit={timeLimit}
                setTimeLimit={setTimeLimit}
                randomizeBattery={randomizeBattery}
                setRandomizeBattery={setRandomizeBattery}
            />

            <style>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default SimulationMapMCP;
