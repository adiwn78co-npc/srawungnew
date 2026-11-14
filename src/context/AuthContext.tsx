import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types/index.js';
import { api, setActiveUser, setAuthToken, getAuthToken } from '../lib/api.js';

const AUTH_SESSION_STORAGE_KEY = 'wijna_authenticated_session_v1';

interface AuthContextType {
  currentUser: User | null;
  allUsers: User[];
  loading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  loginAsTestRole: (userId: string) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<User>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
  isDirector: boolean;
  isFinance: boolean;
  isProgramManager: boolean;
  isMeal: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isSystemAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return Boolean(getAuthToken()) && localStorage.getItem(AUTH_SESSION_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const fetchUsersAndCurrent = async () => {
    const token = getAuthToken();
    if (!token) {
      setCurrentUser(null);
      setAllUsers([]);
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [current, users] = await Promise.all([
        api.getCurrentUser(),
        api.getUsers().catch(() => [] as User[]),
      ]);
      if (!current || current.isActive === false) {
        setAuthToken(null);
        setCurrentUser(null);
        setAllUsers([]);
        setIsAuthenticated(false);
        return;
      }
      setCurrentUser(current);
      setAllUsers(Array.isArray(users) ? users : []);
      setActiveUser(current.id);
      setIsAuthenticated(true);
    } catch (err: any) {
      const status = Number(err?.status || 0);
      if (status === 401 || status === 403) {
        setAuthToken(null);
        setCurrentUser(null);
        setAllUsers([]);
        setIsAuthenticated(false);
      } else {
        console.warn(
          `[AUTH] Session check encountered temporary error (status=${status || 'network'}); preserving token.`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndCurrent();
    const onUnauthorized = () => {
      setCurrentUser(null);
      setAllUsers([]);
      setIsAuthenticated(false);
    };
    window.addEventListener('wijna-auth-unauthorized', onUnauthorized);
    return () => window.removeEventListener('wijna-auth-unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    console.info(
      `[AUTH] Authentication state changed: authenticated=${isAuthenticated}, loading=${loading}, role=${currentUser?.role || 'none'}`
    );
  }, [isAuthenticated, loading, currentUser?.id, currentUser?.role]);

  const handleLogin = async (identifier: string, password: string): Promise<User> => {
    const res = await api.login(identifier, password);
    const users = await api.getUsers().catch(() => allUsers);
    try {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors
    }
    setAllUsers(Array.isArray(users) ? users : allUsers);
    setCurrentUser(res.user);
    setLoading(false);
    setIsAuthenticated(true);
    return res.user;
  };

  const handleLoginAsTestRole = async (userId: string): Promise<User> => {
    const res = await api.switchUser(userId);
    try {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors
    }
    setCurrentUser(res.user);
    setLoading(false);
    setIsAuthenticated(true);
    return res.user;
  };

  const handleChangePassword = async (
    currentPassword: string,
    newPassword: string
  ): Promise<User> => {
    const res = await api.changePassword(currentPassword, newPassword) as { message: string; user: User; token?: string };
    if (res.token) {
      setAuthToken(res.token);
    }
    setCurrentUser(res.user);
    setAllUsers((prev) => prev.map((u) => (u.id === res.user.id ? res.user : u)));
    return res.user;
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // ignore logout network errors
    } finally {
      setAuthToken(null);
      setCurrentUser(null);
      setAllUsers([]);
      setIsAuthenticated(false);
    }
  };

  const handleSwitchUser = async (userId: string) => {
    try {
      const res = await api.switchUser(userId);
      setCurrentUser(res.user);
      setIsAuthenticated(true);
      try {
        localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'true');
      } catch {
        // ignore storage errors
      }
    } catch (err) {
      console.error('Failed to switch user:', err);
    }
  };

  const isDirector = currentUser?.role === 'director';
  const isFinance = currentUser?.role === 'finance';
  const isProgramManager = currentUser?.role === 'program_manager';
  const isMeal = currentUser?.role === 'meal';
  const isStaff = currentUser?.role === 'staff';
  const isAdmin = currentUser?.role === 'admin';
  const isSystemAdmin = currentUser?.role === 'system_admin';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        allUsers,
        loading,
        isAuthenticated,
        login: handleLogin,
        loginAsTestRole: handleLoginAsTestRole,
        changePassword: handleChangePassword,
        logout: handleLogout,
        switchUser: handleSwitchUser,
        refreshUsers: fetchUsersAndCurrent,
        isDirector,
        isFinance,
        isProgramManager,
        isMeal,
        isStaff,
        isAdmin,
        isSystemAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
