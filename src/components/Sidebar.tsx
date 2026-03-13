import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Map as MapIcon, Settings, Target, Layers, Cpu, Navigation, Camera, Wifi } from 'lucide-react';

const Sidebar: React.FC = () => {
    return (
        <aside className="hud-panel" style={{
            width: '260px',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--panel-border)',
            borderTop: 'none', borderBottom: 'none', borderLeft: 'none',
            padding: '24px 0'
        }}>
            <div style={{ padding: '0 24px', marginBottom: '48px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Target size={28} color="var(--accent-primary)" />
                <div>
                    <h1 className="hud-text glow-text" style={{ fontSize: '1.2rem', color: 'var(--accent-primary)', margin: 0 }}>SWARM AI</h1>
                    <p className="hud-text" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>COMMAND_SYS.v9</p>
                </div>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 12px' }}>
                <NavLink to="/dashboard" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Activity size={20} />
                    Dashboard
                </NavLink>

                <NavLink to="/map" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <MapIcon size={20} />
                    Tactical Map
                </NavLink>

                <NavLink to="/3d-map" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Layers size={20} />
                    3D Prob Map
                </NavLink>

                <NavLink to="/routing" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Navigation size={20} />
                    Pathing & Routing
                </NavLink>
                
                <NavLink to="/simulation" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Cpu size={20} />
                    Swarm AI Sim
                </NavLink>

                <NavLink to="/simulation-mcp" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Wifi size={20} />
                    Swarm + MCP
                </NavLink>

                <NavLink to="/simulation-duplicate" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Cpu size={20} />
                    Swarm AI Sim 2
                </NavLink>
                
                <NavLink to="/drone-cam" style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    color: isActive ? 'var(--bg-color)' : 'var(--text-primary)',
                    backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                    border: isActive ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 0 10px rgba(0, 255, 204, 0.3)' : 'none'
                })}>
                    <Camera size={20} />
                    Drone Cam
                </NavLink>
            </nav>

            <div style={{ marginTop: 'auto', padding: '24px' }}>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    SYS_STAT: <span className="glow-text animate-pulse" style={{ color: 'var(--accent-primary)' }}>ONLINE</span><br />
                    UPLINK: SECURE
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
