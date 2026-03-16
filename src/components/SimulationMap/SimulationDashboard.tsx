import React from 'react';
import { Activity, Wifi, WifiOff, Radio } from 'lucide-react';
import type { Drone } from '../../types/simulation';

interface SimulationDashboardProps {
    drones: Drone[];
    time: number;
    aiDisconnectedRef: React.MutableRefObject<Set<string>>;
    aiReconnectedUntilTickRef: React.MutableRefObject<Map<string, number>>;
    triggerFailureEvent: (droneId: string) => void;
    metrics: {
        totalUniqueScans: number;
        missionTimeSec: number;
        averageZoneCoverage: number;
        meanProbabilityScanned: number;
        repeatedScanRate: number;
        totalScans: number;
    };
    sensorWeights: Record<string, { base: number, conf: number, color: string }>;
}

export const SimulationDashboard: React.FC<SimulationDashboardProps> = ({
    drones, time, aiDisconnectedRef, aiReconnectedUntilTickRef,
    triggerFailureEvent, metrics, sensorWeights
}) => {
    return (
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Live Swarm Status */}
            <div className="hud-panel" style={{ padding: '16px' }}>
                <h4 className="hud-text" style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} /> LIVE SWARM STATUS
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>ACTIVE DRONES</div>
                        <div style={{ fontSize: '1.5rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{drones.length}</div>
                    </div>
                    <div style={{ background: 'var(--panel-bg)', padding: '12px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>TIME CYCLES</div>
                        <div style={{ fontSize: '1.5rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{time}</div>
                    </div>
                </div>

                <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {drones.map((d, i) => {
                        const batColor = d.battery > 50 ? '#00ffcc' : d.battery > 20 ? '#ffff00' : '#ff4444';
                        const isAiDisconnected = aiDisconnectedRef.current.has(d.id);
                        const isRecentlyReconnected = (aiReconnectedUntilTickRef.current.get(d.id) ?? -1) > time;
                        const statusColor = isAiDisconnected
                            ? '#ff4444'
                            : d.mode === 'Wide'
                                ? '#00ffcc'
                                : d.mode === 'Relay'
                                    ? '#0077ff'
                                    : d.mode === 'Charging'
                                        ? '#ffa500'
                                        : '#ff4444';
                        return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <button
                                        onClick={() => {
                                            if (!isAiDisconnected) triggerFailureEvent(d.id);
                                        }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                                    >
                                        {isAiDisconnected ? <WifiOff size={14} color="#ff4444" /> : <Wifi size={14} color="#00ffcc" />}
                                    </button>
                                    <span style={{ color: isAiDisconnected ? '#ff4444' : '#00ffcc', fontWeight: 700 }}>
                                        {d.id}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ color: batColor, fontSize: '0.7rem' }}>{Math.floor(d.battery)}%</div>
                                    <div style={{ color: statusColor, minWidth: '85px', textAlign: 'right' }}>
                                        {isAiDisconnected ? 'DISCONNECTED' : isRecentlyReconnected ? 'RECONNECTED' : d.mode}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Simulate Failure Panel */}
            <div className="hud-panel" style={{ padding: '16px', background: 'rgba(255, 136, 0, 0.05)', border: '1px solid var(--panel-border)' }}>
                <h4 className="hud-text" style={{ fontSize: '0.85rem', color: '#ff8800', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1px' }}>
                    <WifiOff size={16} /> SIMULATE FAILURE
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {drones.map((d) => {
                        const droneColor = '#00ffcc';
                        const isAiDisconnected = aiDisconnectedRef.current.has(d.id);
                        const isRecentlyReconnected = (aiReconnectedUntilTickRef.current.get(d.id) ?? -1) > time;
                        return (
                            <button
                                key={d.id}
                                onClick={() => triggerFailureEvent(d.id)}
                                disabled={isAiDisconnected}
                                style={{
                                    background: 'rgba(0,0,0,0.3)',
                                    border: `1px solid ${isAiDisconnected ? '#ff4444' : isRecentlyReconnected ? '#33ffaa' : droneColor}`,
                                    padding: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    cursor: isAiDisconnected ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s',
                                    borderRadius: '2px',
                                    opacity: isAiDisconnected ? 0.7 : 1
                                }}
                            >
                                <WifiOff size={12} style={{ color: isAiDisconnected ? '#ff4444' : 'var(--text-secondary)', opacity: isAiDisconnected ? 1 : 0.3 }} />
                                <span style={{
                                    color: isAiDisconnected ? '#ff4444' : isRecentlyReconnected ? '#33ffaa' : droneColor,
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    fontFamily: 'var(--font-mono)'
                                }}>
                                    {d.id}
                                </span>
                                <div style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    background: isAiDisconnected ? '#ff4444' : isRecentlyReconnected ? '#33ffaa' : droneColor,
                                    boxShadow: isAiDisconnected ? '0 0 8px #ff4444' : `0 0 8px ${isRecentlyReconnected ? '#33ffaa' : droneColor}`
                                }} className={!isAiDisconnected ? 'animate-pulse' : ''} />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Swarm Strategy Analytics Overhaul */}
            <div className="hud-panel" style={{ padding: '16px', background: 'rgba(0, 255, 204, 0.05)', border: '1px solid var(--panel-border)' }}>
                <h4 className="hud-text" style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1px' }}>
                    SWARM STRATEGY ANALYTICS
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {/* Metric: Zone Coverage */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            ZONE COVERAGE
                        </div>
                        <div style={{ fontSize: '1.2rem', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {metrics.averageZoneCoverage.toFixed(1)}%
                        </div>
                    </div>

                    {/* Metric: Repeat Scans */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            REPEAT RATE
                        </div>
                        <div style={{ fontSize: '1.2rem', color: metrics.repeatedScanRate > 15 ? '#ff4444' : '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {metrics.repeatedScanRate.toFixed(1)}%
                        </div>
                    </div>

                    {/* Metric: Search Duration */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            SEARCH DURATION
                        </div>
                        <div style={{ fontSize: '1.2rem', color: metrics.totalUniqueScans >= 400 ? '#00ffcc' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {(() => {
                                const s = Math.floor(metrics.missionTimeSec);
                                const hours = Math.floor(s / 3600);
                                const mins = Math.floor((s % 3600) / 60);
                                const secs = s % 60;
                                return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                            })()}
                        </div>
                        {metrics.totalUniqueScans >= 400 && (
                            <div style={{ fontSize: '0.55rem', color: '#00ffcc', fontWeight: 'bold', marginTop: '2px' }}>MISSION COMPLETE</div>
                        )}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '2px', background: '#00ccff', width: `${Math.min(100, (metrics.totalUniqueScans / 400) * 100)}%`, opacity: 0.5 }} />
                    </div>

                    {/* Metric: Mean Probability */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            MEAN PROB
                        </div>
                        <div style={{ fontSize: '1.2rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {metrics.meanProbabilityScanned.toFixed(3)}
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(0, 255, 204, 0.1)', fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>TOTAL SCANS:</span>
                    <span style={{ color: 'var(--text-primary)' }}>{metrics.totalScans.toLocaleString()}</span>
                </div>
            </div>

            <div className="hud-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <h4 className="hud-text" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Radio size={18} /> ADAPTIVE SENSORS
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(Object.entries(sensorWeights) as [string, { base: number, conf: number, color: string }][]).map(([key, data]) => {
                        const finalW = (data.base * data.conf).toFixed(2);
                        return (
                            <div key={key}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginBottom: '4px', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                                    <span>{key} SIG</span>
                                    <span style={{ color: data.color }}>w={finalW}</span>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${(parseFloat(finalW) / 0.4) * 100}%`, height: '100%', background: data.color }}></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
