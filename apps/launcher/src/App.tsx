import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import WelcomeScreen from './pages/WelcomeScreen';
import CapabilitiesScreen from './pages/CapabilitiesScreen';
import CategoryDemosScreen from './pages/CategoryDemosScreen';
import IframeScreen from './pages/IframeScreen';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { getSettings } from './services/api';

const DEFAULT_IDLE_TIMEOUT = 60;

const getInitialTimeout = (): number => {
  const envTimeout = import.meta.env.VITE_IDLE_TIMEOUT;
  return envTimeout ? (parseInt(envTimeout, 10) || DEFAULT_IDLE_TIMEOUT) : DEFAULT_IDLE_TIMEOUT;
};

const App: React.FC = () => {
  const [idleTimeout, setIdleTimeout] = useState(getInitialTimeout);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        if (settings.idleTimeoutSeconds > 0) {
          setIdleTimeout(settings.idleTimeoutSeconds);
        }
      })
      .catch(() => {
        // API not available yet — use default/env
      });
  }, []);

  useIdleTimeout(idleTimeout);

  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/capabilities" element={<CapabilitiesScreen />} />
      <Route path="/capabilities/:capability" element={<CategoryDemosScreen />} />
      <Route path="/demo/iframe" element={<IframeScreen />} />
    </Routes>
  );
};

export default App;
