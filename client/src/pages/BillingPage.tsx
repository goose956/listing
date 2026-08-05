import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Sparkles, Zap } from 'lucide-react';
import { fetchSubscriptionStatus, openBillingPortal, startCheckout, type SubscriptionStatus } from '../lib/stripe';
import { Alert, Button, Card, LoadingScreen, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

export function BillingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscriptionStatus()
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (searchParams.get('success') === '1') {
      setToast('🎉 Subscription activated! Welcome to Pro.');
      setSearchParams({}, { replace: true });
      // Reload status after successful checkout
      fetchSubscriptionStatus().then(setStatus).catch(() => {});
    } else if (searchParams.get('cancelled') === '1') {
      setToast('Checkout cancelled — no charge made.');
      setSearchParams({}, { replace: true });
    }
  }, []);

  async function handleUpgrade() {
    setWorking(true);
    setError(null);
    try {
      await startCheckout();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setWorking(false);
    }
  }

  async function handlePortal() {
    setWorking(true);
    setError(null);
    try {
      await openBillingPortal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open billing portal');
      setWorking(false);
    }
  }

  if (loading) return <LoadingScreen label="Loading billing…" />;

  const creditsRemaining = status
    ? status.creditsLimit != null
      ? Math.max(0, status.creditsLimit - status.creditsUsed)
      : null
    : null;

  const creditPct = status?.creditsLimit
    ? Math.min(100, (status.creditsUsed / status.creditsLimit) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {toast && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-slate-900">Billing</h1>
        <p className="text-sm text-slate-500">Manage your subscription and AI credits</p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Current plan */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${status?.isPro ? 'bg-teal-50' : 'bg-slate-100'}`}>
              {status?.isPro ? <Zap size={20} className="text-teal-600" /> : <Sparkles size={20} className="text-slate-500" />}
            </div>
            <div>
              <p className="font-semibold text-slate-900">
                {status?.isPro ? 'Pro' : 'Free'} plan
              </p>
              <p className="text-sm text-slate-500">
                {status?.isPro
                  ? status.periodEnd
                    ? `Renews ${formatDate(status.periodEnd)}`
                    : 'Active subscription'
                  : 'Limited to 5 AI analyses'}
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            status?.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
            status?.status === 'trialing' ? 'bg-blue-100 text-blue-700' :
            status?.status === 'past_due' ? 'bg-amber-100 text-amber-700' :
            status?.status === 'cancelled' ? 'bg-rose-100 text-rose-700' :
            'bg-slate-100 text-slate-600'
          }`}>
            {status?.status ?? 'free'}
          </span>
        </div>

        {status?.status === 'past_due' && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Payment failed — please update your payment method to avoid losing access.
          </div>
        )}
        {status?.status === 'cancelled' && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Your subscription has been cancelled. Re-subscribe below to regain Pro access.
          </div>
        )}
      </Card>

      {/* AI credits (free users only) */}
      {!status?.isPro && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-teal-600" />
            <h2 className="text-sm font-semibold text-slate-800">AI credits</h2>
          </div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-500">Used this account</span>
            <span className={`font-semibold ${creditsRemaining === 0 ? 'text-rose-600' : 'text-slate-800'}`}>
              {status?.creditsUsed ?? 0} / {status?.creditsLimit ?? 5}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full transition-all ${creditPct >= 100 ? 'bg-rose-500' : creditPct >= 60 ? 'bg-amber-400' : 'bg-teal-500'}`}
              style={{ width: `${creditPct}%` }}
            />
          </div>
          {creditsRemaining === 0 && (
            <p className="mt-2 text-xs text-rose-600">
              Credits exhausted — upgrade to Pro for unlimited AI analyses.
            </p>
          )}
          {creditsRemaining != null && creditsRemaining > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              {creditsRemaining} credit{creditsRemaining !== 1 ? 's' : ''} remaining. Upgrade to Pro for unlimited.
            </p>
          )}
        </Card>
      )}

      {/* Upgrade / manage */}
      <Card>
        {status?.isPro ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <CreditCard size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Manage subscription</h2>
            </div>
            <p className="mb-3 text-sm text-slate-500">
              Update payment method, download invoices, or cancel your subscription.
            </p>
            <Button variant="secondary" disabled={working} onClick={handlePortal}>
              {working ? <Spinner className="border-t-slate-700" /> : <CreditCard size={16} />}
              Open billing portal
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-teal-600" />
              <h2 className="text-sm font-semibold text-slate-800">Upgrade to Pro</h2>
            </div>
            <ul className="mb-4 mt-2 space-y-1.5 text-sm text-slate-600">
              {[
                'Unlimited AI listing generation',
                'Unlimited AI item analysis',
                'Priority support',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-teal-500">✓</span> {f}
                </li>
              ))}
            </ul>
            {!status?.stripeConfigured ? (
              <p className="text-sm text-slate-400">Billing is not yet configured for this app.</p>
            ) : (
              <Button disabled={working} onClick={handleUpgrade}>
                {working ? <Spinner className="border-t-white" /> : <Zap size={16} />}
                Upgrade to Pro
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
