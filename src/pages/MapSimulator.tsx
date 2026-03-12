import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { TextLayer, PolygonLayer } from '@deck.gl/layers';
import { gridDataService } from '../services/gridDataService';

// Center location (using the one from 3DMap.tsx for consistency)
const MAP_CENTER = { longitude: 101.6841, latitude: 3.1319 };
const BBOX_OFFSET = 0.009;
const GRID_CELLS = 20;
const DEG_STEP = (BBOX_OFFSET * 2) / GRID_CELLS; // 0.0009 degrees

export interface HeatmapPoint {
    id: string;
    position: [number, number]; // [longitude, latitude]
    weight: number;
    tags?: any;
}

export interface GridDataPoint {
    id: string;
    label: string;
    centroid: [number, number];
    polygon: [number, number][];
    weight: number;
    hasData: boolean;
}

const getProbabilityFromTags = (tags: any): number => {
    if (!tags) return 0.2;
    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';

    if (['dormitory', 'residential', 'apartments', 'house'].includes(building)) {
        return 0.8 + Math.random() * 0.2;
    }
    if (['university', 'college', 'library', 'research_institute'].includes(building) || 
        ['university', 'library', 'research_institute'].includes(amenity)) {
        return 0.5 + Math.random() * 0.2;
    }
    if (['commercial', 'office'].includes(building) || 
        ['clinic', 'hospital', 'restaurant'].includes(amenity)) {
        return (0.3 + Math.random() * 0.2);
    }
    if (['pitch', 'stadium', 'park'].includes(leisure) || 
        ['garage', 'roof'].includes(building)) {
        return 0.05 + Math.random() * 0.15;
    }
    return 0.2;
};

