import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Capability, CAPABILITIES } from '../types';
import './CapabilitiesScreen.css';

/* Simple SVG icons for each capability */
const icons: Record<Capability, React.ReactNode> = {
  Speech: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  Vision: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Language: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Decision: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" />
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="12" y1="8" x2="6" y2="16" />
      <line x1="12" y1="8" x2="18" y2="16" />
    </svg>
  ),
  Agentic: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="9" cy="16" r="1.5" fill="currentColor" />
      <circle cx="15" cy="16" r="1.5" fill="currentColor" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
};

const CapabilitiesScreen: React.FC = () => {
  const navigate = useNavigate();

  const handleReset = () => {
    // Clear + stay on current screen (no-op for now — future: clear filters)
  };

  const handleClose = () => {
    navigate('/');
  };

  return (
    <div className="capabilities-screen">
      <div className="capabilities-header">
        <div className="capabilities-header-spacer" />
        <div className="capabilities-header-controls">
          <button className="header-btn" onClick={handleReset} type="button" aria-label="Reset">
            Reset
          </button>
          <button className="header-btn header-btn-close" onClick={handleClose} type="button" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="capabilities-content kiosk-container">
        <h1 className="capabilities-title">AI Capabilities</h1>
        <p className="capabilities-subtitle">Select a category to explore scenarios</p>

        <div className="capabilities-list">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap}
              className="capability-card"
              onClick={() => navigate(`/capabilities/${cap.toLowerCase()}`)}
              type="button"
            >
              <span className="capability-icon">{icons[cap]}</span>
              <span className="capability-label">{cap}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CapabilitiesScreen;
