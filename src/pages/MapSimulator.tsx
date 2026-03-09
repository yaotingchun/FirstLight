import React, { useState, useEffect } from 'react';
import { Crosshair, Activity } from 'lucide-react';
import type { HeatmapCell, ScanResult } from '../services/heatmapService';
import { generateHeatmapGrid, scanCell } from '../services/heatmapService';

const GRID_SIZE = 15; // Adjusted size for a better view
const CELL_SIZE = 60; // Render size of each grid square

const MapSimulator: React.FC = () => {
    const [grid, setGrid] = useState<HeatmapCell[][]>([]);

    // Generate initial default probability grid on mount
    useEffect(() => {
        setGrid(generateHeatmapGrid(GRID_SIZE));
    }, []);

    // Function to handle clicking on a cell to simulate a scan
    const handleCellScan = (r: number, c: number, simulatedResult: ScanResult) => {
        setGrid(prev => {
            const newGrid = [...prev];
            const newRow = [...newGrid[r]];
            
            // Scan the cell using our service logic
            newRow[c] = scanCell(newRow[c], simulatedResult);
            
            newGrid[r] = newRow;
            return newGrid;
        });
    };

    /**
     * Determines the heatmap color based on the probability rules requested:
     * Red (High) >= 0.7
     * Yellow (Medium) 0.4 - 0.69
     * Blue (Low) < 0.4
     */
    const getCellColor = (prob: number) => {
        if (prob >= 0.7) return 'rgba(255, 68, 68, 0.8)'; // Red
        if (prob >= 0.4) return 'rgba(255, 204, 0, 0.8)'; // Yellow
        return 'rgba(60, 150, 255, 0.6)'; // Blue
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
            <header>
                <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }}>TACTICAL HEATMAP SCAN MODULE</h2>
                <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; SURVIVOR PROBABILITY MODEL (STATIC-ENV + DYNAMIC-SCAN)</p>
            </header>

            <div style={{ flex: 1, display: 'flex', gap: '24px' }}>
                {/* Heatmap Grid Container */}
                <div className="hud-panel" style={{ flex: 2, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020709' }}>
                    
                    <svg width={GRID_SIZE * CELL_SIZE} height={GRID_SIZE * CELL_SIZE} style={{ border: '2px solid rgba(0, 255, 204, 0.2)' }}>
                        {grid.map((row, r) => 
                            row.map((cell, c) => (
                                <g key={cell.id} transform={`translate(${c * CELL_SIZE}, ${r * CELL_SIZE})`}>
                                    {/* Main Cell Background using the requested coloring logic */}
                                    <rect 
                                        width={CELL_SIZE} 
                                        height={CELL_SIZE} 
                                        fill={getCellColor(cell.probability)}
                                        stroke="rgba(0, 255, 204, 0.1)"
                                        strokeWidth="1"
                                        style={{ transition: 'fill 0.3s ease-in-out' }}
                                    />

                                    {/* Probability Text overlay */}
                                    <text 
                                        x={CELL_SIZE / 2} 
                                        y={CELL_SIZE / 2} 
                                        textAnchor="middle" 
                                        alignmentBaseline="central"
                                        fill="white"
                                        fontSize="10"
                                        fontFamily="var(--font-mono)"
                                        fontWeight="bold"
                                        style={{ opacity: 0.8 }}
                                    >
                                        {(cell.probability * 100).toFixed(0)}%
                                    </text>

                                    {/* Scanned indicator mark */}
                                    {cell.scanned && (
                                        <Crosshair 
                                            size={12} 
                                            color="white" 
                                            style={{ position: 'absolute' }} 
                                            x={4} y={4} 
                                            opacity={0.6}
                                        />
                                    )}

                                    {/* Invisible interactive overlay to make cells clickable for scan simulation */}
                                    {/* We attach different simulated results to different mouse events to test without overwhelming UI buttons */}
                                    <rect 
                                        width={CELL_SIZE} 
                                        height={CELL_SIZE} 
                                        fill="transparent"
                                        cursor="crosshair"
                                        onClick={(e) => {
                                            // Left click simulates 'thermal' (+0.3)
                                            // Shift + Left click simulates 'motion' (+0.2)
                                            // Alt + Left click simulates 'none' (*0.5)
                                            if (e.altKey) {
                                                handleCellScan(r, c, 'none');
                                            } else if (e.shiftKey) {
                                                handleCellScan(r, c, 'motion');
                                            } else {
                                                handleCellScan(r, c, 'thermal');
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault(); // Right click simulates 'none' empty space
                                            handleCellScan(r, c, 'none');
                                        }}
                                        className="hover-scan-cell"
                                    />
                                </g>
                            ))
                        )}
                    </svg>

                    {/* Scan Legend Overlay */}
                    <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: '16px', background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', backdropFilter: 'blur(4px)' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, background: 'rgba(255, 68, 68, 0.8)' }}></div>
                            High Prob (≥0.7)
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, background: 'rgba(255, 204, 0, 0.8)' }}></div>
                            Med Prob (≥0.4)
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ width: 12, height: 12, background: 'rgba(60, 150, 255, 0.6)' }}></div>
                            Low Prob (&lt;0.4)
                        </div>
                    </div>
                </div>

                {/* Info Panel Container */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="hud-panel" style={{ padding: '24px', flex: 1 }}>
                        <h3 className="hud-text" style={{ color: 'var(--accent-primary)', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                            <Activity size={18} style={{ display: 'inline', marginRight: '8px' }}/> 
                            HEATMAP CONFIGURATION
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '24px' }}>
                            Initial Probabilities derived from environment:
                            <br/><span style={{ color: '#fff' }}>[0.5*BldgDen + 0.3*ResFactor + 0.2*RoadAcc]</span>
                        </p>
                        
                        <h4 className="hud-text" style={{ color: 'var(--warning)', marginTop: '32px', marginBottom: '12px' }}>DRONE SIMULATED SCAN CONTROLS</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)', padding: '12px' }}>
                                <strong>LEFT-CLICK CELL:</strong> <br/>Simulate <span style={{color: '#ff4444'}}>Thermal Hit</span> (p = min(p+0.3, 1))
                            </div>
                            <div style={{ background: 'rgba(255,204,0,0.1)', border: '1px solid rgba(255,204,0,0.3)', padding: '12px' }}>
                                <strong>SHIFT + LEFT-CLICK CELL:</strong> <br/>Simulate <span style={{color: '#ffcc00'}}>Motion Hit</span> (p = min(p+0.2, 1))
                            </div>
                            <div style={{ background: 'rgba(60,150,255,0.1)', border: '1px solid rgba(60,150,255,0.3)', padding: '12px' }}>
                                <strong>RIGHT-CLICK CELL:</strong> <br/>Simulate <span style={{color: '#3c96ff'}}>No Detection</span> (p = p * 0.5)
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            <style>{`
                .hover-scan-cell:hover {
                    fill: rgba(255, 255, 255, 0.2) !important;
                }
            `}</style>
        </div>
    );
};

export default MapSimulator;
