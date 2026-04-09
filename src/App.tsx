import { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import MapSimulator from './pages/MapSimulator';
import ProbabilityMap3D from './pages/3DMap';
import SimulationMapMCP from './pages/SimulationMapMCP';
import Analytics from './pages/Analytics';
import DroneCam from './pages/DroneCam';
import LoadingScreen from './components/LoadingScreen';
import { clearOrchestratorRecords } from './services/mcpClient';
import { SimulationProvider } from './context/SimulationContext';

const pages = [
  { path: '/dashboard', element: <Dashboard /> },
  { path: '/analytics', element: <Analytics /> },
  { path: '/3d-map', element: <ProbabilityMap3D /> },
  { path: '/map', element: <MapSimulator /> },
  { path: '/simulation-mcp', element: <SimulationMapMCP /> },
  { path: '/drone-cam', element: <DroneCam /> },
];

function PersistentPages() {
  const location = useLocation();
  const currentPath = location.pathname;
  const visitedRef = useRef<Set<string>>(new Set(['/simulation-mcp']));

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

  useEffect(() => {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navEntry?.type === 'reload') {
      void clearOrchestratorRecords();
    }
  }, []);

  return (
    <Router>
      {isLoading && <LoadingScreen onComplete={() => setIsLoading(false)} />}

      <SimulationProvider>
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
      </SimulationProvider>
    </Router>
  );
}

export default App;
