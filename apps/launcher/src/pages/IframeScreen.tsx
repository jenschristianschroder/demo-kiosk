import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Demo } from '../types';
import { getDemo } from '../services/api';
import './IframeScreen.css';

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const IframeScreen: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const demoId = searchParams.get('demoId');

  const [demo, setDemo] = useState<Demo | null>(null);
  const [loading, setLoading] = useState(Boolean(demoId));
  const [error, setError] = useState<string | null>(
    demoId ? null : 'No demo ID provided.'
  );

  useEffect(() => {
    if (!demoId) return;
    getDemo(demoId)
      .then((d) => {
        if (!isAllowedUrl(d.demoUrl)) {
          setError('Demo URL is not a valid HTTP/HTTPS address.');
          return;
        }
        setDemo(d);
      })
      .catch((err) => {
        console.error('Failed to load demo:', err);
        setError('Unable to load demo. Please check that the demo exists and try again.');
      })
      .finally(() => setLoading(false));
  }, [demoId]);

  const title = demo?.title || 'Demo';

  return (
    <div className="iframe-screen">
      <div className="iframe-nav">
        <button className="nav-btn" onClick={() => navigate(-1)} type="button">
          ← Back
        </button>
        <span className="iframe-nav-title">{title}</span>
        <button className="nav-btn" onClick={() => navigate('/')} type="button">
          Home
        </button>
      </div>

      <div className="iframe-container">
        {loading && <div className="iframe-status">Loading demo…</div>}
        {error && <div className="iframe-error">{error}</div>}
        {demo && (
          <iframe
            src={demo.demoUrl}
            title={title}
            /* allow-same-origin is required so cross-origin demos can access
               their own cookies/storage. allow-popups lets demos open pop-up
               windows (e.g. OAuth flows, help dialogs). allow-popups-to-
               escape-sandbox ensures those pop-ups are not themselves
               sandboxed, which is needed for most auth callback flows.
               allow-downloads lets demos trigger file downloads.
               allow-forms is required for file uploads and form submissions. */
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms"
            allow="fullscreen; microphone"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  );
};

export default IframeScreen;
