import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { fetchAdminCheck } from '../lib/admin';
import { fetchSubscriptionStatus } from '../lib/stripe';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  isAdmin: boolean;
  isPro: boolean;
  creditsUsed: number;
  creditsLimit: number | null;
  itemCount: number;
  itemLimit: number | null;
  refreshSubscription: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName?: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_NOTICE_KEY = 'starsella-auth-notice';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [creditsLimit, setCreditsLimit] = useState<number | null>(5);
  const [itemCount, setItemCount] = useState(0);
  const [itemLimit, setItemLimit] = useState<number | null>(10);

  function refreshSubscription() {
    fetchSubscriptionStatus()
      .then((s) => {
        setIsPro(s.isPro);
        setCreditsUsed(s.creditsUsed);
        setCreditsLimit(s.creditsLimit);
        setItemCount(s.itemCount);
        setItemLimit(s.itemLimit);
      })
      .catch(() => {});
  }

  // Check admin + subscription whenever user changes
  useEffect(() => {
    if (user) {
      fetchAdminCheck().then(setIsAdmin);
      refreshSubscription();
    } else {
      setIsAdmin(false);
      setIsPro(false);
      setCreditsUsed(0);
      setCreditsLimit(5);
      setItemCount(0);
      setItemLimit(10);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      const nextSession = data.session;
      if (!nextSession) {
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: userData, error } = await supabase.auth.getUser(nextSession.access_token);
      if (!mounted) return;

      if (error || !userData.user) {
        if (isRecoverableJwtError(error?.message)) {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(AUTH_NOTICE_KEY, buildAuthNotice(error?.message ?? ''));
          }
          await supabase.auth.signOut().catch(() => {});
        }
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      setSession(nextSession);
      setUser(userData.user);
      setLoading(false);
    })().catch(async () => {
      if (!mounted) return;
      setSession(null);
      setUser(null);
      setLoading(false);
      await supabase.auth.signOut().catch(() => {});
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      configured: isSupabaseConfigured,
      isAdmin,
      isPro,
      creditsUsed,
      creditsLimit,
      itemCount,
      itemLimit,
      refreshSubscription,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        return { error: error?.message ?? null };
      },
      async signUp(email, password, fullName) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName || '' } },
        });
        return { error: error?.message ?? null };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function isRecoverableJwtError(message?: string): boolean {
  const normalized = (message ?? '').toLowerCase();
  return normalized.includes('jwt issued at future')
    || normalized.includes('token is expired')
    || normalized.includes('invalid jwt')
    || normalized.includes('invalid claim');
}

function buildAuthNotice(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('jwt issued at future')) {
    return 'Your device clock appears out of sync. Turn on automatic date and time, then sign in again.';
  }
  return 'Your saved session expired or became invalid. Sign in again to continue.';
}

export function takeAuthNotice(): string | null {
  if (typeof window === 'undefined') return null;
  const message = window.sessionStorage.getItem(AUTH_NOTICE_KEY);
  if (message) {
    window.sessionStorage.removeItem(AUTH_NOTICE_KEY);
  }
  return message;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
