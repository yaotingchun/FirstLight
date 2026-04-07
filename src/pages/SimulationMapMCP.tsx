import React, { useRef, useEffect, useCallback } from 'react';
import { Play, Pause, FileText } from 'lucide-react';
import { useSharedSimulation } from '../context/SimulationContext';
import { useSimulationMCP } from '../hooks/useSimulationMCP';
import { SimulationGrid } from '../components/SimulationMap/SimulationGrid';
import { SimulationDashboard } from '../components/SimulationMap/SimulationDashboard';
import { MCPChatPanel } from '../components/SimulationMap/MCPChatPanel';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// ── Map constants (Sync with DroneCam) ──────────────────────────────────
const EPICENTER = { lng: 101.6841, lat: 3.1319 };
const GRID_W = 20;
const GRID_H = 20;
const CELL_DEG = 0.0009;
const GRID_ORIGIN_LNG = EPICENTER.lng - (GRID_W / 2) * CELL_DEG;
const GRID_ORIGIN_LAT = EPICENTER.lat + (GRID_H / 2) * CELL_DEG;

const gridToLngLat = (gx: number, gy: number): [number, number] => [
    GRID_ORIGIN_LNG + gx * CELL_DEG,
    GRID_ORIGIN_LAT - gy * CELL_DEG
];

const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

