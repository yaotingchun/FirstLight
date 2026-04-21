import React from 'react';
import type { Drone } from '../../types/simulation';
import { DroneCameraFeed } from './DroneCameraFeed';

interface DroneCameraStripProps {
    drones: Drone[];
    canvases: Record<string, HTMLCanvasElement>;
    time: number;
    centerLocation: { lat: number; lng: number };
}

export const DroneCameraStrip: React.FC<DroneCameraStripProps> = ({ drones, canvases, centerLocation }) => {
    return (
        <div style={{
            width: '100%',
            backgroundColor: 'rgba(2, 6, 8, 0.95)',
            height: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 10px',
            boxSizing: 'border-box',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0, 255, 204, 0.3) transparent'
        }}>
            <div style={{ 
                color: '#00ffcc', 
                fontSize: '0.78rem', 
                fontWeight: 'bold', 
                letterSpacing: '2px', 
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontFamily: 'monospace'
            }}>
                LIVE OPTICS FEED [SWARM]
            </div>

            {drones.map(drone => (
                <div key={`feed-container-${drone.id}`}>
                    <DroneCameraFeed 
                        drone={drone}
                        sourceCanvas={canvases[drone.id]}
                        centerLocation={centerLocation}
                    />
                </div>
            ))}

            {drones.length === 0 && (
                <div style={{ 
                    color: 'rgba(255,255,255,0.3)', 
                    fontSize: '0.6rem', 
                    textAlign: 'center', 
                    marginTop: '40px',
                    fontFamily: 'monospace' 
                }}>
                    AWAITING ASSET UPLINK...
                </div>
            )}
        </div>
    );
};
