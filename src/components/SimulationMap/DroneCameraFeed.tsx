import React, { useRef, useEffect } from 'react';
import { Battery, Mountain, SignalHigh, Crosshair } from 'lucide-react';
import type { Drone } from '../../types/simulation';

interface DroneCameraFeedProps {
    drone: Drone;
    sourceCanvas: HTMLCanvasElement | null | undefined;
    time: number;
    centerLocation: { lat: number; lng: number };
}

const CELL_DEG = 0.0009;
const GRID_W = 20;
const GRID_H = 20;

export const DroneCameraFeed: React.FC<DroneCameraFeedProps> = ({ drone, sourceCanvas, time, centerLocation }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const GRID_ORIGIN_LNG = centerLocation.lng - (GRID_W / 2) * CELL_DEG;
    const GRID_ORIGIN_LAT = centerLocation.lat + (GRID_H / 2) * CELL_DEG;
    const lng = GRID_ORIGIN_LNG + drone.x * CELL_DEG;
    const lat = GRID_ORIGIN_LAT - drone.y * CELL_DEG;

    useEffect(() => {
        if (!canvasRef.current || !sourceCanvas) return;

        let animId: number;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const frame = () => {
            if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
                ctx.drawImage(sourceCanvas, 0, 0, canvasRef.current!.width, canvasRef.current!.height);
            }
            animId = requestAnimationFrame(frame);
        };

        animId = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(animId);
    }, [sourceCanvas]);

    const batteryColor = drone.battery > 60 ? '#00ffcc' : drone.battery > 30 ? '#ffa500' : '#ff4444';
    const altitudeLabel = drone.mode === 'Micro' ? '80.0m' : drone.mode === 'Charging' ? '0.0m' : '300.0m';
    
    return (
        <div style={{
            width: '240px',
            height: '180px',
            background: '#000',
            border: '1px solid rgba(0, 255, 204, 0.2)',
            borderRadius: '4px',
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            fontFamily: 'monospace'
        }}>
            {/* Mirror Canvas - NATURAL COLOR (removed grayscale) */}
            <canvas
                ref={canvasRef}
                width={240}
                height={180}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'contrast(1.1) brightness(1.0) saturate(1.1)' 
                }}
            />

            {/* Tactical HUD Overlay - Sync with DroneCam OSD */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                boxSizing: 'border-box'
            }}>
                {/* Header info */}
                <div style={{ 
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    background: 'rgba(2, 6, 8, 0.75)', 
                    padding: '4px 8px', 
                    borderRadius: '2px', 
                    borderLeft: `2px solid ${drone.isConnected ? '#00ffcc' : '#ff4444'}`,
                    fontSize: '0.65rem',
                    color: '#eee',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                }}>
                    <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {drone.id} <SignalHigh size={10} color={drone.isConnected ? '#00ffcc' : '#ff4444'} />
                    </div>
                    <div style={{ opacity: 0.7, fontSize: '0.55rem', letterSpacing: '1px' }}>{drone.mode.toUpperCase()}</div>
                </div>

                <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                    <SignalHigh size={12} color="#00ffcc" opacity={0.6} />
                </div>

                {/* Center Crosshair Overlay */}
                <div style={{ 
                    position: 'absolute', 
                    top: '50%', 
                    left: '50%', 
                    transform: 'translate(-50%, -50%)',
                    opacity: 0.4
                }}>
                    <Crosshair size={28} color="#00ffcc" strokeWidth={1} />
                </div>

                {/* Footer Telemetry - Matching DroneCam style */}
                <div style={{ 
                    position: 'absolute',
                    bottom: 0,
                    width: '100%',
                    background: 'rgba(2, 6, 8, 0.8)',
                    padding: '4px 8px',
                    fontSize: '0.5rem',
                    color: '#00ffcc',
                    borderTop: '1px solid rgba(0, 255, 204, 0.2)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    boxSizing: 'border-box'
                }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={{ opacity: 0.7 }}><Mountain size={8} style={{ verticalAlign: 'middle' }} /> {altitudeLabel}</span>
                        <span style={{ color: batteryColor }}><Battery size={8} style={{ verticalAlign: 'middle' }} /> {Math.floor(drone.battery)}%</span>
                    </div>
                    <div>
                        {lat.toFixed(4)}, {lng.toFixed(4)} • T:{time}
                    </div>
                </div>
            </div>

            {/* Subtle SCANLINES Effect */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.05) 50%)',
                backgroundSize: '100% 2px',
                pointerEvents: 'none',
                opacity: 0.3
            }} />
        </div>
    );
};
