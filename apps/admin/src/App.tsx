import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import DemoList from './pages/DemoList';
import DemoForm from './pages/DemoForm';
import Settings from './pages/Settings';

const App: React.FC = () => {
  return (
    <div className="admin-layout">
      <header className="admin-header">
        <h1>Kiosk Admin</h1>
        <nav className="admin-nav">
          <Link to="/">Demos</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<DemoList />} />
        <Route path="/demos/new" element={<DemoForm />} />
        <Route path="/demos/:id/edit" element={<DemoForm />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  );
};

export default App;
