import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Download, Activity, Radar, BarChart2, Terminal, Layers, Radio } from 'lucide-react';
import { executeTool, getOrchestratorRecords, type OrchestratorRecord } from '../services/mcpClient';
import ReactMarkdown from 'react-markdown';
import { RobotIcon, DroneIcon } from '../components/SimulationMap/LogIcons';

type DroneMode = 'Wide' | 'Micro' | 'Relay' | 'Charging';

interface DroneStatus {
    id: string;
    mode: DroneMode;
    battery: number;
    isConnected: boolean;
    isActive: boolean;
    target?: { x: number; y: number; gridCell: string } | null;
}

interface DashboardDrone {
    id: string;
    battery: number;
    state: 'OK' | 'OFFLINE';
    mode: string;
    signal: number;
    rawMode: string;
    target?: { x: number; y: number; gridCell: string } | null;
}

interface MissionStats {
    currentTick: number;
    sectorsScanned: number;
    totalSectors: number;
    scanProgress: number;
    averageBattery?: number;
    averageZoneCoverage?: number;
    meanProbabilityScanned?: number;
    repeatedScanRate?: number;
    missionTimeSec?: number;
    sensorWeights?: {
        mobile: { base: number; conf: number; color: string };
        thermal: { base: number; conf: number; color: string };
        sound: { base: number; conf: number; color: string };
        wifi: { base: number; conf: number; color: string };
    };
    totalEstimatedSurvivors?: number;
}

interface GridHeatmap {
    width: number;
    height: number;
    cells: number[][];
}

