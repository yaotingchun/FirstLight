import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { gridDataService, type GridSource, type TerrainType } from '../services/gridDataService';
import { fetchOSMFeatures } from '../utils/osmClient';
import { useSharedSimulation } from '../context/SimulationContext';

// Default constants
const DEFAULT_MAP_CENTER = { longitude: 101.6841, latitude: 3.1319 };
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
    weight: number;
    hasData: boolean;
    terrain: TerrainType;
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
        return 0.3 + Math.random() * 0.2;
    }
    if (['pitch', 'stadium', 'park'].includes(leisure) || 
        ['garage', 'roof'].includes(building)) {
        return 0.05 + Math.random() * 0.15;
    }
    return 0.2;
};

/** Map OSM tags → SimulationMap terrain type */
const getTerrainFromTags = (tags: any): TerrainType => {
    if (!tags) return 'Open Field';
    const building = tags.building || '';
    const amenity = tags.amenity || '';
    const leisure = tags.leisure || '';
    const highway = tags.highway || '';

    // Residential / shelter-type buildings
    if (['dormitory', 'residential', 'apartments', 'house', 'university',
         'college', 'library', 'commercial', 'office'].includes(building) ||
        ['clinic', 'hospital', 'restaurant', 'university', 'library'].includes(amenity)) {
        return 'Shelter';
    }
    // Damaged / ruins
    if (['ruins', 'collapsed', 'damaged'].includes(building) ||
        building === 'yes') {
        return 'Collapsed Area';
    }
    // Roads / open paved areas
    if (highway || ['pitch', 'stadium', 'park'].includes(leisure) ||
        ['garage', 'roof'].includes(building)) {
        return 'Road';
    }
    return 'Open Field';
};

