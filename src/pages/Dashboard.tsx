import React from 'react';

const Dashboard: React.FC = () => {
    return (
        <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--panel-border)', paddingBottom: '16px' }}>
                <div>
                    <h2 className="hud-text glow-text" style={{ fontSize: '2rem', color: 'var(--accent-primary)', marginBottom: '4px' }}>TELEMETRY & OVERRIDE</h2>
                    <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>[MONITORING SWARM ASSETS]</p>
                </div>
                <div className="hud-text" style={{ color: 'var(--accent-secondary)' }}>
                    {new Date().toISOString()}
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                {/* Stat Cards */}
                <div className="hud-panel" style={{ padding: '24px' }}>
                    <h3 className="hud-text" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>ACTIVE ASSETS</h3>
                    <div style={{ fontSize: '3rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', lineHeight: 1 }}>24/25</div>
                    <div style={{ width: '100%', height: '2px', background: 'var(--panel-border)', marginTop: '16px', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '96%', background: 'var(--accent-primary)' }}></div>
                    </div>
                </div>

                <div className="hud-panel" style={{ padding: '24px' }}>
                    <h3 className="hud-text" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>PROBABILITY TARGETS</h3>
                    <div style={{ fontSize: '3rem', fontFamily: 'var(--font-mono)', color: '#ffb800', lineHeight: 1 }}>07</div>
                    <div style={{ fontSize: '0.8rem', marginTop: '16px', color: 'var(--text-secondary)' }}>AWAITING MICRO-SCAN</div>
                </div>

                <div className="hud-panel" style={{ padding: '24px' }}>
                    <h3 className="hud-text" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>CRITICAL ERRORS</h3>
                    <div style={{ fontSize: '3rem', fontFamily: 'var(--font-mono)', color: 'var(--danger)', lineHeight: 1 }}>01</div>
                    <div style={{ fontSize: '0.8rem', marginTop: '16px', color: 'var(--text-secondary)' }}>DRONE_05 OFFLINE [BATTERY]</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flex: 1 }}>
                {/* Chain of Thought Log */}
                <div className="hud-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                    <h3 className="hud-text" style={{ color: 'var(--accent-primary)', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                        &gt; AI LOGIC_CHAIN
                    </h3>
                    <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>[T-03:45]</span> Evaluated Sector 4 thermal return. Confidence: 82%. Directing Swarm Alpha.</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>[T-03:42]</span> Drone_12 battery critical (14%). Reassigning to Base. Drone_15 taking over grid 7A.</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>[T-03:40]</span> Audio anomaly detected in Sector 2. Adjusting sensor weights: Audio [High], Thermal [Med].</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>[T-03:35]</span> Wide-area scan complete. 4 high-probability zones identified. Commencing micro-scans.</div>
                    </div>
                </div>

                {/* Human Override */}
                <div className="hud-panel" style={{ padding: '24px' }}>
                    <h3 className="hud-text" style={{ color: 'var(--warning)', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                        &gt; MANUAL OVERRIDE
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Force swarm prioritization bypassing current probability map.</p>
                        <button className="btn-cyber">PRIORITIZE: SCHOOL BUILDINGS</button>
                        <button className="btn-cyber">PRIORITIZE: HOSPITALS & CLINICS</button>
                        <button className="btn-cyber">RECALL ALL ASSETS TO BASE</button>
                        <div style={{ marginTop: 'auto', border: '1px dashed var(--danger)', padding: '12px', background: 'rgba(255,51,51,0.05)' }}>
                            <span className="hud-text glow-text" style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>! WARNING: OVERRIDE WILL DISRUPT CURRENT SCAN ALGORITHM</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
