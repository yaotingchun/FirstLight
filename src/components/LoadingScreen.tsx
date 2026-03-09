import React, { useState, useEffect } from 'react';

interface LoadingScreenProps {
    onComplete: () => void;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ onComplete }) => {
    const [loadingText, setLoadingText] = useState('INITIALIZING SWARM PROTOCOL...');
    const [progress, setProgress] = useState(0);
    const [opacity, setOpacity] = useState(1);

    // Decorative UI state
    const [scanData, setScanData] = useState({ top: 'SYS.STATUS: NOMINAL', bottom: 'FREQ: 144.00MHz' });
    const [sideBars, setSideBars] = useState<boolean[]>(Array(16).fill(false));
    const [blips, setBlips] = useState<{ id: number, x: number, y: number, opacity: number }[]>([]);

    // Streaming Logs State
    const [leftLogs, setLeftLogs] = useState<string[]>(Array(15).fill(''));
    const [rightLogs, setRightLogs] = useState<string[]>(Array(15).fill(''));

    const generateHex = () => `0x${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase()}`;

    const logMessages = [
        "Establishing handshake...", "Bypassing security protocols...", "Allocating drone memory...",
        "Calibrating IR sensors...", "Ping gateway...", "Resolving coordinates...",
        "Syncing telemetry data...", "Deploying mesh network...", "Calculating optimal flight paths...",
        "Connecting to satellite uplink...", "Loading map tiles...", "Parsing terrain data..."
    ];

    useEffect(() => {
        // Sequence of loading events
        const sequence = [
            { time: 0, text: 'INITIALIZING BOOT SEQUENCE...' },
            { time: 800, text: 'ESTABLISHING SECURE UPLINK...' },
            { time: 1500, text: 'CALIBRATING ADAPTIVE SENSORS...' },
            { time: 2200, text: 'LOADING PROBABILITY MATRICES...' },
            { time: 2800, text: 'DEPLOYING SWARM AI...' },
            { time: 3500, text: 'SYSTEM READY.' }
        ];

        // Progress bar animation
        const progressInterval = setInterval(() => {
            setProgress(p => {
                if (p >= 100) {
                    clearInterval(progressInterval);
                    return 100;
                }
                return p + (Math.random() * 15);
            });
        }, 200);

        // Decorative Data Animation
        const dataInterval = setInterval(() => {
            setScanData({
                top: `TRGT_LCK: ${Math.random() > 0.8 ? 'ACQUIRED' : 'SEARCHING...'} | SEC: ${(Math.random() * 100).toFixed(2)}`,
                bottom: `FREQ: ${(144 + Math.random() * 10).toFixed(2)}MHz | LAT: 1.56${Math.floor(Math.random() * 99)}`
            });
            setSideBars(Array(16).fill(false).map(() => Math.random() > 0.4));

            if (Math.random() > 0.6) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 120; // max radius for blips
                setBlips(prev => [
                    ...prev.slice(-4), // keep tail small
                    { id: Date.now() + Math.random(), x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, opacity: 1 }
                ]);
            }
        }, 150);

        // Stream Logs Animation
        const logInterval = setInterval(() => {
            setLeftLogs(prev => {
                const newLogs = [...prev.slice(1)];
                newLogs.push(`> ${generateHex()} : ${logMessages[Math.floor(Math.random() * logMessages.length)]}`);
                return newLogs;
            });
            setRightLogs(prev => {
                const newLogs = [...prev.slice(1)];
                // Random hex pairs or system info
                let msg = "";
                for (let i = 0; i < 4; i++) msg += `${generateHex()} `;
                newLogs.push(msg);
                return newLogs;
            });
        }, 100);

        // Blip Fading
        const blipInterval = setInterval(() => {
            setBlips(prev => prev.map(b => ({ ...b, opacity: b.opacity - 0.05 })).filter(b => b.opacity > 0));
        }, 50);

        // Text sequence
        sequence.forEach(({ time, text }, index) => {
            setTimeout(() => {
                setLoadingText(text);
                if (index === sequence.length - 1) {
                    // Fade out after a short delay when ready
                    setTimeout(() => {
                        setOpacity(0);
                        // Notify parent to unmount after fade transition
                        setTimeout(onComplete, 800);
                    }, 800);
                }
            }, time);
        });

        return () => {
            clearInterval(progressInterval);
            clearInterval(dataInterval);
            clearInterval(blipInterval);
            clearInterval(logInterval);
            sequence.forEach(({ time }) => clearTimeout(time));
        };
    }, [onComplete]);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: '#010507', // Deep, almost black background
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: opacity,
            transition: 'opacity 0.8s ease-out',
            overflow: 'hidden',
            color: '#e0ffff',
            fontFamily: '"Share Tech Mono", monospace'
        }}>
            {/* Background Grid - Darker, denser */}
            <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `
          linear-gradient(rgba(0, 255, 204, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 255, 204, 0.03) 1px, transparent 1px)
        `,
                backgroundSize: '20px 20px',
                opacity: 0.8
            }} />

            {/* Cinematic Vignette */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(ellipse at center, transparent 20%, #010507 85%)',
                pointerEvents: 'none'
            }} />

            {/* --- Sci-Fi Screen Frame Additions --- */}
            {/* Top Bar */}
            <div style={{ position: 'absolute', top: 20, left: 40, right: 40, height: '2px', backgroundColor: 'rgba(0, 255, 204, 0.3)' }}>
                <div style={{ position: 'absolute', top: '-10px', left: 0, padding: '2px 8px', backgroundColor: 'rgba(0, 255, 204, 0.1)', color: '#00ffcc', fontSize: '10px' }}>SYS.INFO</div>
                <div style={{ position: 'absolute', top: '-10px', right: 0, padding: '2px 8px', backgroundColor: 'rgba(0, 255, 204, 0.1)', color: '#00ffcc', fontSize: '10px' }}>SECURE</div>
                {/* Top side decorations */}
                <div style={{ position: 'absolute', left: '100px', top: '-1px', width: '30px', height: '4px', backgroundColor: '#00ffcc' }} />
                <div style={{ position: 'absolute', right: '100px', top: '-1px', width: '10px', height: '4px', backgroundColor: '#00ffcc' }} />
            </div>

            {/* Bottom Bar */}
            <div style={{ position: 'absolute', bottom: 20, left: 40, right: 40, height: '2px', backgroundColor: 'rgba(0, 255, 204, 0.3)' }}>
                <div style={{ position: 'absolute', bottom: '-15px', left: '50%', transform: 'translateX(-50%)', color: 'rgba(0, 255, 204, 0.5)', fontSize: '10px', letterSpacing: '4px' }}>FIRST LIGHT SWARM OPTICS LOGIC</div>
            </div>

            {/* --- Streaming Data Panels (Filling left/right empty space) --- */}
            <div style={{
                position: 'absolute',
                left: 40,
                top: 60,
                bottom: 60,
                width: '250px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                fontSize: '10px',
                color: 'rgba(0, 255, 204, 0.4)',
                overflow: 'hidden',
                maskImage: 'linear-gradient(to bottom, transparent, black 20%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 20%)'
            }}>
                {leftLogs.map((log, i) => (
                    <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '2px 0' }}>{log}</div>
                ))}
            </div>

            <div style={{
                position: 'absolute',
                right: 40,
                top: 60,
                bottom: 60,
                width: '200px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                fontSize: '10px',
                color: 'rgba(0, 255, 204, 0.3)',
                textAlign: 'right',
                overflow: 'hidden',
                maskImage: 'linear-gradient(to top, transparent, black 20%)',
                WebkitMaskImage: 'linear-gradient(to top, transparent, black 20%)'
            }}>
                {rightLogs.map((log, i) => (
                    <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', margin: '2px 0' }}>{log}</div>
                ))}
                {/* Right panel extra graphic element */}
                <div style={{ marginTop: 'auto', border: '1px solid rgba(0, 255, 204, 0.2)', padding: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span>CPU_LOAD</span><span>{(Math.random() * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: 'rgba(0,255,204,0.1)' }}>
                        <div style={{ width: `${Math.random() * 80 + 20}%`, height: '100%', background: '#00ffcc' }} />
                    </div>
                </div>
            </div>


            {/* --- Main Center Container --- */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center' }}>

                {/* Cinematic Radar / Scanner Container */}
                <div style={{ position: 'relative', width: '450px', height: '450px', marginBottom: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>

                    {/* Corner Brackets */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '60px', height: '60px', borderTop: '2px solid rgba(0, 255, 204, 0.8)', borderLeft: '2px solid rgba(0, 255, 204, 0.8)' }} />
                    <div style={{ position: 'absolute', top: 0, right: 0, width: '60px', height: '60px', borderTop: '2px solid rgba(0, 255, 204, 0.8)', borderRight: '2px solid rgba(0, 255, 204, 0.8)' }} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, width: '60px', height: '60px', borderBottom: '2px solid rgba(0, 255, 204, 0.8)', borderLeft: '2px solid rgba(0, 255, 204, 0.8)' }} />
                    <div style={{ position: 'absolute', bottom: 0, right: 0, width: '60px', height: '60px', borderBottom: '2px solid rgba(0, 255, 204, 0.8)', borderRight: '2px solid rgba(0, 255, 204, 0.8)' }} />

                    {/* Added decorative cross angles */}
                    <div style={{ position: 'absolute', top: '10px', left: '10px', width: '15px', height: '15px', borderTop: '1px solid #00ffcc', borderLeft: '1px solid #00ffcc', opacity: 0.5, transform: 'rotate(45deg)' }} />
                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', width: '15px', height: '15px', borderBottom: '1px solid #00ffcc', borderRight: '1px solid #00ffcc', opacity: 0.5, transform: 'rotate(45deg)' }} />

                    {/* HUD Ring Details */}
                    <div style={{ position: 'absolute', inset: '-30px', border: '1px solid rgba(0, 255, 204, 0.05)', borderRadius: '50%' }} />
                    <div className="rotate-slow-reverse" style={{ position: 'absolute', inset: '15px', border: '2px dashed rgba(0, 255, 204, 0.2)', borderRadius: '50%' }} />
                    <div className="rotate-slow" style={{ position: 'absolute', inset: '35px', border: '1px dotted rgba(0, 255, 204, 0.4)', borderRadius: '50%' }} />

                    {/* Radar Base Circles */}
                    <div style={{ position: 'absolute', inset: '60px', border: '2px solid rgba(0, 255, 204, 0.15)', borderRadius: '50%' }} />
                    <div style={{ position: 'absolute', inset: '130px', border: '1px solid rgba(0, 255, 204, 0.3)', borderRadius: '50%' }} />
                    <div style={{ position: 'absolute', inset: '180px', border: '1px dashed rgba(0, 255, 204, 0.4)', borderRadius: '50%' }} />

                    {/* Target Blips */}
                    <div style={{ position: 'absolute', inset: '60px', overflow: 'hidden', borderRadius: '50%' }}>
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                            {blips.map(b => (
                                <div key={b.id} style={{
                                    position: 'absolute',
                                    top: `calc(50% + ${b.y}px)`,
                                    left: `calc(50% + ${b.x}px)`,
                                    width: '8px',
                                    height: '8px',
                                    backgroundColor: '#00ffcc',
                                    borderRadius: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    opacity: b.opacity,
                                    boxShadow: '0 0 12px #00ffcc'
                                }}>
                                    <div className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid #00ffcc' }}></div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Grid lines inside radar */}
                    <div style={{ position: 'absolute', top: '60px', bottom: '60px', left: '50%', width: '1px', backgroundColor: 'rgba(0, 255, 204, 0.15)' }} />
                    <div style={{ position: 'absolute', left: '60px', right: '60px', top: '50%', height: '1px', backgroundColor: 'rgba(0, 255, 204, 0.15)' }} />

                    {/* Primary Sweep Wrapper */}
                    <div style={{ position: 'absolute', inset: '60px', borderRadius: '50%', overflow: 'hidden' }}>
                        <div className="radar-sweep" style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'conic-gradient(from 0deg, rgba(0, 255, 204, 0) 0%, rgba(0, 255, 204, 0.05) 60%, rgba(0, 255, 204, 0.4) 100%)',
                        }} />
                    </div>

                    {/* Secondary Inner Sweep */}
                    <div style={{ position: 'absolute', inset: '130px', borderRadius: '50%', overflow: 'hidden' }}>
                        <div className="radar-sweep-fast" style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'conic-gradient(from 0deg, rgba(0, 255, 204, 0) 0%, rgba(0, 255, 204, 0.1) 80%, rgba(0, 255, 204, 0.3) 100%)',
                        }} />
                    </div>

                    {/* Center Node */}
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '16px',
                        height: '16px',
                        backgroundColor: '#00ffcc',
                        borderRadius: '50%',
                        boxShadow: '0 0 25px 8px rgba(0, 255, 204, 0.6)'
                    }} className="pulse-fast">
                        <div style={{ position: 'absolute', inset: '4px', backgroundColor: '#fff', borderRadius: '50%' }}></div>
                    </div>

                    {/* Dynamic Readouts Context */}
                    <div style={{ position: 'absolute', top: '-25px', left: '35px', fontSize: '11px', color: 'rgba(0,255,204,0.8)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', background: '#00ffcc', borderRadius: '50%' }} className="animate-pulse"></div>
                        {scanData.top}
                    </div>
                    <div style={{ position: 'absolute', bottom: '-25px', right: '35px', fontSize: '11px', color: 'rgba(0,255,204,0.8)' }}>
                        {scanData.bottom}
                    </div>

                    {/* Inner Side panels (vertical data streams) - keeping original logic but spreading out styling */}
                    <div style={{ position: 'absolute', left: '-60px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sideBars.slice(0, 8).map((active, i) => (
                            <div key={`left-in-${i}`} style={{ width: '18px', height: '4px', background: active ? '#00e5b5' : 'rgba(0,229,181,0.15)', boxShadow: active ? '0 0 10px #00e5b5' : 'none', transition: 'all 0.1s' }} />
                        ))}
                    </div>
                    <div style={{ position: 'absolute', right: '-60px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sideBars.slice(8, 16).map((active, i) => (
                            <div key={`right-in-${i}`} style={{ width: '18px', height: '4px', background: active ? '#0077ff' : 'rgba(0,119,255,0.15)', boxShadow: active ? '0 0 10px #0077ff' : 'none', transition: 'all 0.1s' }} />
                        ))}
                    </div>

                    {/* Circular Data Rings (Arc) */}
                    <div style={{ position: 'absolute', inset: '-50px', border: '1px solid transparent', borderTopColor: 'rgba(0, 255, 204, 0.3)', borderRadius: '50%', transform: 'rotate(45deg)' }} className="rotate-slow" />
                    <div style={{ position: 'absolute', inset: '-60px', border: '1px solid transparent', borderBottomColor: 'rgba(0, 119, 255, 0.3)', borderRadius: '50%', transform: 'rotate(-45deg)' }} className="rotate-slow-reverse" />
                </div>

                {/* Loading Information */}
                <div style={{ textAlign: 'center', zIndex: 1, width: '500px', marginTop: '20px' }}>
                    <h2 style={{
                        color: '#00ffcc',
                        letterSpacing: '12px',
                        marginBottom: '25px',
                        fontSize: '2rem',
                        textShadow: '0 0 20px rgba(0,255,204,0.6)',
                        textTransform: 'uppercase'
                    }}>
                        FIRST LIGHT OS
                    </h2>

                    <div style={{
                        height: '30px',
                        marginBottom: '25px',
                        fontSize: '1rem',
                        letterSpacing: '3px',
                        color: opacity === 1 && progress >= 100 ? '#00ffcc' : '#e0ffff',
                        transition: 'color 0.3s',
                        textShadow: opacity === 1 && progress >= 100 ? '0 0 15px #00ffcc' : 'none'
                    }}>
                        &gt; {loadingText}
                    </div>

                    {/* Decorative Progress Container */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#00ffcc', opacity: 0.8, letterSpacing: '1px' }}>[SYS_MEM]</div>

                        {/* Progress Bar */}
                        <div style={{
                            flex: 1,
                            height: '8px',
                            backgroundColor: 'rgba(0, 255, 204, 0.05)',
                            border: '1px solid rgba(0, 255, 204, 0.4)',
                            position: 'relative',
                            overflow: 'hidden'
                        }}>
                            {/* Background grid within progress bar */}
                            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,255,204,0.1) 10px, rgba(0,255,204,0.1) 20px)' }}></div>

                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                height: '100%',
                                width: `${Math.min(progress, 100)}%`,
                                backgroundColor: '#00ffcc',
                                boxShadow: '0 0 15px #00ffcc',
                                transition: 'width 0.2s ease-out'
                            }} />
                        </div>

                        <div style={{ fontSize: '0.8rem', color: '#00ffcc', opacity: 0.9, width: '45px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{Math.floor(Math.min(progress, 100))}%</div>
                    </div>

                    {/* Hex Data */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '20px',
                        fontSize: '0.7rem',
                        color: 'rgba(224, 255, 255, 0.5)',
                        fontFamily: 'monospace'
                    }}>
                        <span>0x00FFCA 0x00FFCB 0x1A4C4C</span>
                        <span>UPLINK: ENCRYPTED-256</span>
                    </div>
                </div>
            </div>

            {/* Static overlay lines */}
            <div className="scanline-overlay"></div>
        </div>
    );
};

export default LoadingScreen;
