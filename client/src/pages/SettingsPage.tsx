import { useEffect, useState } from 'react';
import { Check, KeyRound, Mail, Save, Trash2 } from 'lucide-react';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, health] = await Promise.all([
          fetchSettings().catch(() => null),
          checkApiHealth().catch(() => null),
        ]);
        if (cancelled) return;
        setSettings(s);
        setModel(s?.openai_model || 'gpt-4o-mini');
        setVintedUsername(s?.vinted_username || '');
        setEmailAddress(s?.email_address || '');
        setApiHealth(health);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
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

      <p className="text-xs text-slate-400">
        Account: {user?.email} · User id: {user?.id?.slice(0, 8)}…
      </p>
    </div>
  );
}