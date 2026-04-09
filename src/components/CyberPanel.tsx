import React from 'react';

interface CyberPanelProps {
    title: string;
    color?: string;
    icon?: React.ReactNode;
    flex?: number | string;
    children: React.ReactNode;
    headerRight?: React.ReactNode;
    style?: React.CSSProperties;
}

const CyberPanel: React.FC<CyberPanelProps> = ({ 
    title, 
    color = '#00ffcc', 
    icon, 
    flex, 
    children, 
    headerRight, 
    style 
}) => (
    <div style={{
        position: 'relative',
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(5, 12, 18, 0.7)',
        border: `1px solid rgba(0, 255, 204, 0.1)`,
        flex,
        minHeight: 0,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        ...style
    }}>
        {/* Corners */}
        <div style={{ position: 'absolute', top: -1, left: -1, width: '12px', height: '2px', background: color }} />
        <div style={{ position: 'absolute', top: -1, left: -1, width: '2px', height: '12px', background: color }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: '12px', height: '2px', background: color }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: '2px', height: '12px', background: color }} />
        <div style={{ position: 'absolute', top: -1, right: -1, width: '12px', height: '2px', background: color }} />
        <div style={{ position: 'absolute', top: -1, right: -1, width: '2px', height: '12px', background: color }} />
        <div style={{ position: 'absolute', bottom: -1, left: -1, width: '12px', height: '2px', background: color }} />
        <div style={{ position: 'absolute', bottom: -1, left: -1, width: '2px', height: '12px', background: color }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ color, fontSize: '0.85rem', fontWeight: 700, letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                {icon && <span style={{ opacity: 0.9 }}>{icon}</span>}
                {title}
            </div>
            {headerRight}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {children}
        </div>
    </div>
);

export default CyberPanel;
