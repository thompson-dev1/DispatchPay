import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { apiClient, setAccessToken } from '../services/api-client';

export interface UserSession {
  id: string;
  email?: string;
  phoneNumber?: string;
  role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'BUSINESS_MANAGER' | 'RIDER';
  businessId: string | null;
}

export interface AuthContextType {
  user: UserSession | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Check login session (silent refresh) on app mount
  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const res = await apiClient.post<{ accessToken: string; user: UserSession }>('/auth/refresh');
        if (active) {
          setAccessToken(res.data.accessToken);
          setUser(res.data.user);
        }
      } catch (err) {
        if (active) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    checkSession();

    return () => {
      active = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await apiClient.post<{ accessToken: string; user: UserSession }>('/auth/business/login', {
        email,
        password,
      });
      setAccessToken(res.data.accessToken);
      setUser(res.data.user);
    } catch (err) {
      setAccessToken(null);
      setUser(null);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      // Proceed with clearing client-side session even if backend call fails
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
