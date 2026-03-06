import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

// UTM Johor Bahru, Malaysia
const MAP_CENTER = { longitude: 103.6384, latitude: 1.5583 };

// Helper for normally-distributed math (Box-Muller transform)
const randomGaussian = (mean = 0, stdev = 1) => {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
};

// Generate mock data for survivor probability (people distribution)
const generateMockData = () => {
    const data = [];

    // Core areas in UTM JB to center the hotspots around (approximate)
    const hotspots = [
        { lon: 103.6384, lat: 1.5583, weight: 1.0, count: 2000, spread: 0.002 }, // Main Campus / Library area
        { lon: 103.6420, lat: 1.5620, weight: 0.8, count: 1200, spread: 0.0015 }, // Northern Faculty blocks
        { lon: 103.6340, lat: 1.5650, weight: 0.9, count: 1500, spread: 0.002 }, // KDSE/KRP Hostels
        { lon: 103.6450, lat: 1.5530, weight: 0.6, count: 800, spread: 0.001 },  // Southern Engineering
        { lon: 103.6320, lat: 1.5520, weight: 0.7, count: 1000, spread: 0.0018 }  // Western sports/admin
    ];

    // Generate clustered data
    hotspots.forEach(spot => {
        for (let i = 0; i < spot.count; i++) {
            data.push({
                position: [
                    randomGaussian(spot.lon, spot.spread),
                    randomGaussian(spot.lat, spot.spread)
                ],
                // Closer to center = slightly higher potential weight
                weight: Math.random() * spot.weight
            });
        }
    });

    // Add some uniform sparse background noise across the whole campus area
    const bgCount = 1000;
    const bgRadius = 0.012;
    for (let i = 0; i < bgCount; i++) {
        data.push({
            position: [
                MAP_CENTER.longitude + (Math.random() - 0.5) * bgRadius * 2,
                MAP_CENTER.latitude + (Math.random() - 0.5) * bgRadius * 2
            ],
            weight: Math.random() * 0.2
        });
    }

    return data;
};

const ProbabilityMap3D: React.FC = () => {
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        setData(generateMockData());
    }, []);

    const INITIAL_VIEW_STATE = {
        longitude: MAP_CENTER.longitude,
        latitude: MAP_CENTER.latitude,
        zoom: 13,
        maxZoom: 18,
        pitch: 0, // Flat 2D layout mimicking user screenshot
        bearing: 0,
    };

    const layers = [
        new HeatmapLayer({
            id: 'probability-ground-heatmap',
            data,
            pickable: false,
            getPosition: (d: any) => d.position,
            getWeight: (d: any) => d.weight,
            radiusPixels: 45, // Tighter radius so clusters don't merge into a giant square
            intensity: 2.0,
            threshold: 0.08,
            colorRange: [
                [0, 0, 255, 0],         // Transparent blue for base
                [0, 0, 255, 120],       // Blue
                [0, 255, 0, 160],       // Green
                [255, 255, 0, 200],     // Yellow
                [255, 165, 0, 230],     // Orange
                [255, 0, 0, 255]        // Red peak
            ]
        })
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
            <header style={{ padding: '24px', paddingBottom: 0 }}>
                <h2 className="hud-text glow-text" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }}>SURVIVOR HEATMAP</h2>
                <p className="hud-text" style={{ color: 'var(--text-secondary)' }}>&gt; SURVIVOR DENSITY & PREDICTION</p>
            </header>

            <div style={{ flex: 1, position: 'relative', margin: '0 24px 24px 24px', border: '1px solid var(--panel-border)', overflow: 'hidden' }} className="hud-panel">
                <DeckGL
                    layers={layers}
                    initialViewState={INITIAL_VIEW_STATE}
                    controller={true}
                >
                    {/* CARTO Dark Matter Raster Tiles */}
                    <Map
                        mapStyle={{
                            version: 8,
                            sources: {
                                'carto-dark': {
                                    type: 'raster',
                                    tiles: [
                                        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                                        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                                    ],
                                    tileSize: 256,
                                    attribution: '&copy; OpenStreetMap Contributors &copy; CARTO'
                                }
                            },
                            layers: [
                                {
                                    id: 'carto-dark-tiles',
                                    type: 'raster',
                                    source: 'carto-dark',
                                    minzoom: 0,
                                    maxzoom: 19
                                }
                            ]
                        }}
                        reuseMaps
                    />
                </DeckGL>

                {/* Legend Overlay */}
                <div style={{ position: 'absolute', bottom: 24, left: 24, background: 'var(--panel-bg)', padding: '16px', border: '1px solid var(--panel-border)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h4 className="hud-text" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>PROBABILITY DENSITY</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(128, 0, 128)' }}></div>
                        Critical (Highest)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(255, 0, 0)' }}></div>
                        High
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(255, 255, 0)' }}></div>
                        Medium
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        <div style={{ width: 16, height: 16, background: 'rgb(0, 255, 0)' }}></div>
                        Low
                    </div>
                </div>

                <div style={{ position: 'absolute', top: 24, right: 24, padding: '12px', background: 'rgba(0, 255, 204, 0.1)', border: '1px dashed var(--accent-primary)', backdropFilter: 'blur(4px)' }}>
                    <div style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                        <span className="animate-pulse" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)', marginRight: 8 }}></span>
                        LIVE DATA FEED: ACTIVE
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProbabilityMap3D;
