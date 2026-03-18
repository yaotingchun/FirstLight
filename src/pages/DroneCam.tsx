import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Camera, Target, Radio, Crosshair, Activity } from 'lucide-react';
import { useSharedSimulation } from '../context/SimulationContext';
import { INITIAL_SENSORS } from '../services/gridDataService';

// ── Map constants ──────────────────────────────────────────────────────
const EPICENTER = { lng: 101.6841, lat: 3.1319 }; // Matches 3D Probability Map

const GRID_W = 20;
const GRID_H = 20;
const CELL_DEG = 0.0009; // ~100 m
const GRID_ORIGIN_LNG = EPICENTER.lng - (GRID_W / 2) * CELL_DEG;
const GRID_ORIGIN_LAT = EPICENTER.lat + (GRID_H / 2) * CELL_DEG;

const gridToLngLat = (gx: number, gy: number): [number, number] => [
    GRID_ORIGIN_LNG + gx * CELL_DEG,
    GRID_ORIGIN_LAT - gy * CELL_DEG
];

const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

// Allow default access token to be set by Cesium automatically or configure manually
// Cesium.Ion.defaultAccessToken = 'YOUR_DEFAULT_TOKEN';

const DroneCam: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Cesium.Viewer | null>(null);
    const markersRef = useRef<Record<string, Cesium.Entity>>({});
    const commsLinesRef = useRef<Record<string, Cesium.Entity>>({});

    const { 
        running, timeRef, dronesRef, survivorsRef, pinsRef, sensorWeightsRef, commLinksRef 
    } = useSharedSimulation();

    const [activeDrone, setActiveDrone] = useState('DRN-Alpha');
    const location = useLocation();
    const isActivePage = location.pathname === '/drone-cam';

    useEffect(() => {
        if (dronesRef.current.length > 0 && !dronesRef.current.find(d => d.id === activeDrone)) {
            setActiveDrone(dronesRef.current[0].id);
        }
    }, [dronesRef, activeDrone]);

    // ── Handle drone switch ─────────────────────────────────────────
    const handleDroneSwitch = useCallback((droneId: string) => {
        setActiveDrone(droneId);
    }, []);

    // ── Cesium init ─────────────────────────────────────────────────
    useEffect(() => {
        if (!isActivePage || viewerRef.current || !mapContainer.current) return;

        let viewer: Cesium.Viewer | null = null;
        let isMounted = true;

        const initMap = async () => {
            try {
                const imageryProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
                );

                if (!isMounted || !mapContainer.current) return;

                viewer = new Cesium.Viewer(mapContainer.current, {
                    animation: false,
                    timeline: false,
                    geocoder: false,
                    homeButton: false,
                    navigationHelpButton: false,
                    sceneModePicker: false,
                    infoBox: false,
                    selectionIndicator: false,
                    fullscreenButton: false,
                    vrButton: false,
                    baseLayerPicker: false,
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
                
                // Add epicenter as an entity
                if (isMounted && viewer) {
                    viewer.entities.add({
                        position: Cesium.Cartesian3.fromDegrees(EPICENTER.lng, EPICENTER.lat, 0),
                        ellipse: {
                            semiMinorAxis: 200.0,
                            semiMajorAxis: 200.0,
                            material: Cesium.Color.RED.withAlpha(0.3),
                            outline: true,
                            outlineColor: Cesium.Color.RED
                        }
                    });

                    setTimeout(() => {
                        const credits = document.querySelector('.cesium-widget-credits') as HTMLElement;
                        if (credits) credits.style.display = 'none';
                    }, 500);
                }
            } catch (err) {
                console.error("Cesium init error:", err);
            }
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

    // ── Per-frame map sync ──────────────────────────────────────────
    useEffect(() => {
        if (!isActivePage) return;
        
        let animId: number;
        let heading = 0; // Cesium uses radians

        const frame = () => {
            const viewer = viewerRef.current;
            if (!viewer) { animId = requestAnimationFrame(frame); return; }

            const drones = dronesRef.current;

            // Update / create drone markers
            drones.forEach(d => {
                const [lng, lat] = gridToLngLat(d.x, d.y);
                const altitude = d.mode === 'Micro' ? 80 : d.mode === 'Charging' ? 0 : 300;
                const col = !d.isConnected ? '#555555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                const cesiumCol = Cesium.Color.fromCssColorString(col);

                if (!markersRef.current[d.id]) {
                    markersRef.current[d.id] = viewer.entities.add({
                        id: d.id,
                        position: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
                        point: {
                            pixelSize: d.mode === 'Micro' ? 14 : 18,
                            color: cesiumCol,
                            outlineColor: Cesium.Color.WHITE,
                            outlineWidth: 2,
                            show: d.id !== activeDrone
                        }
                    });
                } else {
                    const ent = markersRef.current[d.id];
                    ent.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lng, lat, altitude));
                    if (ent.point) {
                        ent.point.color = new Cesium.ConstantProperty(cesiumCol);
                        ent.point.show = new Cesium.ConstantProperty(d.id !== activeDrone);
                    }
                }
            });

            const currentMarkerIds = drones.map(d => d.id);
            Object.keys(markersRef.current).forEach(id => {
                if (!currentMarkerIds.includes(id)) {
                    viewer.entities.remove(markersRef.current[id]);
                    delete markersRef.current[id];
                }
            });

            // Comm links
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

            // Camera follows active drone
            const active = drones.find(dd => dd.id === activeDrone);
            if (active) {
                const [aLng, aLat] = gridToLngLat(active.x, active.y);
                const aAlt = active.mode === 'Micro' ? 80 : active.mode === 'Charging' ? 5 : 300;
                
                // Calculate bearing towards target
                const dx = active.tx - active.x;
                const dy = -(active.ty - active.y); // Negative because geographic Y grows downward
                let targetHeading = heading;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    targetHeading = Math.atan2(dx, dy);
                }
                
                // Smooth heading interpolation
                let diff = targetHeading - heading;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                heading = heading + diff * 0.1;

                // FPV levels: look slightly down
                const pitch = active.mode === 'Charging' ? Cesium.Math.toRadians(-5) : Cesium.Math.toRadians(-15);

                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(aLng, aLat, aAlt),
                    orientation: {
                        heading: heading,
                        pitch: pitch,
                        roll: 0.0
                    }
                });
            }

            animId = requestAnimationFrame(frame);
        };

        animId = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(animId);
    }, [activeDrone, dronesRef, commLinksRef]);

    const activeD = dronesRef.current.find(d => d.id === activeDrone);
    const activeLngLat = activeD ? gridToLngLat(activeD.x, activeD.y) : [EPICENTER.lng, EPICENTER.lat];
    const altitudeLabel = activeD ? (activeD.mode === 'Micro' ? '80M' : activeD.mode === 'Charging' ? '0M (DOCKED)' : '300M') : '—';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', paddingTop: '40px' }}>
            <header style={{ paddingLeft: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: '20px' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Camera size={24} /> DRONE CAM OPTICS (CESIUM)
                    </h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; LIVE UPLINK — SYNCHRONIZED WITH SWARM COMMAND</p>
                </div>
                <div style={{ display: 'flex', gap: '10px', background: 'var(--panel-bg)', padding: '10px', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 12px', color: running ? '#00ffcc' : 'var(--warning)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                        {running ? '● SIMULATION RUNNING' : '■ SIMULATION PAUSED BY MCP'}
                    </div>
                </div>
            </header>

            <div style={{ flex: 1, display: 'flex', background: 'var(--bg-color)', overflow: 'hidden' }}>
                <div className="drone-container">

                    <div className="drone-view">
                        <div id="map" ref={mapContainer} style={{ width: '100%', height: '100%', background: '#000' }} />
                        <div className="drone-crt-lines" />
                        <div className="drone-hud-overlay" />
                        <div className="drone-telemetry">
                            {activeDrone} • {activeD ? activeD.mode : '—'} • LAT: {(activeLngLat as number[])[1].toFixed(4)} LON: {(activeLngLat as number[])[0].toFixed(4)} • ALT: {altitudeLabel} • BAT: {activeD ? Math.floor(activeD.battery) : 0}% • T:{timeRef.current}
                        </div>
                    </div>

                    <div className="drone-side-panel">
                        <div className="hud-panel flex-col" style={{ padding: '20px', gap: '16px', height: '100%', overflowY: 'auto' }}>
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>SELECT ACTIVE ASSET</label>
                                <select className="drone-select" value={activeDrone} onChange={e => handleDroneSwitch(e.target.value)}>
                                    {dronesRef.current.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}
                                </select>
                            </div>

                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>SWARM STATUS</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                                    {dronesRef.current.map(d => {
                                        const bc = d.battery > 50 ? '#00ffcc' : d.battery > 20 ? '#ffff00' : '#ff4444';
                                        const mc = !d.isConnected ? '#555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                                        return (
                                            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: d.id === activeDrone ? 'rgba(0,255,204,0.08)' : 'transparent', border: d.id === activeDrone ? '1px solid rgba(0,255,204,0.3)' : '1px solid transparent', cursor: 'pointer' }} onClick={() => handleDroneSwitch(d.id)}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {d.mode === 'Wide' ? <Target size={12} color="#00ffcc" /> : d.mode === 'Relay' ? <Radio size={12} color="#0077ff" /> : d.mode === 'Charging' ? <Activity size={12} color="#ffa500" /> : <Crosshair size={12} color="#ff4444" />}
                                                    <span>{d.id}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <span style={{ color: bc }}>{Math.floor(d.battery)}%</span>
                                                    <span style={{ color: mc, minWidth: 50, textAlign: 'right' }}>{!d.isConnected ? 'OFF' : d.mode}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>ADAPTIVE SENSORS</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {(Object.entries(sensorWeightsRef.current) as [keyof typeof INITIAL_SENSORS, { base: number; conf: number; color?: string }][]).map(([key, data]) => {
                                        const fw = (data.base * data.conf).toFixed(2);
                                        const defaultColor = key === 'mobile' ? '#00ffcc' : key === 'thermal' ? '#ff4444' : key === 'sound' ? '#ffff00' : '#ff00ff';
                                        return (
                                            <div key={key}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                                                    <span>{key}</span><span style={{ color: data.color || defaultColor }}>w={fw}</span>
                                                </div>
                                                <div style={{ width: '100%', height: '3px', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                                    <div style={{ width: `${(parseFloat(fw) / 0.4) * 100}%`, height: '100%', background: data.color || defaultColor }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>SURVIVORS FOUND</label>
                                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: '#00ffcc' }}>{pinsRef.current.length} / {survivorsRef.current.length}</div>
                            </div>

                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                                    <span>ALGORITHM LOG</span>
                                </label>
                                <div className="log-feed" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic', padding: '10px' }}>
                                    Please refer to the Swarm + MCP dashboard for the full interactive AI orchestration logs and live communication metrics.
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default DroneCam;
