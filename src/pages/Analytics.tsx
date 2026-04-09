import React, { useMemo } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { BarChart2, TrendingUp, Activity, Clock, AlertCircle } from 'lucide-react';
import CyberPanel from '../components/CyberPanel';
import performanceData from '../assets/performance_analytics.json';

const Analytics: React.FC = () => {
    // Helper to calculate linear regression trend line
    const getTrendData = (data: { x: number, y: number }[]) => {
        if (data.length === 0) return [];
        const n = data.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        data.forEach(p => {
            sumX += p.x;
            sumY += p.y;
            sumXY += p.x * p.y;
            sumXX += p.x * p.x;
        });
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Return 50 points following the trend
        return data.map(p => ({
            id: p.x,
            trend: slope * p.x + intercept
        }));
    };

    // Extract summary metrics from the specialized first two rows
    const stats = useMemo(() => {
        const meanRow = performanceData[0] as any;
        const sdRow = performanceData[1] as any;
        
        return {
            searchDurationMean: meanRow['Search_Duration(mm:ss)_1'],
            searchDurationSD: sdRow['Search_Duration(mm:ss)_1'],
            repeatRateMean: meanRow['Repeat_Rate(%)_1'],
            repeatRateSD: sdRow['Repeat_Rate(%)_1'],
            totalTests: performanceData.length
        };
    }, []);

    // Map data for the chart (JSON is already sliced to 50 and converted to minutes)
    const chartData = useMemo(() => {
        return performanceData.map((d: any) => ({
            id: d.Test_ID,
            duration: d['Search_Duration(mm:ss)'],
            repeatRate: d['Repeat_Rate(%)'] * 100
        }));
    }, []);

    const trendDuration = useMemo(() => 
        getTrendData(chartData.map(d => ({ x: d.id, y: d.duration }))), 
    [chartData]);

    const trendRepeat = useMemo(() => 
        getTrendData(chartData.map(d => ({ x: d.id, y: d.repeatRate }))), 
    [chartData]);

    // Merge trend into chart data for ComposedChart/multi-item charts
    const fullData = useMemo(() => {
        return chartData.map((d, i) => ({
            ...d,
            trendDuration: trendDuration[i]?.trend,
            trendRepeat: trendRepeat[i]?.trend
        }));
    }, [chartData, trendDuration, trendRepeat]);

    const formatMinutes = (value: number) => {
        return value.toFixed(2);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#020608', height: '100%', minHeight: 0, padding: '24px 20px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
            {/* Header */}
            <header style={{ borderBottom: '1px solid rgba(0, 255, 204, 0.3)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexShrink: 0 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: '#00ffcc', letterSpacing: '3px', textTransform: 'uppercase', fontFamily: 'monospace', textShadow: '0 0 10px rgba(0, 255, 204, 0.4)' }}>
                        PERFORMANCE ANALYTICS
                    </h2>
                    <div style={{ color: '#6b8a8b', letterSpacing: '1px', fontSize: '0.75rem', marginTop: '6px', fontFamily: 'monospace' }}>
                        [SYSTEM PERFORMANCE EVALUATION]
                    </div>
                </div>
                <div style={{ color: '#00ffcc', fontSize: '0.85rem', opacity: 0.8, fontFamily: 'monospace' }}>
                    DATA_SOURCE: PERFORMANCE_ANALYTICS.XLSX
                </div>
            </header>

            {/* Stats Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px', flexShrink: 0 }}>
                <CyberPanel title="SEARCH DURATION (MEAN)" icon={<Clock size={16} />} color="#00ffcc">
                    <div style={{ padding: '8px 0' }}>
                        <div style={{ fontSize: '1.8rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>
                            {formatMinutes(stats.searchDurationMean)} <span style={{ fontSize: '0.8rem', color: '#6b8a8b' }}>min</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b8a8b', marginTop: '4px' }}>AVERAGE RESPONSE TIME</div>
                    </div>
                </CyberPanel>

                <CyberPanel title="SEARCH DURATION (SD)" icon={<AlertCircle size={16} />} color="#ff9900">
                    <div style={{ padding: '8px 0' }}>
                        <div style={{ fontSize: '1.8rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>
                             ± {formatMinutes(stats.searchDurationSD)} <span style={{ fontSize: '0.8rem', color: '#6b8a8b' }}>min</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b8a8b', marginTop: '4px' }}>DEVIATION FROM MEAN</div>
                    </div>
                </CyberPanel>

                <CyberPanel title="REPEAT RATE (MEAN)" icon={<TrendingUp size={16} />} color="#4da3ff">
                    <div style={{ padding: '8px 0' }}>
                        <div style={{ fontSize: '1.8rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>
                            {(stats.repeatRateMean * 100).toFixed(2)}%
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b8a8b', marginTop: '4px' }}>AVG AREA RE-SCAN RATE</div>
                    </div>
                </CyberPanel>

                <CyberPanel title="TOTAL SAMPLES" icon={<Activity size={16} />} color="#fff">
                    <div style={{ padding: '8px 0' }}>
                        <div style={{ fontSize: '1.8rem', color: '#fff', fontWeight: 'bold', fontFamily: 'monospace' }}>
                            {stats.totalTests}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#6b8a8b', marginTop: '4px' }}>DATA POINTS ANALYZED</div>
                    </div>
                </CyberPanel>
            </div>

            {/* Main Content Area - Split Graphs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, minHeight: 0 }}>
                <CyberPanel title="SEARCH DURATION TRENDS" icon={<Clock size={16} />} flex={1}>
                    <div style={{ width: '100%', height: '100%', minHeight: '300px', padding: '10px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={fullData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorDuration" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#00ffcc" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#00ffcc" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis 
                                    dataKey="id" 
                                    stroke="#6b8a8b" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false}
                                />
                                <YAxis 
                                    stroke="#6b8a8b" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false}
                                    tickFormatter={(val) => val.toFixed(1)}
                                />
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'rgba(5, 12, 18, 0.9)', 
                                        border: '1px solid rgba(0, 255, 204, 0.2)',
                                        color: '#fff',
                                        fontSize: '11px'
                                    }}
                                    formatter={(val: any) => [`${parseFloat(val).toFixed(2)} min`, 'Duration']}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="duration" 
                                    name="Search Duration" 
                                    stroke="#00ffcc" 
                                    fillOpacity={1} 
                                    fill="url(#colorDuration)" 
                                    strokeWidth={2}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="trendDuration" 
                                    stroke="#00ffcc" 
                                    strokeDasharray="5 5" 
                                    dot={false} 
                                    strokeWidth={1.5}
                                    opacity={0.8}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </CyberPanel>

                <CyberPanel title="REPEAT RATE TRENDS" icon={<BarChart2 size={16} />} flex={1} color="#4da3ff">
                    <div style={{ width: '100%', height: '100%', minHeight: '300px', padding: '10px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={fullData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorRepeat" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#4da3ff" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#4da3ff" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis 
                                    dataKey="id" 
                                    stroke="#6b8a8b" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false}
                                />
                                <YAxis 
                                    stroke="#6b8a8b" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false}
                                    tickFormatter={(val) => `${val.toFixed(0)}%`}
                                />
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'rgba(5, 12, 18, 0.9)', 
                                        border: '1px solid rgba(0, 255, 204, 0.2)',
                                        color: '#fff',
                                        fontSize: '11px'
                                    }}
                                    formatter={(val: any) => [`${parseFloat(val).toFixed(2)}%`, 'Repeat Rate']}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="repeatRate" 
                                    name="Repeat Rate" 
                                    stroke="#4da3ff" 
                                    fillOpacity={1} 
                                    fill="url(#colorRepeat)" 
                                    strokeWidth={2}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="trendRepeat" 
                                    stroke="#4da3ff" 
                                    strokeDasharray="5 5" 
                                    dot={false} 
                                    strokeWidth={1.5}
                                    opacity={0.8}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </CyberPanel>
            </div>
        </div>
    );
};

export default Analytics;
