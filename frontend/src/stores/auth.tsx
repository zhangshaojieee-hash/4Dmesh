import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  avatar_path?: string | null;
  is_admin?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }, []);

  const isTokenExpired = (jwtToken: string): boolean => {
    try {
      const payload = jwtToken.split('.')[1];
      if (!payload) return true;

      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const decoded = JSON.parse(atob(padded)) as { exp?: number };

      if (!decoded.exp) return false;
      return decoded.exp * 1000 <= Date.now();
    } catch {
      return true;
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const storedToken = localStorage.getItem('token');
    if (storedUser && storedToken) {
      try {
        if (isTokenExpired(storedToken)) {
          logout();
          return;
        }
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      } catch {
        logout();
      } finally {
        setIsHydrated(true);
      }
      return;
    }
    setIsHydrated(true);
  }, [logout]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setIsHydrated(true);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token, isHydrated }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
