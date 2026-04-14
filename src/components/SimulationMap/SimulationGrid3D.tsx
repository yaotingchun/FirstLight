import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { GRID_W, GRID_H, CELL_SIZE, BASE_STATION } from '../../types/simulation';
import type { Sector, Drone, FoundPin } from '../../types/simulation';
import { generateBuildingHeights, getDroneAltitude } from '../../utils/buildingHeightMap';
import { getDroneThemeColor } from './SimulationGrid';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// ─── Constants ────────────────────────────────────────────────────────────────
const UNIT = CELL_SIZE / 10;      // world units per grid cell  (3.5)
const H_SCALE = UNIT * 0.65;      // building height multiplier
const BG = 0x050a10;              // clean, dark blue-black background

// ─── Helpers ──────────────────────────────────────────────────────────────────
function gw(gx: number, gy: number): THREE.Vector3 {
    return new THREE.Vector3(
        (gx - GRID_W / 2 + 0.5) * UNIT,
        0,
        (gy - GRID_H / 2 + 0.5) * UNIT,
    );
}

/** Create a canvas-texture label sprite */
function makeSprite(text: string, hexColor: string): THREE.Sprite {
    const W = 160, H = 56;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')!;

    // Background pill
    ctx.fillStyle = 'rgba(2,9,18,0.82)';
    ctx.strokeStyle = hexColor;
    ctx.lineWidth = 2.5;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W - r, 0);
    ctx.arcTo(W, 0, W, r, r);
    ctx.lineTo(W, H - r);
    ctx.arcTo(W, H, W - r, H, r);
    ctx.lineTo(r, H);
    ctx.arcTo(0, H, 0, H - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = hexColor;
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(UNIT * 0.9, UNIT * 0.32, 1);
    return sp;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface SimulationGrid3DProps {
    grid: Sector[][];
    drones: Drone[];
    pins: FoundPin[];
    visible: boolean;
    running: boolean;
    getSectorProbability: (x: number, y: number) => number;
    searchArea: { x: number; y: number }[];
    searchScanActive: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const SimulationGrid3D: React.FC<SimulationGrid3DProps> = ({ 
    grid, drones, pins, running, 
    getSectorProbability, searchArea, searchScanActive 
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Live data refs – animation loop reads these every frame (never stale)
    const dronesRef = useRef<Drone[]>(drones);
    const pinsRef = useRef<FoundPin[]>(pins);
    const gridRef = useRef<Sector[][]>(grid);
    const runningRef = useRef<boolean>(running);
    const searchAreaRef = useRef<{ x: number, y: number }[]>(searchArea);
    const searchScanActiveRef = useRef<boolean>(searchScanActive);
    const getSectorProbabilityRef = useRef(getSectorProbability);
    
    // Smooth state tracking
    const hoverRef = useRef<{ x: number, y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const [hoverInfo, setHoverInfo] = React.useState<{ x: number, y: number, sector: Sector } | null>(null);

    const heightMap = useMemo(() => generateBuildingHeights(grid), []); // eslint-disable-line
    const maxH = useMemo(() => Math.max(1, ...heightMap.flat()), [heightMap]);

    // Keep refs in sync with props WITHOUT triggering re-renders of the 3D scene
    useEffect(() => {
        dronesRef.current = drones;
        pinsRef.current = pins;
        gridRef.current = grid;
        runningRef.current = running;
        searchAreaRef.current = searchArea;
        searchScanActiveRef.current = searchScanActive;
        getSectorProbabilityRef.current = getSectorProbability;
    }, [drones, pins, grid, running, searchArea, searchScanActive, getSectorProbability]);

    // ── Main Three.js setup ──────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement!;

        const WW = GRID_W * UNIT;   // world width
        const WD = GRID_H * UNIT;   // world depth

        // ── Renderer ────────────────────────────────────────────────────────
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        const initW = parent.clientWidth || 700;
        const initH = parent.clientHeight || 640;
        renderer.setSize(initW, initH);

        // ── Scene ────────────────────────────────────────────────────────────
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(BG);
        scene.fog = new THREE.Fog(BG, WW * 1.6, WW * 3.5);

        // ── Camera – perspective, ~35° elevation matching reference image ───
        const camera = new THREE.PerspectiveCamera(52, initW / initH, 0.1, WW * 12);
        camera.position.set(0, WD * 0.88, WD * 1.05);
        camera.lookAt(new THREE.Vector3(0, 0, -WD * 0.06));

        // ── Controls ────────────────────────────────────────────────────────
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.rotateSpeed = 0.8;
        controls.maxPolarAngle = Math.PI / 2.1; // Limit so we don't go under ground
        controls.minDistance = UNIT * 2;
        controls.maxDistance = WW * 4;
        controls.target.set(0, 0, -WD * 0.06);
        
        controls.addEventListener('start', () => { isDraggingRef.current = true; });
        controls.addEventListener('end', () => { isDraggingRef.current = false; });

        // ── Lighting – crisp, clean, single key light ─────────────────────────
        scene.add(new THREE.AmbientLight(0x1a2d55, 3.2));

        const keyLight = new THREE.DirectionalLight(0x77bbff, 1.8);
        keyLight.position.set(WW * 0.4, WW * 1.5, WD * 0.5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        const sc = keyLight.shadow.camera as THREE.OrthographicCamera;
        sc.left = sc.bottom = -WW; sc.right = sc.top = WW;
        sc.near = 0.1; sc.far = WW * 4;
        scene.add(keyLight);

        // ── Ground ────────────────────────────────────────────────────────────
        const gndMat = new THREE.MeshStandardMaterial({ color: 0x071525, roughness: 1 });
        const gnd = new THREE.Mesh(new THREE.PlaneGeometry(WW, WD), gndMat);
        gnd.rotation.x = -Math.PI / 2;
        gnd.receiveShadow = true;
        scene.add(gnd);

        // ── Grid lines – cyan, matching reference image ───────────────────────
        const minorGrid = new THREE.GridHelper(WW, GRID_W, 0x0d4a78, 0x0d3060);
        minorGrid.position.y = 0.02;
        scene.add(minorGrid);

        // Heatmap Planes
        const heatmapGroup = new THREE.Group();
        const heatmapPlanes: THREE.Mesh[] = [];
        const heatMatBase = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const p = new THREE.Mesh(new THREE.PlaneGeometry(UNIT*0.96, UNIT*0.96), heatMatBase.clone());
                p.rotation.x = -Math.PI / 2;
                const pos = gw(gx, gy);
                p.position.set(pos.x, 0.05, pos.z);
                heatmapGroup.add(p);
                heatmapPlanes.push(p);
            }
        }
        scene.add(heatmapGroup);

        // Scanned cells Floor – subtle glow
        const scannedGroup = new THREE.Group();
        const scannedPlanes: THREE.Mesh[] = [];
        const scanMatBase = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const p = new THREE.Mesh(new THREE.PlaneGeometry(UNIT, UNIT), scanMatBase.clone());
                p.rotation.x = -Math.PI / 2;
                const pos = gw(gx, gy);
                p.position.set(pos.x, 0.02, pos.z);
                scannedGroup.add(p);
                scannedPlanes.push(p);
            }
        }
        scene.add(scannedGroup);

        // Search Area Boundary
        const searchLineMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2, transparent: true, opacity: 0.8 });
        let searchBoundary: THREE.LineLoop | null = null;

        // Mouse interaction for Raycasting
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(WW, WD), new THREE.MeshBasicMaterial({ visible: false }));
        groundPlane.rotation.x = -Math.PI / 2;
        scene.add(groundPlane);

        // Bright centre axis lines
        const axisMat = new THREE.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.55 });
        [[new THREE.Vector3(-WW / 2, 0.03, 0), new THREE.Vector3(WW / 2, 0.03, 0)],
         [new THREE.Vector3(0, 0.03, -WD / 2), new THREE.Vector3(0, 0.03, WD / 2)]
        ].forEach(pts => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), axisMat)));

        // ── Buildings ─────────────────────────────────────────────────────────
        const buildingMeshMap = new Map<string, THREE.Mesh>();
        const bldgMatBase = new THREE.MeshStandardMaterial({ 
            color: 0x182a40, 
            roughness: 0.65, 
            metalness: 0.15,
            transparent: false, // Fully opaque now
            opacity: 1.0, 
            emissive: new THREE.Color(0xaa2828), // Slightly brighter burgundy
            emissiveIntensity: 0
        });

        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const h = heightMap[gy]?.[gx] ?? 0;
                if (h === 0) continue;
                const hW = h * H_SCALE;
                const pos = gw(gx, gy);
                const box = new THREE.BoxGeometry(UNIT * 0.84, hW, UNIT * 0.84);
                // Use unique material per building so we can vary emissive glow
                const mesh = new THREE.Mesh(box, bldgMatBase.clone());
                mesh.position.set(pos.x, hW / 2, pos.z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
                buildingMeshMap.set(`${gx}-${gy}`, mesh);
            }
        }

        // ── Base station ───
        const bsPos = gw(BASE_STATION.x, BASE_STATION.y);
        const bsRingMat = new THREE.MeshBasicMaterial({ color: 0xff1133, transparent: true, opacity: 0.95 });
        const bsRing = new THREE.Mesh(new THREE.TorusGeometry(UNIT * 0.75, 0.045, 8, 32), bsRingMat);
        bsRing.rotation.x = Math.PI / 2;
        bsRing.position.set(bsPos.x, 0.08, bsPos.z);
        scene.add(bsRing);

        // ── Drone management ───
        const droneMeshMap = new Map<string, THREE.Group>();
        const droneSmoothed = new Map<string, THREE.Vector3>();
        const droneAlt = new Map<string, number>();

        function ensureDrone(drone: Drone): THREE.Group {
            if (droneMeshMap.has(drone.id)) return droneMeshMap.get(drone.id)!;
            const hexStr = getDroneThemeColor(drone.id);
            const col = new THREE.Color(hexStr);
            const group = new THREE.Group();
            const bodyMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.25, metalness: 0.8 });
            const body = new THREE.Mesh(new THREE.OctahedronGeometry(UNIT * 0.14, 0), bodyMat);
            body.castShadow = true;
            group.add(body);
            const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 });
            const ring1 = new THREE.Mesh(new THREE.TorusGeometry(UNIT * 0.2, 0.02, 4, 16), ringMat);
            ring1.rotation.x = Math.PI / 2;
            group.add(ring1);
            group.add(new THREE.PointLight(col, 1.2, UNIT * 2.8));
            const label = makeSprite(drone.id.replace('DRN-', '').replace('RLY-', 'R:'), hexStr);
            label.position.y = UNIT * 0.5;
            group.add(label);
            scene.add(group);
            droneMeshMap.set(drone.id, group);
            return group;
        }

        // ── Pin management ───
        const pinMeshMap = new Map<string, THREE.Group>();
        function ensurePin(pin: FoundPin): THREE.Group {
            if (pinMeshMap.has(pin.id)) return pinMeshMap.get(pin.id)!;
            const group = new THREE.Group();
            const pos = gw(pin.x, pin.y);
            const bh = (heightMap[pin.y]?.[pin.x] ?? 0) * H_SCALE;
            const stickMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
            const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, UNIT * 1.0, 5), stickMat);
            stick.position.y = bh + UNIT * 0.5;
            group.add(stick);
            const top = new THREE.Mesh(new THREE.SphereGeometry(UNIT * 0.13, 8, 8), stickMat);
            top.position.y = bh + UNIT;
            group.add(top);
            const lbl = makeSprite(`PIN`, '#00ffcc');
            lbl.position.set(0, bh + UNIT * 1.5, 0);
            group.add(lbl);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);
            pinMeshMap.set(pin.id, group);
            return group;
        }

        // ── Animation loop ────────────────────────────────────────────────────
        const clock = new THREE.Clock();
        let raf = 0;

        const animate = () => {
            raf = requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            bsRing.scale.setScalar(1 + 0.07 * Math.sin(t * 2.2));
            bsRingMat.opacity = 0.5 + 0.3 * Math.sin(t * 2.2);

            // Drones
            const liveDrones = dronesRef.current;
            const liveIds = new Set(liveDrones.map(d => d.id));
            droneMeshMap.forEach((grp, id) => { if (!liveIds.has(id)) { scene.remove(grp); droneMeshMap.delete(id); droneSmoothed.delete(id); droneAlt.delete(id); } });

            liveDrones.forEach(drone => {
                const grp = ensureDrone(drone);
                const tgt = gw(drone.x, drone.y);

                const isGrounded = !runningRef.current || drone.mode === 'Charging';
                const gxPad = Math.max(0, Math.min(GRID_W - 1, Math.round(drone.x)));
                const gyPad = Math.max(0, Math.min(GRID_H - 1, Math.round(drone.y)));
                const groundH = (heightMap[gyPad]?.[gxPad] ?? 0) * H_SCALE;
                
                const tAlt = isGrounded ? groundH : (getDroneAltitude(drone.x, drone.y, heightMap) * H_SCALE + UNIT * 0.45);
                if (!droneAlt.has(drone.id)) droneAlt.set(drone.id, isGrounded ? groundH : 0);
                
                const cAlt = droneAlt.get(drone.id)!;
                const nAlt = cAlt + (tAlt - cAlt) * 0.065;
                droneAlt.set(drone.id, nAlt);

                if (!droneSmoothed.has(drone.id)) droneSmoothed.set(drone.id, tgt.clone());
                const cur = droneSmoothed.get(drone.id)!;
                cur.x += (tgt.x - cur.x) * 0.075;
                cur.z += (tgt.z - cur.z) * 0.075;

                const bob = nAlt > groundH + 0.15 ? Math.sin(t * 1.8 + drone.x * 0.7) * 0.04 : 0;
                grp.position.set(cur.x, nAlt + bob, cur.z);

                const ring1 = grp.children[1] as THREE.Mesh;
                if (ring1) {
                    ring1.rotation.z += nAlt > groundH + 0.15 ? 0.025 : 0.005;
                    ring1.visible = nAlt > groundH + 0.01;
                }
            });

            // Pins
            const livePins = pinsRef.current;
            const livePinIds = new Set(livePins.map(p => p.id));
            pinMeshMap.forEach((grp, id) => { if (!livePinIds.has(id)) { scene.remove(grp); pinMeshMap.delete(id); } });
            livePins.forEach(pin => {
                const grp = ensurePin(pin);
                const bh = (heightMap[pin.y]?.[pin.x] ?? 0) * H_SCALE;
                const bob = Math.sin(t * 2.0) * 0.04;
                (grp.children[0] as THREE.Mesh).position.y = bh + UNIT * 0.5 + bob;
                (grp.children[1] as THREE.Mesh).position.y = bh + UNIT + bob;
            });

            // Heatmap & Scanned
            const liveGrid = gridRef.current;
            for (let gy = 0; gy < GRID_H; gy++) {
                for (let gx = 0; gx < GRID_W; gx++) {
                    const idx = gy * GRID_W + gx;
                    const cell = liveGrid[gy]?.[gx];
                    if (!cell) continue;

                    const prob = getSectorProbabilityRef.current(gx, gy);
                    
                    // Heatmap plane update - sync with 2D visibility (only if scanned)
                    const hPlane = heatmapPlanes[idx];
                    if (hPlane) { 
                        const mat = hPlane.material as THREE.MeshBasicMaterial;
                        // Slightly brighter burgundy #aa2828
                        mat.color.setHex(0xaa2828);
                        if (cell.scanned) {
                            mat.opacity = prob * 0.6; 
                        } else {
                            mat.opacity = 0;
                        }
                    }

                    // Scanned Glow (Subtle cyan footprint)
                    const sPlane = scannedPlanes[idx];
                    if (sPlane) { 
                        const mat = sPlane.material as THREE.MeshBasicMaterial;
                        mat.opacity = cell.scanned ? 0.05 : 0; 
                    }

                    // Building Glow (New) - sync with 2D visibility (only if scanned)
                    const bMesh = buildingMeshMap.get(`${gx}-${gy}`);
                    if (bMesh) {
                        const bMat = bMesh.material as THREE.MeshStandardMaterial;
                        if (cell.scanned) {
                            // Slightly brighter burgundy glow on opaque building
                            bMat.emissiveIntensity = prob * 1.2;
                        } else {
                            bMat.emissiveIntensity = 0;
                        }
                    }
                }
            }

            // Search Area
            const liveSearchArea = searchAreaRef.current;
            if (liveSearchArea.length >= 3) {
                if (!searchBoundary) { searchBoundary = new THREE.LineLoop(new THREE.BufferGeometry(), searchLineMat); scene.add(searchBoundary); }
                const pts = liveSearchArea.map(p => { const w = gw(p.x, p.y); return new THREE.Vector3(w.x, 0.1, w.z); });
                searchBoundary.geometry.setFromPoints(pts);
                searchBoundary.visible = true;
                searchLineMat.opacity = searchScanActiveRef.current ? 0.8 + 0.2 * Math.sin(t * 5) : 0.6;
            } else if (searchBoundary) { searchBoundary.visible = false; }

            // ── Raycasting for hover ──────────────────────────────────────────
            if (!isDraggingRef.current) {
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObject(groundPlane);
                if (intersects.length > 0) {
                    const pt = intersects[0].point;
                    const gx_h = Math.floor((pt.x / UNIT) + (GRID_W / 2));
                    const gy_h = Math.floor((pt.z / UNIT) + (GRID_H / 2));
                    if (gx_h >= 0 && gx_h < GRID_W && gy_h >= 0 && gy_h < GRID_H) {
                        if (!hoverRef.current || hoverRef.current.x !== gx_h || hoverRef.current.y !== gy_h) {
                            hoverRef.current = { x: gx_h, y: gy_h };
                            const sector = liveGrid[gy_h]?.[gx_h];
                            if (sector) setHoverInfo({ x: gx_h, y: gy_h, sector });
                        }
                    } else if (hoverRef.current) { hoverRef.current = null; setHoverInfo(null); }
                } else if (hoverRef.current) { hoverRef.current = null; setHoverInfo(null); }
            } else {
                // If dragging, hide HUD for clarity
                if (hoverRef.current) {
                    hoverRef.current = null;
                    setHoverInfo(null);
                }
            }

            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Resize
        const onMouseMove = (e: MouseEvent) => {
            const rect = parent.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };
        parent.addEventListener('mousemove', onMouseMove);

        const ro = new ResizeObserver(() => {
            const w = parent.clientWidth, h = parent.clientHeight;
            if (w && h) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
        });
        ro.observe(parent);

        return () => {
            parent.removeEventListener('mousemove', onMouseMove);
            ro.disconnect();
            cancelAnimationFrame(raf);
            renderer.dispose();
        };
    }, [heightMap, maxH]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            {hoverInfo && (
                <div style={{
                    position: 'absolute', top: 10, right: 10,
                    background: 'rgba(2, 9, 18, 0.9)', border: '1px solid var(--accent-primary)',
                    padding: '10px', borderRadius: '4px', fontFamily: 'monospace',
                    fontSize: '0.7rem', color: 'var(--accent-primary)', pointerEvents: 'none',
                    boxShadow: '0 0 15px rgba(0, 255, 204, 0.2)', zIndex: 100, minWidth: '140px'
                }}>
                    <div style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', marginBottom: '6px', paddingBottom: '4px', fontWeight: 'bold' }}>CELL [{hoverInfo.x}, {hoverInfo.y}]</div>
                    <div>PROBABILITY: {(getSectorProbabilityRef.current(hoverInfo.x, hoverInfo.y) * 100).toFixed(1)}%</div>
                    <div>SCANNED: {hoverInfo.sector.scanned ? 'YES' : 'NO'}</div>
                    <div style={{ marginTop: '6px', color: '#888' }}>SENSORS:</div>
                    <div style={{ color: '#00ffcc' }}>MOBILE: {hoverInfo.sector.signals.mobile.toFixed(2)}</div>
                    <div style={{ color: '#ff4444' }}>THERMAL: {hoverInfo.sector.signals.thermal.toFixed(2)}</div>
                    <div style={{ color: '#ffff00' }}>SOUND: {hoverInfo.sector.signals.sound.toFixed(2)}</div>
                    <div style={{ color: '#ff00ff' }}>WIFI: {hoverInfo.sector.signals.wifi.toFixed(2)}</div>
                </div>
            )}
        </div>
    );
};
