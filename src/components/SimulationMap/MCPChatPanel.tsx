import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Terminal, X, MessageSquare, Send } from 'lucide-react';
import type { AgentChatMessage, MultiAgentState } from '../../types/simulation';

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
    multiAgentState: MultiAgentState | null;
    chatMessages: AgentChatMessage[];
    chatInput: string;
    setChatInput: (input: string) => void;
    chatSending: boolean;
    sendChatMessage: () => void;
    runThinkNow: () => void;
}

export const MCPChatPanel: React.FC<MCPChatPanelProps> = ({
    mcpConnected, mcpPanelOpen, setMcpPanelOpen,
    mcpSelectedTool, setMcpSelectedTool, mcpToolParams, setMcpToolParams,
    executeMcpTool, mcpToolOutput,
    chatOpen, setChatOpen, chatPos, setChatPos, chatSize, setChatSize,
    chatDragRef, chatResizeRef, chatScrollRef,
    multiAgentState, chatMessages, chatInput, setChatInput, chatSending, sendChatMessage, runThinkNow
}) => {

    const getRoleColor = (role: string) => {
        if (role === 'ORCHESTRATOR') return '#00ffcc';
        if (role.includes('Alpha')) return '#4CAF50';
        if (role.includes('Beta')) return '#9C27B0';
        if (role.includes('Gamma')) return '#FF9800';
        if (role.includes('Delta')) return '#2196F3';
        if (role === 'RLY-Prime') return '#FFFFFF';
        if (role === 'RLY-Backup') return '#B0BEC5';
        if (role === 'USER') return '#00ffcc'; // For borders/text
        if (role === 'system') return '#888888';
        return '#888888';
    };

    return (
        <>
            {/* MCP Tools Panel */}
            {mcpPanelOpen && (
                <div style={{
                    position: 'fixed',
                    top: 80,
                    right: 20,
                    width: 450,
                    maxHeight: 'calc(100vh - 120px)',
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

            {/* AI Orchestrator Chat Panel */}
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
                            <MessageSquare size={16} /> {multiAgentState?.orchestratorDroneId ? `Orchestrator: ${multiAgentState.orchestratorDroneId}` : 'Orchestrator Chat'}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                onClick={runThinkNow}
                                disabled={!mcpConnected || chatSending}
                                style={{
                                    background: '#00ffcc',
                                    border: 'none',
                                    color: '#001018',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: !mcpConnected || chatSending ? 'not-allowed' : 'pointer',
                                    opacity: !mcpConnected || chatSending ? 0.5 : 1
                                }}
                            >
                                THINK NOW
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
                    }} ref={chatScrollRef}>
                        {chatMessages.map((m, i) => {
                            const isUser = m.role === 'USER' || m.role === 'user';
                            const isSystem = m.role === 'system';
                            const roleColor = getRoleColor(m.role);

                            return (
                                <div key={m.id || i} style={{
                                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                                    maxWidth: '95%',
                                    background: isUser ? 'rgba(0,255,204,0.1)' : isSystem ? 'rgba(255,255,255,0.05)' : 'rgba(5, 15, 25, 0.6)',
                                    border: `1px solid ${isUser ? 'rgba(0,255,204,0.3)' : isSystem ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
                                    borderLeft: !isUser && !isSystem ? `3px solid ${roleColor}` : undefined,
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    fontSize: 13,
                                    lineHeight: '1.4',
                                    overflowWrap: 'break-word',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4
                                }}>
                                    {!isUser && !isSystem && (
                                        <div style={{ fontSize: 10, fontWeight: 700, color: roleColor, letterSpacing: '0.5px' }}>
                                            {m.role}
                                        </div>
                                    )}
                                    <ReactMarkdown
                                        components={{
                                            p: ({ node, ...props }) => <p style={{ margin: '0 0 4px 0', color: isSystem ? '#aaa' : '#e0e0e0' }} {...props} />,
                                            ul: ({ node, ...props }) => <ul style={{ margin: '0 0 6px 0', paddingLeft: '20px', listStyleType: 'disc', color: '#ccc' }} {...props} />,
                                            ol: ({ node, ...props }) => <ol style={{ margin: '0 0 6px 0', paddingLeft: '20px', listStyleType: 'decimal', color: '#ccc' }} {...props} />,
                                            li: ({ node, ...props }) => <li style={{ marginBottom: '2px' }} {...props} />,
                                            strong: ({ node, ...props }) => <strong style={{ color: roleColor }} {...props} />
                                        }}
                                    >
                                        {m.text}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    sendChatMessage();
                                }
                            }}
                            placeholder={mcpConnected ? 'Asking AI Orchestrator...' : 'Connect MCP server first'}
                            disabled={!mcpConnected || chatSending}
                            style={{
                                flex: 1,
                                background: '#0a1520',
                                border: '1px solid #334455',
                                color: '#fff',
                                borderRadius: 6,
                                padding: '8px 10px',
                                fontSize: 12
                            }}
                        />
                        <button
                            onClick={sendChatMessage}
                            disabled={!mcpConnected || chatSending || !chatInput.trim()}
                            style={{
                                border: 'none',
                                borderRadius: 6,
                                padding: '8px 10px',
                                background: '#00ffcc',
                                color: '#001018',
                                cursor: !mcpConnected || chatSending || !chatInput.trim() ? 'not-allowed' : 'pointer',
                                opacity: !mcpConnected || chatSending || !chatInput.trim() ? 0.5 : 1
                            }}
                        >
                            <Send size={14} />
                        </button>
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
