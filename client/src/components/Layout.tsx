import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell,
  LayoutDashboard,
  Package,
  PlusCircle,
  ListOrdered,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
  Warehouse,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchDueQueueCount } from '../lib/items';
import { cn } from './ui';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/add', label: 'Add Item', icon: PlusCircle },
  { to: '/queue', label: 'List Queue', icon: ListOrdered },
  { to: '/storage', label: 'Storage', icon: Warehouse },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dueCount, setDueCount] = useState(0);

  // In-app reminder: poll for due queue items while the app is open.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function check() {
      try {
        const count = await fetchDueQueueCount();
        if (!cancelled) setDueCount(count);
      } catch {
        // ignore — reminders are best-effort
      }
    }

    check();
    const interval = setInterval(check, 60_000); // every minute
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {/* Top bar mobile */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
              V
            </div>
            <span className="font-semibold tracking-tight">Listings Assistant</span>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-slate-100 px-2 py-2">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium',
                    isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'
                  )
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={18} />
              Sign out
            </button>
          </nav>
        )}
      </header>

      {dueCount > 0 && (
        <div className="sticky top-14 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2 lg:top-0">
          <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm text-amber-900">
            <Bell size={16} className="shrink-0" />
            <p className="min-w-0 flex-1 truncate">
              {dueCount} item{dueCount > 1 ? 's' : ''} due to list now
            </p>
            <NavLink
              to="/queue"
              className="shrink-0 font-semibold text-amber-900 underline-offset-2 hover:underline"
            >
              Open queue
            </NavLink>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white px-3 py-5 lg:flex">
          <div className="mb-8 flex items-center gap-2.5 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-sm font-bold text-white shadow-sm shadow-teal-600/30">
              V
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">Listings Assistant</p>
              <p className="text-[11px] text-slate-400">Vinted-first resale</p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )
                }
              >
                <ShieldCheck size={18} />
                Admin
              </NavLink>
            )}
          </nav>

          <div className="mt-auto border-t border-slate-100 pt-3">
            <p className="truncate px-3 text-xs text-slate-400">{user?.email}</p>
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={18} />
              Sign out
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-6 gap-1 px-1 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-medium',
                  isActive ? 'text-teal-700' : 'text-slate-400'
                )
              }
            >
              <item.icon size={20} />
              <span className="truncate">{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
