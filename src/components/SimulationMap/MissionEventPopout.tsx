import React from 'react';
import { AlertCircle, Zap, Radio, X, Battery } from 'lucide-react';
import type { MissionEvent } from '../../types/simulation';

interface MissionEventPopoutProps {
    event: MissionEvent | null;
    onDismiss: () => void;
}

export const MissionEventPopout: React.FC<MissionEventPopoutProps> = ({ event, onDismiss }) => {
    if (!event) return null;

    const colors = {
        RELAY_HANDOFF: '#0077ff',
        BATTERY_RECALL: '#ffa500',
        EMERGENCY_LANDING: '#ff4444',
        SYSTEM_ALERT: '#00ffcc'
    };

    const icons = {
        RELAY_HANDOFF: <Radio size={16} />,
        BATTERY_RECALL: <Battery size={16} />,
        EMERGENCY_LANDING: <AlertCircle size={16} />,
        SYSTEM_ALERT: <Zap size={16} />
    };

    const color = colors[event.type] || '#00ffcc';
    const icon = icons[event.type] || <AlertCircle size={16} />;

    return (
        <div 
            className="mission-event-popout"
            style={{
                position: 'absolute',
                top: '0px',
                left: '0px', // Left aligned
                zIndex: 3000,
                width: '320px',
                background: 'rgba(1, 10, 14, 0.96)',
                border: `1px solid ${color}44`,
                borderLeft: `4px solid ${color}`, // Border on the left
                borderRadius: '0 4px 4px 0',
                boxShadow: `0 0 20px ${color}11, 10px 10px 30px rgba(0,0,0,0.8)`,
                backdropFilter: 'blur(12px)',
                padding: '12px 16px',
                paddingLeft: '12px',
                display: 'flex',
                gap: '14px',
                alignItems: 'center',
                animation: 'slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                fontFamily: 'var(--font-mono)',
                pointerEvents: 'auto',
                userSelect: 'none',
                overflow: 'hidden'
            }}
        >
            <div style={{ 
                color: color, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                background: `${color}15`,
                borderRadius: '4px',
                flexShrink: 0
            }}>
                {icon}
            </div>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ 
                    fontSize: '0.6rem', 
                    color: color, 
                    fontWeight: 800, 
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    opacity: 0.9,
                }}>
                    {event.type.replace('_', ' ')}
                </div>
                <div style={{ 
                    fontSize: '0.85rem', 
                    color: '#fff', 
                    fontWeight: 700,
                    letterSpacing: '0.5px'
                }}>
                    {event.title}
                </div>
                <div style={{ 
                    fontSize: '0.7rem', 
                    color: 'rgba(255,255,255,0.7)',
                    lineHeight: 1.4
                }}>
                    {event.message}
                </div>
            </div>

            <button 
                onClick={onDismiss}
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
            >
                <X size={16} />
            </button>

            {/* Tactical Detail Overlay */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.05) 50%)',
                backgroundSize: '100% 4px',
                pointerEvents: 'none',
                opacity: 0.3
            }} />

            {/* Glow effect at the bottom */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '100%',
                height: '1px',
                background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                opacity: 0.5
            }} />
            
            <style>{`
                @keyframes slideInLeft {
                    from { transform: translateX(-100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};
