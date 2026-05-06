// src/contexts/AuthContext.tsx
// Replaces Supabase auth with JWT-based API auth

import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, setToken, clearToken } from '../lib/api';
import { AuthContextType, User } from '../types/auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [minLoadingTime, setMinLoadingTime] = useState(true);

  useEffect(() => {
    const minLoadTimer = setTimeout(() => setMinLoadingTime(false), 300);

    // Restore session from stored token
    auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUser(mapProfile(data.session.user));
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    return () => clearTimeout(minLoadTimer);
  }, []);

  const mapProfile = (data: any): User => ({
    id: data.id,
    email: data.email,
    phone: data.phone,
    name: data.name,
    role: data.role,
    account_type: data.account_type,
    account_tier: data.account_tier,
    subscription_plan: data.subscription_plan,
    max_employees: data.max_employees,
    can_track_attendance: data.can_track_attendance,
    can_access_full_statements: data.can_access_full_statements,
    subscription_expires_at: data.subscription_expires_at,
    subscription_status: data.subscription_status,
    trial_ends_at: data.trial_ends_at,
    payment_method_added: data.payment_method_added,
    profile_photo: data.profile_photo,
    profession: data.profession,
    job_status: data.job_status,
    show_status_ring: data.show_status_ring,
    created_at: data.created_at,
  });

  const signIn = async (emailOrPhone: string, password: string) => {
    const { data, error } = await auth.signIn(emailOrPhone, password);
    if (error) throw new Error(error);
    if (data?.user) setUser(mapProfile(data.user));
  };

  const signUp = async (email: string, password: string, name: string, role: 'employer' | 'employee') => {
    const { data, error } = await auth.signUp(email, password, name, role);
    if (error) throw new Error(error);
    if (data?.user) setUser(mapProfile(data.user));
  };

  const signOut = async () => {
    setUser(null);
    await auth.signOut();
    clearToken();
    window.location.replace('/');
  };

  const refreshUser = async () => {
    const { data } = await auth.getSession();
    if (data.session?.user) setUser(mapProfile(data.session.user));
  };

  const isLoading = loading || minLoadingTime;

  return (
    <AuthContext.Provider value={{ user, profile: user, loading: isLoading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
