import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './IframeScreen.css';

const IframeScreen: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const demoUrl = searchParams.get('url');
  const demoTitle = searchParams.get('title') || 'Demo';

  return (
    <div className="iframe-screen">
      <div className="iframe-nav">
        <button className="nav-btn" onClick={() => navigate(-1)} type="button">
          ← Back
        </button>
        <span className="iframe-nav-title">{demoTitle}</span>
        <button className="nav-btn" onClick={() => navigate('/')} type="button">
          Home
        </button>
      </div>

      <div className="iframe-container">
        {demoUrl ? (
          <iframe
            src={demoUrl}
            title={demoTitle}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="camera; microphone; fullscreen"
          />
        ) : (
          <div className="iframe-error">No demo URL provided.</div>
        )}
      </div>
    </div>
  );
};

export default IframeScreen;
