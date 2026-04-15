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
const HEADING_MAX_STEP = 0.03;
const HEADING_DEAD_ZONE = 0.006;
const CAMERA_POS_DEAD_ZONE = 0.000002;
const CAMERA_ALT_DEAD_ZONE = 0.5;

export const PersistentCameraEngine: React.FC<PersistentCameraEngineProps> = ({ drones, commLinks, centerLocation, onCanvasesReady }) => {
    const containersRef = useRef<Record<string, HTMLDivElement | null>>({});
    const viewersRef = useRef<Record<string, Cesium.Viewer>>({});
    const canvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
    const headingMapRef = useRef<Record<string, number>>({});
    const lastPositionRef = useRef<Record<string, { x: number; y: number }>>({});
    const cameraPoseRef = useRef<Record<string, { lng: number; lat: number; altitude: number }>>({});
    
    // Per-viewer entity tracking: { [viewerDroneId]: { [entityId]: Entity } }
    const markersPoolRef = useRef<Record<string, Record<string, Cesium.Entity>>>({});
    const commsLinesPoolRef = useRef<Record<string, Record<string, Cesium.Entity>>>({});

    const GRID_ORIGIN_LNG = centerLocation.lng - (GRID_W / 2) * CELL_DEG;
    const GRID_ORIGIN_LAT = centerLocation.lat + (GRID_H / 2) * CELL_DEG;
    const droneSignature = drones.map(drone => drone.id).join('|');

    const emitCanvases = () => {
        onCanvasesReady({ ...canvasesRef.current });
    };

    const gridToLngLat = (gx: number, gy: number): [number, number] => [
        GRID_ORIGIN_LNG + gx * CELL_DEG,
        GRID_ORIGIN_LAT - gy * CELL_DEG
    ];

    // Initialize viewers for each drone with high-fidelity assets
    useEffect(() => {
        const droneIds = new Set(drones.map(drone => drone.id));

        Object.keys(viewersRef.current).forEach(droneId => {
            if (droneIds.has(droneId)) return;

            viewersRef.current[droneId].destroy();
            delete viewersRef.current[droneId];
            delete canvasesRef.current[droneId];
            delete markersPoolRef.current[droneId];
            delete commsLinesPoolRef.current[droneId];
            delete containersRef.current[droneId];
            delete lastPositionRef.current[droneId];
            delete headingMapRef.current[droneId];
            delete cameraPoseRef.current[droneId];
        });

        drones.forEach(drone => {
            if (viewersRef.current[drone.id] || !containersRef.current[drone.id]) return;

            const initViewer = async () => {
                try {
                    const imageryProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
                    );

                    const container = containersRef.current[drone.id];
                    if (!container || !droneIds.has(drone.id)) return;

                    const viewer = new Cesium.Viewer(container, {
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
                        requestRenderMode: false, // Ensure constant rendering even when idle for smoother feed mirroring
                    });

                    // Optimization: Disable heavy features
                    viewer.scene.fog.enabled = false;
                    viewer.scene.shadowMap.enabled = false;
                    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

                    // Keep hidden viewers lightweight; terrain/buildings can starve one feed and leave it blank.
                    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
                    viewer.scene.globe.depthTestAgainstTerrain = false;

                    // Hide credits
                    const credits = container.querySelector('.cesium-widget-credits') as HTMLElement;
                    if (credits) credits.style.display = 'none';

                    viewersRef.current[drone.id] = viewer;
                    markersPoolRef.current[drone.id] = {};
                    commsLinesPoolRef.current[drone.id] = {};

                    canvasesRef.current[drone.id] = viewer.scene.canvas;
                    emitCanvases();
                } catch (e) {
                    console.error(`Failed to init Cesium for ${drone.id}`, e);
                }
            };

            void initViewer();
        });

        emitCanvases();

        return () => {
            Object.values(viewersRef.current).forEach(v => v.destroy());
            viewersRef.current = {};
            canvasesRef.current = {};
            markersPoolRef.current = {};
            commsLinesPoolRef.current = {};
            onCanvasesReady({});
        };
    }, [droneSignature, onCanvasesReady]);

    const getStableHeading = (drone: Drone) => {
        const last = lastPositionRef.current[drone.id];
        if (last) {
            const moveDx = drone.x - last.x;
            const moveDy = last.y - drone.y;

            if (Math.abs(moveDx) > HEADING_DEAD_ZONE || Math.abs(moveDy) > HEADING_DEAD_ZONE) {
                return Math.atan2(moveDx, moveDy);
            }
        }

        const tx = drone.tx - drone.x;
        const ty = -(drone.ty - drone.y);
        void tx;
        void ty;

        return headingMapRef.current[drone.id] ?? 0;
    };

    // Internal frame sync logic for each viewer
    useEffect(() => {
        let animId: number;

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

                const targetHeading = getStableHeading(activeD);

                // Smoothing logic for heading
                let currentHeading = headingMapRef.current[activeD.id] || 0;
                let diff = targetHeading - currentHeading;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                if (Math.abs(diff) < HEADING_DEAD_ZONE) {
                    currentHeading = targetHeading;
                } else {
                    currentHeading = currentHeading + Math.max(-HEADING_MAX_STEP, Math.min(HEADING_MAX_STEP, diff));
                }
                headingMapRef.current[activeD.id] = currentHeading;
                lastPositionRef.current[activeD.id] = { x: activeD.x, y: activeD.y };

                const smoothing = activeD.mode === 'Charging' ? 0.24 : 0.14;
                const pose = cameraPoseRef.current[activeD.id];
                if (!pose) {
                    cameraPoseRef.current[activeD.id] = { lng, lat, altitude };
                } else {
                    pose.lng += (lng - pose.lng) * smoothing;
                    pose.lat += (lat - pose.lat) * smoothing;
                    pose.altitude += (altitude - pose.altitude) * smoothing;

                    if (Math.abs(lng - pose.lng) < CAMERA_POS_DEAD_ZONE) pose.lng = lng;
                    if (Math.abs(lat - pose.lat) < CAMERA_POS_DEAD_ZONE) pose.lat = lat;
                    if (Math.abs(altitude - pose.altitude) < CAMERA_ALT_DEAD_ZONE) pose.altitude = altitude;
                }

                const finalPose = cameraPoseRef.current[activeD.id] ?? { lng, lat, altitude };

                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(finalPose.lng, finalPose.lat, finalPose.altitude),
                    orientation: {
                        heading: currentHeading,
                        pitch: activeD.mode === 'Charging' ? Cesium.Math.toRadians(-10) : Cesium.Math.toRadians(-28),
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
