import React from 'react';
import { useNavigate } from 'react-router-dom';
import './WelcomeScreen.css';

const WelcomeScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        {/* Simple placeholder icon */}
        <div className="welcome-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" stroke="#111" strokeWidth="2" />
            <circle cx="24" cy="24" r="8" fill="#111" />
          </svg>
        </div>

        <h1 className="welcome-title">Explore AI</h1>
        <p className="welcome-subtitle">
          Experience live demonstrations of AI in action!
        </p>

        <button
          className="welcome-cta"
          onClick={() => navigate('/capabilities')}
          type="button"
        >
          How do errors happen?
        </button>
      </div>

      <footer className="welcome-footer">
        Microsoft Innovation Hub Denmark
      </footer>
    </div>
  );
};

export default WelcomeScreen;
