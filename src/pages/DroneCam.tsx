import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Camera, Settings, Target, Hexagon, Zap } from 'lucide-react';

// Required for mapbox-gl to work
mapboxgl.accessToken = "pk.eyJ1IjoieWFvdGluZ2NodW4iLCJhIjoiY21tZ2x1MW9yMGtlMDJ3b2ozaGNhd3ZnZyJ9.d5zcnqiWRPTcoYewN9d-YA";

const EPICENTER = { lng: 103.7414, lat: 1.4927 };
const MAGNITUDE = 6.8;

const haversine = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const computeDamage = (lng: number, lat: number) => {
    let d = haversine(lng, lat, EPICENTER.lng, EPICENTER.lat);
    let intensity = MAGNITUDE / (d + 0.1);
    if (intensity > 4) return { level: 3, factor: 0.1 }; // destroyed
    if (intensity > 2) return { level: 2, factor: 0.4 }; // partially collapsed
    if (intensity > 1) return { level: 1, factor: 0.8 }; // cracked
    return { level: 0, factor: 1.0 }; // normal
};

const DRONE_TARGETS: Record<string, { lng: number, lat: number }> = {
    'DRN-01 (Lead)': { lng: 103.7414, lat: 1.4927 },
    'DRN-02 (Scout)': { lng: 103.7430, lat: 1.4910 },
    'DRN-03 (Scout)': { lng: 103.7390, lat: 1.4950 },
    'DRN-04 (Relay)': { lng: 103.7450, lat: 1.4940 },
    'DRN-05 (Heavy)': { lng: 103.7370, lat: 1.4920 },
};

