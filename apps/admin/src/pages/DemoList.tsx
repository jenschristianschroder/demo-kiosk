import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Demo } from '../types';
import { api } from '../services/api';

const DemoList: React.FC = () => {
  const [demos, setDemos] = useState<Demo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadDemos = () => {
    api.getDemos()
      .then(setDemos)
      .catch((err) => setError(err.message));
  };

  useEffect(() => { loadDemos(); }, []);

  const handleToggle = async (demo: Demo) => {
    try {
      await api.patchDemo(demo.id, { isActive: !demo.isActive });
      loadDemos();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this demo?')) return;
    try {
      await api.deleteDemo(id);
      loadDemos();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Demos</h2>
        <Link to="/demos/new" className="btn btn-primary">+ Add Demo</Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Title</th>
            <th>Tags</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {demos.map((demo) => (
            <tr key={demo.id}>
              <td>{demo.sortOrder}</td>
              <td>
                <strong>{demo.title}</strong>
                <br />
                <small style={{ color: '#888' }}>{demo.description}</small>
              </td>
              <td>{demo.tags.join(', ')}</td>
              <td>{demo.launchMode}</td>
              <td>
                <span className={`status-badge ${demo.isActive ? 'active' : 'inactive'}`}>
                  {demo.isActive ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td>
                <div className="actions">
                  <Link to={`/demos/${demo.id}/edit`} className="btn btn-sm">Edit</Link>
                  <button className="btn btn-sm" onClick={() => handleToggle(demo)}>
                    {demo.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(demo.id)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {demos.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>No demos found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DemoList;
