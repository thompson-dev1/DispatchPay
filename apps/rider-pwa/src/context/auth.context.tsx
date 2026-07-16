import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessTokenInMemory } from '../services/api-client';

type Role = 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'BUSINESS_MANAGER' | 'RIDER';

interface AuthUser {
  id: string;
  email?: string;
  phoneNumber?: string;
  role: Role;
  businessId: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const { data } = await api.post('/api/v1/auth/refresh', {});
      const token = (data?.accessToken as string | undefined) || null;
      setAccessToken(token);
      setAccessTokenInMemory(token);
      setUser((data?.user as AuthUser | undefined) || null);
    } catch {
      setAccessToken(null);
      setAccessTokenInMemory(null);
      setUser(null);
    }
  };

  useEffect(() => {
    const boot = async () => {
      await refreshSession();
      setLoading(false);
    };

    void boot();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, accessToken, loading, refreshSession }),
    [user, accessToken, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return ctx;
}