// ── Dedicated Hidden Engine for Popups ──────────────────────────────────
const HiddenCameraEngine: React.FC<{ activeDroneId: string | null }> = ({ activeDroneId }) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Cesium.Viewer | null>(null);
    const markersRef = useRef<Record<string, Cesium.Entity>>({});
    const commsLinesRef = useRef<Record<string, Cesium.Entity>>({});
    const { dronesRef, commLinksRef } = useSharedSimulation();

    useEffect(() => {
        if (!mapContainer.current || viewerRef.current) return;
        let viewer: Cesium.Viewer | null = null;
        let isMounted = true;

        const initMap = async () => {
            try {
                const imageryProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
                );
                if (!isMounted || !mapContainer.current) return;
                viewer = new Cesium.Viewer(mapContainer.current, {
                    animation: false, timeline: false, geocoder: false,
                    homeButton: false, navigationHelpButton: false,
                    sceneModePicker: false, infoBox: false,
                    selectionIndicator: false, fullscreenButton: false,
                    vrButton: false, baseLayerPicker: false,
                    baseLayer: new Cesium.ImageryLayer(imageryProvider),
                });
                viewerRef.current = viewer;
                const tp = await Cesium.createWorldTerrainAsync();
                if (isMounted && viewer) {
                    viewer.terrainProvider = tp;
                    viewer.scene.globe.depthTestAgainstTerrain = true;
                }
                const buildings = await Cesium.createOsmBuildingsAsync();
                if (isMounted && viewer) viewer.scene.primitives.add(buildings);
            } catch (err) { console.error("Popup Engine Error:", err); }
        };
        void initMap();
        return () => {
            isMounted = false;
            if (viewerRef.current) {
                viewerRef.current.destroy();
                viewerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        let animId: number;
        let heading = 0;
        const frame = () => {
            const viewer = viewerRef.current;
            if (!viewer) { animId = requestAnimationFrame(frame); return; }
            const drones = dronesRef.current;

            drones.forEach(d => {
                const [lng, lat] = gridToLngLat(d.x, d.y);
                const altitude = d.mode === 'Micro' ? 80 : d.mode === 'Charging' ? 0 : 300;
                const col = !d.isConnected ? '#555555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                const cesiumCol = Cesium.Color.fromCssColorString(col);
                if (!markersRef.current[d.id]) {
                    markersRef.current[d.id] = viewer.entities.add({
                        id: d.id, position: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
                        point: { pixelSize: 14, color: cesiumCol, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, show: d.id !== activeDroneId }
                    });
                } else {
                    const ent = markersRef.current[d.id];
                    ent.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lng, lat, altitude));
                    if (ent.point) {
                        ent.point.color = new Cesium.ConstantProperty(cesiumCol);
                        ent.point.show = new Cesium.ConstantProperty(d.id !== activeDroneId);
                    }
                }
            });

            // ── Comm links ──────────────────────────────────────────────
            const currentCommLnkIds: string[] = [];
            commLinksRef.current.forEach(link => {
                const linkId = `${link.source}-${link.target}`;
                currentCommLnkIds.push(linkId);
                const getCoord = (id: string): Cesium.Cartesian3 => {
                    let lng, lat, alt = 300;
                    if (id === BASE_STATION.id) {
                        [lng, lat] = gridToLngLat(BASE_STATION.x, BASE_STATION.y);
                        alt = 50;
                    } else {
                        const dd = drones.find(dr => dr.id === id);
                        if (dd) {
                            [lng, lat] = gridToLngLat(dd.x, dd.y);
                            alt = dd.mode === 'Micro' ? 80 : dd.mode === 'Charging' ? 0 : 300;
                        } else {
                            [lng, lat] = gridToLngLat(0, 0);
                        }
                    }
                    return Cesium.Cartesian3.fromDegrees(lng, lat, alt);
                };

                const color = link.active ? Cesium.Color.YELLOW : Cesium.Color.AQUAMARINE.withAlpha(0.25);
                const width = link.active ? 3 : 1;

                if (!commsLinesRef.current[linkId]) {
                    commsLinesRef.current[linkId] = viewer.entities.add({
                        polyline: {
                            positions: [getCoord(link.source), getCoord(link.target)],
                            width: width,
                            material: color
                        }
                    });
                } else {
                    const ent = commsLinesRef.current[linkId];
                    if (ent.polyline) {
                        ent.polyline.positions = new Cesium.ConstantProperty([getCoord(link.source), getCoord(link.target)]);
                        ent.polyline.material = new Cesium.ColorMaterialProperty(color);
                    }
                }
            });
            Object.keys(commsLinesRef.current).forEach(id => {
                if (!currentCommLnkIds.includes(id)) {
                    viewer.entities.remove(commsLinesRef.current[id]);
                    delete commsLinesRef.current[id];
                }
            });

            const active = drones.find(dd => dd.id === activeDroneId);
            if (active) {
                const [aLng, aLat] = gridToLngLat(active.x, active.y);
                const aAlt = active.mode === 'Micro' ? 80 : active.mode === 'Charging' ? 5 : 300;
                const dx = active.tx - active.x;
                const dy = -(active.ty - active.y);
                let targetHeading = heading;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) targetHeading = Math.atan2(dx, dy);
                let diff = targetHeading - heading;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                heading = heading + diff * 0.1;
                const pitch = active.mode === 'Charging' ? Cesium.Math.toRadians(-5) : Cesium.Math.toRadians(-15);
                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(aLng, aLat, aAlt),
                    orientation: { heading, pitch, roll: 0.0 }
                });
            }
            animId = requestAnimationFrame(frame);
        };
        animId = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(animId);
    }, [activeDroneId, dronesRef]);

    return (
        <div id="hidden-popup-engine" style={{ position: 'absolute', width: '240px', height: '180px', left: '-5000px', top: '0', pointerEvents: 'none', opacity: 0 }}>
            <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        </div>
    );
};

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
        getSectorProbability, performTickCore,
        randomizeBattery, setRandomizeBattery,
        cameraPopupDroneId, setCameraPopupDroneId
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
        resetSim, aiBusyRef, survivorsRef
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

                <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg)', padding: '6px 12px', border: '1px solid var(--panel-border)', borderRadius: '4px', marginBottom: '4px' }}>
                    <button onClick={toggleRunning} className="hud-btn" style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                        {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'PAUSE' : 'START SCAN'}
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
                    cameraPopupDroneId={cameraPopupDroneId}
                    setCameraPopupDroneId={setCameraPopupDroneId}
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
                    cameraPopupDroneId={cameraPopupDroneId}
                    setCameraPopupDroneId={setCameraPopupDroneId}
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

            <HiddenCameraEngine activeDroneId={cameraPopupDroneId} />
        </div>
    );
};

export default SimulationMapMCP;
