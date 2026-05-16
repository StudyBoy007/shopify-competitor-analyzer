import { useEffect, useState } from 'react';
import { api, clearAuthToken, getAuthToken, setAuthToken } from '../api/client.js';
import { useAppContext } from '../store/AppContext.jsx';

export default function AuthGate({ children }) {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(Boolean(getAuthToken()));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setCurrentUser } = useAppContext();

  useEffect(() => {
    const savedToken = getAuthToken();
    if (!savedToken) {
      setChecking(false);
      return;
    }

    api.me()
      .then((data) => {
        setCurrentUser(data.user);
        setAuthorized(true);
      })
      .catch(() => {
        clearAuthToken();
        setAuthorized(false);
      })
      .finally(() => setChecking(false));
  }, [setCurrentUser]);

  const login = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login({ username, password });
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setAuthorized(true);
    } catch (err) {
      clearAuthToken();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>正在验证访问权限</h1>
          <p>请稍候...</p>
        </div>
      </div>
    );
  }

  if (authorized) {
    return children;
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={login}>
        <h1>访问竞品分析平台</h1>
        <p>请输入管理员分配的账号和密码。</p>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="账号"
          autoFocus
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="访问密码"
        />
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="btn-primary" disabled={!username || !password || loading}>
          {loading ? '验证中...' : '进入系统'}
        </button>
      </form>
    </div>
  );
}
