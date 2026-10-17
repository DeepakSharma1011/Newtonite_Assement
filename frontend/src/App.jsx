import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ItemsListPage from './pages/ItemsListPage';
import ItemDetailPage from './pages/ItemDetailPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const initials = user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('') || '?';

  // Determine primary role for display
  const primaryRole = user?.memberships?.reduce((best, m) => {
    const hierarchy = { viewer: 0, member: 1, lead: 2, admin: 3 };
    return (hierarchy[m.role] > hierarchy[best]) ? m.role : best;
  }, 'viewer') || 'user';

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            ⚡ <span>Newtonite</span>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="nav-section-title">Navigation</div>
          <NavLink
            to="/"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            end
            id="nav-dashboard"
          >
            📊 Dashboard
          </NavLink>
          <NavLink
            to="/items"
            className={() => `nav-link ${location.pathname.startsWith('/items') ? 'active' : ''}`}
            id="nav-items"
          >
            📋 Work Items
          </NavLink>

          <div className="nav-section-title" style={{ marginTop: '16px' }}>Quick Filters</div>
          <NavLink
            to="/items?assignee=me"
            className="nav-link"
          >
            👤 My Items
          </NavLink>
          <NavLink
            to="/items?priority=urgent"
            className="nav-link"
          >
            🔴 Urgent
          </NavLink>
          <NavLink
            to="/items?status=awaiting_approval"
            className="nav-link"
          >
            ⏳ Awaiting Approval
          </NavLink>
          <NavLink
            to="/items?status=open"
            className="nav-link"
          >
            🟢 Open
          </NavLink>
        </div>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{initials}</div>
            <div className="user-details">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{primaryRole}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={logout} id="logout-btn">
            Sign Out
          </button>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/items" element={<ItemsListPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function AppRouter() {
  const { isLoggedIn } = useAuth();

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
