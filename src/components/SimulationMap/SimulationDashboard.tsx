import React from 'react';
import { Activity, Wifi, WifiOff, Radio, Download } from 'lucide-react';
import type { Drone } from '../../types/simulation';
import { generateTrainingAnalysis } from '../../services/mcpClient';

interface SimulationDashboardProps {
    drones: Drone[];
    time: number;
    aiDisconnectedRef: React.MutableRefObject<Set<string>>;
    aiReconnectedUntilTickRef: React.MutableRefObject<Map<string, number>>;
    metrics: {
        totalUniqueScans: number;
        missionTimeSec: number;
        averageZoneCoverage: number;
        survivorFoundCount: number;
        repeatedScanRate: number;
        totalScans: number;
    };
    sensorWeights: Record<string, { base: number, conf: number, color: string }>;
    running: boolean;
    onAppendSimulationRecord?: () => Promise<boolean>;
}

export const SimulationDashboard: React.FC<SimulationDashboardProps> = ({
    drones, time, aiDisconnectedRef, aiReconnectedUntilTickRef,
    metrics, sensorWeights, running, onAppendSimulationRecord,
}) => {
    const [appendState, setAppendState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [toast, setToast] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const missionComplete = metrics.averageZoneCoverage >= 100;

    React.useEffect(() => {
        if (!missionComplete) {
            setAppendState('idle');
            setToast(null);
        }
    }, [missionComplete]);

    React.useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => {
            setToast(null);
        }, 2600);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const handleAppendRecord = React.useCallback(async () => {
        if (!onAppendSimulationRecord || appendState === 'saving' || appendState === 'saved') {
            return;
        }
        setAppendState('saving');
        setToast({ type: 'success', message: 'GENERATING AI ANALYSIS...' });

        const success = await onAppendSimulationRecord();
        
        // --- NEW LLM ANALYST RAG PIPELINE ---
        const simData = {
            environment: 'Urban Simulation',
            speed: 'Default',
            sectorsScanned: metrics.totalUniqueScans,
            averageZoneCoverage: metrics.averageZoneCoverage,
            totalScans: metrics.totalScans,
            repeatedScanRate: metrics.repeatedScanRate
        };
        const analysisResult = await generateTrainingAnalysis(simData);
        
        if (analysisResult.success && analysisResult.report) {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(analysisResult.report, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "training_analyst_report.json");
            dlAnchorElem.click();
            
            setToast({ type: 'success', message: 'ANALYSIS SAVED & DOWNLOADED' });
            setAppendState('saved');
        } else {
            console.error('Failed to generate analyst report:', analysisResult.error);
            setToast({ type: 'error', message: 'ANALYSIS GENERATION FAILED' });
            setAppendState('error');
        }
    }, [appendState, onAppendSimulationRecord, metrics]);

    return (
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {toast && (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        position: 'fixed',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 1200,
                        minWidth: '300px',
                        maxWidth: '420px',
                        padding: '16px 18px',
                        border: `2px solid ${toast.type === 'success' ? 'rgba(0, 255, 204, 0.75)' : 'rgba(255, 68, 68, 0.75)'}`,
                        borderRadius: '6px',
                        background: 'rgba(1, 10, 14, 0.98)',
                        color: toast.type === 'success' ? '#00ffcc' : '#ff6666',
                        fontSize: '0.82rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        boxShadow: toast.type === 'success'
                            ? '0 0 0 1px rgba(0,255,204,0.35), 0 0 24px rgba(0,255,204,0.35), 0 14px 34px rgba(0,0,0,0.55)'
                            : '0 0 0 1px rgba(255,68,68,0.35), 0 0 24px rgba(255,68,68,0.35), 0 14px 34px rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(8px)',
                        textAlign: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    <div style={{ fontSize: '1.05rem', marginBottom: '6px', lineHeight: 1 }}>
                        {toast.type === 'success' ? 'DOWNLOAD COMPLETE' : 'DOWNLOAD FAILED'}
                    </div>
                    <div style={{ opacity: 0.92 }}>{toast.message}</div>
                </div>
            )}
            {/* Live Swarm Status */}
            <div className="hud-panel" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h4 className="hud-text" style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1.2px' }}>
                        <Activity size={18} /> LIVE SWARM STATUS
                    </h4>
                </div>

                <div style={{ fontSize: '0.84rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {drones.map((d, i) => {
                        const batColor = d.battery > 50 ? '#00ffcc' : d.battery > 20 ? '#ffff00' : '#ff4444';
                        const isAiDisconnected = aiDisconnectedRef.current.has(d.id);
                        const isRecentlyReconnected = (aiReconnectedUntilTickRef.current.get(d.id) ?? -1) > time;
                        const statusColor = (isAiDisconnected || d.isDestroyed || d.failureType)
                            ? '#ff4444'
                            : d.mode === 'Wide'
                                ? '#00ffcc'
                                : d.mode === 'Relay'
                                    ? '#0077ff'
                                    : d.mode === 'Charging'
                                        ? '#ffa500'
                                        : '#ff4444';

                        const getStatusText = () => {
                            if (d.isDestroyed || d.failureType === 'HARDWARE_FAILURE') return 'HARDWARE FAILURE';
                            if (isAiDisconnected) return 'DISCONNECTED';
                            if (isRecentlyReconnected) return 'RECONNECTED';
                            return d.mode;
                        };
                        return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', padding: 2 }}>
                                        {isAiDisconnected ? <WifiOff size={14} color="#ff4444" /> : <Wifi size={14} color="#00ffcc" />}
                                    </span>
                                    <span style={{ color: isAiDisconnected ? '#ff4444' : '#00ffcc', fontWeight: 700, fontSize: '0.86rem', letterSpacing: '0.02em' }}>
                                        {d.id}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ color: batColor, fontSize: '0.76rem', letterSpacing: '0.03em' }}>{Math.floor(d.battery)}%</div>
                                    <div style={{ color: statusColor, minWidth: '85px', textAlign: 'right', letterSpacing: '0.03em', fontSize: (getStatusText().length > 10) ? '0.72rem' : '0.86rem' }}>
                                        {getStatusText()}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Swarm Strategy Analytics Overhaul */}
            <div className="hud-panel" style={{ padding: '16px', background: 'rgba(0, 255, 204, 0.05)', border: '1px solid var(--panel-border)' }}>
                <h4 className="hud-text" style={{ fontSize: '0.92rem', color: 'var(--accent-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1.3px' }}>
                    SWARM STRATEGY ANALYTICS
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {/* Metric: Zone Coverage */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            ZONE COVERAGE
                        </div>
                        <div style={{ fontSize: '1.28rem', color: '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
                            {metrics.averageZoneCoverage.toFixed(1)}%
                        </div>
                    </div>

                    {/* Metric: Repeat Scans */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            REPEAT RATE
                        </div>
                        <div style={{ fontSize: '1.28rem', color: metrics.repeatedScanRate > 15 ? '#ff4444' : '#00ffcc', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
                            {metrics.repeatedScanRate.toFixed(1)}%
                        </div>
                    </div>

                    {/* Metric: Search Duration */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '4px' }}>
                            <span>SEARCH TIME</span>
                            {missionComplete && onAppendSimulationRecord && (
                                <button
                                    onClick={() => {
                                        void handleAppendRecord();
                                    }}
                                    title={appendState === 'saved' ? 'Saved to analytics' : 'Append simulation to analytics JSON'}
                                    aria-label="Append simulation result to analytics"
                                    disabled={appendState === 'saving' || appendState === 'saved'}
                                    style={{
                                        border: '1px solid var(--panel-border)',
                                        background: appendState === 'saved' ? 'rgba(0, 255, 204, 0.18)' : 'rgba(0,0,0,0.45)',
                                        color: appendState === 'error' ? '#ff4444' : '#00ffcc',
                                        padding: '2px 4px',
                                        lineHeight: 0,
                                        borderRadius: '2px',
                                        cursor: appendState === 'saving' || appendState === 'saved' ? 'default' : 'pointer',
                                        opacity: appendState === 'saving' ? 0.6 : 1,
                                    }}
                                >
                                    <Download size={12} />
                                </button>
                            )}
                        </div>
                        <div style={{ fontSize: '1.28rem', color: metrics.averageZoneCoverage >= 100 ? '#00ffcc' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
                            {(() => {
                                const s = Math.floor(metrics.missionTimeSec);
                                const hours = Math.floor(s / 3600);
                                const mins = Math.floor((s % 3600) / 60);
                                const secs = s % 60;
                                return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                            })()}
                        </div>
                        {metrics.averageZoneCoverage >= 100 && (
                            <div style={{ fontSize: '0.55rem', color: '#00ffcc', fontWeight: 'bold', marginTop: '2px' }}>
                                {appendState === 'saving' ? 'MISSION COMPLETE | SAVING...' : 'MISSION COMPLETE'}
                            </div>
                        )}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '2px', background: '#00ccff', width: `${Math.min(100, metrics.averageZoneCoverage)}%`, opacity: 0.5 }} />
                    </div>

                    {/* Metric: Mean Probability */}
                    <div style={{ padding: '10px', border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            SURVIVORS FOUND
                        </div>
                        <div style={{ fontSize: '1.28rem', color: running ? '#00ffcc' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.02em' }}>
                            {metrics.survivorFoundCount.toLocaleString()}
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(0, 255, 204, 0.1)', fontSize: '0.74rem', letterSpacing: '0.04em', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>TOTAL SCANS:</span>
                    <span style={{ color: 'var(--text-primary)' }}>{metrics.totalScans.toLocaleString()}</span>
                </div>
            </div>

            <div className="hud-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <h4 className="hud-text" style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '1.2px' }}>
                    <Radio size={18} /> ADAPTIVE SENSORS
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(Object.entries(sensorWeights) as [string, { base: number, conf: number, color: string }][]).map(([key, data]) => {
                        const finalW = (data.base * data.conf).toFixed(2);
                        return (
                            <div key={key}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', marginBottom: '4px', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                                    <span style={{ letterSpacing: '0.08em' }}>{key} SIG</span>
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
