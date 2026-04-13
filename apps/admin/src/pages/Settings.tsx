import React, { useEffect, useState } from 'react';
import { KioskSettings } from '../types';
import { api } from '../services/api';

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<KioskSettings>({ idleTimeoutSeconds: 60, featuredDemoIds: [] });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, []);

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

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
};

export default Settings;
