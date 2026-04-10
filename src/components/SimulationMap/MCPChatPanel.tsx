import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Terminal, X, FileText } from 'lucide-react';
import { getOrchestratorRecords, type OrchestratorRecord } from '../../services/mcpClient';
import { RobotIcon, DroneIcon } from './LogIcons';

interface MCPChatPanelProps {
    mcpConnected: boolean;
    mcpPanelOpen: boolean;
    setMcpPanelOpen: (open: boolean) => void;
    mcpSelectedTool: string;
    setMcpSelectedTool: (tool: string) => void;
    mcpToolParams: string;
    setMcpToolParams: (params: string) => void;
    executeMcpTool: () => void;
    mcpToolOutput: string;

    chatOpen: boolean;
    setChatOpen: (open: boolean) => void;
    chatPos: { x: number, y: number };
    setChatPos: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
    chatSize: { width: number, height: number };
    setChatSize: React.Dispatch<React.SetStateAction<{ width: number, height: number }>>;
    chatDragRef: React.MutableRefObject<{ isDragging: boolean, startX: number, startY: number, startPosX: number, startPosY: number }>;
    chatResizeRef: React.MutableRefObject<{ isResizing: boolean, startWidth: number, startHeight: number, startX: number, startY: number, startPosX: number, startPosY: number }>;
    chatScrollRef: React.MutableRefObject<HTMLDivElement | null>;
    running: boolean;
    onStartSimulation: () => void;
}

