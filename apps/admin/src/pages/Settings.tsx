import React, { useEffect, useState } from 'react';
import { Demo, KioskSettings } from '../types';
import { api } from '../services/api';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<KioskSettings>({ idleTimeoutSeconds: 60, featuredDemoIds: [] });
  const [demos, setDemos] = useState<Demo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch((err) => setError(err.message));
    api.getDemos()
      .then(setDemos)
      .catch((err) => setError(err.message));
  }, []);

  const toggleFeatured = (demoId: string) => {
    setSettings((s) => {
      const ids = s.featuredDemoIds;
      return {
        ...s,
        featuredDemoIds: ids.includes(demoId)
          ? ids.filter((id) => id !== demoId)
          : [...ids, demoId],
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>Kiosk Settings</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">Settings saved successfully.</div>}

      <form onSubmit={handleSave}>
        <div className="form-group">
          <label htmlFor="idleTimeoutSeconds">Idle Timeout (seconds)</label>
          <input
            id="idleTimeoutSeconds"
            type="number"
            min={10}
            max={600}
            value={settings.idleTimeoutSeconds}
            onChange={(e) => setSettings((s) => ({ ...s, idleTimeoutSeconds: parseInt(e.target.value, 10) || 60 }))}
          />
          <small style={{ color: '#888', display: 'block', marginTop: 4 }}>
            The kiosk returns to the welcome screen after this many seconds of inactivity.
          </small>
        </div>

        <div className="form-group">
          <label>Featured Demos</label>
          <small style={{ color: '#888', display: 'block', marginBottom: 8 }}>
            Select demos to highlight on the kiosk home screen.
          </small>
          {demos.length === 0 && <p style={{ color: '#888' }}>No demos available.</p>}
          {demos.map((demo) => (
            <label key={demo.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.featuredDemoIds.includes(demo.id)}
                onChange={() => toggleFeatured(demo.id)}
              />
              {demo.title}
              {!demo.isActive && <span style={{ color: '#888', fontSize: '0.85em' }}>(inactive)</span>}
            </label>
          ))}
        </div>

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
};

export default Settings;
