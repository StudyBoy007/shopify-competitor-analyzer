import { NavLink, Outlet } from 'react-router-dom';
import { clearAuthToken } from '../api/client.js';
import { useAppContext } from '../store/AppContext.jsx';
import ProcessingStatus from './ProcessingStatus.jsx';

const navItems = [
  { to: '/', label: '数据看板' },
  { to: '/sites', label: '站点管理' },
  { to: '/products', label: '商品列表' },
  { to: '/relations', label: '竞品关系' },
  { to: '/reports', label: '分析报告' },
  { to: '/admin/users', label: '用户管理', adminOnly: true },
  { to: '/admin/settings', label: '系统配置', adminOnly: true },
];

export default function Layout() {
  const { notification, globalLoading, globalLoadingMessage, currentUser, setCurrentUser } = useAppContext();

  const logout = () => {
    clearAuthToken();
    setCurrentUser(null);
    window.location.reload();
  };

  return (
    <div className="app-layout">
      {notification && <div className={`notification toast-${notification.type}`}>{notification.message}</div>}
      <aside className="sidebar">
        <div className="logo">竞品分析平台</div>
        <nav className="nav-menu">
          {navItems.filter((item) => !item.adminOnly || currentUser?.role === 'admin').map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ProcessingStatus active={globalLoading} message={globalLoadingMessage} />
          <div className="sidebar-user">{currentUser?.username} · {currentUser?.role === 'admin' ? '管理员' : '普通用户'}</div>
          <button className="sidebar-logout" onClick={logout}>退出登录</button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
