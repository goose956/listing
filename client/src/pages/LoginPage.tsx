import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { takeAuthNotice, useAuth } from '../context/AuthContext';
import { Alert, Button, Card, Input } from '../components/ui';

export function LoginPage() {
  const { signIn, signUp, user, loading, configured } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const notice = takeAuthNotice();
    if (notice) setInfo(notice);
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email, password);
        if (err) setError(err);
        else navigate('/');
      } else {
        const { error: err } = await signUp(email, password, fullName);
        if (err) setError(err);
        else {
          setInfo('Check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-50 via-teal-50/40 to-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandMark size={112} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Starsella</h1>
          <p className="mt-1 text-sm text-slate-500">Resale inventory for five-star sellers</p>
        </div>

        <Card>
          {!configured && (
            <Alert tone="warning">
              Supabase is not configured. Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> to <code className="font-mono">client/.env</code>.
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            {mode === 'signup' && (
              <Input
                label="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            )}
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />

            {error && <Alert>{error}</Alert>}
            {info && <Alert tone="success">{info}</Alert>}

            <Button type="submit" className="w-full" disabled={busy || !configured} size="lg">
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            {mode === 'signin' ? (
              <>
                No account?{' '}
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onClick={() => setMode('signup')}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onClick={() => setMode('signin')}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}