export const MCPChatPanel: React.FC<MCPChatPanelProps> = ({
    mcpConnected, mcpPanelOpen, setMcpPanelOpen,
    mcpSelectedTool, setMcpSelectedTool, mcpToolParams, setMcpToolParams,
    executeMcpTool, mcpToolOutput,
    chatOpen, setChatOpen, chatPos, setChatPos, chatSize, setChatSize,
    chatDragRef, chatResizeRef, chatScrollRef,
    running, onStartSimulation
}) => {
    const [activityRecords, setActivityRecords] = useState<OrchestratorRecord[]>([]);
    const [startPressedOnce, setStartPressedOnce] = useState(false);
    const shouldAutoScrollRef = useRef(true);

    const updateAutoScrollState = useCallback(() => {
        const el = chatScrollRef.current;
        if (!el) return;

        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        // Keep auto-scroll only when the user is already near the bottom.
        shouldAutoScrollRef.current = distanceFromBottom <= 24;
    }, [chatScrollRef]);

    const loadActivityRecords = useCallback(async () => {
        const result = await getOrchestratorRecords(30);
        if (result.success && result.records) {
            setActivityRecords(result.records);
        }
    }, []);

    useEffect(() => {
        if (!chatOpen || !mcpConnected) return;

        void loadActivityRecords();
        const pollId = window.setInterval(() => {
            void loadActivityRecords();
        }, 1500);

        return () => {
            window.clearInterval(pollId);
        };
    }, [chatOpen, mcpConnected, loadActivityRecords]);

    useEffect(() => {
        if (!chatOpen) return;
        const el = chatScrollRef.current;
        if (!el) return;
        if (!shouldAutoScrollRef.current) return;

        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    }, [activityRecords, chatOpen, chatScrollRef]);

    useEffect(() => {
        if (!chatOpen) return;
        updateAutoScrollState();
    }, [chatOpen, updateAutoScrollState]);

    return (
        <>
            {/* MCP Tools Panel */}
            {mcpPanelOpen && (
                <div style={{
                    position: 'fixed',
                    top: 80,
                    right: 20,
                    width: 450,
                    maxHeight: 'calc(125vh - 120px)',
                    background: 'rgba(5, 10, 16, 0.98)',
                    border: '1px solid #00ffcc',
                    borderRadius: 8,
                    padding: 16,
                    zIndex: 1000,
                    overflow: 'auto',
                    boxShadow: '0 0 30px rgba(0, 255, 204, 0.3)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h3 style={{ margin: 0, color: '#00ffcc', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Terminal size={18} /> MCP Tools
                        </h3>
                        <button
                            onClick={() => setMcpPanelOpen(false)}
                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Tool</label>
                        <select
                            value={mcpSelectedTool}
                            onChange={(e) => {
                                setMcpSelectedTool(e.target.value);
                                // Set default params based on tool
                                const paramTemplates: Record<string, string> = {
                                    'getDroneStatus': '{"droneId": "DRN-Alpha"}',
                                    'getAllDroneStatuses': '{}',
                                    'setDroneTarget': '{"droneId": "DRN-Alpha", "targetX": 5, "targetY": 5}',
                                    'setDroneMode': '{"droneId": "DRN-Alpha", "mode": "Micro"}',
                                    'recallDroneToBase': '{"droneId": "DRN-Alpha"}',
                                    'killDrone': '{"droneId": "DRN-Alpha"}',
                                    'getBatteryForecast': '{"droneId": "DRN-Alpha", "targetX": 15, "targetY": 3}',
                                    'getDroneDiscoveryList': '{}',
                                    'setAutoRecallThreshold': '{"droneId": "DRN-Alpha", "batteryThreshold": 25}',
                                    'getSectorScanResult': '{"sector": "E10"}',
                                    'getGridHeatmap': '{}',
                                    'getScannedSectors': '{}',
                                    'getSurroundingSectors': '{"centerSector": "J10", "radius": 2}',
                                    'getCommNetworkStatus': '{}',
                                    'getDisconnectedDrones': '{}',
                                    'checkDroneConnectivity': '{"droneId": "DRN-Alpha"}',
                                    'getSwarmStatus': '{}',
                                    'getMissionStats': '{}',
                                    'getFoundSurvivors': '{}',
                                    'setSurvivorPin': '{"x": 5, "y": 5, "droneId": "DRN-Alpha", "message": "Survivor found"}',
                                    'resetMission': '{}',
                                    'setSimulationRunning': '{"running": true}',
                                    'getMissionBriefing': '{}',
                                    'getSectorAssignments': '{}',
                                    'getExplorationGradient': '{}',
                                    'getUnassignedHotspots': '{"probabilityThreshold": 0.3, "maxResults": 10}',
                                    'getDroneAssignmentMap': '{}',
                                    'validateAssignmentPlan': '{"assignments":[{"droneId":"DRN-Alpha","targetX":11,"targetY":8,"mode":"Wide"}]}',
                                    'assignHotspotBatch': '{"assignments":[{"droneId":"DRN-Alpha","targetX":11,"targetY":8,"mode":"Wide"}]}',
                                    'getRecommendedActions': '{"maxActions": 8}',
                                    'getBatteryRiskMap': '{"safetyBuffer": 15}'
                                };
                                setMcpToolParams(paramTemplates[e.target.value] || '{}');
                            }}
                            style={{
                                width: '100%',
                                padding: 8,
                                background: '#0a1520',
                                border: '1px solid #333',
                                borderRadius: 4,
                                color: '#fff',
                                fontSize: 13
                            }}
                        >
                            <optgroup label="Drone Tools">
                                <option value="getDroneStatus">getDroneStatus</option>
                                <option value="getAllDroneStatuses">getAllDroneStatuses</option>
                                <option value="setDroneTarget">setDroneTarget</option>
                                <option value="setDroneMode">setDroneMode</option>
                                <option value="recallDroneToBase">recallDroneToBase</option>
                                <option value="killDrone">killDrone</option>
                                <option value="getBatteryForecast">getBatteryForecast ✦</option>
                                <option value="getDroneDiscoveryList">getDroneDiscoveryList ✦</option>
                                <option value="setAutoRecallThreshold">setAutoRecallThreshold ✦</option>
                            </optgroup>
                            <optgroup label="Scan Tools">
                                <option value="getSectorScanResult">getSectorScanResult</option>
                                <option value="getGridHeatmap">getGridHeatmap</option>
                                <option value="getScannedSectors">getScannedSectors</option>
                                <option value="getSurroundingSectors">getSurroundingSectors</option>
                            </optgroup>
                            <optgroup label="Communication Tools">
                                <option value="getCommNetworkStatus">getCommNetworkStatus</option>
                                <option value="getDisconnectedDrones">getDisconnectedDrones</option>
                                <option value="checkDroneConnectivity">checkDroneConnectivity</option>
                            </optgroup>
                            <optgroup label="Mission Tools">
                                <option value="getSwarmStatus">getSwarmStatus</option>
                                <option value="getMissionStats">getMissionStats</option>
                                <option value="getFoundSurvivors">getFoundSurvivors</option>
                                <option value="setSurvivorPin">setSurvivorPin</option>
                                <option value="resetMission">resetMission</option>
                                <option value="setSimulationRunning">setSimulationRunning</option>
                                <option value="getMissionBriefing">getMissionBriefing</option>
                                <option value="getSectorAssignments">getSectorAssignments ✦</option>
                            </optgroup>
                            <optgroup label="Swarm Intelligence">
                                <option value="getExplorationGradient">getExplorationGradient</option>
                                <option value="getUnassignedHotspots">getUnassignedHotspots</option>
                                <option value="getDroneAssignmentMap">getDroneAssignmentMap</option>
                            </optgroup>
                            <optgroup label="Orchestration">
                                <option value="validateAssignmentPlan">validateAssignmentPlan ✦</option>
                                <option value="assignHotspotBatch">assignHotspotBatch ✦</option>
                                <option value="getRecommendedActions">getRecommendedActions ✦</option>
                                <option value="getBatteryRiskMap">getBatteryRiskMap ✦</option>
                            </optgroup>
                        </select>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Parameters (JSON)</label>
                        <textarea
                            value={mcpToolParams}
                            onChange={(e) => setMcpToolParams(e.target.value)}
                            style={{
                                width: '100%',
                                height: 60,
                                padding: 8,
                                background: '#0a1520',
                                border: '1px solid #333',
                                borderRadius: 4,
                                color: '#fff',
                                fontFamily: 'monospace',
                                fontSize: 12,
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    <button
                        onClick={executeMcpTool}
                        disabled={!mcpConnected}
                        style={{
                            width: '100%',
                            padding: 10,
                            background: mcpConnected ? '#00ffcc' : '#333',
                            border: 'none',
                            borderRadius: 4,
                            color: mcpConnected ? '#000' : '#666',
                            fontWeight: 'bold',
                            cursor: mcpConnected ? 'pointer' : 'not-allowed',
                            marginBottom: 12
                        }}
                    >
                        Execute Tool
                    </button>

                    <div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Output</label>
                        <pre style={{
                            background: '#0a1520',
                            border: '1px solid #333',
                            borderRadius: 4,
                            padding: 8,
                            maxHeight: 300,
                            overflow: 'auto',
                            fontSize: 11,
                            color: '#0f0',
                            margin: 0
                        }}>
                            {mcpToolOutput || 'No output yet. Execute a tool to see results.'}
                        </pre>
                    </div>
                </div>
            )}

            {/* Mission Log Panel */}
            {chatOpen && (
                <div style={{
                    position: 'fixed',
                    bottom: 20,
                    right: 20,
                    transform: `translate(${chatPos.x}px, ${chatPos.y}px)`,
                    width: chatSize.width,
                    height: chatSize.height,
                    background: 'rgba(5, 10, 16, 0.98)',
                    border: '1px solid #00ffcc',
                    borderRadius: 8,
                    padding: 12,
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 0 30px rgba(0, 255, 204, 0.2)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h3 
                            style={{ margin: 0, color: '#00ffcc', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'grab', userSelect: 'none' }}
                            onPointerDown={(e) => {
                                chatDragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, startPosX: chatPos.x, startPosY: chatPos.y };
                                e.currentTarget.setPointerCapture(e.pointerId);
                            }}
                            onPointerMove={(e) => {
                                if (!chatDragRef.current.isDragging) return;
                                const dx = e.clientX - chatDragRef.current.startX;
                                const dy = e.clientY - chatDragRef.current.startY;
                                setChatPos({ x: chatDragRef.current.startPosX + dx, y: chatDragRef.current.startPosY + dy });
                            }}
                            onPointerUp={(e) => {
                                chatDragRef.current.isDragging = false;
                                e.currentTarget.releasePointerCapture(e.pointerId);
                            }}
                        >
                            <FileText size={16} /> Mission Log
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                onClick={() => {
                                    setStartPressedOnce(true);
                                    if (!running) onStartSimulation();
                                }}
                                disabled={startPressedOnce || running}
                                style={{
                                    background: '#00ffcc',
                                    border: 'none',
                                    color: '#001018',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: startPressedOnce || running ? 'not-allowed' : 'pointer',
                                    opacity: startPressedOnce || running ? 0.5 : 1
                                }}
                            >
                                START SIMULATION
                            </button>
                            <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        border: '1px solid #243444',
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                    }} ref={chatScrollRef} onScroll={updateAutoScrollState}>
                        <div style={{
                            border: '1px solid #243444',
                            borderRadius: 6,
                            padding: 8,
                            background: 'rgba(255,255,255,0.03)'
                        }}>
                            <div style={{
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                color: '#00ffcc',
                                textTransform: 'uppercase',
                                marginBottom: 8
                            }}>
                                Activity Feed
                            </div>
                            {activityRecords.length === 0 ? (
                                <div style={{ fontSize: 12, color: '#8aa0b3' }}>
                                    Awaiting orchestrator activity...
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {activityRecords.map((record, index) => {
                                        const stamp = new Date(record.timestamp).toLocaleTimeString('en-US', {
                                            hour12: false,
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit',
                                        });

                                        const isOverride = record.source === 'system' && record.droneId === 'ORCHESTRATOR';

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

                                        if (isOverride) {
                                            return (
                                                <div
                                                    key={`${record.timestamp}-${index}`}
                                                    style={{
                                                        border: '1px solid rgba(255,255,255,0.08)',
                                                        borderRadius: 6,
                                                        padding: '6px 8px',
                                                        background: 'rgba(0,0,0,0.2)',
                                                        fontSize: 12,
                                                        lineHeight: 1.45,
                                                        position: 'relative',
                                                        borderLeft: '1px solid rgba(255,255,255,0.08)'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, fontWeight: 600 }}>
                                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                            <div style={{ 
                                                                width: 18, 
                                                                height: 18, 
                                                                borderRadius: '4px', 
                                                                background: 'rgba(255,255,255,0.05)', 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                justifyContent: 'center', 
                                                                flexShrink: 0,
                                                                border: '1px solid rgba(255,255,255,0.08)'
                                                            }}>
                                                                <RobotIcon color="#9db1c1" size={11} />
                                                            </div>
                                                            <span style={{ color: '#8aa0b3' }}>[{stamp}]</span>
                                                            <span style={{ color: '#9db1c1' }}>SYSTEM</span>
                                                        </div>
                                                    </div>
                                                    <ReactMarkdown
                                                        components={{
                                                            p: ({ node, ...props }) => <p style={{ margin: 0, color: '#9db1c1' }} {...props} />,
                                                            ul: ({ node, ...props }) => <ul style={{ margin: '4px 0 0 18px', padding: 0 }} {...props} />,
                                                            ol: ({ node, ...props }) => <ol style={{ margin: '4px 0 0 18px', padding: 0 }} {...props} />,
                                                            li: ({ node, ...props }) => <li style={{ marginBottom: '2px' }} {...props} />,
                                                            strong: ({ node, ...props }) => <strong style={{ color: '#fff' }} {...props} />
                                                        }}
                                                    >
                                                        {record.message}
                                                    </ReactMarkdown>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div
                                                key={`${record.timestamp}-${index}`}
                                                style={{
                                                    border: `1px solid ${droneId ? themeColor + '44' : 'rgba(255,255,255,0.08)'}`,
                                                    borderRadius: 6,
                                                    padding: '6px 8px',
                                                    background: droneId ? `${themeColor}11` : 'rgba(0,0,0,0.2)',
                                                    fontSize: 12,
                                                    lineHeight: 1.45,
                                                    position: 'relative',
                                                    borderLeft: droneId ? `3px solid ${themeColor}` : '1px solid rgba(255,255,255,0.08)'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, fontWeight: 600 }}>
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
                                                    {record.source === 'ai' && <span style={{ color: '#4da3ff', opacity: 0.8 }}>STRATEGIC_INTEL</span>}
                                                    {record.source === 'action' && <span style={{ color: '#00ffcc', opacity: 0.8 }}>EXECUTED</span>}
                                                </div>
                                                <ReactMarkdown
                                                    components={{
                                                        p: ({ node, ...props }) => <p style={{ margin: 0, color: droneId ? '#eee' : '#9db1c1' }} {...props} />,
                                                        ul: ({ node, ...props }) => <ul style={{ margin: '4px 0 0 18px', padding: 0 }} {...props} />,
                                                        ol: ({ node, ...props }) => <ol style={{ margin: '4px 0 0 18px', padding: 0 }} {...props} />,
                                                        li: ({ node, ...props }) => <li style={{ marginBottom: '2px' }} {...props} />,
                                                        strong: ({ node, ...props }) => <strong style={{ color: '#fff' }} {...props} />
                                                    }}
                                                >
                                                    {record.message}
                                                </ReactMarkdown>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                    </div>

                    {/* Resize Handle */}
                    <div 
                        style={{
                            position: 'absolute',
                            right: 0,
                            bottom: 0,
                            width: 16,
                            height: 16,
                            cursor: 'nwse-resize',
                            zIndex: 10,
                            borderBottomRightRadius: 8
                        }}
                        onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            chatResizeRef.current = {
                                isResizing: true,
                                startX: e.clientX,
                                startY: e.clientY,
                                startWidth: chatSize.width,
                                startHeight: chatSize.height,
                                startPosX: chatPos.x,
                                startPosY: chatPos.y
                            };
                            e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            if (!chatResizeRef.current.isResizing) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const dx = e.clientX - chatResizeRef.current.startX;
                            const dy = e.clientY - chatResizeRef.current.startY;
                            
                            const newWidth = Math.max(300, chatResizeRef.current.startWidth + dx);
                            const newHeight = Math.max(200, chatResizeRef.current.startHeight + dy);
                            
                            const actualDx = newWidth - chatResizeRef.current.startWidth;
                            const actualDy = newHeight - chatResizeRef.current.startHeight;

                            setChatSize({ width: newWidth, height: newHeight });
                            setChatPos({ 
                                x: chatResizeRef.current.startPosX + actualDx, 
                                y: chatResizeRef.current.startPosY + actualDy 
                            });
                        }}
                        onPointerUp={(e) => {
                            chatResizeRef.current.isResizing = false;
                            e.currentTarget.releasePointerCapture(e.pointerId);
                        }}
                    >
                        {/* Little triangle for handle */}
                        <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 3, right: 3 }}>
                            <path d="M 10 0 L 10 10 L 0 10 Z" fill="rgba(0, 255, 204, 0.4)" />
                        </svg>
                    </div>
                </div>
            )}
        </>
    );
};
