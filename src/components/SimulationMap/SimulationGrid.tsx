import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Radio, MapPin, X } from 'lucide-react';
import {
    GRID_W, GRID_H, CELL_SIZE, BASE_STATION, COMM_RANGE_BASE, COMM_RANGE_RELAY
} from '../../types/simulation';
import type { Sector, Drone, CommEdge, HiddenSurvivor, FoundPin } from '../../types/simulation';

interface SimulationGridProps {
    grid: Sector[][];
    drones: Drone[];
    commLinks: CommEdge[];
    survivors: HiddenSurvivor[];
    pins: FoundPin[];
    selectedPin: FoundPin | null;
    setSelectedPin: (pin: FoundPin | null) => void;
    showSensors: boolean;
    showTrails: boolean;
    setShowTrails: (show: boolean) => void;
    selectedTrailDroneId: string | 'all';
    setSelectedTrailDroneId: (id: string | 'all') => void;
    getSectorProbability: (x: number, y: number) => number;
    time: number;
    aiDisconnectedRef: React.MutableRefObject<Set<string>>;
    aiReconnectedUntilTickRef: React.MutableRefObject<Map<string, number>>;
    cameraPopupDroneId: string | null;
    setCameraPopupDroneId: (id: string | null) => void;
}

export const getDroneThemeColor = (id?: string) => {
    if (!id) return '#9db1c1';
    if (id === 'ORCHESTRATOR') return '#00ffcc';
    if (id.includes('Alpha')) return '#4da3ff';
    if (id.includes('Beta')) return '#51cf66';
    if (id.includes('Gamma')) return '#f06595';
    if (id.includes('Delta')) return '#fcc419';
    if (id.startsWith('RLY')) return '#ff922b';
    return '#adb5bd';
};

