import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Demo, CAPABILITY_TAGS } from '../types';
import { api } from '../services/api';

const EMPTY_DEMO: Partial<Demo> = {
  title: '',
  description: '',
  demoUrl: '',
  thumbnailUrl: '',
  tags: [],
  launchMode: 'sameTab',
  isActive: true,
  sortOrder: 0,
  owner: '',
};

const DemoForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [form, setForm] = useState<Partial<Demo>>(EMPTY_DEMO);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      api.getDemo(id)
        .then((demo) => setForm(demo))
        .catch((err) => setError(err.message));
    }
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else if (type === 'number') {
      setForm((prev) => ({ ...prev, [name]: parseInt(value, 10) || 0 }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const toggleTag = (tag: string) => {
    setForm((prev) => {
      const tags = prev.tags || [];
      return {
        ...prev,
        tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEditing && id) {
        await api.updateDemo(id, form);
      } else {
        await api.createDemo(form);
      }
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>{isEditing ? 'Edit Demo' : 'Add Demo'}</h2>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title">Title *</label>
          <input id="title" name="title" value={form.title || ''} onChange={handleChange} required />
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" value={form.description || ''} onChange={handleChange} />
        </div>

        <div className="form-group">
          <label htmlFor="demoUrl">Demo URL *</label>
          <input id="demoUrl" name="demoUrl" type="url" value={form.demoUrl || ''} onChange={handleChange} required />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="thumbnailUrl">Thumbnail URL</label>
            <input id="thumbnailUrl" name="thumbnailUrl" value={form.thumbnailUrl || ''} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="healthCheckUrl">Health Check URL</label>
            <input id="healthCheckUrl" name="healthCheckUrl" value={form.healthCheckUrl || ''} onChange={handleChange} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="launchMode">Launch Mode</label>
            <select id="launchMode" name="launchMode" value={form.launchMode || 'sameTab'} onChange={handleChange}>
              <option value="sameTab">Same Tab</option>
              <option value="newTab">New Tab</option>
              <option value="iframe">iFrame</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sortOrder">Sort Order</label>
            <input id="sortOrder" name="sortOrder" type="number" value={form.sortOrder || 0} onChange={handleChange} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="owner">Owner</label>
          <input id="owner" name="owner" value={form.owner || ''} onChange={handleChange} />
        </div>

        <div className="form-group">
          <label>Capability Tags</label>
          <div className="tag-chips">
            {CAPABILITY_TAGS.map((tag) => (
              <span
                key={tag}
                className={`tag-chip ${(form.tags || []).includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTag(tag); }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="isActive"
              checked={form.isActive ?? true}
              onChange={handleChange}
              style={{ marginRight: 8 }}
            />
            Active
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Update Demo' : 'Create Demo'}
          </button>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default DemoForm;
