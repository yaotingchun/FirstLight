import React, { useRef, useEffect } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Drone, CommEdge } from '../../types/simulation';

interface PersistentCameraEngineProps {
    drones: Drone[];
    commLinks: CommEdge[];
    centerLocation: { lat: number; lng: number };
    onCanvasesReady: (canvases: Record<string, HTMLCanvasElement>) => void;
}

const GRID_W = 20;
const GRID_H = 20;
const CELL_DEG = 0.0009;
const BASE_STATION = { id: 'BASE', x: 9.5, y: 19 };

export const PersistentCameraEngine: React.FC<PersistentCameraEngineProps> = ({ drones, commLinks, centerLocation, onCanvasesReady }) => {
    const containersRef = useRef<Record<string, HTMLDivElement | null>>({});
    const viewersRef = useRef<Record<string, Cesium.Viewer>>({});
    const canvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
    
    // Per-viewer entity tracking: { [viewerDroneId]: { [entityId]: Entity } }
    const markersPoolRef = useRef<Record<string, Record<string, Cesium.Entity>>>({});
    const commsLinesPoolRef = useRef<Record<string, Record<string, Cesium.Entity>>>({});

    const GRID_ORIGIN_LNG = centerLocation.lng - (GRID_W / 2) * CELL_DEG;
    const GRID_ORIGIN_LAT = centerLocation.lat + (GRID_H / 2) * CELL_DEG;

    const gridToLngLat = (gx: number, gy: number): [number, number] => [
        GRID_ORIGIN_LNG + gx * CELL_DEG,
        GRID_ORIGIN_LAT - gy * CELL_DEG
    ];

    // Initialize viewers for each drone with high-fidelity assets
    useEffect(() => {
        drones.forEach(drone => {
            if (!viewersRef.current[drone.id] && containersRef.current[drone.id]) {
                const initViewer = async () => {
                    try {
                        const imageryProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
                        );

                        const viewer = new Cesium.Viewer(containersRef.current[drone.id]!, {
                            animation: false,
                            timeline: false,
                            geocoder: false,
                            homeButton: false,
                            navigationHelpButton: false,
                            sceneModePicker: false,
                            infoBox: false,
                            selectionIndicator: false,
                            fullscreenButton: false,
                            baseLayerPicker: false,
                            scene3DOnly: true,
                            baseLayer: new Cesium.ImageryLayer(imageryProvider),
                            requestRenderMode: true, // Performance boost for multi-view
                        });

                        // Optimization: Disable heavy features
                        viewer.scene.fog.enabled = false;
                        viewer.scene.shadowMap.enabled = false;
                        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
                        
                        // Add Terrain
                        const terrainProvider = await Cesium.createWorldTerrainAsync();
                        viewer.terrainProvider = terrainProvider;
                        viewer.scene.globe.depthTestAgainstTerrain = true;

                        // Add OSM Buildings
                        const buildings = await Cesium.createOsmBuildingsAsync();
                        viewer.scene.primitives.add(buildings);

                        // Hide credits
                        const credits = containersRef.current[drone.id]?.querySelector('.cesium-widget-credits') as HTMLElement;
                        if (credits) credits.style.display = 'none';

                        viewersRef.current[drone.id] = viewer;
                        markersPoolRef.current[drone.id] = {};
                        commsLinesPoolRef.current[drone.id] = {};
                        
                        // Capture the canvas
                        const canvas = containersRef.current[drone.id]?.querySelector('canvas');
                        if (canvas) {
                            canvasesRef.current[drone.id] = canvas;
                            onCanvasesReady({ ...canvasesRef.current });
                        }
                    } catch (e) {
                        console.error(`Failed to init Cesium for ${drone.id}`, e);
                    }
                };
                void initViewer();
            }
        });

        return () => {
            Object.values(viewersRef.current).forEach(v => v.destroy());
            viewersRef.current = {};
            canvasesRef.current = {};
            markersPoolRef.current = {};
            commsLinesPoolRef.current = {};
        };
    }, [drones.length]);

    // Internal frame sync logic for each viewer
    useEffect(() => {
        let animId: number;
        let headingMap: Record<string, number> = {};

        const frame = () => {
            drones.forEach(activeD => {
                const viewer = viewersRef.current[activeD.id];
                if (!viewer) return;

                const markersRef = markersPoolRef.current[activeD.id];
                const commsLinesRef = commsLinesPoolRef.current[activeD.id];

                // 1. Update/Create Drone Markers inside this viewport
                drones.forEach(d => {
                    const [lng, lat] = gridToLngLat(d.x, d.y);
                    const altitude = d.mode === 'Micro' ? 80 : d.mode === 'Charging' ? 0 : 300;
                    const col = !d.isConnected ? '#555555' : d.mode === 'Relay' ? '#0077ff' : d.mode === 'Wide' ? '#00ffcc' : d.mode === 'Charging' ? '#ffa500' : '#ff4444';
                    const cesiumCol = Cesium.Color.fromCssColorString(col);

                    if (!markersRef[d.id]) {
                        markersRef[d.id] = viewer.entities.add({
                            id: d.id,
                            position: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
                            point: {
                                pixelSize: d.mode === 'Micro' ? 14 : 18,
                                color: cesiumCol,
                                outlineColor: Cesium.Color.WHITE,
                                outlineWidth: 2,
                                // Only show other drones, not the one carrying this camera
                                show: d.id !== activeD.id 
                            }
                        });
                    } else {
                        const ent = markersRef[d.id];
                        ent.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lng, lat, altitude));
                        if (ent.point) {
                            ent.point.color = new Cesium.ConstantProperty(cesiumCol);
                            ent.point.show = new Cesium.ConstantProperty(d.id !== activeD.id);
                        }
                    }
                });

                // 2. Update/Create Comm Links inside this viewport
                const currentCommLnkIds: string[] = [];
                commLinks.forEach(link => {
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

                    if (!commsLinesRef[linkId]) {
                        commsLinesRef[linkId] = viewer.entities.add({
                            polyline: {
                                positions: [getCoord(link.source), getCoord(link.target)],
                                width: width,
                                material: color
                            }
                        });
                    } else {
                        const ent = commsLinesRef[linkId];
                        if (ent.polyline) {
                            ent.polyline.positions = new Cesium.ConstantProperty([getCoord(link.source), getCoord(link.target)]);
                            ent.polyline.material = new Cesium.ColorMaterialProperty(color);
                        }
                    }
                });

                // Cleanup stale entities
                const currentDroneIds = drones.map(d => d.id);
                Object.keys(markersRef).forEach(id => {
                    if (!currentDroneIds.includes(id)) {
                        viewer.entities.remove(markersRef[id]);
                        delete markersRef[id];
                    }
                });
                Object.keys(commsLinesRef).forEach(id => {
                    if (!currentCommLnkIds.includes(id)) {
                        viewer.entities.remove(commsLinesRef[id]);
                        delete commsLinesRef[id];
                    }
                });

                // 3. Update Camera Position for this sub-viewer
                const [lng, lat] = gridToLngLat(activeD.x, activeD.y);
                const altitude = activeD.mode === 'Micro' ? 80 : activeD.mode === 'Charging' ? 5 : 300;

                const dx = activeD.tx - activeD.x;
                const dy = -(activeD.ty - activeD.y);
                let targetHeading = headingMap[activeD.id] || 0;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    targetHeading = Math.atan2(dx, dy);
                }
                
                // Smoothing logic for heading
                let currentHeading = headingMap[activeD.id] || 0;
                let diff = targetHeading - currentHeading;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                currentHeading = currentHeading + diff * 0.1;
                headingMap[activeD.id] = currentHeading;

                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
                    orientation: {
                        heading: currentHeading,
                        pitch: activeD.mode === 'Charging' ? Cesium.Math.toRadians(-5) : Cesium.Math.toRadians(-15),
                        roll: 0.0
                    }
                });

                // Manually trigger render as we are in requestRenderMode
                viewer.scene.requestRender();
            });
            animId = requestAnimationFrame(frame);
        };

        animId = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(animId);
    }, [drones, commLinks, centerLocation]);

    return (
        <div style={{ position: 'fixed', left: '-5000px', top: 0, pointerEvents: 'none' }}>
            {drones.map(d => (
                <div 
                    key={`hidden-cam-${d.id}`}
                    ref={el => { containersRef.current[d.id] = el; }}
                    style={{ width: '480px', height: '360px' }} // Slightly higher internal resolution
                />
            ))}
        </div>
    );
};