export const SimulationGrid: React.FC<SimulationGridProps> = ({
    grid, drones, commLinks, survivors, pins,
    selectedPin, setSelectedPin, showSensors,
    showTrails, setShowTrails, selectedTrailDroneId, setSelectedTrailDroneId,
    getSectorProbability, time, aiDisconnectedRef, aiReconnectedUntilTickRef,
    cameraPopupDroneId, setCameraPopupDroneId
}) => {
    const [is3D, setIs3D] = useState(false);
    const [scanlineActive, setScanlineActive] = useState(false);
    const scanlineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [angleX, setAngleX] = useState(55);
    const [angleZ, setAngleZ] = useState(45);
    const [isDraggingMap, setIsDraggingMap] = useState(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const dragStartPosRef = useRef({ x: 0, y: 0 });

    // Trigger scanline effect on view transition
    const triggerScanline = useCallback(() => {
        setScanlineActive(true);
        if (scanlineTimeoutRef.current) clearTimeout(scanlineTimeoutRef.current);
        scanlineTimeoutRef.current = setTimeout(() => setScanlineActive(false), 1100);
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (scanlineTimeoutRef.current) clearTimeout(scanlineTimeoutRef.current);
        };
    }, []);

    const handleDroneClick = (droneId: string) => {
        if (cameraPopupDroneId === droneId) {
            // Clicking same drone again — close popup and return to 2D
            setCameraPopupDroneId(null);
            setIs3D(false);
            triggerScanline();
        } else {
            // Open popup and tilt to 3D
            setCameraPopupDroneId(droneId);
            if (!is3D) {
                setAngleX(55);
                setAngleZ(45);
                setIs3D(true);
                triggerScanline();
            }
        }
    };

    const handleEmptyDoubleClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (is3D) {
            setIs3D(false);
            setCameraPopupDroneId(null);
            triggerScanline();
        }
    }, [is3D, setCameraPopupDroneId, triggerScanline]);

    const handleClosePopup = useCallback(() => {
        setCameraPopupDroneId(null);
        setIs3D(false);
        triggerScanline();
    }, [setCameraPopupDroneId, triggerScanline]);

    const activeDroneForPopup = drones.find(d => d.id === cameraPopupDroneId);

    const SVG_W = GRID_W * CELL_SIZE;
    const SVG_H = GRID_H * CELL_SIZE;

    return (
        <div className="hud-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* ── Perspective Container ── */}
            <div style={{
                perspective: '800px',
                perspectiveOrigin: '50% 50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                position: 'relative',
            }}>
                {/* ── 3D Atmospheric Vignette ── */}
                {is3D && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 1,
                        background: 'radial-gradient(ellipse at 50% 80%, transparent 30%, rgba(0,10,6,0.7) 70%, rgba(0,5,3,0.95) 100%)',
                        transition: 'opacity 1s ease',
                    }} />
                )}
                {/* ── CRT Scanlines Overlay in 3D ── */}
                {is3D && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 2,
                        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,159,0.015) 2px, rgba(0,255,159,0.015) 4px)',
                        mixBlendMode: 'screen',
                    }} />
                )}
                {/* ── Unified Grid + Overlay Container ── */}
                <div
                    style={{
                        position: 'relative',
                        width: SVG_W,
                        height: SVG_H,
                        flexShrink: 0,
                        transform: is3D ? `rotateX(${angleX}deg) rotateZ(${angleZ}deg) scale(0.65)` : 'rotateX(0deg) rotateZ(0deg) scale(1)',
                        transformOrigin: '50% 50%',
                        transition: isDraggingMap ? 'none' : 'transform 1s cubic-bezier(0.4, 0, 0.2, 1), border 0.5s ease, box-shadow 1s ease',
                        transformStyle: 'preserve-3d',
                        willChange: 'transform',
                        boxShadow: is3D ? '0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(0,255,204,0.08), inset 0 0 120px rgba(0,255,204,0.02)' : 'none',
                        cursor: is3D ? (isDraggingMap ? 'grabbing' : 'grab') : (cameraPopupDroneId ? 'pointer' : 'default'),
                    }}
                    onPointerDown={(e) => {
                        if (is3D) {
                            setIsDraggingMap(true);
                            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
                            dragStartPosRef.current = { x: e.clientX, y: e.clientY };
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        }
                    }}
                    onPointerMove={(e) => {
                        if (isDraggingMap && is3D) {
                            const dx = e.clientX - lastMousePosRef.current.x;
                            const dy = e.clientY - lastMousePosRef.current.y;
                            setAngleZ(prev => prev - dx * 0.5);
                            setAngleX(prev => Math.min(85, Math.max(0, prev + dy * 0.5)));
                            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
                        }
                    }}
                    onPointerUp={(e) => {
                        if (isDraggingMap) {
                            setIsDraggingMap(false);
                            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                        }
                    }}
                    onPointerCancel={(e) => {
                        if (isDraggingMap) {
                            setIsDraggingMap(false);
                            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                        }
                    }}
                    onClick={(e) => {
                        if (is3D) {
                            const dx = e.clientX - dragStartPosRef.current.x;
                            const dy = e.clientY - dragStartPosRef.current.y;
                            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return;
                        }
                        if (cameraPopupDroneId) {
                            setCameraPopupDroneId(null);
                        }
                    }}
                    onDoubleClick={handleEmptyDoubleClick}
                >
                <svg
                    width={SVG_W}
                    height={SVG_H}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        border: is3D ? '1px solid rgba(0,255,204,0.3)' : '1px dashed rgba(0,255,204,0.2)',
                        boxSizing: 'border-box',
                        backgroundColor: '#050a10',
                        filter: is3D ? 'saturate(1.2) contrast(1.05)' : 'none',
                    }}
                >
                    {/* ── SVG Filter Definitions ── */}
                    <defs>
                        <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <filter id="glow-strong" x="-100%" y="-100%" width="300%" height="300%">
                            <feGaussianBlur stdDeviation="6" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                        <filter id="heat-glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                        <radialGradient id="drone-aura" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#00ffcc" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
                        </radialGradient>
                        <linearGradient id="beam-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00ffcc" stopOpacity="0" />
                            <stop offset="50%" stopColor="#00ffcc" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
                        </linearGradient>
                        {/* Edge glow gradient for tilted map */}
                        <linearGradient id="edge-glow-top" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00ffcc" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {/* Grid & Heatmap */}
                    {grid.map((row, y) =>
                        row.map((cell, x) => {
                            const prob = getSectorProbability(x, y);
                            const isHot = prob > 0.3;
                            return (
                                <React.Fragment key={`cell-group-${x}-${y}`}>
                                    <rect
                                        x={x * CELL_SIZE}
                                        y={y * CELL_SIZE}
                                        width={CELL_SIZE}
                                        height={CELL_SIZE}
                                        fill={!showTrails && cell.scanned
                                            ? `rgba(255, 68, 68, ${0.05 + prob * 0.75})`
                                            : 'transparent'}
                                        stroke={is3D ? 'rgba(0, 255, 204, 0.08)' : 'rgba(0, 255, 204, 0.05)'}
                                        strokeWidth="1"
                                        filter={is3D && isHot && cell.scanned ? 'url(#heat-glow)' : undefined}
                                    />

                                    {/* Disaster Image Discovery - Visible if scanned OR sensors toggled */}
                                    {!showTrails && (cell.scanned || showSensors) && cell.disasterImage && (
                                        <image
                                            href={cell.disasterImage}
                                            x={x * CELL_SIZE + 2}
                                            y={y * CELL_SIZE + 2}
                                            width={CELL_SIZE - 4}
                                            height={CELL_SIZE - 4}
                                            style={{ opacity: 0.6, pointerEvents: 'none' }}
                                        />
                                    )}

                                    {/* Sensor Values Overlay */}
                                    {!showTrails && showSensors && (
                                        <g style={{ pointerEvents: 'none' }}>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 8} fontSize="5" fill="#00ffcc" opacity="0.9" fontFamily="var(--font-mono)">M:{cell.signals.mobile.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 15} fontSize="5" fill="#ff4444" opacity="0.9" fontFamily="var(--font-mono)">T:{cell.signals.thermal.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 22} fontSize="5" fill="#ffff00" opacity="0.9" fontFamily="var(--font-mono)">S:{cell.signals.sound.toFixed(1)}</text>
                                            <text x={x * CELL_SIZE + 2} y={y * CELL_SIZE + 29} fontSize="5" fill="#ff00ff" opacity="0.9" fontFamily="var(--font-mono)">W:{cell.signals.wifi.toFixed(1)}</text>

                                            {/* Survivor Ground Truth Indicator */}
                                            {survivors.some((s: HiddenSurvivor) => s.x === x && s.y === y) && (
                                                <text
                                                    x={x * CELL_SIZE + CELL_SIZE - 2}
                                                    y={y * CELL_SIZE + CELL_SIZE - 2}
                                                    fontSize="6"
                                                    fill="#00ffcc"
                                                    textAnchor="end"
                                                    fontWeight="bold"
                                                    fontFamily="var(--font-mono)"
                                                >
                                                    [S]
                                                </text>
                                            )}
                                        </g>
                                    )}
                                </React.Fragment>
                            );
                        })
                    )}

                    {/* ── 3D Grid Lines Overlay ── */}
                    {is3D && !showTrails && (
                        <g style={{ pointerEvents: 'none' }}>
                            {/* Horizontal grid lines */}
                            {Array.from({ length: GRID_H + 1 }, (_, i) => (
                                <line key={`hline-${i}`} x1={0} y1={i * CELL_SIZE} x2={SVG_W} y2={i * CELL_SIZE}
                                    stroke="rgba(0,255,204,0.06)" strokeWidth="0.5" />
                            ))}
                            {/* Vertical grid lines */}
                            {Array.from({ length: GRID_W + 1 }, (_, i) => (
                                <line key={`vline-${i}`} x1={i * CELL_SIZE} y1={0} x2={i * CELL_SIZE} y2={SVG_H}
                                    stroke="rgba(0,255,204,0.06)" strokeWidth="0.5" />
                            ))}
                            {/* Top edge glow */}
                            <rect x={0} y={0} width={SVG_W} height={30} fill="url(#edge-glow-top)" />
                        </g>
                    )}

                    {/* COMM_LINKS_MOVED */}

                    {/* Mesh Network Lines (collision avoidance awareness) */}
                    {drones.map(d => {
                        if (showTrails) return null;
                        return (
                            <g key={`mesh-${d.id}`}>
                                {Object.entries(d.knownOtherDrones).map(([otherId, knownPos]) => {
                                    if (time - knownPos.lastUpdate < 20) {
                                        const otherDrone = drones.find(od => od.id === otherId);
                                        if (otherDrone) {
                                            const isPinging = (time - knownPos.lastUpdate <= 1);
                                            return (
                                                <g key={`link-group-${d.id}-${otherId}`}>
                                                    <line
                                                        x1={otherDrone.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y1={otherDrone.y * CELL_SIZE + CELL_SIZE / 2}
                                                        x2={d.x * CELL_SIZE + CELL_SIZE / 2}
                                                        y2={d.y * CELL_SIZE + CELL_SIZE / 2}
                                                        strokeWidth="1"
                                                        className="mesh-link-base"
                                                    />
                                                    {isPinging && (
                                                        <line
                                                            x1={otherDrone.x * CELL_SIZE + CELL_SIZE / 2}
                                                            y1={otherDrone.y * CELL_SIZE + CELL_SIZE / 2}
                                                            x2={d.x * CELL_SIZE + CELL_SIZE / 2}
                                                            y2={d.y * CELL_SIZE + CELL_SIZE / 2}
                                                            strokeWidth="2"
                                                            className="mesh-link"
                                                        />
                                                    )}
                                                </g>
                                            );
                                        }
                                    }
                                    return null;
                                })}
                            </g>
                        );
                    })}

                    {/* Base Station */}
                    {!showTrails && (
                        <g transform={`translate(${BASE_STATION.x * CELL_SIZE + CELL_SIZE / 2}, ${BASE_STATION.y * CELL_SIZE + CELL_SIZE / 2})`}>
                            <rect x="-15" y="-15" width="30" height="30" fill="var(--panel-bg)" stroke="#33ffaa" strokeWidth="2" />
                            <Radio color="#33ffaa" size={20} style={{ transform: 'translate(-10px, -10px)' }} />
                            <text x="20" y="5" fill="#33ffaa" fontSize="10" fontFamily="var(--font-mono)">BASE</text>
                            <circle r={COMM_RANGE_BASE * CELL_SIZE} fill="transparent" stroke="#33ffaa" strokeWidth="1" strokeDasharray="10 5" style={{ animation: 'spin 10s linear infinite reverse', opacity: 0.2 }} />
                        </g>
                    )}

                    {/* Terrain Overlays */}
                    {!showTrails && grid.map((row, y) => row.map((cell, x) => {
                        if (cell.terrain === 'Road') {
                            return <line key={`road-${x}-${y}`} x1={x * CELL_SIZE} y1={y * CELL_SIZE + CELL_SIZE / 2} x2={x * CELL_SIZE + CELL_SIZE} y2={y * CELL_SIZE + CELL_SIZE / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeDasharray="4" />
                        }
                        if (cell.terrain === 'Shelter') {
                            return <rect key={`shelter-${x}-${y}`} x={x * CELL_SIZE + 4} y={y * CELL_SIZE + 4} width={CELL_SIZE - 8} height={CELL_SIZE - 8} fill="rgba(60, 150, 255, 0.1)" stroke="rgba(60, 150, 255, 0.3)" />
                        }
                        return null;
                    }))}

                    {/* Breadcrumb Trails */}
                    {showTrails && drones.map(d => {
                        if (selectedTrailDroneId !== 'all' && selectedTrailDroneId !== d.id) return null;

                        return (
                            <g key={`trail-${d.id}`}>
                                {d.path.map((p, i) => {
                                    const isScan = p.scanned;
                                    const color = isScan ? "#ffffff" : getDroneThemeColor(d.id);
                                    return (
                                        <circle
                                            key={`path-${d.id}-${i}`}
                                            cx={p.x * CELL_SIZE + CELL_SIZE / 2}
                                            cy={p.y * CELL_SIZE + CELL_SIZE / 2}
                                            r={isScan ? 5 : 2}
                                            fill={color}
                                            style={{
                                                opacity: 1,
                                                filter: `drop-shadow(0 0 6px ${color})`
                                            }}
                                        />
                                    );
                                })}

                                {/* Start Marker */}
                                {d.path.length > 0 && (() => {
                                    const color = getDroneThemeColor(d.id);
                                    return (
                                        <circle
                                            cx={d.path[0].x * CELL_SIZE + CELL_SIZE / 2}
                                            cy={d.path[0].y * CELL_SIZE + CELL_SIZE / 2}
                                            r="4.5"
                                            fill={color}
                                            style={{ pointerEvents: 'none', filter: `drop-shadow(0 0 4px ${color})` }}
                                        />
                                    );
                                })()}

                                {/* End Marker */}
                                {d.path.length > 1 && (() => {
                                    const color = getDroneThemeColor(d.id);
                                    return (
                                        <circle
                                            cx={d.path[d.path.length - 1].x * CELL_SIZE + CELL_SIZE / 2}
                                            cy={d.path[d.path.length - 1].y * CELL_SIZE + CELL_SIZE / 2}
                                            r="4.5"
                                            fill={color}
                                            style={{ pointerEvents: 'none', filter: `drop-shadow(0 0 4px ${color})` }}
                                        />
                                    );
                                })()}
                            </g>
                        );
                    })}

                    {/* DRONES_MOVED */}{/* PINS_MOVED */}

                </svg>
                {/* ── Overlay layer for HTML-based elements (drones, pins, comm lines) ── */}
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: SVG_W,
                    height: SVG_H,
                    transformStyle: 'preserve-3d',
                    pointerEvents: 'none',
                }}>
                    <div style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        transformStyle: 'preserve-3d',
                        pointerEvents: 'auto',
                    }}>
                        {/* Comm Network Edges — Arc style in 3D, straight in 2D */}
                        {commLinks.map((link, idx) => {
                            if (showTrails) return null;
                            const getCoords = (id: string) => {
                                if (id === BASE_STATION.id) return { x: BASE_STATION.x, y: BASE_STATION.y };
                                const d = drones.find((dr: Drone) => dr.id === id);
                                if (d) return { x: d.x, y: d.y };
                                return null;
                            };
                            const c1 = getCoords(link.source);
                            const c2 = getCoords(link.target);
                            if (!c1 || !c2) return null;
                            const x1 = c1.x * CELL_SIZE + CELL_SIZE / 2;
                            const y1 = c1.y * CELL_SIZE + CELL_SIZE / 2;
                            const x2 = c2.x * CELL_SIZE + CELL_SIZE / 2;
                            const y2 = c2.y * CELL_SIZE + CELL_SIZE / 2;

                            if (is3D) {
                                // 3D bell-curve arch: arc plane stands upright above the map
                                // Path drawn in local coords: x-axis = along the line, y-axis = height above map
                                const length = Math.hypot(x2 - x1, y2 - y1);
                                const theta = Math.atan2(y2 - y1, x2 - x1);
                                const arcH = Math.min(length * 0.4, 80);
                                // Path from (0,0) to (length,0) with control point arching upward (negative Y = up in SVG)
                                const pathD = `M 0 0 Q ${length / 2} ${-arcH} ${length} 0`;

                                return (
                                    <div key={`edge-${idx}`} style={{
                                        position: 'absolute', left: 0, top: 0,
                                        width: length, height: arcH,
                                        pointerEvents: 'none',
                                        transformOrigin: '0 0',
                                        transform: `translate3d(${x1}px, ${y1}px, 0px) rotateZ(${theta}rad) rotateX(-90deg)`
                                    }}>
                                        <svg width={length} height={arcH} style={{ overflow: 'visible', position: 'absolute', left: 0, top: 0 }}>
                                            {/* Glow under-layer */}
                                            <path d={pathD} fill="none" stroke={link.active ? '#ffff00' : '#00ffaa'}
                                                strokeWidth={link.active ? 6 : 3} strokeOpacity={0.15}
                                                filter="url(#glow-green)" />
                                            {/* Main arc */}
                                            <path d={pathD} fill="none" stroke={link.active ? '#ffff00' : '#00ffaa'}
                                                strokeWidth={link.active ? 2.5 : 1}
                                                strokeDasharray={link.active ? 'none' : '6 4'}
                                                strokeOpacity={link.active ? 0.9 : 0.5}
                                                filter={link.active ? 'url(#bloom)' : undefined} />
                                            {/* Animated pulse dot traveling along path */}
                                            {link.active && (
                                                <circle r="2.5" fill="#ffff00" filter="url(#glow-green)">
                                                    <animateMotion dur="2s" repeatCount="indefinite" path={pathD} />
                                                </circle>
                                            )}
                                        </svg>
                                    </div>
                                );
                            }

                            return (
                                <div key={`edge-${idx}`} style={{ position: 'absolute', left: 0, top: 0 }}>
                                    <svg width={SVG_W} height={SVG_H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
                                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#33ffaa" strokeWidth="1" strokeDasharray="4" style={{ opacity: 0.3 }} />
                                        {link.active && (
                                            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffff00" strokeWidth="3" style={{ opacity: 0.8, filter: 'drop-shadow(0 0 4px #ffff00)' }} />
                                        )}
                                    </svg>
                                </div>
                            );
                        })}
                        {/* Drones */}
                        {drones.map(d => {
                            if (showTrails) return null;
                            const cx = d.x * CELL_SIZE + CELL_SIZE / 2;
                            const cy = d.y * CELL_SIZE + CELL_SIZE / 2;
                            const isAiDisconnected = aiDisconnectedRef.current.has(d.id);
                            const isRecentlyReconnected = (aiReconnectedUntilTickRef.current.get(d.id) ?? -1) > time;
                            const droneColor = isAiDisconnected
                                ? '#ff4444'
                                : d.mode === 'Relay'
                                    ? '#0077ff'
                                    : d.mode === 'Wide'
                                        ? '#00ffcc'
                                        : d.mode === 'Charging'
                                            ? '#ffa500'
                                            : '#ff4444';
                            const isSelected = cameraPopupDroneId === d.id;


                            return (
                                <div
                                    key={d.id}
                                    style={{
                                        position: 'absolute', left: cx, top: cy,
                                        transformStyle: 'preserve-3d',
                                        cursor: 'pointer',
                                        transform: 'translateZ(1px)' // Small lift to prevent z-fighting
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDroneClick(d.id);
                                    }}
                                >
                                    {/* ── 3D Enhanced Drone Rendering ── */}
                                    <svg style={{ position: 'absolute', left: -50, top: -50, width: 100, height: 100, overflow: 'visible' }}>
                                        <g transform="translate(50, 50)">

                                            {is3D ? (
                                                <>
                                                    {/* Ground Aura */}
                                                    <circle r="18" fill="url(#drone-aura)" style={{ pointerEvents: 'none' }}>
                                                        <animate attributeName="r" values="16;20;16" dur="3s" repeatCount="indefinite" />
                                                    </circle>

                                                    {/* Scan Radius — enlarged glow ring */}
                                                    {d.mode !== 'Relay' && d.mode !== 'Charging' && (
                                                        <>
                                                            <circle
                                                                r={d.mode === 'Wide' ? CELL_SIZE * 1.5 : CELL_SIZE * 0.75}
                                                                fill="transparent"
                                                                stroke={droneColor}
                                                                strokeWidth="1.5"
                                                                strokeDasharray="6 3"
                                                                filter="url(#glow-green)"
                                                                style={{ opacity: 0.4, animation: 'spin 4s linear infinite', pointerEvents: 'none' }}
                                                            />
                                                            {/* Second ring for depth */}
                                                            <circle
                                                                r={(d.mode === 'Wide' ? CELL_SIZE * 1.5 : CELL_SIZE * 0.75) - 3}
                                                                fill="transparent"
                                                                stroke={droneColor}
                                                                strokeWidth="0.5"
                                                                strokeDasharray="2 6"
                                                                style={{ opacity: 0.2, animation: 'spin 6s linear infinite reverse', pointerEvents: 'none' }}
                                                            />
                                                        </>
                                                    )}
                                                    {d.mode === 'Relay' && (
                                                        <circle
                                                            r={COMM_RANGE_RELAY * CELL_SIZE}
                                                            fill="transparent"
                                                            stroke="#0077ff"
                                                            strokeWidth="1.5"
                                                            strokeDasharray="8 4"
                                                            filter="url(#glow-green)"
                                                            style={{ opacity: 0.25, animation: 'spin 8s linear infinite reverse', pointerEvents: 'none' }}
                                                        />
                                                    )}

                                                    {/* Hit Area */}
                                                    <circle r="18" fill="rgba(0,0,0,0)" style={{ cursor: 'pointer' }} />

                                                    {/* Outer glow ring */}
                                                    <circle r="10" fill="transparent" stroke={droneColor} strokeWidth="0.8" strokeOpacity={0.3}
                                                        filter="url(#glow-green)">
                                                        <animate attributeName="r" values="9;12;9" dur="2.5s" repeatCount="indefinite" />
                                                        <animate attributeName="stroke-opacity" values="0.3;0.1;0.3" dur="2.5s" repeatCount="indefinite" />
                                                    </circle>

                                                    {/* Inner glow ring */}
                                                    <circle r="6" fill="transparent" stroke={droneColor} strokeWidth="1.2" strokeOpacity={0.6}
                                                        filter="url(#bloom)" />


                                                    {/* Hit Area */}
                                                    <circle r="18" fill="rgba(0,0,0,0)" style={{ cursor: 'pointer', pointerEvents: 'all' }} />


                                                    {/* Selected highlight */}
                                                    {isSelected && (
                                                        <>
                                                            <circle r="14" fill="transparent" stroke="#fff" strokeWidth="1.5"
                                                                strokeDasharray="4 2" filter="url(#bloom)">
                                                                <animate attributeName="r" values="13;16;13" dur="1.5s" repeatCount="indefinite" />
                                                            </circle>
                                                            <circle r="22" fill="transparent" stroke={droneColor} strokeWidth="0.5"
                                                                strokeOpacity={0.3}>
                                                                <animate attributeName="r" values="20;26;20" dur="2s" repeatCount="indefinite" />
                                                                <animate attributeName="stroke-opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                                                            </circle>
                                                        </>
                                                    )}

                                                    {isRecentlyReconnected && !isAiDisconnected && (
                                                        <circle r="9" fill="transparent" stroke="#33ffaa" strokeWidth="1.5"
                                                            strokeDasharray="3" style={{ opacity: 0.9 }} filter="url(#glow-green)" />
                                                    )}

                                                    {/* Target line */}
                                                    {d.mode === 'Micro' && (
                                                        <line
                                                            x1={0} y1={0}
                                                            x2={(d.tx - d.x) * CELL_SIZE} y2={(d.ty - d.y) * CELL_SIZE}
                                                            stroke="#ff4444" strokeWidth="1" strokeDasharray="3 2"
                                                            style={{ opacity: 0.5 }} filter="url(#glow-green)"
                                                        />
                                                    )}
                                                </>

                                            ) : (
                                                <>
                                                    <circle r="16" fill="rgba(0,0,0,0)" style={{ cursor: 'pointer', pointerEvents: 'all' }} />


                                                    {/* Drone blip */}
                                                    <circle r="4" fill={droneColor} />
                                                    <polygon points="0,-6 6,4 -6,4" fill={droneColor} />
                                                    {isRecentlyReconnected && !isAiDisconnected && (
                                                        <circle r="9" fill="transparent" stroke="#33ffaa" strokeWidth="1.5" strokeDasharray="3" style={{ opacity: 0.9 }} />
                                                    )}
                                                    {/* Label */}
                                                    <rect x="-18" y="-22" width="36" height="12" fill="rgba(0,0,0,0.7)" rx="2" />
                                                    <text x="0" y="-14" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="var(--font-mono)">
                                                        {d.id.replace('DRN-', '').replace('RLY-', 'R:')}
                                                    </text>
                                                    {isAiDisconnected && <text x="10" y="0" fill="#ff4444" fontSize="8" fontFamily="var(--font-mono)">DISCONNECTED</text>}
                                                    {isRecentlyReconnected && !isAiDisconnected && <text x="10" y="0" fill="#33ffaa" fontSize="8" fontFamily="var(--font-mono)">REJOIN</text>}
                                                    {/* Haversine Line visually tracking target */}
                                                    {d.mode === 'Micro' && (
                                                        <line
                                                            x1={0} y1={0}
                                                            x2={(d.tx - d.x) * CELL_SIZE} y2={(d.ty - d.y) * CELL_SIZE}
                                                            stroke="#ff4444" strokeWidth="1" strokeDasharray="2" style={{ opacity: 0.4 }}
                                                        />
                                                    )}
                                                </>
                                            )}

                                        </g>
                                    </svg>

                                    {is3D && (
                                        <div style={{ position: 'absolute', left: 0, top: 0, transformStyle: 'preserve-3d', pointerEvents: 'none' }}>
                                            {/* Plane X */}
                                            <svg style={{ position: 'absolute', left: -25, top: -50, width: 50, height: 100, overflow: 'visible', transform: 'rotateX(-90deg)' }}>
                                                <polygon points="25,50 17,32 25,27 33,32" fill={droneColor} fillOpacity={0.8} stroke={droneColor} strokeWidth="0.5" filter="url(#bloom)" />
                                            </svg>
                                            {/* Plane Y */}
                                            <svg style={{ position: 'absolute', left: -25, top: -50, width: 50, height: 100, overflow: 'visible', transform: 'rotateX(-90deg) rotateY(90deg)' }}>
                                                <polygon points="25,50 17,32 25,27 33,32" fill={droneColor} fillOpacity={0.4} stroke={droneColor} strokeWidth="0.5" filter="url(#bloom)" />
                                            </svg>

                                            {/* Upright Elements (Billboarded, truly floating in Z space) */}
                                            <div style={{ position: 'absolute', left: 0, top: 0, transform: `translateZ(25px) rotateZ(${-angleZ}deg) rotateX(${-angleX}deg)` }}>
                                                <svg style={{ position: 'absolute', left: -50, top: -50, width: 100, height: 100, overflow: 'visible' }}>
                                                    <g transform="translate(50, 50)">
                                                        {/* Vertical beam line */}
                                                        <line x1={0} y1={-18} x2={0} y2={-42} stroke={droneColor} strokeWidth="1"
                                                            strokeOpacity={0.4} strokeDasharray="2 2" filter="url(#glow-green)">
                                                            <animate attributeName="stroke-opacity" values="0.2;0.5;0.2" dur="2s" repeatCount="indefinite" />
                                                        </line>

                                                        {/* Label with background — elevated */}
                                                        <rect x="-22" y="-56" width="44" height="14" fill="rgba(0,16,12,0.85)"
                                                            stroke={droneColor} strokeWidth="0.5" rx="2" />
                                                        <text x="0" y="-46" textAnchor="middle" fill={droneColor} fontSize="8"
                                                            fontFamily="var(--font-mono)" fontWeight="bold" letterSpacing="1">
                                                            {d.id.replace('DRN-', '').replace('RLY-', 'R:')}
                                                        </text>

                                                        {/* Battery micro-bar */}
                                                        <rect x="-12" y="-40" width="24" height="2" fill="rgba(255,255,255,0.1)" rx="1" />
                                                        <rect x="-12" y="-40" width={Math.max(0, 24 * d.battery / 100)} height="2"
                                                            fill={d.battery > 60 ? '#00ffcc' : d.battery > 30 ? '#ffa500' : '#ff4444'} rx="1" />

                                                        {isAiDisconnected && <text x="14" y="-12" fill="#ff4444" fontSize="7" fontFamily="var(--font-mono)" filter="url(#glow-green)">DISCONNECTED</text>}
                                                        {isRecentlyReconnected && !isAiDisconnected && <text x="14" y="-12" fill="#33ffaa" fontSize="7" fontFamily="var(--font-mono)">REJOIN</text>}
                                                    </g>
                                                </svg>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}



                        {/* Visible Survivor Pins */}
                        {!showTrails && pins.map(pin => (

                            <div key={pin.id}
                                style={{
                                    position: 'absolute', left: pin.x * CELL_SIZE + CELL_SIZE / 2, top: pin.y * CELL_SIZE + CELL_SIZE / 2,
                                    transformStyle: 'preserve-3d',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setSelectedPin(pin)}
                            >
                                <svg style={{ position: 'absolute', left: -50, top: -50, width: 100, height: 100, overflow: 'visible' }}>
                                    <g transform="translate(50, 50)">

                                        {is3D ? (
                                            <>
                                                <circle r="16" fill="rgba(0, 255, 204, 0.15)" filter="url(#glow-strong)">
                                                    <animate attributeName="r" values="14;18;14" dur="2s" repeatCount="indefinite" />
                                                </circle>
                                                <circle r="8" fill="rgba(0,255,204,0.25)" stroke="#00ffcc" strokeWidth="1" />
                                                <circle r="3" fill="#00ffcc" filter="url(#bloom)" />

                                                <circle r="16" fill="rgba(0,0,0,0)" style={{ cursor: 'pointer', pointerEvents: 'all' }} />

                                            </>
                                        ) : (
                                            <>
                                                <circle r="12" fill="rgba(0, 255, 204, 0.3)" className="animate-pulse" />
                                                <circle r="6" fill="#00ffcc" />
                                                <foreignObject x="-10" y="-10" width="20" height="20">
                                                    <MapPin size={20} color="#00ffcc" style={{ transform: 'translateY(-18px)' }} />
                                                </foreignObject>
                                            </>
                                        )}

                                    </g>
                                </svg>

                                {is3D && (
                                    <div style={{ position: 'absolute', left: 0, top: 0, transformStyle: 'preserve-3d', pointerEvents: 'none' }}>
                                        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translateZ(25px) rotateZ(${-angleZ}deg) rotateX(${-angleX}deg)` }}>
                                            <svg style={{ position: 'absolute', left: -50, top: -50, width: 100, height: 100, overflow: 'visible' }}>
                                                <g transform="translate(50, 50)">
                                                    <line x1={0} y1={-8} x2={0} y2={-22} stroke="#00ffcc" strokeWidth="1" strokeDasharray="2" strokeOpacity={0.6} />
                                                    <text x={0} y={-25} textAnchor="middle" fill="#00ffcc" fontSize="6" fontFamily="var(--font-mono)" letterSpacing="1">SOS</text>
                                                </g>
                                            </svg>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                </div>{/* end unified container */}
            </div>{/* end perspective container */}


            {/* Trail Manager Overlay (Red Box area) */}
            <div style={{
                position: 'absolute',
                top: 16,
                right: 16,
                width: '200px',
                background: 'rgba(5, 10, 16, 0.85)',
                border: '1px solid var(--panel-border)',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,255,204,0.2)', paddingBottom: '8px' }}>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold', letterSpacing: '1px' }}>TRAIL SYSTEMS</span>
                    <div
                        onClick={() => setShowTrails(!showTrails)}
                        style={{
                            width: '32px',
                            height: '16px',
                            background: showTrails ? 'var(--accent-primary)' : '#333',
                            borderRadius: '8px',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease'
                        }}
                    >
                        <div style={{
                            width: '12px',
                            height: '12px',
                            background: '#fff',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: '2px',
                            left: showTrails ? '18px' : '2px',
                            transition: 'all 0.3s ease'
                        }} />
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div
                        onClick={() => setSelectedTrailDroneId('all')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            background: selectedTrailDroneId === 'all' ? 'rgba(0,255,204,0.1)' : 'transparent',
                            color: selectedTrailDroneId === 'all' ? 'var(--accent-primary)' : 'var(--text-secondary)'
                        }}
                    >
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1px solid #fff', opacity: 0.5 }} />
                        <span>ALL DRONES</span>
                    </div>

                    {drones.map(d => {
                        const color = getDroneThemeColor(d.id);
                        const isSelected = selectedTrailDroneId === d.id;
                        return (
                            <div
                                key={`trail-sel-${d.id}`}
                                onClick={() => setSelectedTrailDroneId(d.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    borderRadius: '2px',
                                    background: isSelected ? `${color}22` : 'transparent',
                                    color: isSelected ? color : 'var(--text-secondary)',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '2px',
                                    background: color,
                                    boxShadow: isSelected ? `0 0 8px ${color}` : 'none'
                                }} />
                                <span>{d.id.replace('DRN-', '').replace('RLY-', 'RELAY-')}</span>
                            </div>
                        );
                    })}
                </div>

                {showTrails && (
                    <div style={{ fontSize: '0.65rem', color: 'rgba(0,255,204,0.5)', marginTop: '4px', fontStyle: 'italic' }}>
                        * Rendering {selectedTrailDroneId === 'all' ? 'all' : 'selected'} search paths
                    </div>
                )}
            </div>

            {/* Legend */}
            <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px', zIndex: 5 }}>
                <div style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid var(--panel-border)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', backdropFilter: 'blur(4px)' }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>MAP LEGEND</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #00ffcc' }}></div> Wide-Scan Mode</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ff4444' }}></div> Micro-Scan Mode</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #0077ff' }}></div> Relay Drone</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ffa500' }}></div> Charging</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #ff4444' }}></div> Disconnected</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00ffcc' }}><MapPin size={12} /> Confirmed Survivor</div>
                </div>
            </div>

            {/* Survivor Pin Popup */}
            {selectedPin && (
                <div style={{
                    position: 'absolute',
                    left: selectedPin.x * CELL_SIZE + CELL_SIZE / 2 + 20,
                    top: selectedPin.y * CELL_SIZE + CELL_SIZE / 2 - 20,
                    background: 'rgba(5, 10, 16, 0.95)',
                    border: '1px solid #00ffcc',
                    padding: '16px',
                    borderRadius: '4px',
                    boxShadow: '0 0 20px rgba(0, 255, 204, 0.2)',
                    zIndex: 10,
                    minWidth: '220px'
                }}>
                    <button onClick={() => setSelectedPin(null)} style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <X size={16} />
                    </button>
                    <h4 className="glow-text" style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#00ffcc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Radio size={16} /> SIGNAL UPLINK
                    </h4>
                    <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '12px', padding: '8px', background: 'rgba(0, 255, 204, 0.1)', borderLeft: '2px solid #00ffcc' }}>
                        "{selectedPin.info.message}"
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>DEVICE BATTERY:</span>
                        <span style={{ color: '#ff4444' }}>{selectedPin.info.battery}</span>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        LAT: {(1.5600 - selectedPin.y * 0.001).toFixed(4)} <br />
                        LON: {(103.6300 + selectedPin.x * 0.001).toFixed(4)}
                    </div>
                </div>
            )}

            {/* ── Green Scanline Transition Effect ── */}
            {scanlineActive && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 50,
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute',
                        left: 0,
                        width: '100%',
                        height: '4px',
                        background: 'linear-gradient(180deg, transparent, #00ffcc, rgba(0,255,204,0.6), transparent)',
                        boxShadow: '0 0 30px 10px rgba(0,255,204,0.3), 0 0 60px 20px rgba(0,255,204,0.15)',
                        animation: 'tac-scanline-sweep 1s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                    }} />
                    {/* Full-screen brief green flash */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        background: 'rgba(0,255,204,0.03)',
                        animation: 'tac-scanline-flash 1s ease-out forwards',
                    }} />
                </div>
            )}

            {/* ── 3D Drone Info + Camera Popup ── */}
            {activeDroneForPopup && (
                <DroneInfoPopup3D
                    drone={activeDroneForPopup}
                    grid={grid}
                    is3D={is3D}
                    onClose={handleClosePopup}
                />
            )}

            {/* 3D/2D mode indicator */}
            {is3D && (
                <div style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    padding: '6px 14px',
                    background: 'rgba(0,255,204,0.1)',
                    border: '1px solid rgba(0,255,204,0.4)',
                    borderRadius: '4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: '#00ffcc',
                    letterSpacing: '2px',
                    zIndex: 5,
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ffcc', boxShadow: '0 0 6px #00ffcc', animation: 'pulse 2s infinite' }} />
                    3D TACTICAL VIEW
                    <span style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.6rem' }}>DBL-CLICK TO EXIT</span>
                </div>
            )}

            {/* Scanline keyframes */}
            <style>{`
                @keyframes tac-scanline-sweep {
                    0%   { top: 0%; opacity: 0; }
                    10%  { opacity: 1; }
                    80%  { top: 95%; opacity: 0.7; }
                    100% { top: 100%; opacity: 0; }
                }
                @keyframes tac-scanline-flash {
                    0%   { opacity: 1; }
                    30%  { opacity: 0.5; }
                    100% { opacity: 0; }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
            `}</style>
        </div>
    );
};


/* ── Combined 3D Info + Camera Feed Popup ── */
const DroneInfoPopup3D: React.FC<{
    drone: Drone;
    grid: Sector[][];
    is3D: boolean;
    onClose: () => void;
}> = ({ drone, grid, is3D, onClose }) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = React.useState<'LIVE' | 'SEARCHING' | 'WAITING'>('WAITING');

    // Simulated feed fallback
    const sx = Math.max(0, Math.min(GRID_W - 1, Math.round(drone.x)));
    const sy = Math.max(0, Math.min(GRID_H - 1, Math.round(drone.y)));
    const currentSector = grid[sy]?.[sx];
    const simulatedFeed = currentSector?.disasterImage;

    React.useEffect(() => {
        let animId: number;
        const copyFrame = () => {
            const sourceCanvas = document.querySelector('#hidden-popup-engine canvas') as HTMLCanvasElement | null;
            const targetCanvas = canvasRef.current;
            if (sourceCanvas && targetCanvas) {
                const ctx = targetCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
                    if (status !== 'LIVE') setStatus('LIVE');
                }
            } else if (simulatedFeed) {
                if (status !== 'LIVE') setStatus('LIVE');
            } else {
                if (status !== 'SEARCHING') setStatus('SEARCHING');
            }
            animId = requestAnimationFrame(copyFrame);
        };
        animId = requestAnimationFrame(copyFrame);
        return () => cancelAnimationFrame(animId);
    }, [drone.id, simulatedFeed, status]);

    const isLive = status === 'LIVE';
    function frameSourceExists() {
        return !!document.querySelector('#hidden-popup-engine canvas');
    }

    // Battery color
    const batteryColor = drone.battery > 60 ? '#00ffcc' : drone.battery > 30 ? '#ffa500' : '#ff4444';
    const modeColor = drone.mode === 'Wide' ? '#00ffcc' : drone.mode === 'Relay' ? '#0077ff' : drone.mode === 'Charging' ? '#ffa500' : '#ff4444';
    const signalStrength = drone.isConnected ? 'STRONG' : 'LOST';
    const signalColor = drone.isConnected ? '#00ffcc' : '#ff4444';

    // Popup dimensions — wider to fit info + camera side by side
    const POPUP_W = is3D ? 380 : 240;
    const POPUP_H = is3D ? 200 : 180;

    // Position: top-right of the panel in 3D, near-drone in 2D
    const popupStyle: React.CSSProperties = is3D ? {
        position: 'absolute',
        top: 16,
        left: 16,
        width: POPUP_W,
        height: POPUP_H,
        zIndex: 100,
    } : {
        position: 'absolute',
        left: Math.min(drone.x * CELL_SIZE + CELL_SIZE / 2 + 20, 700 - POPUP_W - 10),
        top: Math.max(drone.y * CELL_SIZE + CELL_SIZE / 2 - POPUP_H - 20, 10),
        width: POPUP_W,
        height: POPUP_H,
        zIndex: 100,
    };

    return (
        <div
            style={{
                ...popupStyle,
                background: 'rgba(5, 10, 16, 0.97)',
                border: '1px solid #00ffcc',
                boxShadow: '0 0 30px rgba(0, 255, 204, 0.25), inset 0 0 40px rgba(0, 255, 204, 0.03)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                pointerEvents: 'auto',
                borderRadius: '4px',
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: 'popup-fade-in 0.3s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Title Bar */}
            <div style={{
                background: 'linear-gradient(90deg, rgba(0, 255, 204, 0.2), rgba(0, 255, 204, 0.05))',
                padding: '5px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(0, 255, 204, 0.3)',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: isLive ? '#00ffcc' : '#ff4444', boxShadow: isLive ? '0 0 6px #00ffcc' : 'none' }} />
                    <span style={{ fontSize: '0.7rem', color: '#00ffcc', fontWeight: 'bold', fontFamily: 'var(--font-mono)', letterSpacing: '1.5px' }}>
                        {drone.id}
                    </span>
                    <span style={{ fontSize: '0.5rem', color: 'rgba(0,255,204,0.5)', fontFamily: 'var(--font-mono)' }}>
                        {isLive ? 'LIVE' : 'OFFLINE'}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'rgba(255,68,68,0.1)',
                        border: '1px solid rgba(255,68,68,0.3)',
                        color: '#ff4444',
                        cursor: 'pointer',
                        borderRadius: '2px',
                        padding: '2px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,68,68,0.3)';
                        e.currentTarget.style.borderColor = '#ff4444';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,68,68,0.1)';
                        e.currentTarget.style.borderColor = 'rgba(255,68,68,0.3)';
                    }}
                >
                    <X size={12} />
                </button>
            </div>

            {/* Body: Info + Camera side by side in 3D, camera only in 2D */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Info Panel — shown in 3D mode */}
                {is3D && (
                    <div style={{
                        width: '140px',
                        flexShrink: 0,
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        borderRight: '1px solid rgba(0,255,204,0.15)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                    }}>
                        {/* Battery */}
                        <div>
                            <div style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.55rem', marginBottom: '2px', letterSpacing: '1px' }}>BATTERY</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${drone.battery}%`, height: '100%', background: batteryColor, borderRadius: '2px', transition: 'width 0.3s' }} />
                                </div>
                                <span style={{ color: batteryColor, fontWeight: 'bold', minWidth: '30px', textAlign: 'right' }}>{Math.floor(drone.battery)}%</span>
                            </div>
                        </div>
                        {/* Signal */}
                        <div>
                            <div style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.55rem', marginBottom: '2px', letterSpacing: '1px' }}>SIGNAL</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} style={{
                                        width: '3px',
                                        height: 4 + i * 3,
                                        background: drone.isConnected && i < 4 ? signalColor : 'rgba(255,255,255,0.15)',
                                        borderRadius: '1px',
                                    }} />
                                ))}
                                <span style={{ color: signalColor, marginLeft: '4px' }}>{signalStrength}</span>
                            </div>
                        </div>
                        {/* Status */}
                        <div>
                            <div style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.55rem', marginBottom: '2px', letterSpacing: '1px' }}>STATUS</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: 6, height: 6, borderRadius: '1px', background: modeColor, boxShadow: `0 0 4px ${modeColor}` }} />
                                <span style={{ color: modeColor }}>{drone.mode.toUpperCase()}</span>
                            </div>
                        </div>
                        {/* Position */}
                        <div>
                            <div style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.55rem', marginBottom: '2px', letterSpacing: '1px' }}>POSITION</div>
                            <div style={{ color: 'var(--text-primary)', fontSize: '0.6rem' }}>
                                X:{drone.x.toFixed(1)} Y:{drone.y.toFixed(1)}
                            </div>
                        </div>
                        {/* Altitude */}
                        <div>
                            <div style={{ color: 'rgba(0,255,204,0.5)', fontSize: '0.55rem', marginBottom: '2px', letterSpacing: '1px' }}>ALTITUDE</div>
                            <div style={{ color: 'var(--text-primary)', fontSize: '0.6rem' }}>
                                {drone.mode === 'Micro' ? '80m' : drone.mode === 'Charging' ? '0m' : '300m'}
                            </div>
                        </div>
                    </div>
                )}

                {/* Camera Feed */}
                <div style={{ flex: 1, background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {/* Primary: Direct Canvas Mirror */}
                    <canvas
                        ref={canvasRef}
                        width={240}
                        height={180}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: frameSourceExists() ? 'block' : 'none',
                        }}
                    />

                    {/* Secondary: Simulated Terrestrial Feed */}
                    {!frameSourceExists() && simulatedFeed && (
                        <img
                            src={simulatedFeed}
                            alt="Simulated Feed"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                filter: 'grayscale(1) contrast(1.5) brightness(0.8)',
                            }}
                        />
                    )}

                    {/* Tertiary: Scanning State */}
                    {!frameSourceExists() && !simulatedFeed && (
                        <div style={{ textAlign: 'center', padding: '20px' }}>
                            <div className="animate-pulse" style={{ marginBottom: '12px' }}>
                                <Radio size={32} color="rgba(0, 255, 204, 0.4)" />
                            </div>
                            <div style={{ fontSize: '0.6rem', color: 'rgba(0, 255, 204, 0.6)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                {currentSector?.scanned ? 'UPLINK REQUIRED...' : 'LINKING ASSET...'}
                            </div>
                            <div style={{ fontSize: '0.5rem', color: 'rgba(0, 255, 204, 0.3)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                                INITIALIZING INDEPENDENT UPLINK...
                            </div>
                            <div style={{ width: '100px', height: '2px', background: 'rgba(0, 255, 204, 0.1)', marginTop: '8px', marginInline: 'auto', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', width: '30%', height: '100%', background: '#00ffcc', animation: 'scan-line 1.5s infinite linear' }} />
                            </div>
                        </div>
                    )}

                    {/* HUD Overlay */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', border: '1px solid rgba(0, 255, 204, 0.1)', boxSizing: 'border-box' }}>
                        <div style={{ position: 'absolute', top: 4, left: 4, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ fontSize: '0.5rem', color: '#00ffcc', fontFamily: 'var(--font-mono)', textShadow: '1px 1px 1px #000' }}>BAT: {Math.floor(drone.battery)}%</div>
                            <div style={{ fontSize: '0.5rem', color: '#00ffcc', fontFamily: 'var(--font-mono)', textShadow: '1px 1px 1px #000' }}>ALT: {drone.mode === 'Micro' ? '80m' : '300m'}</div>
                        </div>
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.3 }}>
                            <svg width="40" height="40" viewBox="0 0 40 40">
                                <line x1="20" y1="0" x2="20" y2="10" stroke="#00ffcc" strokeWidth="0.5" />
                                <line x1="20" y1="30" x2="20" y2="40" stroke="#00ffcc" strokeWidth="0.5" />
                                <line x1="0" y1="20" x2="10" y2="20" stroke="#00ffcc" strokeWidth="0.5" />
                                <line x1="30" y1="20" x2="40" y2="20" stroke="#00ffcc" strokeWidth="0.5" />
                                <circle cx="20" cy="20" r="15" fill="none" stroke="#00ffcc" strokeWidth="0.5" strokeDasharray="2 1" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* CRT Lines Effect */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03))',
                backgroundSize: '100% 2px, 3px 100%',
                pointerEvents: 'none',
                opacity: 0.4,
            }} />

            <style>{`
                @keyframes popup-fade-in {
                    0%   { opacity: 0; transform: translateY(8px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};
