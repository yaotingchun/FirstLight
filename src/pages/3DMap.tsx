import React, { useState, useEffect, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { fetchOSMFeatures } from '../utils/osmClient';
import { useSharedSimulation } from '../context/SimulationContext';

// --- CONFIG ---
const MAPTILER_KEY = 'SAX29oYdDKXlxm4RKRBu'; // API key
const DEFAULT_CENTER = { lat: 3.1319, lng: 101.6841 };

export interface HeatmapPoint {
    id: string;
    position: [number, number]; // [longitude, latitude]
    weight: number;
    type: string;
    name: string;
}

// Map OSM tags to baseline survival probabilities
const getProbabilityFromTags = (tags: any): number => {
    let prob = 0.2;
    if (!tags) return prob;

    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';

    if (['dormitory', 'residential', 'apartments', 'house'].includes(building)) {
        prob = 0.8 + Math.random() * 0.2;
    } else if (['university', 'college', 'school'].includes(building) || ['university', 'library', 'research_institute'].includes(amenity)) {
        prob = 0.5 + Math.random() * 0.2;
    } else if (['commercial', 'office'].includes(building) || ['clinic', 'hospital', 'food_court', 'restaurant'].includes(amenity)) {
        prob = 0.3 + Math.random() * 0.2;
    } else if (['pitch', 'stadium', 'park'].includes(leisure) || ['roof', 'garage'].includes(building)) {
        prob = 0.05 + Math.random() * 0.15;
    }
    return prob;
};

const ProbabilityMap3D: React.FC = () => {
    const { centerLocation } = useSharedSimulation();
    const [data, setData] = useState<HeatmapPoint[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    const [viewState, setViewState] = useState({
        longitude: centerLocation.lng || DEFAULT_CENTER.lng,
        latitude: centerLocation.lat || DEFAULT_CENTER.lat,
        zoom: 14,
        maxZoom: 18,
        pitch: 0,
        bearing: 0,
    });

    // Sync viewState when centerLocation changes
    useEffect(() => {
        setViewState(prev => ({
            ...prev,
            longitude: centerLocation.lng,
            latitude: centerLocation.lat,
            // Smoothly transition if needed, or just jump
        }));
    }, [centerLocation.lat, centerLocation.lng]);

    // Fetch building footprints and extract centroids
    const fetchOSMData = async () => {
        setLoading(true);
        const lat = centerLocation.lat || DEFAULT_CENTER.lat;
        const lng = centerLocation.lng || DEFAULT_CENTER.lng;
        const offset = 0.009;
        const bbox = `${(lat - offset).toFixed(4)},${(lng - offset).toFixed(4)},${(lat + offset).toFixed(4)},${(lng + offset).toFixed(4)}`;

        try {
            // Use the robust mirror-rotating client (now with built-in caching)
            const features = await fetchOSMFeatures(bbox);

            const points: HeatmapPoint[] = features.map((f) => {
                const type = f.tags?.building || f.tags?.leisure || 'unknown';
                const name = f.tags?.name || `Building ${f.id}`;
                return {
                    id: f.id,
                    position: [f.center.lon, f.center.lat],
                    weight: getProbabilityFromTags(f.tags),
                    type,
                    name
                };
            });

            setData(points);
        } catch (err: any) {
            console.error("Failed to load OSM data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOSMData();
    }, [centerLocation]);


    // Simulated Drone Scan Interaction Functionality
    const handleMapClick = useCallback((info: any, event: any) => {
        // Find if we clicked near a specific heat point
        if (info && info.coordinate) {
            const [clickLon, clickLat] = info.coordinate;

            // Interaction logic: Left click = Motion detected (higher prob), Alt+Left Click / Right Click = Clear (lower prob)
            // Need to update the state. Let's find points within a ~50m radius (approx 0.00045 degrees)
            const RADIUS = 0.00045;

            setData(prevData => {
                let changed = false;
                const newData = prevData.map(point => {
                    const dLon = point.position[0] - clickLon;
                    const dLat = point.position[1] - clickLat;
                    const distSq = (dLon * dLon) + (dLat * dLat);

                    if (distSq < (RADIUS * RADIUS)) {
                        changed = true;

                        // Modifier logic based on event.
                        // We use shiftKey to mimic a cleared scan here (since altKey/right click might be snagged by map controls)
                        const isClearScan = event.srcEvent.shiftKey || event.rightButton;

                        let newWeight = point.weight;
                        if (isClearScan) {
                            newWeight = newWeight * 0.5; // Simulate finding nothing
                        } else {
                            newWeight = Math.min(1.0, newWeight + 0.3); // Simulate finding motion/heat
                        }

                        return { ...point, weight: newWeight };
                    }
                    return point;
                });

                return changed ? newData : prevData;
            });
        }
    }, []);

    const layers = [
        new HeatmapLayer({
            id: 'probability-ground-heatmap',
            data,
            pickable: false,
            getPosition: (d: HeatmapPoint) => d.position,
            getWeight: (d: HeatmapPoint) => d.weight,
            radiusPixels: 40,
            intensity: 1.5,
            threshold: 0.05,
            colorRange: [
                [0, 0, 255, 0],         // Transparent blue for base
                [0, 0, 255, 120],       // Blue
                [0, 255, 0, 160],       // Green
                [255, 255, 0, 200],     // Yellow
                [255, 165, 0, 230],     // Orange
                [255, 0, 0, 255]        // Red peak
            ],
            updateTriggers: {
                getWeight: [data] // Ensure layer re-renders when data points change weights
            }
        }),
        // Add an invisible scatterplot layer to catch click events over the data points specifically,
        // or we can just rely on DeckGL's onClick prop on the canvas itself mapping to coordinates.
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#020608', height: '100%', gap: '16px', padding: '24px 20px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
            <header style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0, margin: 0 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#00ffcc', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'monospace', textShadow: '0 0 10px rgba(0, 255, 204, 0.4)' }}>
                        PREDICTIVE SURVIVOR HEATMAP
                    </h2>
                    <div style={{ color: '#6b8a8b', letterSpacing: '1px', fontSize: '0.75rem', marginTop: '6px', fontFamily: 'monospace' }}>
                        [PREDICTIVE ANALYSIS BASED ON ENVIRONMENTAL DATA]
                    </div>
                </div>
                <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', textAlign: 'right', marginBottom: '4px' }}>
                    {loading && <span style={{ color: 'var(--warning)' }}>FETCHING SATELLITE BUILDING DATA...</span>}
                    {!loading && data.length > 0 && <span style={{ color: '#00ffcc', opacity: 0.8 }}>LOADED {data.length} CENTROIDS SUCCESSFULLY</span>}
                </div>
            </header>

            <div style={{ flex: 1, position: 'relative', margin: 0, border: '1px solid var(--panel-border)', overflow: 'hidden' }} className="hud-panel">
                <DeckGL
                    layers={layers}
                    viewState={viewState}
                    onViewStateChange={e => setViewState(e.viewState as any)}
                    controller={true}
                    onClick={handleMapClick}
                    getCursor={() => 'crosshair'}
                >
                    <Map
                        mapStyle={`https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`}
                        reuseMaps
                    />
                </DeckGL>

                {/* Legend Overlay */}
                <div style={{ position: 'absolute', bottom: 24, left: 24, background: 'var(--panel-bg)', padding: '16px', border: '1px solid var(--panel-border)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', gap: '14px', zIndex: 10, width: '200px' }}>
                    <h4 className="hud-text" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>PROBABILITY DENSITY</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 14, height: 14, background: 'rgb(255, 0, 0)', flexShrink: 0 }}></div>
                        Critical (Res, ≥80%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 14, height: 14, background: 'rgb(255, 165, 0)', flexShrink: 0 }}></div>
                        High (Acad, ≥50%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 14, height: 14, background: 'rgb(0, 255, 0)', flexShrink: 0 }}></div>
                        Med (Office, ≥30%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 14, height: 14, background: 'rgba(0, 0, 255, 0.5)', flexShrink: 0 }}></div>
                        Low (Open, ≤20%)
                    </div>
 
                    <div style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid var(--panel-border)' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--warning)', marginBottom: '10px' }}>DRONE SIMULATION CONTROLS</h4>
                        <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            <strong>Left Click:</strong> <br/>+Heat (Motion detected)<br />
                            <strong>Shift + Click:</strong> <br/>-Heat (Area clear)<br />
                        </div>
                    </div>
                </div>
</div>

                <div style={{ position: 'absolute', top: 24, right: 24, padding: '12px', background: 'rgba(0, 255, 204, 0.1)', border: '1px dashed var(--accent-primary)', backdropFilter: 'blur(4px)', zIndex: 10 }}>
                    <div style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center' }}>
                        <span className="animate-pulse" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: loading ? '#ffcc00' : 'var(--accent-primary)', marginRight: 8 }}></span>
                        {loading ? 'SYNCING SATELLITE DATA...' : 'LIVE DATA FEED: ACTIVE'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProbabilityMap3D;