const MapSimulator: React.FC = () => {
    const { centerLocation } = useSharedSimulation();
    const [points, setPoints] = useState<HeatmapPoint[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [scanOverlay, setScanOverlay] = useState<number[][] | null>(null);
    const [activeSource, setActiveSource] = useState<GridSource | null>(null);

    // Use context location or default
    const mapCenter = useMemo(() => ({
        latitude: centerLocation.lat || DEFAULT_MAP_CENTER.latitude,
        longitude: centerLocation.lng || DEFAULT_MAP_CENTER.longitude
    }), [centerLocation]);

    // Subscribe to gridDataService — when scan writes arrive, overlay them on the map
    useEffect(() => {
        const unsubscribe = gridDataService.subscribe((newWeights) => {
            const src = gridDataService.getActiveSource();
            setActiveSource(src);

            if (src === 'scan') {
                setScanOverlay(newWeights);
            } else {
                setScanOverlay(null);
            }
        });
        return unsubscribe;
    }, []);

    // Listen for centralized terrain updates (location changes)
    useEffect(() => {
        const handleTerrainChange = () => {
            if (gridDataService.isTerrainReady()) {
                const rawPoints = gridDataService.getOSMPoints();
                const mappedPoints: HeatmapPoint[] = rawPoints.map((f: any) => ({
                    id: f.id,
                    position: [f.center.lon, f.center.lat],
                    weight: getProbabilityFromTags(f.tags),
                    tags: f.tags
                }));
                setPoints(mappedPoints);
                setLoading(false);
            } else {
                setLoading(true);
            }
        };

        const unsubscribe = gridDataService.subscribeTerrain(handleTerrainChange);
        handleTerrainChange(); // Initial sync
        return unsubscribe;
    }, []);




    const handleMapClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        
        const scaleX = 700 / rect.width;
        const scaleY = 700 / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const col = Math.floor(x / 35);
        const row = Math.floor(y / 35);

        const rIndex = 19 - row; 
        const cIndex = col;

        const startLat = mapCenter.latitude - BBOX_OFFSET;
        const startLon = mapCenter.longitude - BBOX_OFFSET;
        const clickLon = startLon + cIndex * DEG_STEP + DEG_STEP / 2;
        const clickLat = startLat + rIndex * DEG_STEP + DEG_STEP / 2;

        const RADIUS = 0.0005;
        const isShift = e.shiftKey;

        setPoints(prevPoints => {
            return prevPoints.map(p => {
                const distSq = Math.pow(p.position[0] - clickLon, 2) + Math.pow(p.position[1] - clickLat, 2);
                if (distSq < RADIUS * RADIUS) {
                    let newWeight = isShift ? p.weight * 0.5 : p.weight + 0.3;
                    return { ...p, weight: Math.min(1.0, Math.max(0, newWeight)) };
                }
                return p;
            });
        });
    }, []);

    const gridData = useMemo(() => {
        const cells: GridDataPoint[] = [];
        const startLat = mapCenter.latitude - BBOX_OFFSET;
        const startLon = mapCenter.longitude - BBOX_OFFSET;

        for (let r = 0; r < GRID_CELLS; r++) {
            for (let c = 0; c < GRID_CELLS; c++) {
                const latMin = startLat + r * DEG_STEP;
                const lonMin = startLon + c * DEG_STEP;

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

                let cellTerrain: TerrainType = 'Open Field';
                if (pointsInside.length > 0) {
                    const counts: Record<TerrainType, number> = {
                        'Open Field': 0, 'Road': 0, 'Shelter': 0, 'Collapsed Area': 0
                    };
                    pointsInside.forEach(p => { counts[getTerrainFromTags(p.tags)]++; });
                    cellTerrain = (Object.entries(counts) as [TerrainType, number][])
                        .sort((a, b) => b[1] - a[1])[0][0];
                }

                cells.push({
                    id: `${rLabel}${cLabel}`,
                    weight: avgWeight,
                    hasData: pointsInside.length > 0,
                    terrain: cellTerrain
                });
            }
        }
        return cells;
    }, [points]);

    // Merge scan overlay into display grid when scan data is active
    const displayGrid = useMemo(() => {
        if (!scanOverlay) return gridData;
        return gridData.map(cell => {
            const rowChar = cell.id.charAt(0);
            const colNum = parseInt(cell.id.substring(1));
            const r = rowChar.charCodeAt(0) - 65;
            const c = colNum - 1;
            if (r >= 0 && r < 20 && c >= 0 && c < 20) {
                const scanW = scanOverlay[r]?.[c] ?? 0;
                // Use the higher of OSM prediction or scan probability
                const mergedWeight = Math.max(cell.weight, scanW);
                return { ...cell, weight: mergedWeight, hasData: cell.hasData || scanW > 0.05 };
            }
            return cell;
        });
    }, [gridData, scanOverlay]);

    // --- Sync to Global Grid Service ---
    useEffect(() => {
        // Only push prediction weights when scan is NOT active
        if (activeSource === 'scan') return;
        const weights: number[][] = Array.from({ length: 20 }, () => new Array(20).fill(0.05));
        gridData.forEach(d => {
            const rowChar = d.id.charAt(0);
            const colNum = parseInt(d.id.substring(1));
            const r = rowChar.charCodeAt(0) - 65; 
            const c = colNum - 1;
            if (r >= 0 && r < 20 && c >= 0 && c < 20) {
                weights[r][c] = d.weight;
            }
        });
        gridDataService.setWeights(weights, 'prediction');
    }, [gridData, activeSource]);

    // --- Sync terrain grid from OSM tags → gridDataService ---
    useEffect(() => {
        const terrain: TerrainType[][] = Array.from({ length: 20 }, () =>
            new Array<TerrainType>(20).fill('Open Field')
        );
        gridData.forEach(d => {
            const rowChar = d.id.charAt(0);
            const colNum = parseInt(d.id.substring(1));
            const r = rowChar.charCodeAt(0) - 65; 
            const c = colNum - 1;
            if (r >= 0 && r < 20 && c >= 0 && c < 20) {
                terrain[r][c] = d.terrain;
            }
        });
        gridDataService.setTerrainGrid(terrain);
    }, [gridData]);



    return (
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#020608', height: '100%', gap: '16px', padding: '24px 20px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
            <header style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0, margin: 0 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#00ffcc', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'monospace', textShadow: '0 0 10px rgba(0, 255, 204, 0.4)' }}>
                        TACTICAL HEATMAP
                    </h2>
                    <div style={{ color: '#6b8a8b', letterSpacing: '1px', fontSize: '0.75rem', marginTop: '6px', fontFamily: 'monospace' }}>
                        [ADAPTIVE PREDICTIVE MODELING]
                    </div>
                </div>
            </header>

            <div style={{ padding: 0 }}>
                {loading && <p style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>Synchronizing with Overpass API...</p>}
                {!loading && (
                    <p className="hud-text" style={{ color: activeSource === 'scan' ? '#ffff00' : 'var(--accent-primary)', fontSize: '0.85rem' }}>
                        Active Points: {points.length} | 
                        Status: {activeSource === 'scan' ? 'RECEIVING LIVE SCAN DATA' : 'TACTICAL FEED STATIC'}
                    </p>
                )}
            </div>

            <div style={{ flex: 1, position: 'relative', margin: 0, border: '1px solid var(--panel-border)', overflow: 'hidden', backgroundColor: '#050a10', display: 'flex', justifyContent: 'center', alignItems: 'center' }} className="hud-panel">
                <svg 
                    width="100%" 
                    height="100%" 
                    viewBox="0 0 700 700" 
                    preserveAspectRatio="xMidYMid meet"
                    style={{ backgroundColor: '#050a10', cursor: 'crosshair', maxWidth: '100%', maxHeight: '100%' }}
                    onClick={handleMapClick}
                >
                    {displayGrid.map((d) => {
                        const r = d.id.charCodeAt(0) - 65; 
                        const c = parseInt(d.id.substring(1)) - 1; 
                        const x = c * 35;
                        const y = r * 35;

                        const alpha = !d.hasData || d.weight === 0 ? 0 : 0.05 + d.weight * 0.75;
                        const fill = alpha === 0 ? 'transparent' : `rgba(255, 68, 68, ${alpha})`;
                        const stroke = (d.hasData && d.weight > 0) ? 'rgba(0, 255, 204, 0.2)' : 'rgba(0, 255, 204, 0.05)';

                        return (
                            <React.Fragment key={d.id}>
                                <rect x={x} y={y} width="35" height="35" fill={fill} stroke={stroke} strokeWidth="1" />
                                {d.terrain === 'Shelter' && (
                                    <rect x={x + 4} y={y + 4} width="27" height="27" fill="rgba(60, 150, 255, 0.1)" stroke="rgba(60, 150, 255, 0.3)" />
                                )}
                                {d.terrain === 'Road' && (
                                    <line x1={x} y1={y + 17.5} x2={x + 35} y2={y + 17.5} stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeDasharray="4" />
                                )}
                            </React.Fragment>
                        );
                    })}
                </svg>

                {/* Legend */}
                <div style={{ position: 'absolute', bottom: 24, left: 24, padding: '16px', backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
                    <h4 className="hud-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>TACTICAL PROBABILITY KEY</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {[
                            { label: 'Critical Area (≥0.8)', color: `rgba(255, 68, 68, ${0.05 + 0.8 * 0.75})`, border: 'none' },
                            { label: 'High Priority (≥0.5)', color: `rgba(255, 68, 68, ${0.05 + 0.5 * 0.75})`, border: 'none' },
                            { label: 'Moderate Area (≥0.3)', color: `rgba(255, 68, 68, ${0.05 + 0.3 * 0.75})`, border: 'none' },
                            { label: 'Minimal / Unknown (<0.3)', color: 'transparent', border: '1px solid rgba(0, 255, 204, 0.2)' }
                        ].map(item => (
                            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', color: 'var(--text-primary)' }}>
                                <div style={{ width: 12, height: 12, backgroundColor: item.color, border: item.border }}></div>
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