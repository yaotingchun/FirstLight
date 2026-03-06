import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import MapSimulator from './pages/MapSimulator';
import ProbabilityMap3D from './pages/3DMap';
import SimulationMap from './pages/SimulationMap';

function App() {
  return (
    <Router>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
          <div className="scanline-overlay"></div>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/map" element={<MapSimulator />} />
            <Route path="/3d-map" element={<ProbabilityMap3D />} />
            <Route path="/simulation" element={<SimulationMap />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
