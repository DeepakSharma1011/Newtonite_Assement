import { useState } from 'react';
import { login as apiLogin } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { loginUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiLogin(email, password);
      loginUser(data.user, data.token);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">
          ⚡ <span style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Newtonite</span>
        </h1>
        <p className="login-subtitle">Operations Under Pressure</p>

        {error && <div className="alert alert-error">⚠ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              placeholder="you@newtonite.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
            id="login-submit"
            style={{ marginTop: '8px' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-primary)' }}>
          <p className="text-sm text-muted" style={{ marginBottom: '8px', fontWeight: 600 }}>Demo Credentials</p>
          <p className="text-sm text-muted">All passwords: <code style={{ color: 'var(--accent-primary-hover)' }}>password123</code></p>
          <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            <span>alice@newtonite.io</span><span style={{ color: 'var(--text-secondary)' }}>admin</span>
            <span>bob@newtonite.io</span><span style={{ color: 'var(--text-secondary)' }}>lead</span>
            <span>carol@newtonite.io</span><span style={{ color: 'var(--text-secondary)' }}>member</span>
            <span>dave@newtonite.io</span><span style={{ color: 'var(--text-secondary)' }}>viewer</span>
          </div>
        </div>
      </div>
    </div>
  );
}
