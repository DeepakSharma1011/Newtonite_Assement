import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('newtonite_user');
    return stored ? JSON.parse(stored) : null;
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem('newtonite_token');
  });

  const loginUser = useCallback((userData, tokenStr) => {
    setUser(userData);
    setToken(tokenStr);
    localStorage.setItem('newtonite_user', JSON.stringify(userData));
    localStorage.setItem('newtonite_token', tokenStr);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('newtonite_user');
    localStorage.removeItem('newtonite_token');
  }, []);

  const isLoggedIn = !!token && !!user;

  // Check if user has a specific role in a team
  const hasRole = useCallback((teamId, minRole) => {
    if (!user?.memberships) return false;
    const hierarchy = { viewer: 0, member: 1, lead: 2, admin: 3 };
    const membership = user.memberships.find(m => m.team_id === teamId);
    if (!membership) return false;
    return (hierarchy[membership.role] ?? -1) >= (hierarchy[minRole] ?? 999);
  }, [user]);

  const getUserRole = useCallback((teamId) => {
    if (!user?.memberships) return null;
    const membership = user.memberships.find(m => m.team_id === teamId);
    return membership?.role || null;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, isLoggedIn, loginUser, logout, hasRole, getUserRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