const DroneCam: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const orbitCenter = useRef(DRONE_TARGETS['DRN-01 (Lead)']);
    const [zoom, setZoom] = useState(18);
    const [damageCalculated, setDamageCalculated] = useState(false);
    const [activeDrone, setActiveDrone] = useState('DRN-01 (Lead)');
    const [logs, setLogs] = useState<{ id: string; time: string; msg: string }[]>([
        { id: '1', time: new Date().toLocaleTimeString(), msg: 'SYSTEM: Swarm initialization sequence complete.' },
        { id: '2', time: new Date().toLocaleTimeString(), msg: 'DRN-01: Establishing secure satellite uplink...' },
        { id: '3', time: new Date().toLocaleTimeString(), msg: 'Swarm Intelligence: Map data synchronized.' }
    ]);

    // Handle drone switch
    const handleDroneSwitch = (droneName: string) => {
        setActiveDrone(droneName);
        const newTarget = DRONE_TARGETS[droneName];
        if (newTarget) {
            orbitCenter.current = newTarget;
            // Immediate jump to new location to make it obvious
            if (map.current) {
                map.current.jumpTo({
                    center: [newTarget.lng, newTarget.lat],
                    zoom: 18,
                    bearing: (map.current.getBearing() || 0)
                });
            }
        }
    };

    // Simulate logs
    useEffect(() => {
        const logOptions = [
            "DRN-02: Battery at 88%. Scanning sector B-4.",
            "Swarm: Collaborative search pattern adjusted for terrain.",
            "DRN-05: Signal interference detected. Rerouting via DRN-01.",
            "SYSTEM: Visual enhancement filter: PANDOPTIC active.",
            "DRN-03: Structural anomaly identified at 103.74, 1.49.",
            "Swarm: Survivor probability heatmap updated.",
            "DRN-01: Altitude stabilized at 300m.",
            "Swarm: Rebalancing search density in high-risk zones."
        ];

        const interval = setInterval(() => {
            const newLog = {
                id: Math.random().toString(36).substr(2, 9),
                time: new Date().toLocaleTimeString(),
                msg: logOptions[Math.floor(Math.random() * logOptions.length)]
            };
            setLogs(prev => [newLog, ...prev].slice(0, 50));
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        console.log("DroneCam: Effect triggered. Token:", mapboxgl.accessToken?.substring(0, 15));
        if (map.current || !mapContainer.current) return;

        console.log("DroneCam: Creating Map instance...");
        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/satellite-v9', // standard fallback if token is bad
                center: [orbitCenter.current.lng, orbitCenter.current.lat],
                zoom: zoom,
                pitch: 60,
                bearing: -20,
                antialias: true // For smooth 3d buildings
            }).on('error', (e) => {
                console.error("Mapbox Error:", e);
            });
        } catch (err) {
            console.error("Mapbox Init Exception:", err);
        }

        const currentMap = map.current; // capture for cleanup
        if (!currentMap) return;

        currentMap.on('load', () => {
            // Add 3D building layer
            currentMap.addLayer({
                id: "3d-buildings",
                source: "composite",
                "source-layer": "building",
                filter: ["==", "extrude", "true"],
                type: "fill-extrusion",
                paint: {
                    // Color based on damage state
                    "fill-extrusion-color": [
                        'case',
                        ['==', ['feature-state', 'damageLevel'], 3], '#441111',
                        ['==', ['feature-state', 'damageLevel'], 2], '#884422',
                        ['==', ['feature-state', 'damageLevel'], 1], '#999966',
                        '#aaaaaa' // normal default
                    ],
                    // Apply damage factor to height
                    "fill-extrusion-height": [
                        '*',
                        ['get', 'height'],
                        ['coalesce', ['feature-state', 'damageFactor'], 1.0]
                    ],
                    "fill-extrusion-base": ["get", "min_height"],
                    "fill-extrusion-opacity": 0.8
                }
            });

            // Epicenter Marker using a Mapbox GL Point
            currentMap.addSource('epicenter', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'Point', coordinates: [EPICENTER.lng, EPICENTER.lat] }
                }
            });
            currentMap.addLayer({
                id: 'epicenter-glow',
                type: 'circle',
                source: 'epicenter',
                paint: {
                    'circle-radius': 40,
                    'circle-color': '#ff4444',
                    'circle-opacity': 0.3,
                    'circle-blur': 1
                }
            });
            currentMap.addLayer({
                id: 'epicenter-dot',
                type: 'circle',
                source: 'epicenter',
                paint: {
                    'circle-radius': 8,
                    'circle-color': '#ff0000',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                }
            });

            // Evaluate building damage when map is idle (tiles loaded)
            currentMap.on('idle', () => {
                if (damageCalculated) return;

                try {
                    const features = currentMap.queryRenderedFeatures({ layers: ['3d-buildings'] });
                    if (features.length > 0) {
                        const processedIds = new Set();
                        features.forEach(f => {
                            // Some buildings might lack an id; Mapbox feature-state requires id
                            // If missing, we can't reliably apply feature-state unless we assign IDs via a GeoJSON source, 
                            // but composite vector tiles usually have feature.id
                            if (f.id && !processedIds.has(f.id)) {
                                processedIds.add(f.id);

                                // Get center approximation
                                let lng = EPICENTER.lng; let lat = EPICENTER.lat;
                                if (f.geometry.type === 'Polygon') {
                                    lng = f.geometry.coordinates[0][0][0];
                                    lat = f.geometry.coordinates[0][0][1];
                                }

                                const damage = computeDamage(lng, lat);

                                currentMap.setFeatureState(
                                    { source: 'composite', sourceLayer: 'building', id: f.id },
                                    { damageLevel: damage.level, damageFactor: damage.factor }
                                );
                            }
                        });
                        setDamageCalculated(true);
                    }
                } catch (e) {
                    console.log("Error evaluating damage", e);
                }
            });
        });

        // Force per-frame updates to simulate drone flight
        let animationId: number;
        let angle = 0;
        const radius = 0.001;

        const animateFlight = () => {
            if (currentMap) {
                angle += 0.0005; // orbit speed

                // Constantly push the map center to create orbit effect
                const newLng = orbitCenter.current.lng + radius * Math.cos(angle);
                const newLat = orbitCenter.current.lat + radius * Math.sin(angle);

                // Sweep bearing
                const newBearing = (currentMap.getBearing() + 0.1) % 360;

                currentMap.setCenter([newLng, newLat]);
                currentMap.setBearing(newBearing);
            }
            animationId = requestAnimationFrame(animateFlight);
        };

        // Start animation once styles load
        currentMap.once('idle', () => {
            animateFlight();
        });

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
            if (currentMap) {
                currentMap.remove();
                map.current = null;
            }
        };
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', paddingTop: '40px' }}>
            <header style={{ paddingLeft: '20px' }}>
                <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Camera size={24} /> DRONE CAM OPTICS
                </h2>
                <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; LIVE UPLINK: KH11-4166 OPS-4117 // TOWER BRIDGE REGION</p>
            </header>

            <div style={{ flex: 1, display: 'flex', background: 'var(--bg-color)', overflow: 'hidden' }}>
                <div className="drone-container">

                    {/* LEFT PANEL: RECTANGULAR MAP */}
                    <div className="drone-view">
                        <div id="map" ref={mapContainer} style={{ width: '100%', height: '100%', background: '#000' }} />
                        <div className="drone-crt-lines" />
                        <div className="drone-hud-overlay" />
                        <div className="drone-telemetry">
                            {activeDrone} • LAT: {orbitCenter.current.lat.toFixed(4)} LON: {orbitCenter.current.lng.toFixed(4)} • ALT: 300M • REC
                        </div>
                    </div>

                    {/* RIGHT PANEL: DRONE SELECT & LOGS */}
                    <div className="drone-side-panel">
                        <div className="hud-panel flex-col" style={{ padding: '20px', gap: '20px' }}>
                            <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '15px', flexShrink: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>SELECT ACTIVE ASSET</label>
                                <select
                                    className="drone-select"
                                    value={activeDrone}
                                    onChange={(e) => handleDroneSwitch(e.target.value)}
                                >
                                    <option>DRN-01 (Lead)</option>
                                    <option>DRN-02 (Scout)</option>
                                    <option>DRN-03 (Scout)</option>
                                    <option>DRN-04 (Relay)</option>
                                    <option>DRN-05 (Heavy)</option>
                                </select>
                            </div>

                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <label className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block', flexShrink: 0 }}>SWARM INTELLIGENCE LOGS</label>
                                <div className="log-feed">
                                    {logs.map(log => (
                                        <div key={log.id} className="log-entry">
                                            <span className="log-time">[{log.time}]</span>
                                            <span className="log-msg">{log.msg}</span>
                                        </div>
                                    ))}
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
