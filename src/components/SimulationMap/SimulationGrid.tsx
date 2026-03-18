import React from 'react';
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
    getSectorProbability, time, aiDisconnectedRef, aiReconnectedUntilTickRef
}) => {
    return (
        <div className="hud-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={GRID_W * CELL_SIZE} height={GRID_H * CELL_SIZE} style={{ border: '1px dashed rgba(0,255,204,0.2)', backgroundColor: '#050a10' }}>
                {/* Grid & Heatmap */}
                {grid.map((row, y) =>
                    row.map((cell, x) => (
                        <React.Fragment key={`cell-group-${x}-${y}`}>
                            <rect
                                x={x * CELL_SIZE}
                                y={y * CELL_SIZE}
                                width={CELL_SIZE}
                                height={CELL_SIZE}
                                fill={!showTrails && cell.scanned 
                                    ? `rgba(255, 68, 68, ${0.05 + getSectorProbability(x, y) * 0.75})` 
                                    : 'transparent'}
                                stroke="rgba(0, 255, 204, 0.05)"
                                strokeWidth="1"
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
                    ))
                )}

                {/* Comm Network Edges */}
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

                    return (
                        <g key={`edge-${idx}`}>
                            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#33ffaa" strokeWidth="1" strokeDasharray="4" style={{ opacity: 0.3 }} />
                            {link.active && (
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffff00" strokeWidth="3" style={{ opacity: 0.8, filter: 'drop-shadow(0 0 4px #ffff00)' }} />
                            )}
                        </g>
                    );
                })}

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

                {/* Drones */}
                {drones.map(d => {
                    if (showTrails) return null;
                    return (
                    <g key={d.id} transform={`translate(${d.x * CELL_SIZE + CELL_SIZE / 2}, ${d.y * CELL_SIZE + CELL_SIZE / 2})`}>
                        {(() => {
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

                            return (
                                <>
                                    {/* Scan Radius Indicator */}
                                    {d.mode !== 'Relay' && d.mode !== 'Charging' && (
                                        <circle
                                            r={d.mode === 'Wide' ? CELL_SIZE * 1.5 : CELL_SIZE * 0.75}
                                            fill="transparent"
                                            stroke={d.mode === 'Wide' ? '#00ffcc' : '#ff4444'}
                                            strokeWidth="1"
                                            strokeDasharray="4"
                                            className="spin-xs"
                                            style={{ opacity: 0.5, animation: 'spin 4s linear infinite' }}
                                        />
                                    )}
                                    {d.mode === 'Relay' && (
                                        <circle
                                            r={COMM_RANGE_RELAY * CELL_SIZE}
                                            fill="transparent"
                                            stroke="#0077ff"
                                            strokeWidth="1"
                                            strokeDasharray="8"
                                            style={{ opacity: 0.2, animation: 'spin 8s linear infinite reverse' }}
                                        />
                                    )}
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
                            );
                        })()}
                    </g>
                    );
                })}

                {/* Visible Survivor Pins */}
                {!showTrails && pins.map(pin => (
                    <g key={pin.id}
                        transform={`translate(${pin.x * CELL_SIZE + CELL_SIZE / 2}, ${pin.y * CELL_SIZE + CELL_SIZE / 2})`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedPin(pin)}
                    >
                        <circle r="12" fill="rgba(0, 255, 204, 0.3)" className="animate-pulse" />
                        <circle r="6" fill="#00ffcc" />
                        <foreignObject x="-10" y="-10" width="20" height="20">
                            <MapPin size={20} color="#00ffcc" style={{ transform: 'translateY(-18px)' }} />
                        </foreignObject>
                    </g>
                ))}
            </svg>
            
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
            <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px' }}>
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
        </div>
    );
};
