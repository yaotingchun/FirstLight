import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Navigation, PowerOff, Activity, Radio } from 'lucide-react';
import {
    calculateVO,
    aStarPath,
    BASE_X,
    BASE_Y,
    COMM_RANGE_GRID,
    GRID_W,
    GRID_H,
    GRID_CENTER,
    OBSTACLES,
    OBSTACLE_SET,
    DRONE_COUNT,
    RELAY_COLOR,
    initializeSwarm,
    reallocateOnFailure,
    nextScanTarget,
    type SearchDrone,
    type RelayDrone,
    type GridPoint,
} from '../utils/swarmRouting';
import { gridDataService } from '../services/gridDataService';

const CELL_SIZE = 35;
const COMM_RANGE_PX = COMM_RANGE_GRID * CELL_SIZE;

type Drone = SearchDrone;

const RoutingSandbox: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [showVO, setShowVO] = useState(true);
    const [showPath, setShowPath] = useState(true);
    const [mcpLog, setMcpLog] = useState<string[]>(['> Sys ready. A* + VO routing active.']);
    const [showHeatmap, setShowHeatmap] = useState(true);
    const [heatmap, setHeatmap] = useState<number[][]>(() => gridDataService.getWeights());
    const [drones, setDrones] = useState<Drone[]>([]);
    const [relay, setRelay] = useState<RelayDrone>({
        id: 'R1', x: BASE_X, y: BASE_Y, vx: 0, vy: 0,
        active: true, color: RELAY_COLOR, path: [], pathIndex: 0, arrived: false,
    });
    const relayRef = useRef(relay);
    useEffect(() => { relayRef.current = relay; }, [relay]);

    const pushLog = (msg: string) => {
        setMcpLog(prev => [`> [${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 30));
    };

    useEffect(() => { resetSimulation(); }, []);

    // --- Subscribe to Live Grid Data ---
    useEffect(() => {
        const unsubscribe = gridDataService.subscribe((newWeights) => {
            setHeatmap(newWeights);
            // Optionally trigger re-allocation if probability changes significantly
            // For now, just update the visual heatmap
        });
        return unsubscribe;
    }, []);

    const resetSimulation = () => {
        const liveWeights = gridDataService.getWeights();
        setHeatmap(liveWeights);
        const { drones: newDrones, relay: newRelay } = initializeSwarm(liveWeights);
        const activeDroneCount = newDrones.filter(d => d.active).length;
        setDrones(newDrones);
        setRelay(newRelay);
        setIsRunning(false);
        setMcpLog([`> Sys reset. ${activeDroneCount} search drones + 1 relay online. TACTICAL grid data active.`]);
    };

    const killDrone = (id: string) => {
        setDrones(prev => {
            const result = reallocateOnFailure(prev, id, heatmap);
            const count = result.filter(d => d.active).length;
            if (count > 0) pushLog(`[REALLOC] ${id} offline → priority realloc across ${count} drones.`);
            return result;
        });
    };

    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => {
            // ── Move relay drone toward grid centre ──────────────────────────
            setRelay(prev => {
                if (!prev.active || prev.arrived) return prev;
                const speed = 0.18;
                // Lazy-build path on first tick
                if (prev.path.length === 0) {
                    const rPath = aStarPath(
                        { x: Math.round(prev.x), y: Math.round(prev.y) },
                        GRID_CENTER, OBSTACLE_SET, GRID_W, GRID_H
                    );
                    if (rPath.length > 0) {
                        pushLog(`[RELAY] R1 departing base → grid centre (${GRID_CENTER.x},${GRID_CENTER.y}).`);
                        return { ...prev, path: rPath, pathIndex: 0 };
                    }
                    return prev;
                }
                if (prev.pathIndex >= prev.path.length) {
                    pushLog('[RELAY] R1 arrived at grid centre — relay link established.');
                    return { ...prev, arrived: true, vx: 0, vy: 0 };
                }
                const wp = prev.path[prev.pathIndex];
                const dx = wp.x - prev.x, dy = wp.y - prev.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.3) return { ...prev, pathIndex: prev.pathIndex + 1 };
                const vx = (dx / dist) * speed, vy = (dy / dist) * speed;
                return { ...prev, vx, vy, x: prev.x + vx, y: prev.y + vy };
            });

            // ── Move search drones ───────────────────────────────────────────
            setDrones(prev => prev.map(d => {
                if (!d.active) return d;
                const speed = 0.2;

                // Staggered launch: wait until countdown reaches 0
                if (d.launchTick > 0) return { ...d, launchTick: d.launchTick - 1 };

                if (d.path.length === 0 || d.pathIndex >= d.path.length) {
                    const { target, newIndex } = nextScanTarget(d);
                    // Build relay network: base + relay drone + all OTHER active search drones
                    const relays: GridPoint[] = [
                        { x: BASE_X, y: BASE_Y },
                        { x: Math.round(relayRef.current.x), y: Math.round(relayRef.current.y) },
                    ];
                    prev.filter(r => r.active && r.id !== d.id).forEach(r => relays.push({ x: Math.round(r.x), y: Math.round(r.y) }));

                    const newPath = aStarPath({ x: Math.round(d.x), y: Math.round(d.y) }, target, OBSTACLE_SET, GRID_W, GRID_H, { xMin: d.regionXMin, xMax: d.regionXMax, yMin: d.regionYMin, yMax: d.regionYMax }, 6, relays);
                    if (newPath.length > 0) {
                        pushLog(`[A*] ${d.id} → (${target.x},${target.y}) via ${newPath.length} nodes.`);
                        return { ...d, tx: target.x, ty: target.y, path: newPath, pathIndex: 0, scanQueueIndex: newIndex };
                    }
                    return { ...d, scanQueueIndex: newIndex };
                }

                const wp = d.path[d.pathIndex];
                const dx = wp.x - d.x, dy = wp.y - d.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.3) return { ...d, pathIndex: d.pathIndex + 1 };

                const distFromBase = Math.sqrt((d.x - BASE_X) ** 2 + (d.y - BASE_Y) ** 2);
                const inLaunchCorridor = distFromBase < 4.0; // suppress VO near the base

                const vo = (showVO && !inLaunchCorridor)
                    ? calculateVO(d, prev, (dx / dist) * speed, (dy / dist) * speed, speed)
                    : { vx: (dx / dist) * speed, vy: (dy / dist) * speed, avoidanceTriggered: false, logMessage: null };

                if (vo.avoidanceTriggered && vo.logMessage) pushLog(vo.logMessage);
                return { ...d, vx: vo.vx, vy: vo.vy, x: d.x + vo.vx, y: d.y + vo.vy };
            }));
        }, 50);
        return () => clearInterval(interval);
    }, [isRunning, showVO]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#050a10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Heatmap overlay (mock survivor probability)
        if (showHeatmap) {
            for (let y = 0; y < GRID_H; y++) {
                for (let x = 0; x < GRID_W; x++) {
                    const prob = heatmap[y][x];
                    
                    if (prob >= 0.8) ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                    else if (prob >= 0.5) ctx.fillStyle = 'rgba(255, 165, 0, 0.7)';
                    else if (prob >= 0.3) ctx.fillStyle = 'rgba(255, 255, 0, 0.7)';
                    else ctx.fillStyle = 'rgba(0, 80, 120, 0.4)'; // Tactical Blue for low/no data
                    
                    ctx.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                }
            }
        }

        // Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= GRID_W; i++) {
            ctx.beginPath(); ctx.moveTo(i * CELL_SIZE, 0); ctx.lineTo(i * CELL_SIZE, GRID_H * CELL_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * CELL_SIZE); ctx.lineTo(GRID_W * CELL_SIZE, i * CELL_SIZE); ctx.stroke();
        }

        // Obstacles
        OBSTACLES.forEach(o => {
            ctx.fillStyle = 'rgba(255,51,51,0.18)';
            ctx.fillRect(o.x * CELL_SIZE + 1, o.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 1;
            ctx.strokeRect(o.x * CELL_SIZE + 2, o.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
            ctx.strokeStyle = 'rgba(255,80,80,0.55)';
            ctx.beginPath(); ctx.moveTo(o.x*CELL_SIZE+5, o.y*CELL_SIZE+5); ctx.lineTo((o.x+1)*CELL_SIZE-5, (o.y+1)*CELL_SIZE-5); ctx.stroke();
            ctx.beginPath(); ctx.moveTo((o.x+1)*CELL_SIZE-5, o.y*CELL_SIZE+5); ctx.lineTo(o.x*CELL_SIZE+5, (o.y+1)*CELL_SIZE-5); ctx.stroke();
        });

        const cx = BASE_X * CELL_SIZE + CELL_SIZE / 2;
        const cy = BASE_Y * CELL_SIZE + CELL_SIZE / 2;

        // Base station
        ctx.fillStyle = '#00ffcc';
        ctx.fillRect(cx - 6, cy - 6, 12, 12);
        ctx.fillStyle = '#020b0e'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
        ctx.fillText('B', cx, cy + 3);
        ctx.fillStyle = 'rgba(0,255,204,0.4)'; ctx.font = '8px monospace';
        ctx.fillText('BASE', cx, cy + 18); ctx.textAlign = 'left';

        // ── Relay drone ──────────────────────────────────────────────────────
        if (relay.active) {
            const rpx = relay.x * CELL_SIZE + CELL_SIZE / 2;
            const rpy = relay.y * CELL_SIZE + CELL_SIZE / 2;

            // Relay comm range ring
            ctx.beginPath(); ctx.arc(rpx, rpy, COMM_RANGE_PX, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,229,181,0.12)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
            ctx.stroke(); ctx.setLineDash([]);

            // A* path line
            if (showPath && relay.path.length > 0 && relay.pathIndex < relay.path.length) {
                ctx.beginPath();
                ctx.moveTo(rpx, rpy);
                for (let i = relay.pathIndex; i < relay.path.length; i++)
                    ctx.lineTo(relay.path[i].x * CELL_SIZE + CELL_SIZE / 2, relay.path[i].y * CELL_SIZE + CELL_SIZE / 2);
                ctx.strokeStyle = relay.color; ctx.globalAlpha = 0.35;
                ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5; ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1.0;
            }

            // Relay body — diamond shape
            ctx.beginPath(); ctx.arc(rpx, rpy, 14, 0, Math.PI * 2);
            ctx.strokeStyle = relay.color; ctx.globalAlpha = 0.2; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1.0;

            ctx.save(); ctx.translate(rpx, rpy);
            ctx.fillStyle = relay.color;
            ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
            ctx.restore();

            ctx.fillStyle = '#e0ffff'; ctx.font = 'bold 9px Share Tech Mono, monospace';
            ctx.fillText('R1', rpx + 10, rpy - 8);
            if (relay.arrived) {
                ctx.fillStyle = 'rgba(0,229,181,0.5)'; ctx.font = '7px monospace';
                ctx.fillText('RELAY', rpx + 10, rpy + 3);
            }
        }

        drones.forEach(d => {
            if (!d.active) return;

            // Region rectangle
            const rx = d.regionXMin * CELL_SIZE;
            const ry = d.regionYMin * CELL_SIZE;
            const rw = (d.regionXMax - d.regionXMin) * CELL_SIZE;
            const rh = (d.regionYMax - d.regionYMin) * CELL_SIZE;
            ctx.fillStyle = d.color; ctx.globalAlpha = 0.06;
            ctx.fillRect(rx, ry, rw, rh);
            ctx.globalAlpha = 0.25; ctx.strokeStyle = d.color; ctx.lineWidth = 1;
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.globalAlpha = 1.0;

            // A* path
            if (showPath && d.path.length > 0 && d.pathIndex < d.path.length) {
                ctx.beginPath();
                ctx.moveTo(d.x * CELL_SIZE + CELL_SIZE/2, d.y * CELL_SIZE + CELL_SIZE/2);
                for (let i = d.pathIndex; i < d.path.length; i++)
                    ctx.lineTo(d.path[i].x * CELL_SIZE + CELL_SIZE/2, d.path[i].y * CELL_SIZE + CELL_SIZE/2);
                ctx.strokeStyle = d.color; ctx.globalAlpha = 0.4;
                ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5; ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1.0;

                // Target diamond
                const g = d.path[d.path.length - 1];
                const gx = g.x * CELL_SIZE + CELL_SIZE/2, gy = g.y * CELL_SIZE + CELL_SIZE/2;
                ctx.beginPath();
                ctx.moveTo(gx, gy-6); ctx.lineTo(gx+6, gy); ctx.lineTo(gx, gy+6); ctx.lineTo(gx-6, gy);
                ctx.closePath(); ctx.fillStyle = d.color; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1.0;
            }

            // Drone glow + body
            const dx2 = d.x * CELL_SIZE + CELL_SIZE/2, dy2 = d.y * CELL_SIZE + CELL_SIZE/2;
            ctx.beginPath(); ctx.arc(dx2, dy2, 13, 0, Math.PI * 2);
            ctx.strokeStyle = d.color; ctx.globalAlpha = 0.18; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1.0;

            ctx.save(); ctx.translate(dx2, dy2);
            ctx.fillStyle = d.color;
            ctx.beginPath(); ctx.moveTo(0,-7); ctx.lineTo(6,5); ctx.lineTo(-6,5); ctx.closePath(); ctx.fill();
            ctx.restore();

            ctx.fillStyle = '#e0ffff'; ctx.font = 'bold 9px Share Tech Mono, monospace';
            ctx.fillText(d.id, dx2 + 9, dy2 - 8);
        });
    }, [drones, relay, showPath, showVO, showHeatmap, heatmap]);

    const activeDrones = drones.filter(d => d.active).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--panel-border)', background: 'var(--panel-bg)', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Navigation size={20} color="var(--accent-primary)" />
                    <div>
                        <div className="hud-text glow-text" style={{ color: 'var(--accent-primary)', fontSize: '1rem' }}>MULTI-DRONE ROUTING SANDBOX</div>
                        <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>&gt; A* PATH PLANNING + VELOCITY OBSTACLE COLLISION AVOIDANCE</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-cyber" onClick={() => setIsRunning(r => !r)} style={{ padding: '6px 16px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isRunning ? <Pause size={14} /> : <Play size={14} />}
                        {isRunning ? 'PAUSE' : 'START SIM'}
                    </button>
                    <button className="btn-cyber" onClick={() => resetSimulation()} style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RotateCcw size={14} /> RESET
                    </button>
                </div>
            </div>

            {/* Main area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Canvas */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#020b0e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <canvas ref={canvasRef} width={GRID_W * CELL_SIZE} height={GRID_H * CELL_SIZE} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    {/* Floating legend */}
                    <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(0,0,0,0.8)', border: '1px solid var(--panel-border)', padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', backdropFilter: 'blur(4px)' }}>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>MAP LEGEND</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-primary)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><div style={{ width: 10, height: 10, border: '1px solid #00ffcc' }}></div> Region boundary</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: RELAY_COLOR }}><div style={{ width: 8, height: 8, background: RELAY_COLOR, transform: 'rotate(45deg)' }}></div> Relay drone (R1)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ff3333' }}><div style={{ width: 10, height: 10, background: 'rgba(255,51,51,0.4)', border: '1px solid #ff3333' }}></div> Obstacle / debris</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>◆ A* target &nbsp; ╌ Planned path</div>
                        </div>
                    </div>
                </div>

                {/* Right sidebar */}
                <div style={{ width: '300px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--panel-border)', overflow: 'hidden', gap: '8px', padding: '8px' }}>

                    {/* Swarm Status */}
                    <div className="hud-panel" style={{ padding: '10px' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Activity size={13} /> SWARM STATUS
                        </h4>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                            <div style={{ flex: 1, background: 'var(--panel-bg)', padding: '6px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>SEARCH</div>
                                <div style={{ fontSize: '1.1rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{activeDrones}/{DRONE_COUNT}</div>
                            </div>
                            <div style={{ flex: 1, background: 'var(--panel-bg)', padding: '6px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>RELAY</div>
                                <div style={{ fontSize: '1.1rem', color: RELAY_COLOR, fontFamily: 'var(--font-mono)' }}>{relay.active ? '1' : '0'}</div>
                            </div>
                            <div style={{ flex: 1, background: 'var(--panel-bg)', padding: '6px', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>REGIONS</div>
                                <div style={{ fontSize: '1.1rem', color: '#ffb800', fontFamily: 'var(--font-mono)' }}>{activeDrones > 0 ? `${activeDrones} RGN` : '--'}</div>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: DRONE_COUNT > 4 ? '1fr 1fr' : '1fr', gap: '4px' }}>
                            {/* Relay drone row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${RELAY_COLOR}33` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                                    <div style={{ width: 6, height: 6, transform: 'rotate(45deg)', background: relay.active ? RELAY_COLOR : '#444', flexShrink: 0 }} />
                                    R1 <span style={{ fontSize: '0.58rem', color: 'var(--text-secondary)' }}>RELAY</span>
                                </div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: relay.active ? RELAY_COLOR : 'var(--text-secondary)' }}>
                                    {relay.arrived ? '◆' : relay.active ? '→' : '✕'}
                                </div>
                            </div>
                            {/* Search drones */}
                            {drones.map(d => (
                                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.active ? d.color : '#444', flexShrink: 0 }} />
                                        {d.id}
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: d.active ? d.color : 'var(--text-secondary)' }}>
                                        {d.active ? '●' : '✕'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Algorithm Toggles */}
                    <div className="hud-panel" style={{ padding: '10px' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Radio size={13} /> ALGORITHMS
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontSize: '0.75rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={showPath} onChange={e => setShowPath(e.target.checked)} /> Show A* Paths
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontSize: '0.75rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={showVO} onChange={e => setShowVO(e.target.checked)} /> Enable VO Avoidance
                            </label>
                            <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '7px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', color: '#ffb800', fontSize: '0.75rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} /> Show Heatmap
                                </label>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                    ⚡ Priority regions active — swap heatmap with teammate data at merge
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Simulate Failure */}
                    <div className="hud-panel" style={{ padding: '10px' }}>
                        <h4 className="hud-text" style={{ fontSize: '0.75rem', color: 'var(--warning)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <PowerOff size={13} /> SIMULATE FAILURE
                        </h4>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: DRONE_COUNT > 4 ? '1fr 1fr' : '1fr',
                            gap: '4px'
                        }}>
                            {drones.map(d => (
                                <button key={d.id} className="hud-button"
                                    style={{ borderColor: d.color, color: d.color, backgroundColor: d.active ? 'rgba(0,0,0,0.5)' : 'transparent', opacity: d.active ? 1 : 0.3, textDecoration: d.active ? 'none' : 'line-through', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', justifyContent: 'center' }}
                                    onClick={() => d.active ? killDrone(d.id) : undefined} disabled={!d.active}>
                                    <PowerOff size={10} /> {d.id} {d.active ? '●' : '✕'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* MCP Log */}
                    <div className="hud-panel" style={{ padding: '10px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '1px' }}>MCP Algorithm Log</div>
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {mcpLog.map((entry, i) => (
                                <div key={i} className="hud-text" style={{
                                    fontSize: '0.63rem',
                                    opacity: i === 0 ? 1 : Math.max(0.3, 1 - i * 0.06),
                                    color: entry.includes('[REALLOC]') ? 'var(--danger)' : entry.includes('[VO]') ? 'var(--warning)' : entry.includes('[A*]') ? 'var(--accent-primary)' : 'var(--text-secondary)'
                                }}>{entry}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RoutingSandbox;
