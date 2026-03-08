import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import MapSimulator from './pages/MapSimulator';
import ProbabilityMap3D from './pages/3DMap';
import SimulationMap from './pages/SimulationMap';
import DroneCam from './pages/DroneCam';
import LoadingScreen from './components/LoadingScreen';

function App() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <Router>
      {isLoading && <LoadingScreen onComplete={() => setIsLoading(false)} />}

      {/* We keep the main app rendered but potentially hidden or underneath to pre-load assets if any, though React handles this well. 
          For a true cinematic feel, we'll just not show it if we wanted, but overlaying is smoother for the fade out. */}
      <div style={{ display: 'flex', width: '100%', height: '100%', opacity: isLoading ? 0 : 1, transition: 'opacity 0.5s ease-in' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
          <div className="scanline-overlay"></div>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/map" element={<MapSimulator />} />
            <Route path="/3d-map" element={<ProbabilityMap3D />} />
            <Route path="/simulation" element={<SimulationMap />} />
            <Route path="/drone-cam" element={<DroneCam />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
