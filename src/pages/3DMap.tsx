import React, { useState, useEffect, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

// UTM Johor Bahru, Malaysia
const MAP_CENTER = { longitude: 101.6841, latitude: 3.1319 };

export interface HeatmapPoint {
    id: string;
    position: [number, number]; // [longitude, latitude]
    weight: number;
    type: string;
    name: string;
}

// Map OSM tags to baseline survival probabilities
const getProbabilityFromTags = (tags: any): number => {
    // Default low probability for unknown structures
    let prob = 0.2;

    if (!tags) return prob;

    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';

    // Residential / Hostels -> High Probability (0.8 - 1.0)
    if (
        building === 'dormitory' ||
        building === 'residential' ||
        building === 'apartments' ||
        building === 'house'
    ) {
        prob = 0.8 + Math.random() * 0.2;
    }
    // Academic Buildings -> Medium Probability (0.5 - 0.7)
    else if (
        building === 'university' ||
        building === 'college' ||
        building === 'school' ||
        amenity === 'university' ||
        amenity === 'library' ||
        amenity === 'research_institute'
    ) {
        prob = 0.5 + Math.random() * 0.2;
    }
    // Administrative / General -> Medium-Low (0.3 - 0.5)
    else if (
        building === 'commercial' ||
        building === 'office' ||
        amenity === 'clinic' ||
        amenity === 'hospital' ||
        amenity === 'food_court' ||
        amenity === 'restaurant'
    ) {
        prob = 0.3 + Math.random() * 0.2;
    }
    // Open areas / Sports fields -> Very Low (0.05 - 0.2)
    else if (
        leisure === 'pitch' ||
        leisure === 'stadium' ||
        leisure === 'park' ||
        building === 'roof' ||
        building === 'garage'
    ) {
        prob = 0.05 + Math.random() * 0.15;
    }

    return prob;
};

const ProbabilityMap3D: React.FC = () => {
    const [data, setData] = useState<HeatmapPoint[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    // Fetch building footprints and extract centroids from Overpass API
    const fetchOSMData = async () => {
        setLoading(true);

        // Define bounding box around MAP_CENTER (~1km radius)
        // south, west, north, east
        const offset = 0.009;
        const bbox = `${(MAP_CENTER.latitude - offset).toFixed(4)},${(MAP_CENTER.longitude - offset).toFixed(4)},${(MAP_CENTER.latitude + offset).toFixed(4)},${(MAP_CENTER.longitude + offset).toFixed(4)}`;

        // Overpass QL query:
        // [out:json];
        // (
        //   way["building"](1.5400,103.6200,1.5750,103.6550);
        //   way["leisure"="pitch"](1.5400,103.6200,1.5750,103.6550);
        // );
        // out center;
        const query = `
            [out:json][timeout:25];
            (
              way["building"](${bbox});
              way["leisure"="pitch"](${bbox});
            );
            out center;
        `;

        try {
            const url = `https://overpass-api.de/api/interpreter`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: "data=" + encodeURIComponent(query)
            });

            if (!response.ok) {
                throw new Error(`Overpass API returned ${response.status}: ${response.statusText}`);
            }

            const json = await response.json();

            const points: HeatmapPoint[] = [];

            if (json.elements && json.elements.length > 0) {
                json.elements.forEach((el: any) => {
                    // Overpass 'out center' provides the calculated center of the way in 'center'
                    if (el.center && el.center.lat && el.center.lon) {
                        const weight = getProbabilityFromTags(el.tags);
                        const type = el.tags?.building || el.tags?.leisure || 'unknown';
                        const name = el.tags?.name || `Building ${el.id}`;

                        points.push({
                            id: el.id.toString(),
                            position: [el.center.lon, el.center.lat],
                            weight,
                            type,
                            name
                        });
                    }
                });
            }

            setData(points);
        } catch (err: any) {
            console.error("Failed to load OSM data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOSMData();
    }, []);

    const INITIAL_VIEW_STATE = {
        longitude: MAP_CENTER.longitude,
        latitude: MAP_CENTER.latitude,
        zoom: 14,
        maxZoom: 18,
        pitch: 0,
        bearing: 0,
    };

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
                    initialViewState={INITIAL_VIEW_STATE}
                    controller={true}
                    onClick={handleMapClick}
                    getCursor={() => 'crosshair'}
                >
                    {/* CARTO Dark Matter Raster Tiles */}
                    <Map
                        mapStyle={{
                            version: 8,
                            sources: {
                                'carto-dark': {
                                    type: 'raster',
                                    tiles: [
                                        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                                    ],
                                    tileSize: 256,
                                    attribution: '&copy; OpenStreetMap Contributors &copy; CARTO'
                                }
                            },
                            layers: [
                                {
                                    id: 'carto-dark-tiles',
                                    type: 'raster',
                                    source: 'carto-dark',
                                    minzoom: 0,
                                    maxzoom: 19
                                }
                            ]
                        }}
                        reuseMaps
                    />
                </DeckGL>

                {/* Legend Overlay */}
                <div style={{ position: 'absolute', bottom: 24, left: 24, background: 'var(--panel-bg)', padding: '16px', border: '1px solid var(--panel-border)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 10 }}>
                    <h4 className="hud-text" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>PROBABILITY DENSITY</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(255, 0, 0)' }}></div>
                        Critical (Residential, ≥80%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(255, 165, 0)' }}></div>
                        High (Academic, ≥50%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(0, 255, 0)' }}></div>
                        Medium (Offices, ≥30%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgba(0, 0, 255, 0.5)' }}></div>
                        Low (Fields/Open, ≤20%)
                    </div>

                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--panel-border)' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--warning)', marginBottom: '8px' }}>DRONE SIMULATION CONTROLS</h4>
                        <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            <strong>Left Click:</strong> +Heat (Motion detected)<br />
                            <strong>Shift + Left Click:</strong> -Heat (Area clear)<br />
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

