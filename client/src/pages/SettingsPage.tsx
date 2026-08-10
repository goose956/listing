import { useEffect, useState } from 'react';
import { Check, KeyRound, Link, Link2Off, Mail, RefreshCw, Save, ShoppingBag, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { checkApiHealth } from '../lib/api';
import { clearOpenAIKey, fetchSettings, saveSettings, type UserSettingsSafe } from '../lib/settings';
import {
  Alert,
  Button,
  Card,
  Input,
  LoadingScreen,
  PageHeader,
  Spinner,
} from '../components/ui';
import {
  type EbayPolicies,
  type EbayStatus,
  createDefaultEbayPolicies,
  disconnectEbay,
  getEbayPolicies,
  getEbayStatus,
  saveEbaySettings,
  startEbayConnect,
} from '../lib/ebay';

export function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettingsSafe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [vintedUsername, setVintedUsername] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [apiHealth, setApiHealth] = useState<{ status: string; aiConfigured: boolean } | null>(null);

  // eBay state
  const [ebayStatus, setEbayStatus] = useState<EbayStatus | null>(null);
  const [ebayPolicies, setEbayPolicies] = useState<EbayPolicies | null>(null);
  const [ebayMarketplace, setEbayMarketplace] = useState<'EBAY_GB' | 'EBAY_US'>('EBAY_GB');
  const [ebayFulfillment, setEbayFulfillment] = useState('');
  const [ebayPayment, setEbayPayment] = useState('');
  const [ebayReturn, setEbayReturn] = useState('');
  const [ebayLocation, setEbayLocation] = useState('');
  const [ebaySaving, setEbaySaving] = useState(false);
  const [ebayLoading, setEbayLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, health, ebay] = await Promise.all([
          fetchSettings().catch(() => null),
          checkApiHealth().catch(() => null),
          getEbayStatus().catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(s);
        setModel(s?.openai_model || 'gpt-4o-mini');
        setVintedUsername(s?.vinted_username || '');
        setEmailAddress(s?.email_address || '');
        setApiHealth(health);

        if (ebay) {
          setEbayStatus(ebay);
          if (ebay.connected) {
            setEbayMarketplace((ebay.marketplace as 'EBAY_GB' | 'EBAY_US') ?? 'EBAY_GB');
            setEbayFulfillment(ebay.fulfillmentPolicyId ?? '');
            setEbayPayment(ebay.paymentPolicyId ?? '');
            setEbayReturn(ebay.returnPolicyId ?? '');
            setEbayLocation(ebay.merchantLocationKey ?? '');
            // Auto-load policies; on failure set empty object so text inputs render
            getEbayPolicies()
              .then(setEbayPolicies)
              .catch(() => setEbayPolicies({ fulfillment: [], payment: [], returns: [], locations: [] }));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Handle eBay OAuth callback query params
    const params = new URLSearchParams(window.location.search);
    const ebayParam = params.get('ebay');
    if (ebayParam === 'connected') {
      flash('eBay account connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (ebayParam === 'error') {
      const reason = params.get('reason') ?? 'unknown';
      setError(`eBay connection failed: ${reason.replace(/_/g, ' ')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleEbayConnect() {
    setEbayLoading(true);
    try {
      await startEbayConnect(ebayMarketplace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start eBay connect');
      setEbayLoading(false);
    }
  }

  async function handleEbayDisconnect() {
    setEbaySaving(true);
    try {
      await disconnectEbay();
      setEbayStatus({ connected: false });
      setEbayPolicies(null);
      flash('eBay account disconnected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect eBay');
    } finally {
      setEbaySaving(false);
    }
  }

  async function handleLoadPolicies() {
    setEbayLoading(true);
    try {
      const policies = await getEbayPolicies();
      setEbayPolicies(policies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load eBay policies');
    } finally {
      setEbayLoading(false);
    }
  }

  async function handleCreateDefaultPolicies() {
    setEbayLoading(true);
    setError(null);
    try {
      const { results, errors } = await createDefaultEbayPolicies();
      if (errors.length > 0) {
        setError(`Policy creation errors: ${errors.join(' | ')}`);
      }
      if (Object.keys(results).length > 0) {
        const [policies, status] = await Promise.all([getEbayPolicies(), getEbayStatus()]);
        setEbayPolicies(policies);
        setEbayStatus(status);
        setEbayFulfillment(status.fulfillmentPolicyId ?? '');
        setEbayPayment(status.paymentPolicyId ?? '');
        setEbayReturn(status.returnPolicyId ?? '');
        setEbayLocation(status.merchantLocationKey ?? '');
        flash(`Created ${Object.keys(results).length} policies`);
      } else if (errors.length === 0) {
        setError('No policies were created and no errors returned — your eBay token may have expired. Try disconnecting and reconnecting eBay.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create default policies');
    } finally {
      setEbayLoading(false);
    }
  }

  async function handleSaveEbaySettings() {
    setEbaySaving(true);
    try {
      await saveEbaySettings({
        fulfillmentPolicyId: ebayFulfillment || undefined,
        paymentPolicyId: ebayPayment || undefined,
        returnPolicyId: ebayReturn || undefined,
        merchantLocationKey: ebayLocation || undefined,
        marketplace: ebayMarketplace,
      });
      // Refresh status
      const status = await getEbayStatus();
      setEbayStatus(status);
      flash('eBay settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save eBay settings');
    } finally {
      setEbaySaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveSettings({
        openaiApiKey: apiKey.trim() || undefined,
        openaiModel: model,
        vintedUsername,
        emailAddress,
      });
      setSettings(await fetchSettings());
      setApiKey('');
      flash('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    setSaving(true);
    setError(null);
    try {
      await clearOpenAIKey();
      setSettings(await fetchSettings());
      flash('API key removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove key');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingScreen label="Loading settings…" />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage API keys and preferences" />

      {toast && (
        <div className="mb-4">
          <Alert tone="success">
            <span className="inline-flex items-center gap-1">
              <Check size={14} /> {toast}
            </span>
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {/* API connection status */}
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Connection status</h2>
        <div className="flex flex-wrap gap-2">
          <Alert tone={user ? 'success' : 'error'}>
            {user ? 'Signed in as ' + user.email : 'Not signed in'}
          </Alert>
          <Alert tone={apiHealth?.status === 'ok' ? 'success' : 'warning'}>
            {apiHealth?.status === 'ok' ? 'API server reachable' : 'API server not detected'}
          </Alert>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {apiHealth?.aiConfigured
            ? 'Server has a global OpenAI key configured.'
            : 'No global OpenAI key on server — add your own key below to enable AI features.'}
        </p>
      </Card>

      {/* OpenAI */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <KeyRound size={16} className="text-teal-600" />
            OpenAI API key
          </h2>
          {settings?.openai_key_configured && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Configured ✓
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Used for AI photo analysis and listing generation. Get a key from{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">
            platform.openai.com/api-keys
          </a>
          . Your key is stored securely and never shown back.
        </p>
        <div className="space-y-3">
          <Input
            label="API key"
            type="password"
            placeholder={
              settings?.openai_key_configured
                ? '••••••••••••••••  (key saved — type a new one to replace)'
                : 'sk-...'
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            hint="Default: gpt-4o-mini (cheap + fast for listings)"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saving} onClick={handleSave}>
              {saving ? <Spinner className="border-t-white" /> : <Save size={16} />}
              Save settings
            </Button>
            {settings?.openai_key_configured && (
              <Button type="button" variant="ghost" disabled={saving} onClick={handleClearKey}>
                <Trash2 size={16} />
                Remove key
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Email preferences */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Mail size={16} className="text-teal-600" />
            Email listings
          </h2>
          {settings?.email_address && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Set ✓
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Send your prepared listings to this email address so you can copy-paste them into Vinted
          on any device. Use the "Email" button on an item or the queue.
        </p>
        <Input
          label="Email address"
          type="email"
          value={emailAddress}
          onChange={(e) => setEmailAddress(e.target.value)}
          placeholder="you@example.com"
        />
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={saving || !emailAddress} onClick={handleSave}>
            <Save size={16} />
            Save
          </Button>
        </div>
      </Card>

      {/* Vinted preferences */}
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Vinted preferences</h2>
        <Input
          label="Vinted username"
          value={vintedUsername}
          onChange={(e) => setVintedUsername(e.target.value)}
          placeholder="e.g. your-vinted-name"
          hint="Used in generated listing descriptions and future integrations"
        />
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={saving || !vintedUsername} onClick={handleSave}>
            <Save size={16} />
            Save
          </Button>
        </div>
      </Card>

      {/* eBay integration */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShoppingBag size={16} className="text-teal-600" />
            eBay integration
          </h2>
          {ebayStatus?.connected && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Connected ✓
            </span>
          )}
        </div>

        {!ebayStatus?.connected ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Connect your eBay account to list items directly from the app. You'll be redirected
              to eBay to authorise access, then returned here.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Marketplace:</label>
              <select
                value={ebayMarketplace}
                onChange={(e) => setEbayMarketplace(e.target.value as 'EBAY_GB' | 'EBAY_US')}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_US">eBay US</option>
              </select>
            </div>
            <Button type="button" variant="secondary" disabled={ebayLoading} onClick={handleEbayConnect}>
              {ebayLoading ? <Spinner className="border-t-teal-600" /> : <Link size={16} />}
              Connect eBay
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <span>
                Marketplace:{' '}
                <strong className="text-slate-700">
                  {ebayStatus.marketplace === 'EBAY_GB' ? 'eBay UK' : 'eBay US'}
                </strong>
              </span>
            </div>

            {/* Policy selectors */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">Listing policies</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCreateDefaultPolicies}
                    disabled={ebayLoading}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:underline"
                  >
                    {ebayLoading ? <Spinner className="border-t-slate-500 h-3 w-3" /> : null}
                    Create defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadPolicies}
                    disabled={ebayLoading}
                    className="flex items-center gap-1 text-xs text-teal-600 hover:underline"
                  >
                    {ebayLoading ? <Spinner className="border-t-teal-600 h-3 w-3" /> : <RefreshCw size={12} />}
                    {ebayPolicies ? 'Refresh' : 'Load policies'}
                  </button>
                </div>
              </div>

              {ebayPolicies ? (
                <div className="grid gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Fulfillment / Shipping</label>
                    {ebayPolicies.fulfillment.length > 0 ? (
                      <select
                        value={ebayFulfillment}
                        onChange={(e) => setEbayFulfillment(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="">— Select policy —</option>
                        {ebayPolicies.fulfillment.map((p) => (
                          <option key={p.policyId} value={p.policyId}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={ebayFulfillment}
                        onChange={(e) => setEbayFulfillment(e.target.value)}
                        placeholder="Policy ID (e.g. 6242950000)"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      />
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Payment <span className="text-slate-400">(optional in sandbox)</span></label>
                    {ebayPolicies.payment.length > 0 ? (
                      <select
                        value={ebayPayment}
                        onChange={(e) => setEbayPayment(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="">— Select policy —</option>
                        {ebayPolicies.payment.map((p) => (
                          <option key={p.policyId} value={p.policyId}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={ebayPayment}
                        onChange={(e) => setEbayPayment(e.target.value)}
                        placeholder="Policy ID (leave blank for sandbox)"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      />
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Returns <span className="text-slate-400">(optional in sandbox)</span></label>
                    {ebayPolicies.returns.length > 0 ? (
                      <select
                        value={ebayReturn}
                        onChange={(e) => setEbayReturn(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="">— Select policy —</option>
                        {ebayPolicies.returns.map((p) => (
                          <option key={p.policyId} value={p.policyId}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={ebayReturn}
                        onChange={(e) => setEbayReturn(e.target.value)}
                        placeholder="Policy ID (leave blank for sandbox)"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      />
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Merchant Location Key</label>
                    {ebayPolicies.locations.length > 0 ? (
                      <select
                        value={ebayLocation}
                        onChange={(e) => setEbayLocation(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      >
                        <option value="">— Select location —</option>
                        {ebayPolicies.locations.map((l) => (
                          <option key={l.merchantLocationKey} value={l.merchantLocationKey}>{l.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={ebayLocation}
                        onChange={(e) => setEbayLocation(e.target.value)}
                        placeholder="e.g. la-default-location"
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Load your eBay account policies to configure listings.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={ebaySaving} onClick={handleSaveEbaySettings}>
                {ebaySaving ? <Spinner className="border-t-teal-600" /> : <Save size={16} />}
                Save eBay settings
              </Button>
              <Button type="button" variant="ghost" disabled={ebaySaving} onClick={handleEbayDisconnect}>
                <Link2Off size={16} />
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-400">
        Account: {user?.email} · User id: {user?.id?.slice(0, 8)}…
      </p>
    </div>
  );
}