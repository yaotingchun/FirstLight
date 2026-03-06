import React, { useState, useEffect } from 'react';
import { Crosshair, Map as MapIcon, Wifi, Radio } from 'lucide-react';

// Generate mock buildings map
const GRID_SIZE = 8;
const CELL_SIZE = 80;

interface Building {
    id: number;
    row: number;
    col: number;
    probability: number;
    type: 'residential' | 'commercial' | 'school' | 'hospital';
}

const generateMap = (): Building[] => {
    const map: Building[] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            let type: Building['type'] = 'residential';
            if (row === 2 && col === 3) type = 'school';
            if (row === 6 && col === 6) type = 'hospital';
            if (Math.random() > 0.8) type = 'commercial';

            let prob = Math.random() * 0.3; // Base prob 0-30%
            if (type === 'school') prob += 0.4;
            if (type === 'hospital') prob += 0.5;

            map.push({ id: row * GRID_SIZE + col, row, col, probability: Math.min(prob, 1), type });
        }
    }
    return map;
};

const DroneSimMap: React.FC<{ buildings: Building[] }> = ({ buildings }) => {
    // Simulate drone positions moving
    const [drones, setDrones] = useState([
        { id: 1, x: 100, y: 100, target: { x: 400, y: 400 }, status: 'scanning' },
        { id: 2, x: 500, y: 200, target: { x: 200, y: 500 }, status: 'micro-scan' },
        { id: 3, x: 300, y: 600, target: { x: 600, y: 100 }, status: 'moving' }
    ]);

    useEffect(() => {
        const interval = setInterval(() => {
            setDrones(prev => prev.map(drone => {
                const dx = drone.target.x - drone.x;
                const dy = drone.target.y - drone.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 10) {
                    // New target
                    return { ...drone, target: { x: Math.random() * 600, y: Math.random() * 600 } };
                }

                return {
                    ...drone,
                    x: drone.x + (dx / dist) * 5,
                    y: drone.y + (dy / dist) * 5
                };
            }));
        }, 100);
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#020709', border: '1px solid var(--panel-border)' }}>
            {/* Grid Overlay */}
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--panel-border)" strokeWidth="0.5" opacity="0.3" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Buildings (Probability Heatmap visualization as isometric heights or glowing boxes) */}
                {buildings.map(b => {
                    const x = b.col * CELL_SIZE + 40;
                    const y = b.row * CELL_SIZE + 40;
                    // High probability = bright neon cyan glow, Low probability = dark teal
                    const isHigh = b.probability > 0.6;
                    const fillColor = isHigh ? 'var(--accent-primary)' : 'var(--accent-muted)';
                    const opacity = Math.max(0.1, b.probability);

                    return (
                        <g key={b.id} transform={`translate(${x}, ${y})`}>
                            {/* Simulated 'Height' via shadow/glow */}
                            <rect x="-30" y="-30" width="60" height="60" fill="var(--bg-color)" stroke="var(--panel-border)" strokeWidth="1" />
                            <rect x="-26" y="-26" width="52" height="52" fill={fillColor} fillOpacity={opacity} />

                            {isHigh && (
                                <>
                                    <rect x="-30" y="-30" width="60" height="60" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeOpacity={0.8} />
                                    {/* Crosshair marking high target */}
                                    <path d="M -10 0 L 10 0 M 0 -10 L 0 10" stroke="var(--bg-color)" strokeWidth="2" />
                                </>
                            )}
                            {/* Type Badges */}
                            {b.type === 'school' && <text x="-20" y="20" fill="var(--warning)" fontSize="10" fontFamily="var(--font-mono)">[SCH]</text>}
                            {b.type === 'hospital' && <text x="-20" y="20" fill="var(--warning)" fontSize="10" fontFamily="var(--font-mono)">[HOS]</text>}
                        </g>
                    )
                })}

                {/* Drones */}
                {drones.map(d => (
                    <g key={d.id} transform={`translate(${d.x}, ${d.y})`} style={{ transition: 'transform 0.1s linear' }}>
                        <circle r="15" fill="none" stroke="var(--accent-secondary)" strokeWidth="1" strokeDasharray="4 2" className="animate-spin" />
                        <circle r="5" fill="var(--bg-color)" stroke="var(--accent-secondary)" strokeWidth="2" />
                        <text x="12" y="-12" fill="var(--accent-secondary)" fontSize="10" fontFamily="var(--font-mono)">DRN_{d.id}</text>
                        <path d={`M 0 0 L ${d.target.x - d.x} ${d.target.y - d.y}`} stroke="var(--accent-secondary)" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="2 2" />
                    </g>
                ))}

                {/* Decorative Sci-Fi UI Overlay */}
                <path d="M 0 20 L 20 0 L 100 0" fill="none" stroke="var(--accent-primary)" strokeWidth="1" />
                <path d="M 100% 100% L calc(100% - 20px) calc(100% - 20px)" fill="none" stroke="var(--accent-primary)" strokeWidth="1" />
            </svg>

            {/* Absolute UI Overlays */}
            <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: '8px' }}>
                <div className="btn-cyber active"><MapIcon size={14} /> HEATMAP</div>
                <div className="btn-cyber"><Wifi size={14} /> RF_SWEEP</div>
                <div className="btn-cyber"><Radio size={14} /> AUDIO_SCAN</div>
            </div>

        </div>
    );
};

const MapSimulator: React.FC = () => {
    const [buildings, setBuildings] = useState<Building[]>([]);

    useEffect(() => {
        setBuildings(generateMap());
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
            <header>
                <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }}>TACTICAL MAP & PROBABILITY VIZ</h2>
                <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; WIDE AREA SCAN IN PROGRESS</p>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '24px' }}>
                {/* Map Container */}
                <div className="hud-panel" style={{ flex: 2, position: 'relative' }}>
                    <DroneSimMap buildings={buildings} />

                    <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', backdropFilter: 'blur(4px)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, background: 'var(--accent-primary)' }}></div>
                            High Prob
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, background: 'var(--accent-muted)' }}></div>
                            Low Prob
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, border: '2px solid var(--accent-secondary)', borderRadius: '50%' }}></div>
                            Swarm Unit
                        </div>
                    </div>
                </div>

                {/* Metrics Container */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="hud-panel" style={{ padding: '24px', flex: 1 }}>
                        <h3 className="hud-text" style={{ color: 'var(--accent-primary)', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                            &gt; SENSOR FUSION WEIGHTS
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {[
                                { label: 'THERMAL_IR', val: 0.8 },
                                { label: 'MOBILE_PING (LAN/WIFI)', val: 0.9 },
                                { label: 'BLUETOOTH_M', val: 0.4 },
                                { label: 'ACOUSTIC_ANALYTICS', val: 0.6 }
                            ].map(s => (
                                <div key={s.label}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
                                        <span>{s.label}</span>
                                        <span style={{ color: 'var(--accent-primary)' }}>{(s.val * 100)}%</span>
                                    </div>
                                    <div style={{ width: '100%', height: '4px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)' }}>
                                        <div style={{ width: `${s.val * 100}%`, height: '100%', background: 'var(--accent-primary)' }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="hud-panel" style={{ padding: '24px', flex: 1 }}>
                        <h3 className="hud-text" style={{ color: 'var(--warning)', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                            &gt; DISASTER HEATMAP PREDICTION
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                            AI Model predicting survivor movement based on shelter locations and structural integrity.
                            <br /><br />
                            <span style={{ color: 'var(--accent-primary)' }}>[PREDICTION ENGINE: ONLINE]</span><br />
                            Updating dynamic pathways...
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapSimulator;
