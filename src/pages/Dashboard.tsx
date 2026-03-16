import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { getOrchestratorRecords, type OrchestratorRecord } from '../services/mcpClient';
import ReactMarkdown from 'react-markdown';

const Dashboard: React.FC = () => {
    const [logicChainRecords, setLogicChainRecords] = useState<OrchestratorRecord[]>([]);
    const logicChainRef = useRef<HTMLDivElement | null>(null);
    const shouldStickToBottomRef = useRef(true);

    const loadLogicChain = useCallback(async () => {
        const result = await getOrchestratorRecords();
        if (result.success && result.records) {
            setLogicChainRecords(result.records);
        }
    }, []);

    useEffect(() => {
        void loadLogicChain();
        const pollId = window.setInterval(() => {
            void loadLogicChain();
        }, 4000);

        return () => {
            window.clearInterval(pollId);
        };
    }, [loadLogicChain]);

    useEffect(() => {
        const container = logicChainRef.current;
        if (!container || !shouldStickToBottomRef.current) {
            return;
        }

        container.scrollTop = container.scrollHeight;
    }, [logicChainRecords]);

    const handleLogicChainScroll = useCallback(() => {
        const container = logicChainRef.current;
        if (!container) {
            return;
        }

        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom < 24;
    }, []);

    const downloadLogicChainAsText = useCallback(() => {
        const rows = logicChainRecords.filter((record) => record.source === 'ai' || record.source === 'action');
        const recordsToExport = rows.length > 0 ? rows : logicChainRecords;

        if (recordsToExport.length === 0) {
            return;
        }

        const blocks = recordsToExport.map((record) => {
            const stamp = new Date(record.timestamp).toISOString();
            return [
                `[${stamp}]`,
                `SOURCE: ${record.source.toUpperCase()}`,
                `MESSAGE: ${record.message}`,
            ].join('\n');
        });

        const exportBody = [
            'FirstLight AI Logic Chain Export',
            `Generated: ${new Date().toISOString()}`,
            '',
            ...blocks,
            '',
        ].join('\n\n');

        const blob = new Blob([exportBody], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ai-logic-chain-${new Date().toISOString().replace(/[.:]/g, '-')}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [logicChainRecords]);

    const renderRecords = useMemo(() => {
        if (logicChainRecords.length === 0) {
            return (
                <div style={{ color: 'var(--text-secondary)' }}>
                    Awaiting orchestrator activity...
                </div>
            );
        }

        return logicChainRecords.map((record, index) => {
            const stamp = new Date(record.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });

            const sourceColor =
                record.source === 'error'
                    ? 'var(--danger)'
                    : record.source === 'ai'
                        ? 'var(--accent-primary)'
                        : 'var(--text-secondary)';

            return (
                <div
                    key={`${record.timestamp}-${index}`}
                    style={{
                        border: '1px solid var(--panel-border)',
                        background: 'rgba(0, 30, 45, 0.28)',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                    }}
                >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>[{stamp}]</span>
                        <span style={{ color: sourceColor }}>[{record.source.toUpperCase()}]</span>
                    </div>
                    <div style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
                        <ReactMarkdown
                            components={{
                                p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
                                ul: ({ children }) => <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>{children}</ul>,
                                ol: ({ children }) => <ol style={{ margin: '6px 0 0 20px', padding: 0 }}>{children}</ol>,
                                li: ({ children }) => <li style={{ marginBottom: '2px' }}>{children}</li>,
                                pre: ({ children }) => (
                                    <pre
                                        style={{
                                            margin: '6px 0',
                                            whiteSpace: 'pre-wrap',
                                            background: 'rgba(0, 0, 0, 0.35)',
                                            border: '1px solid var(--panel-border)',
                                            padding: '8px',
                                            overflowX: 'auto',
                                        }}
                                    >
                                        {children}
                                    </pre>
                                ),
                                code: ({ children }) => (
                                    <code style={{ color: 'var(--accent-secondary)', background: 'rgba(0, 0, 0, 0.25)', padding: '0 3px' }}>
                                        {children}
                                    </code>
                                ),
                            }}
                        >
                            {record.message}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        });
    }, [logicChainRecords]);

    return (
        <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px', height: '100%', minHeight: 0 }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
                {/* Chain of Thought Log */}
                <div className="hud-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px dashed var(--panel-border)', paddingBottom: '8px' }}>
                        <h3 className="hud-text" style={{ color: 'var(--accent-primary)', marginBottom: 0 }}>
                            &gt; AI LOGIC_CHAIN
                        </h3>
                        <button
                            type="button"
                            onClick={downloadLogicChainAsText}
                            disabled={logicChainRecords.length === 0}
                            aria-label="Download AI logic chain as text"
                            title="Download AI logic chain as text"
                            className="hud-text"
                            style={{
                                border: '1px solid var(--panel-border)',
                                background: 'transparent',
                                color: logicChainRecords.length === 0 ? 'var(--text-secondary)' : 'var(--accent-primary)',
                                width: '30px',
                                height: '30px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: logicChainRecords.length === 0 ? 'not-allowed' : 'pointer'
                            }}
                        >
                            <Download size={14} />
                        </button>
                    </div>
                    <div
                        ref={logicChainRef}
                        onScroll={handleLogicChainScroll}
                        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '8px' }}
                    >
                        {renderRecords}
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