const MapSimulator: React.FC = () => {
    const [points, setPoints] = useState<HeatmapPoint[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [simRunning, setSimRunning] = useState<boolean>(false);

    const fetchOSMData = async () => {
        setLoading(true);
        setError(null);
        const bbox = `${(MAP_CENTER.latitude - BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.longitude - BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.latitude + BBOX_OFFSET).toFixed(4)},${(MAP_CENTER.longitude + BBOX_OFFSET).toFixed(4)}`;
        
        const query = `
            [out:json][timeout:25];
            (way["building"](${bbox}); way["leisure"="pitch"](${bbox}););
            out center;
        `;

        try {
            const url = `https://overpass-api.de/api/interpreter`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: "data=" + encodeURIComponent(query)
            });

            if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);
            const json = await response.json();
            
            const newPoints: HeatmapPoint[] = (json.elements || [])
                .filter((el: any) => el.center)
                .map((el: any) => ({
                    id: el.id.toString(),
                    position: [el.center.lon, el.center.lat],
                    weight: getProbabilityFromTags(el.tags),
                    tags: el.tags
                }));

            setPoints(newPoints);
        } catch (err: any) {
            console.error("OSM Fetch Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOSMData();
    }, []);

    // --- Markov Prediction Engine (Diffusion) ---
    useEffect(() => {
        if (!simRunning) return;

        const interval = setInterval(() => {
            setPoints(prevPoints => {
                // To simulate diffusion on a 20x20 grid using coordinate points:
                // We'll calculate a 'shift' for each point based on its virtual grid cell
                return prevPoints.map(p => {
                    const jitter = 0.0001; // Small movement simulation
                    const newLon = p.position[0] + (Math.random() - 0.5) * jitter;
                    const newLat = p.position[1] + (Math.random() - 0.5) * jitter;
                    
                    // Slightly decay weight to simulate uncertainty spreading
                    const newWeight = Math.max(0.1, p.weight * 0.98); 

                    return {
                        ...p,
                        position: [newLon, newLat],
                        weight: newWeight
                    };
                });
            });
        }, 5000);

        return () => clearInterval(interval);
    }, [simRunning]);

    const handleMapClick = useCallback((info: any, event: any) => {
        if (!info.coordinate) return;
        const [clickLon, clickLat] = info.coordinate;
        const RADIUS = 0.0005;

        setPoints(prevPoints => {
            return prevPoints.map(p => {
                const distSq = Math.pow(p.position[0] - clickLon, 2) + Math.pow(p.position[1] - clickLat, 2);
                if (distSq < RADIUS * RADIUS) {
                    const isShift = event.srcEvent.shiftKey;
                    let newWeight = isShift ? p.weight * 0.5 : p.weight + 0.3;
                    return { ...p, weight: Math.min(1.0, Math.max(0, newWeight)) };
                }
                return p;
            });
        });
    }, []);

    const gridData = useMemo(() => {
        const cells: GridDataPoint[] = [];
        const startLat = MAP_CENTER.latitude - BBOX_OFFSET;
        const startLon = MAP_CENTER.longitude - BBOX_OFFSET;

        for (let r = 0; r < GRID_CELLS; r++) {
            for (let c = 0; c < GRID_CELLS; c++) {
                const latMin = startLat + r * DEG_STEP;
                const lonMin = startLon + c * DEG_STEP;
                const centroid: [number, number] = [lonMin + DEG_STEP / 2, latMin + DEG_STEP / 2];

                // 1. Grid Map is now a full square (no radius clipping for cells)
                const pointsInside = points.filter(p => 
                    p.position[1] >= latMin && p.position[1] < latMin + DEG_STEP &&
                    p.position[0] >= lonMin && p.position[0] < lonMin + DEG_STEP
                );

                const avgWeight = pointsInside.length > 0 
                    ? pointsInside.reduce((sum, p) => sum + p.weight, 0) / pointsInside.length 
                    : 0;

                const rLabel = String.fromCharCode(65 + (GRID_CELLS - 1 - r));
                const cLabel = (c + 1).toString();

                cells.push({
                    id: `${rLabel}${cLabel}`,
                    label: `${rLabel}${cLabel}`,
                    centroid,
                    polygon: [
                        [lonMin, latMin],
                        [lonMin + DEG_STEP, latMin],
                        [lonMin + DEG_STEP, latMin + DEG_STEP],
                        [lonMin, latMin + DEG_STEP]
                    ],
                    weight: avgWeight,
                    hasData: pointsInside.length > 0
                });
            }
        }
        return cells;
    }, [points]);

    // --- Sync to Global Grid Service ---
    useEffect(() => {
        const weights: number[][] = Array.from({ length: 20 }, () => new Array(20).fill(0.05));
        gridData.forEach(d => {
            // d.id is rowLabel + colLabel e.g. "A1", "T20"
            const rowChar = d.id.charAt(0);
            const colNum = parseInt(d.id.substring(1));
            
            // Standardize: Index 0 = Row A (Top), Index 19 = Row T (Bottom)
            const r = rowChar.charCodeAt(0) - 65; 
            const c = colNum - 1;
            
            if (r >= 0 && r < 20 && c >= 0 && c < 20) {
                weights[r][c] = d.weight;
            }
        });
        gridDataService.setWeights(weights);
    }, [gridData]);

    const getGridColor = (d: GridDataPoint): [number, number, number, number] => {
        // Uniform background: No data or Low probability (<0.3) both use Tactical Blue
        if (!d.hasData || d.weight < 0.3) return [0, 80, 120, 150]; 
        
        if (d.weight >= 0.8) return [255, 0, 0, 200];
        if (d.weight >= 0.5) return [255, 165, 0, 200];
        if (d.weight >= 0.3) return [255, 255, 0, 200];
        return [0, 80, 120, 150];
    };

    const layers = [
        new PolygonLayer({
            id: 'grid-fill-layer',
            data: gridData,
            getPolygon: (d: GridDataPoint) => d.polygon,
            getFillColor: (d: GridDataPoint) => getGridColor(d),
            getLineColor: [0, 0, 0, 0],
            stroked: false,
            filled: true,
            pickable: false,
            updateTriggers: { getFillColor: [points, gridData] }
        }),
        new PolygonLayer({
            id: 'grid-stroke-layer',
            data: gridData,
            getPolygon: (d: GridDataPoint) => d.polygon,
            getFillColor: [0, 0, 0, 0],
            getLineColor: [255, 255, 255, 40],
            getLineWidth: 1,
            lineWidthUnits: 'pixels',
            stroked: true,
            filled: false,
            pickable: false,
            updateTriggers: { getLineColor: [gridData] }
        }),
        new TextLayer({
            id: 'grid-label-layer',
            data: gridData,
            getPosition: (d: GridDataPoint) => d.centroid,
            getText: (d: GridDataPoint) => d.label,
            getSize: 8,
            getColor: [255, 255, 255, 200],
            getAngle: 0,
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            updateTriggers: { getText: [gridData] }
        })
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
            <header style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }}>TACTICAL MISSION MAP</h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; 20X20 MISSION GRID | SECTOR A1-T20 ACTIVE</p>
                </div>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                        onClick={() => setSimRunning(!simRunning)} 
                        className="hud-btn" 
                        style={{ padding: '8px 16px', color: simRunning ? 'var(--warning)' : 'var(--accent-primary)', cursor: 'pointer' }}
                    >
                        {simRunning ? '[ PAUSE PREDICTION ]' : '[ START PREDICTION ]'}
                    </button>
                    <button 
                        onClick={fetchOSMData} 
                        className="hud-btn" 
                        style={{ padding: '8px 16px', cursor: 'pointer' }}
                    >
                        [ RESET FEED ]
                    </button>
                </div>
            </header>

            <div style={{ padding: '0 24px' }}>
                {loading && <p style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>Synchronizing with Overpass API...</p>}
                {error && <p style={{ color: '#ff4444', fontSize: '0.85rem' }}>Error: {error}</p>}
                {!loading && !error && (
                    <p style={{ color: 'var(--accent-primary)', fontSize: '0.85rem' }}>
                        Active Points: {points.length} | 
                        Status: {simRunning ? 'MARKOV DIFFUSION ACTIVE' : 'TACTICAL FEED STATIC'}
                    </p>
                )}
            </div>

            <div style={{ flex: 1, position: 'relative', margin: '0 24px 24px', border: '1px solid var(--panel-border)', overflow: 'hidden', backgroundColor: '#050a10' }} className="hud-panel">
                <DeckGL
                    initialViewState={{
                        longitude: MAP_CENTER.longitude,
                        latitude: MAP_CENTER.latitude,
                        zoom: 14.5,
                        pitch: 0,
                        bearing: 0
                    }}
                    controller={true}
                    layers={layers}
                    onClick={handleMapClick}
                    getCursor={() => 'crosshair'}
                />

                {/* Legend */}
                <div style={{ position: 'absolute', bottom: 24, left: 24, padding: '16px', backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
                    <h4 className="hud-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>TACTICAL PROBABILITY KEY</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {[
                            { label: 'Critical Area (≥0.8)', color: 'rgb(255, 0, 0)' },
                            { label: 'High Priority (≥0.5)', color: 'rgb(255, 165, 0)' },
                            { label: 'Moderate Area (≥0.3)', color: 'rgb(255, 255, 0)' },
                            { label: 'Minimal / Unknown (<0.3)', color: 'rgb(0, 80, 120)' }
                        ].map(item => (
                            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', color: 'var(--text-primary)' }}>
                                <div style={{ width: 12, height: 12, backgroundColor: item.color }}></div>
                                {item.label}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Status Indicator */}
                <div style={{ position: 'absolute', top: 24, right: 24, padding: '10px 16px', background: 'rgba(0, 255, 204, 0.05)', border: '1px dashed var(--accent-primary)', zIndex: 10 }}>
                    <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="animate-pulse" style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-primary)' }}></span>
                        {loading ? 'DOWNLOADING OSM SECTOR DATA...' : 'SYSTEM READY: RADIUS FILTER ACTIVE'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapSimulator;
