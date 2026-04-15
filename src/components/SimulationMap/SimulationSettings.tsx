import React from 'react';
import { Settings, X, Navigation, LocateFixed, MapIcon, ChevronDown, Clock, Battery, Crosshair, Scan } from 'lucide-react';

const CITIES = [
    { name: 'Kuala Lumpur', lat: 3.1319, lng: 101.6841 },
    { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
    { name: 'Jakarta', lat: -6.2088, lng: 106.8456 },
    { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
    { name: 'Manila', lat: 14.5995, lng: 120.9842 },
];

import type { Drone } from '../../types/simulation';

interface SimulationSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    running: boolean;

    // Directive Overrides
    microScanOnly: boolean;
    onToggleMicroScanOnly: () => void;
    isDrawingMode: boolean;
    onToggleDrawingMode: () => void;
    searchAreaDrawn: boolean;
    onClearSearchArea: () => void;

    // Location
    centerLocation: { lat: number; lng: number };
    setCenterLocation: (fn: (prev: { lat: number; lng: number }) => { lat: number; lng: number }) => void;

    // Time Budget
    useTimeLimit: boolean;
    setUseTimeLimit: (val: boolean) => void;
    timeLimit: number;
    setTimeLimit: (val: number) => void;

    // Battery
    randomizeBattery: boolean;
    setRandomizeBattery: (val: boolean) => void;
    drones: Drone[];
    updateDroneBattery: (id: string, val: number) => void;
}

export const SimulationSettings: React.FC<SimulationSettingsProps> = ({
    isOpen, onClose, running,
    microScanOnly, onToggleMicroScanOnly,
    isDrawingMode, onToggleDrawingMode,
    searchAreaDrawn, onClearSearchArea,
    centerLocation, setCenterLocation,
    useTimeLimit, setUseTimeLimit,
    timeLimit, setTimeLimit,
    randomizeBattery, setRandomizeBattery,
    drones, updateDroneBattery,
}) => {
    const [latInput, setLatInput] = React.useState(centerLocation.lat.toFixed(4));
    const [lngInput, setLngInput] = React.useState(centerLocation.lng.toFixed(4));
    const [showCityDropdown, setShowCityDropdown] = React.useState(false);

    React.useEffect(() => {
        setLatInput(centerLocation.lat.toFixed(4));
        setLngInput(centerLocation.lng.toFixed(4));
    }, [centerLocation]);

    // Close city dropdown when panel closes
    React.useEffect(() => {
        if (!isOpen) setShowCityDropdown(false);
    }, [isOpen]);

    if (!isOpen) return null;

    const sectionStyle: React.CSSProperties = {
        padding: '16px',
        background: 'rgba(0, 255, 204, 0.02)',
        border: '1px solid rgba(0, 255, 204, 0.12)',
        borderRadius: '4px',
    };

    const sectionTitleStyle: React.CSSProperties = {
        fontSize: '0.8rem',
        color: '#00ffcc',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        marginBottom: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        paddingBottom: '10px',
        borderBottom: '1px solid rgba(0, 255, 204, 0.1)',
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.7rem',
        color: '#7aa5a5',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.5px',
    };

    const rowStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
    };

    return (
        <>
            {/* Settings Panel */}
            <div
                style={{
                    position: 'absolute',
                    top: '85px',
                    right: '20px',
                    bottom: '16px',
                    width: '380px',
                    background: 'rgba(2, 11, 14, 0.97)',
                    border: '1px solid rgba(0, 255, 204, 0.25)',
                    borderRadius: '4px',
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '-8px 0 40px rgba(0, 0, 0, 0.6), -2px 0 15px rgba(0, 255, 204, 0.05)',
                    animation: 'settings-slide-in 0.25s ease-out',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: '1px solid rgba(0, 255, 204, 0.2)',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Settings size={18} color="#00ffcc" style={{ opacity: 0.9 }} />
                        <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '1rem',
                            color: '#00ffcc',
                            letterSpacing: '2px',
                            textTransform: 'uppercase',
                            textShadow: '0 0 8px rgba(0, 255, 204, 0.3)',
                        }}>
                            SIMULATION CONFIG
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px',
                            padding: '6px',
                            color: '#7aa5a5',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'rgba(255, 100, 100, 0.4)';
                            e.currentTarget.style.color = '#ff6b6b';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.color = '#7aa5a5';
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px 20px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                }}>

                    {/* ── SECTION 1: Directive Overrides ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>
                            <Crosshair size={15} /> DIRECTIVE OVERRIDES
                        </div>

                        {/* Custom Search Area */}
                        <div style={{ ...rowStyle, marginBottom: '12px' }}>
                            <div style={labelStyle}>CUSTOM SEARCH AREA</div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                {searchAreaDrawn && (
                                    <button
                                        onClick={onClearSearchArea}
                                        style={{
                                            background: 'rgba(0,0,0,0.4)',
                                            color: '#ff6b6b',
                                            border: '1px solid rgba(255,107,107,0.3)',
                                            borderRadius: '4px',
                                            padding: '6px 10px',
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '0.6rem',
                                            cursor: 'pointer',
                                            letterSpacing: '0.5px',
                                            transition: 'all 0.2s ease',
                                        }}
                                    >
                                        CLEAR
                                    </button>
                                )}
                                <button
                                    onClick={onToggleDrawingMode}
                                    style={{
                                        background: isDrawingMode ? '#00ffcc' : 'rgba(0,0,0,0.4)',
                                        color: isDrawingMode ? '#000' : '#7aa5a5',
                                        border: `1px solid ${isDrawingMode ? '#00ffcc' : 'rgba(0, 255, 204, 0.2)'}`,
                                        borderRadius: '4px',
                                        padding: '6px 10px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.6rem',
                                        cursor: 'pointer',
                                        fontWeight: isDrawingMode ? 700 : 400,
                                        letterSpacing: '0.5px',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {isDrawingMode ? 'DRAWING...' : 'DRAW AREA'}
                                </button>
                            </div>
                        </div>

                        {/* Blanket Micro Scan */}
                        <div style={rowStyle}>
                            <div style={labelStyle}>BLANKET MICRO SCAN</div>
                            <button
                                onClick={onToggleMicroScanOnly}
                                style={{
                                    background: microScanOnly ? 'rgba(255, 68, 68, 0.15)' : 'rgba(0,0,0,0.4)',
                                    color: microScanOnly ? '#ff4444' : '#7aa5a5',
                                    border: `1px solid ${microScanOnly ? 'rgba(255, 68, 68, 0.4)' : 'rgba(0, 255, 204, 0.2)'}`,
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.6rem',
                                    cursor: 'pointer',
                                    fontWeight: microScanOnly ? 700 : 400,
                                    letterSpacing: '0.5px',
                                    transition: 'all 0.2s ease',
                                    minWidth: '80px',
                                    textAlign: 'center',
                                }}
                            >
                                {microScanOnly ? '● ACTIVE' : 'INACTIVE'}
                            </button>
                        </div>
                    </div>

                    {/* ── SECTION 2: Location ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>
                            <Navigation size={15} /> SELECT LOCATION
                        </div>

                        {/* Coordinate Inputs */}
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ ...labelStyle, marginBottom: '8px' }}>COORDINATES</div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.55rem', color: '#5a8585', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>LAT</div>
                                    <input
                                        type="text"
                                        value={latInput}
                                        onChange={e => setLatInput(e.target.value)}
                                        onBlur={() => {
                                            const val = parseFloat(latInput);
                                            if (!isNaN(val)) setCenterLocation(prev => ({ ...prev, lat: val }));
                                        }}
                                        disabled={running}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.5)',
                                            border: '1px solid rgba(0, 255, 204, 0.2)',
                                            borderRadius: '3px',
                                            color: '#fff',
                                            fontSize: '0.8rem',
                                            padding: '7px 10px',
                                            fontFamily: 'var(--font-mono)',
                                            outline: 'none',
                                            transition: 'border-color 0.2s ease',
                                            opacity: running ? 0.5 : 1,
                                        }}
                                        onFocus={e => e.currentTarget.style.borderColor = 'rgba(0, 255, 204, 0.5)'}
                                        onBlurCapture={e => e.currentTarget.style.borderColor = 'rgba(0, 255, 204, 0.2)'}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.55rem', color: '#5a8585', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>LNG</div>
                                    <input
                                        type="text"
                                        value={lngInput}
                                        onChange={e => setLngInput(e.target.value)}
                                        onBlur={() => {
                                            const val = parseFloat(lngInput);
                                            if (!isNaN(val)) setCenterLocation(prev => ({ ...prev, lng: val }));
                                        }}
                                        disabled={running}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.5)',
                                            border: '1px solid rgba(0, 255, 204, 0.2)',
                                            borderRadius: '3px',
                                            color: '#fff',
                                            fontSize: '0.8rem',
                                            padding: '7px 10px',
                                            fontFamily: 'var(--font-mono)',
                                            outline: 'none',
                                            transition: 'border-color 0.2s ease',
                                            opacity: running ? 0.5 : 1,
                                        }}
                                        onFocus={e => e.currentTarget.style.borderColor = 'rgba(0, 255, 204, 0.5)'}
                                        onBlurCapture={e => e.currentTarget.style.borderColor = 'rgba(0, 255, 204, 0.2)'}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* City Presets + GPS */}
                        <div style={{ ...labelStyle, marginBottom: '8px' }}>PRESETS</div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <button
                                    onClick={() => setShowCityDropdown(!showCityDropdown)}
                                    disabled={running}
                                    style={{
                                        width: '100%',
                                        background: 'rgba(0, 255, 204, 0.05)',
                                        border: '1px solid rgba(0, 255, 204, 0.2)',
                                        borderRadius: '3px',
                                        padding: '7px 10px',
                                        color: '#e0ffff',
                                        fontSize: '0.7rem',
                                        cursor: running ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        fontFamily: 'var(--font-mono)',
                                        opacity: running ? 0.5 : 1,
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <MapIcon size={12} color="#00ffcc" /> {
                                            CITIES.find(c => Math.abs(c.lat - centerLocation.lat) < 0.01 && Math.abs(c.lng - centerLocation.lng) < 0.01)?.name || 'SELECT CITY'
                                        }
                                    </span>
                                    <ChevronDown size={12} style={{ transform: showCityDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                                </button>
                                {showCityDropdown && (
                                    <div style={{
                                        position: 'absolute',
                                        top: 'calc(100% + 4px)',
                                        left: 0,
                                        right: 0,
                                        background: 'rgba(5, 15, 20, 0.98)',
                                        border: '1px solid rgba(0, 255, 204, 0.25)',
                                        borderRadius: '3px',
                                        padding: '4px',
                                        zIndex: 10,
                                        boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                                    }}>
                                        {CITIES.map(city => (
                                            <button
                                                key={city.name}
                                                onClick={() => {
                                                    setCenterLocation(() => ({ lat: city.lat, lng: city.lng }));
                                                    setShowCityDropdown(false);
                                                }}
                                                style={{
                                                    width: '100%',
                                                    textAlign: 'left',
                                                    padding: '8px 10px',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#e0ffff',
                                                    fontSize: '0.7rem',
                                                    fontFamily: 'var(--font-mono)',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    borderRadius: '2px',
                                                    transition: 'background 0.15s ease',
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 255, 204, 0.1)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <span>{city.name}</span>
                                                <span style={{ opacity: 0.4, fontSize: '0.6rem' }}>{city.lat.toFixed(2)}, {city.lng.toFixed(2)}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => {
                                    if ("geolocation" in navigator) {
                                        navigator.geolocation.getCurrentPosition((pos) => {
                                            setCenterLocation(() => ({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
                                        });
                                    }
                                }}
                                disabled={running}
                                title="Use GPS Location"
                                style={{
                                    background: 'rgba(0, 255, 204, 0.08)',
                                    border: '1px solid rgba(0, 255, 204, 0.25)',
                                    borderRadius: '3px',
                                    padding: '7px 10px',
                                    color: '#00ffcc',
                                    cursor: running ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.6rem',
                                    opacity: running ? 0.5 : 1,
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <LocateFixed size={14} /> GPS
                            </button>
                        </div>
                    </div>

                    {/* ── SECTION 3: Time Limit ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>
                            <Clock size={15} /> TIME LIMIT MODE
                        </div>

                        <div style={{ ...rowStyle, marginBottom: '12px' }}>
                            <div style={labelStyle}>TIME BUDGET</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: running ? 0.5 : 1 }}>
                                <button
                                    onClick={() => setUseTimeLimit(!useTimeLimit)}
                                    disabled={running}
                                    style={{
                                        background: useTimeLimit ? 'rgba(0, 255, 204, 0.15)' : 'rgba(0,0,0,0.4)',
                                        color: useTimeLimit ? '#00ffcc' : '#7aa5a5',
                                        border: `1px solid ${useTimeLimit ? 'rgba(0, 255, 204, 0.4)' : 'rgba(0, 255, 204, 0.15)'}`,
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.6rem',
                                        cursor: running ? 'not-allowed' : 'pointer',
                                        fontWeight: useTimeLimit ? 700 : 400,
                                        letterSpacing: '0.5px',
                                        transition: 'all 0.2s ease',
                                        minWidth: '80px',
                                        textAlign: 'center',
                                    }}
                                >
                                    {useTimeLimit ? '● ENABLED' : 'DISABLED'}
                                </button>
                            </div>
                        </div>

                        {useTimeLimit && (
                            <div style={{
                                padding: '12px',
                                background: 'rgba(0, 255, 204, 0.03)',
                                border: '1px solid rgba(0, 255, 204, 0.08)',
                                borderRadius: '3px',
                            }}>
                                <div style={{ ...labelStyle, marginBottom: '8px' }}>BUDGET (SECONDS)</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <input
                                        type="range"
                                        min={30}
                                        max={600}
                                        step={10}
                                        value={timeLimit}
                                        onChange={(e) => setTimeLimit(parseInt(e.target.value))}
                                        disabled={running}
                                        className="drone-slider"
                                        style={{ flex: 1, opacity: running ? 0.5 : 1 }}
                                    />
                                    <input
                                        type="number"
                                        value={timeLimit}
                                        onChange={(e) => setTimeLimit(parseInt(e.target.value) || 0)}
                                        disabled={running}
                                        style={{
                                            width: '70px',
                                            background: 'rgba(0,0,0,0.5)',
                                            border: '1px solid rgba(0, 255, 204, 0.2)',
                                            borderRadius: '3px',
                                            color: '#00ffcc',
                                            padding: '5px 8px',
                                            fontSize: '0.8rem',
                                            fontFamily: 'var(--font-mono)',
                                            outline: 'none',
                                            textAlign: 'center',
                                            opacity: running ? 0.5 : 1,
                                        }}
                                    />
                                    <span style={{ fontSize: '0.6rem', color: '#5a8585', fontFamily: 'var(--font-mono)' }}>SEC</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION 4: Initial Battery ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>
                            <Battery size={15} /> INITIAL BATTERY
                        </div>

                        <div style={rowStyle}>
                            <div style={labelStyle}>BATTERY MODE</div>
                            <div style={{
                                display: 'flex',
                                border: '1px solid rgba(0, 255, 204, 0.25)',
                                borderRadius: '4px',
                                overflow: 'hidden',
                                opacity: running ? 0.5 : 1,
                            }}>
                                <button
                                    onClick={() => setRandomizeBattery(false)}
                                    disabled={running}
                                    style={{
                                        background: !randomizeBattery ? 'rgba(0, 255, 204, 0.2)' : 'rgba(0,0,0,0.4)',
                                        color: !randomizeBattery ? '#00ffcc' : '#5a8585',
                                        border: 'none',
                                        padding: '7px 16px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.65rem',
                                        cursor: running ? 'not-allowed' : 'pointer',
                                        fontWeight: !randomizeBattery ? 700 : 400,
                                        transition: 'all 0.2s ease',
                                        letterSpacing: '0.5px',
                                    }}
                                >
                                    FULL
                                </button>
                                <div style={{ width: '1px', background: 'rgba(0, 255, 204, 0.25)' }} />
                                <button
                                    onClick={() => setRandomizeBattery(true)}
                                    disabled={running}
                                    style={{
                                        background: randomizeBattery ? 'rgba(0, 255, 204, 0.2)' : 'rgba(0,0,0,0.4)',
                                        color: randomizeBattery ? '#00ffcc' : '#5a8585',
                                        border: 'none',
                                        padding: '7px 16px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.65rem',
                                        cursor: running ? 'not-allowed' : 'pointer',
                                        fontWeight: randomizeBattery ? 700 : 400,
                                        transition: 'all 0.2s ease',
                                        letterSpacing: '0.5px',
                                    }}
                                >
                                    RANDOM
                                </button>
                            </div>
                        </div>

                        <div style={{
                            marginTop: '12px',
                            padding: '8px 10px',
                            background: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '3px',
                            fontSize: '0.6rem',
                            color: '#5a8585',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: '1.5',
                        }}>
                            {randomizeBattery
                                ? '⚡ Drones will start with randomized battery levels (50-100%), simulating mid-mission deployment.'
                                : '🔋 All drones start at 100% battery for maximum mission duration.'
                            }
                        </div>
                        
                        {randomizeBattery && (
                            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {drones.map(d => (
                                    <div key={d.id} style={{
                                        padding: '8px 12px',
                                        background: 'rgba(0, 255, 204, 0.03)',
                                        border: '1px solid rgba(0, 255, 204, 0.08)',
                                        borderRadius: '3px',
                                    }}>
                                        <div style={{ ...labelStyle, marginBottom: '6px', color: '#00ffcc' }}>{d.id} BATTERY</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <input
                                                type="range"
                                                min={20}
                                                max={100}
                                                step={1}
                                                value={d.battery}
                                                onChange={(e) => updateDroneBattery(d.id, parseInt(e.target.value))}
                                                disabled={running}
                                                className="drone-slider"
                                                style={{ flex: 1, opacity: running ? 0.5 : 1 }}
                                            />
                                            <input
                                                type="number"
                                                value={d.battery}
                                                onChange={(e) => updateDroneBattery(d.id, parseInt(e.target.value) || 20)}
                                                disabled={running}
                                                min={20}
                                                max={100}
                                                style={{
                                                    width: '50px',
                                                    background: 'rgba(0,0,0,0.5)',
                                                    border: '1px solid rgba(0, 255, 204, 0.2)',
                                                    borderRadius: '3px',
                                                    color: '#00ffcc',
                                                    padding: '3px 6px',
                                                    fontSize: '0.8rem',
                                                    fontFamily: 'var(--font-mono)',
                                                    outline: 'none',
                                                    textAlign: 'center',
                                                    opacity: running ? 0.5 : 1,
                                                }}
                                            />
                                            <span style={{ fontSize: '0.6rem', color: '#5a8585', fontFamily: 'var(--font-mono)' }}>%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '12px 20px',
                    borderTop: '1px solid rgba(0, 255, 204, 0.15)',
                    display: 'flex',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}>
                    <span style={{
                        fontSize: '0.55rem',
                        color: '#3a5555',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '1px',
                    }}>
                        ● CHANGES APPLY ON NEXT SIMULATION START
                    </span>
                </div>
            </div>

            <style>{`
                @keyframes settings-slide-in {
                    from {
                        transform: translateX(100%);
                        opacity: 0.5;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `}</style>
        </>
    );
};