const CyberPanel: React.FC<{ title: string, color?: string, icon?: React.ReactNode, flex?: number | string, children: React.ReactNode, headerRight?: React.ReactNode, style?: React.CSSProperties }> = ({ title, color = '#00ffcc', icon, flex, children, headerRight, style }) => (
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

const Dashboard: React.FC = () => {
    const [logicChainRecords, setLogicChainRecords] = useState<OrchestratorRecord[]>([]);
    const [swarmDrones, setSwarmDrones] = useState<DashboardDrone[]>([]);
    const [missionStats, setMissionStats] = useState<MissionStats | null>(null);
    const [gridHeatmap, setGridHeatmap] = useState<GridHeatmap | null>(null);
    const logicChainRef = useRef<HTMLDivElement | null>(null);
    const shouldStickToBottomRef = useRef(true);

    const loadLogicChain = useCallback(async () => {
        const result = await getOrchestratorRecords();
        if (result.success && result.records) setLogicChainRecords(result.records);
    }, []);

    const loadSwarmTelemetry = useCallback(async () => {
        const result = await executeTool<DroneStatus[]>('getAllDroneStatuses');
        if (!result.success || !result.data) return;

        const mapped = result.data.map((d) => {
            const isOffline = !d.isActive || !d.isConnected;
            const signal = isOffline ? 0 : Math.min(100, Math.max(45, Math.round(70 + d.battery * 0.3)));

            let intent = 'Idle';
            if (isOffline) intent = 'OFFLINE';
            else if (d.mode === 'Wide') intent = d.target ? `Exploring Sector (${Math.round(d.target.x)},${Math.round(d.target.y)})` : 'Exploring Sector';
            else if (d.mode === 'Micro') intent = d.target ? `Investigating Hotspot (${Math.round(d.target.x)},${Math.round(d.target.y)})` : 'Investigating Hotspot';
            else if (d.mode === 'Charging') intent = `Returning (Low Battery)`;
            else if (d.mode === 'Relay') intent = `Relay Node`;

            return {
                id: d.id,
                battery: Math.round(d.battery),
                state: isOffline ? 'OFFLINE' : 'OK',
                mode: intent,
                signal,
                rawMode: d.mode,
                target: d.target || null
            } satisfies DashboardDrone;
        });

        setSwarmDrones(mapped);
    }, []);

    const loadDashboardTelemetry = useCallback(async () => {
        const [missionResult, heatmapResult] = await Promise.all([
            executeTool<MissionStats>('getMissionStats'),
            executeTool<GridHeatmap>('getGridHeatmap')
        ]);

        if (missionResult.success && missionResult.data) setMissionStats(missionResult.data);
        if (heatmapResult.success && heatmapResult.data) setGridHeatmap(heatmapResult.data);
    }, []);

    useEffect(() => {
        void loadLogicChain();
        void loadSwarmTelemetry();
        void loadDashboardTelemetry();
        const pollId = window.setInterval(() => {
            void loadLogicChain();
            void loadSwarmTelemetry();
            void loadDashboardTelemetry();
        }, 4000);
        return () => window.clearInterval(pollId);
    }, [loadLogicChain, loadSwarmTelemetry, loadDashboardTelemetry]);

    useEffect(() => {
        if (!logicChainRef.current || !shouldStickToBottomRef.current) return;
        logicChainRef.current.scrollTop = logicChainRef.current.scrollHeight;
    }, [logicChainRecords]);

    const handleLogicChainScroll = useCallback(() => {
        const container = logicChainRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom < 24;
    }, []);


    const downloadLogicChainAsText = useCallback(() => {
        const rows = logicChainRecords.filter((record) => record.source === 'ai' || record.source === 'action');
        const recordsToExport = rows.length > 0 ? rows : logicChainRecords;
        if (recordsToExport.length === 0) return;

        const blocks = recordsToExport.map((record) => {
            const stamp = new Date(record.timestamp).toISOString();
            return [`[${stamp}]`, `SOURCE: ${record.source.toUpperCase()}`, `MESSAGE: ${record.message}`].join('\n');
        });

        const exportBody = ['FirstLight AI Logic Chain Export', `Generated: ${new Date().toISOString()}`, '', ...blocks, ''].join('\n\n');
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
            return <div style={{ color: '#6b8a8b', padding: '16px', fontStyle: 'italic', fontSize: '0.9rem' }}>Awaiting orchestrator strategy...</div>;
        }

        return logicChainRecords.map((record, index) => {
            const date = new Date(record.timestamp);
            const stamp = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const getDroneColor = (id?: string) => {
                if (!id) return '#9db1c1';
                if (id === 'ORCHESTRATOR') return '#00ffcc';
                if (id.includes('Alpha')) return '#4da3ff';
                if (id.includes('Beta')) return '#51cf66';
                if (id.includes('Gamma')) return '#f06595';
                if (id.includes('Delta')) return '#fcc419';
                if (id.startsWith('RLY') || id.includes('Relay')) return '#ff922b';
                return '#adb5bd';
            };

            const droneId = record.droneId || (record.source === 'ai' ? 'ORCHESTRATOR' : undefined);
            const themeColor = getDroneColor(droneId);

            return (
                <div
                    key={`${record.timestamp}-${index}`}
                    style={{
                        border: `1px solid ${droneId ? themeColor + '44' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 6,
                        padding: '8px 10px',
                        background: droneId ? `${themeColor}11` : 'rgba(0,0,0,0.2)',
                        fontSize: '0.8rem',
                        lineHeight: 1.45,
                        position: 'relative',
                        borderLeft: droneId ? `3px solid ${themeColor}` : '1px solid rgba(255,255,255,0.08)',
                        marginBottom: '8px'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.65rem', fontWeight: 600 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <div style={{
                                width: 18,
                                height: 18,
                                borderRadius: '4px',
                                background: `${themeColor}22`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                border: `1px solid ${themeColor}44`
                            }}>
                                {record.source === 'ai' || (droneId && droneId.toLowerCase().includes('agent')) || droneId === 'ORCHESTRATOR' ? (
                                    <RobotIcon color={themeColor} size={11} />
                                ) : (
                                    <DroneIcon color={themeColor} size={11} />
                                )}
                            </div>
                            <span style={{ color: '#8aa0b3' }}>[{stamp}]</span>
                            <span style={{ color: themeColor }}>{droneId || record.source.toUpperCase()}</span>
                        </div>
                        {record.source === 'ai' && <span style={{ color: '#4da3ff', opacity: 0.8, letterSpacing: '1px' }}>THINK</span>}
                        {record.source === 'action' && <span style={{ color: '#00ffcc', opacity: 0.8, letterSpacing: '1px' }}>ACTION</span>}
                    </div>
                    <div style={{ color: droneId ? '#eee' : '#9db1c1', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                        <ReactMarkdown
                            components={{
                                p: ({ node, ...props }) => <p style={{ margin: 0, marginTop: '2px' }} {...props} />,
                                ul: ({ node, ...props }) => <ul style={{ margin: '4px 0 0 16px', padding: 0 }} {...props} />,
                                ol: ({ node, ...props }) => <ol style={{ margin: '4px 0 0 16px', padding: 0 }} {...props} />,
                                li: ({ node, ...props }) => <li style={{ marginBottom: '2px' }} {...props} />,
                                strong: ({ node, ...props }) => <strong style={{ color: '#fff' }} {...props} />,
                                code: ({ node, ...props }) => <code style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '3px', fontFamily: 'monospace', color: '#00ffcc' }} {...props} />
                            }}
                        >
                            {record.message}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        });
    }, [logicChainRecords]);

    const missionCoverage = missionStats?.averageZoneCoverage ?? missionStats?.scanProgress ?? 0;
    const missionSeconds = missionStats?.missionTimeSec ?? (missionStats ? missionStats.currentTick * 0.1 : 0);

    const explorationRate = missionStats && missionSeconds > 0
        ? (missionStats.sectorsScanned / missionSeconds).toFixed(1)
        : '0.0';

    const repeatRate = missionStats?.repeatedScanRate !== undefined
        ? missionStats.repeatedScanRate.toFixed(1)
        : '0.0';

    const activeInvestigations = swarmDrones.filter(d => d.rawMode === 'Micro').length;

    const searchDrones = swarmDrones.filter(d => d.rawMode !== 'Relay' && d.state === 'OK');
    const wideCount = searchDrones.filter(d => d.rawMode === 'Wide').length;
    const microCount = searchDrones.filter(d => d.rawMode === 'Micro').length;
    const totalSearch = Math.max(1, wideCount + microCount);

    const explorationBias = Math.round((wideCount / totalSearch) * 100);
    const investigationBias = Math.round((microCount / totalSearch) * 100);

    let strategyMode = 'Wide';
    if (investigationBias > 0 && explorationBias > 0) strategyMode = 'Hybrid (Wide + Micro)';
    else if (investigationBias > 0) strategyMode = 'Micro';

    const focusDrone = searchDrones.find(d => d.rawMode === 'Micro' && d.target);
    const focusString = focusDrone ? `Hotspot at (${Math.round(focusDrone.target!.x)}, ${Math.round(focusDrone.target!.y)})` : 'None';

    const hotspots = useMemo(() => {
        if (!gridHeatmap || !gridHeatmap.cells) return [];
        const list = [];
        for (let y = 0; y < gridHeatmap.height; y++) {
            for (let x = 0; x < gridHeatmap.width; x++) {
                if (gridHeatmap.cells[y][x] > 0.1) {
                    list.push({ x, y, conf: gridHeatmap.cells[y][x] });
                }
            }
        }
        const sliceCount = missionStats?.totalEstimatedSurvivors ?? 3;
        return list.sort((a, b) => b.conf - a.conf).slice(0, sliceCount);
    }, [gridHeatmap, missionStats?.totalEstimatedSurvivors]);


    return (
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#020608', height: '100%', minHeight: 0, padding: '24px 20px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
            {/* Header */}
            <header style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#00ffcc', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'monospace', textShadow: '0 0 10px rgba(0, 255, 204, 0.4)' }}>
                        TELEMETRY DASHBOARD
                    </h2>
                    <div style={{ color: '#6b8a8b', letterSpacing: '1px', fontSize: '0.75rem', marginTop: '6px', fontFamily: 'monospace' }}>
                        [MISSION COMMAND CENTER]
                    </div>
                </div>
                <div style={{ color: '#00ffcc', fontSize: '0.85rem', opacity: 0.8, fontFamily: 'monospace' }}>
                    {new Date().toISOString()} Z
                </div>
            </header>

            {/* Triptych Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.5fr) minmax(280px, 1fr) minmax(240px, 0.95fr)', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden', paddingBottom: '2px' }}>

                {/* ---------- LEFT COLUMN: Intelligence Feed ---------- */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', paddingBottom: '2px' }}>
                    <CyberPanel
                        title="AI_LOGIC_CHAIN"
                        icon={<Terminal size={16} />}
                        flex={1}
                        headerRight={
                            <button onClick={downloadLogicChainAsText} style={{ background: 'transparent', border: '1px solid currentColor', color: '#00ffcc', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.8 }}>
                                <Download size={14} />
                            </button>
                        }
                    >
                        <div ref={logicChainRef} onScroll={handleLogicChainScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehaviorY: 'contain', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '8px' }}>
                            {renderRecords}
                        </div>
                    </CyberPanel>
                </div>

                {/* ---------- MIDDLE COLUMN: Strategy & Intent ---------- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden', minHeight: 0, paddingBottom: '2px' }}>

                    {/* ACTIVE HOTSPOTS */}
                    <CyberPanel title="ACTIVE HOTSPOTS" icon={<Radar size={16} />} color="#ff4444" flex={1}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, padding: '16px', overflowY: 'auto', justifyContent: 'space-evenly' }}>
                            {hotspots.length > 0 ? hotspots.map((h, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span style={{ color: '#6b8a8b' }}>#{i + 1} ({h.x},{h.y})</span>
                                    <span style={{ fontWeight: 'bold', color: '#ff4444' }}>{h.conf.toFixed(2)} WT</span>
                                </div>
                            )) : <div style={{ fontSize: '0.85rem', color: '#6b8a8b', textAlign: 'center' }}>NO ACTIVE HOTSPOTS</div>}
                        </div>
                    </CyberPanel>

                    {/* DRONE INTENT (SWARM_DIAGNOSTIC) */}
                    <CyberPanel title="DRONE INTENT" icon={<Activity size={16} />} flex={1.4}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#6b8a8b', letterSpacing: '1px' }}>ACTIVE_ASSETS</div>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px', justifyContent: 'space-evenly' }}>
                            {swarmDrones.slice(0, 10).map((d, i) => {
                                const isOffline = d.state === 'OFFLINE';
                                return (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '12px 14px', borderRadius: '4px', fontSize: '0.76rem' }}>
                                        <span style={{ color: isOffline ? '#ff4444' : '#fff', fontWeight: 600 }}>{d.id}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ color: d.battery > 20 ? '#00ffcc' : '#ff4444' }}>{d.battery}%</span>
                                            <span style={{ color: isOffline ? '#ff4444' : '#00ffcc', opacity: 0.8 }}>{d.mode}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CyberPanel>
                </div>

                {/* ---------- RIGHT COLUMN: Hotspots & Progression ---------- */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden', minHeight: 0, paddingBottom: '2px' }}>

                    {/* SWARM STRATEGY */}
                    <CyberPanel title="SWARM STRATEGY" icon={<Layers size={16} />} color="#fff" flex={0.8}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'space-evenly', height: '100%', padding: '8px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                <span style={{ color: '#6b8a8b' }}>MODE</span>
                                <span style={{ color: '#00ffcc', fontWeight: 'bold' }}>{strategyMode}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                <span style={{ color: '#6b8a8b' }}>FOCUS</span>
                                <span style={{ fontWeight: 'bold' }}>{focusString}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                <span style={{ color: '#6b8a8b' }}>EXPLORATION_BIAS</span>
                                <span style={{ fontWeight: 'bold' }}>{explorationBias}%</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                <span style={{ color: '#6b8a8b' }}>INVESTIGATION_BIAS</span>
                                <span style={{ fontWeight: 'bold' }}>{investigationBias}%</span>
                            </div>
                        </div>
                    </CyberPanel>

                    {/* MISSION PROGRESSION */}
                    <CyberPanel title="MISSION PROGRESSION" icon={<BarChart2 size={16} />} color="#ff9900" flex={1.2} style={{ borderBottom: '1px solid rgba(255, 153, 0, 0.45)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', height: '100%', justifyContent: 'space-evenly', padding: '4px 8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#6b8a8b', letterSpacing: '1px' }}>COVERAGE</div>
                                <div style={{ fontSize: '1.5rem', color: '#00ffcc', fontWeight: 'bold', fontFamily: 'monospace' }}>{missionCoverage.toFixed(1)}%</div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#6b8a8b', letterSpacing: '1px' }}>EXPLORATION RATE</div>
                                <div style={{ fontSize: '1.2rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>{explorationRate} <span style={{ fontSize: '0.6rem', color: '#6b8a8b' }}>cells/s</span></div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#6b8a8b', letterSpacing: '1px' }}>REPEAT RATE</div>
                                <div style={{ fontSize: '1.2rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>{repeatRate}%</div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#6b8a8b', letterSpacing: '1px', maxWidth: '50%' }}>HOTSPOT INVESTIGATIONS</div>
                                <div style={{ fontSize: '1.2rem', color: '#ff9900', fontWeight: 'bold', fontFamily: 'monospace' }}>{activeInvestigations} <span style={{ fontSize: '0.6rem', color: '#6b8a8b' }}>Drones</span></div>
                            </div>
                        </div>
                    </CyberPanel>

                    {/* ADAPTIVE SENSORS */}
                    <CyberPanel title="ADAPTIVE SENSORS" icon={<Radio size={16} />} flex={0.85}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 12px', overflowY: 'auto' }}>
                            {missionStats?.sensorWeights ? (
                                (Object.entries(missionStats.sensorWeights) as [string, { base: number; conf: number; color?: string }][]).map(([key, data]) => {
                                    const fw = (data.base * data.conf).toFixed(2);
                                    const defaultColor = key === 'mobile' ? '#00ffcc' : key === 'thermal' ? '#ff4444' : key === 'sound' ? '#ffff00' : '#ff00ff';
                                    return (
                                        <div key={key}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: '8px' }}>
                                                <span>{key} SIG</span><span style={{ color: data.color || defaultColor }}>w={fw}</span>
                                            </div>
                                            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ width: `${Math.min(100, (parseFloat(fw) / 0.4) * 100)}%`, height: '100%', background: data.color || defaultColor, boxShadow: `0 0 6px ${data.color || defaultColor}` }} />
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div style={{ fontSize: '0.75rem', color: '#6b8a8b', textAlign: 'center', marginTop: '10px' }}>NO SENSOR DATA</div>
                            )}
                        </div>
                    </CyberPanel>
                </div>

            </div>
        </div>
    );
};

export default Dashboard;
