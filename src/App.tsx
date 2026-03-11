import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import MapSimulator from './pages/MapSimulator';
import ProbabilityMap3D from './pages/3DMap';
import SimulationMap from './pages/SimulationMap';
import RoutingSandbox from './pages/RoutingSandbox';
import SimulationMapDuplicate from './pages/SimulationMapDuplicate';
import DroneCam from './pages/DroneCam';
import LoadingScreen from './components/LoadingScreen';

const pages = [
  { path: '/dashboard', element: <Dashboard /> },
  { path: '/map', element: <MapSimulator /> },
  { path: '/3d-map', element: <ProbabilityMap3D /> },
  { path: '/simulation', element: <SimulationMap /> },
  { path: '/routing', element: <RoutingSandbox /> },
  { path: '/simulation-duplicate', element: <SimulationMapDuplicate /> },
  { path: '/drone-cam', element: <DroneCam /> },
];

function PersistentPages() {
  const location = useLocation();
  const currentPath = location.pathname;
  const visitedRef = useRef<Set<string>>(new Set());

  // Track which pages have been visited so we mount them lazily but keep them alive
  visitedRef.current.add(currentPath);

  return (
    <>
      {pages.map(({ path, element }) => {
        const isActive = currentPath === path;
        const hasVisited = visitedRef.current.has(path);
        if (!hasVisited) return null;
        return (
          <div
            key={path}
            style={{
              display: isActive ? 'block' : 'none',
              width: '100%',
              height: '100%',
            }}
          >
            {element}
          </div>
        );
      })}
    </>
  );
}

function App() {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <Router>
      {isLoading && <LoadingScreen onComplete={() => setIsLoading(false)} />}

      <div style={{ display: 'flex', width: '100%', height: '100%', opacity: isLoading ? 0 : 1, transition: 'opacity 0.5s ease-in' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
          <div className="scanline-overlay"></div>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<PersistentPages />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
