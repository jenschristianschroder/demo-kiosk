import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Demo } from '../types';
import { getDemos } from '../services/api';
import './CategoryDemosScreen.css';

const CategoryDemosScreen: React.FC = () => {
  const { capability } = useParams<{ capability: string }>();
  const navigate = useNavigate();
  const [demos, setDemos] = useState<Demo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const capLabel = capability
    ? capability.charAt(0).toUpperCase() + capability.slice(1)
    : '';

  useEffect(() => {
    if (!capability) return;
    setLoading(true);
    getDemos(capLabel)
      .then((data) => {
        setDemos(data);
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to fetch demos:', err);
        setError('Unable to load demos. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [capability, capLabel]);

  const handleLaunch = (demo: Demo) => {
    switch (demo.launchMode) {
      case 'newTab':
        window.open(demo.demoUrl, '_blank', 'noopener,noreferrer');
        break;
      case 'sameTab':
      default:
        window.location.href = demo.demoUrl;
        break;
    }
  };

  return (
    <div className="category-screen">
      <div className="category-nav">
        <button className="nav-btn" onClick={() => navigate('/capabilities')} type="button">
          ← Back
        </button>
        <button className="nav-btn" onClick={() => navigate('/')} type="button">
          Home
        </button>
      </div>

      <div className="category-content kiosk-container">
        <h1 className="category-title">{capLabel}</h1>
        <p className="category-subtitle">Demos tagged with {capLabel}</p>

        {loading && <p className="category-status">Loading demos…</p>}
        {error && <p className="category-status category-error">{error}</p>}

        {!loading && !error && demos.length === 0 && (
          <p className="category-status">No demos available for this category.</p>
        )}

        <div className="demos-grid">
          {demos.map((demo) => (
            <button
              key={demo.id}
              className="demo-card"
              onClick={() => handleLaunch(demo)}
              type="button"
            >
              {demo.thumbnailUrl && (
                <div className="demo-thumb">
                  <img
                    src={demo.thumbnailUrl}
                    alt=""
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
              <div className="demo-info">
                <span className="demo-title">{demo.title}</span>
                <span className="demo-desc">{demo.description}</span>
              </div>
              <span className="demo-launch-hint">
                {demo.launchMode === 'newTab' ? 'Opens in new tab ↗' : 'Launch →'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryDemosScreen;
