import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import EmptyState from '../components/EmptyState.jsx';
import { formatTime } from '../service/format.js';
import { useAsync } from '../hooks/useAsync.js';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [passwordDrafts, setPasswordDrafts] = useState({});
  const { loading, run } = useAsync();

  const refresh = async () => {
    const data = await api.listAdminUsers();
    setUsers(data.users);
  };

  useEffect(() => {
    refresh();
  }, []);

  const createUser = () => run(async () => {
    await api.createAdminUser(form);
    setForm({ username: '', password: '', role: 'user' });
    await refresh();
  }, '用户已创建');

  const resetPassword = (user) => run(async () => {
    await api.updateAdminUserPassword(user.id, passwordDrafts[user.id]);
    setPasswordDrafts((prev) => ({ ...prev, [user.id]: '' }));
    await refresh();
  }, '密码已重置');

  const toggleActive = (user) => run(async () => {
    await api.setAdminUserActive(user.id, !user.is_active);
    await refresh();
  }, user.is_active ? '用户已停用' : '用户已启用');

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>用户管理</h1>
          <p>管理员可以创建普通用户、重置密码和停用账号。</p>
        </div>
      </header>

      <section className="panel">
        <div className="inline-form wide">
          <label>
            账号
            <input value={form.username} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} />
          </label>
          <label>
            初始密码
            <input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          </label>
          <label>
            角色
            <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button className="btn-primary" disabled={loading || !form.username || !form.password} onClick={createUser}>新增用户</button>
        </div>
      </section>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>最近登录</th>
              <th>重置密码</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan="6"><EmptyState /></td></tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.role === 'admin' ? '管理员' : '普通用户'}</td>
                <td>{user.is_active ? <span className="badge success">启用</span> : <span className="badge warning">停用</span>}</td>
                <td>{formatTime(user.last_login_at)}</td>
                <td>
                  <div className="inline-edit">
                    <input
                      type="password"
                      placeholder="新密码"
                      value={passwordDrafts[user.id] || ''}
                      onChange={(event) => setPasswordDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                    />
                    <button disabled={!passwordDrafts[user.id]} onClick={() => resetPassword(user)}>保存</button>
                  </div>
                </td>
                <td className="row-actions">
                  <button className={user.is_active ? 'text-warning' : ''} onClick={() => toggleActive(user)}>
                    {user.is_active ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
