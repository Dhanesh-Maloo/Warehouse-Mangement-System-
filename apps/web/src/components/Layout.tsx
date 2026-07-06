import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { api } from '../api/client';
import ivalueLogo from '../assets/ivalue-logo.png';
import {
  LayoutDashboard,
  PackagePlus,
  Package,
  ClipboardCheck,
  BookOpen,
  CreditCard,
  Users,
  Building2,
  MapPin,
  UserCheck,
  LogOut,
  Truck,
  ArrowDownToLine,
  Trash2,
  CircleDollarSign,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X,
  Sun,
  Moon,
  HelpCircle,
  Map,
  Wrench,
  Tag,
} from 'lucide-react';

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  extraRoles?: string[];
};
type NavGroup = { group: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    group: '',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    group: 'Operations',
    items: [
      { to: '/inbound', label: 'Inbound', icon: PackagePlus },
      { to: '/deployment', label: 'Deployment', icon: Truck },
      { to: '/retrieval', label: 'Retrieval', icon: ArrowDownToLine },
      { to: '/disposal', label: 'Disposal', icon: Trash2 },
      { to: '/repair', label: 'Repair', icon: Wrench },
      { to: '/resale', label: 'Resale', icon: Tag },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/inspections', label: 'Inspections', icon: ClipboardCheck },
      { to: '/locations', label: 'Locations', icon: MapPin },
    ],
  },
  {
    group: 'Finance',
    items: [
      { to: '/billing', label: 'Billing', icon: CircleDollarSign },
      { to: '/ledger', label: 'Ledger', icon: BookOpen },
      { to: '/rate-card', label: 'Rate Card', icon: CreditCard },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/clients', label: 'Clients', icon: Building2, adminOnly: true },
      { to: '/users', label: 'Users', icon: Users, adminOnly: true, extraRoles: ['client_admin'] },
      { to: '/end-users', label: 'End Users', icon: UserCheck },
      { to: '/audit-log', label: 'Audit Log', icon: ShieldCheck, adminOnly: true },
      {
        to: '/rural-pincodes',
        label: 'Rural Pincodes',
        icon: Map,
        adminOnly: true,
        extraRoles: ['manager'],
      },
    ],
  },
  {
    group: 'Help',
    items: [{ to: '/help', label: 'User Manual', icon: HelpCircle }],
  },
];

interface AssetSearchResult {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  model: string;
  manufacturer: string;
  currentStatus: string;
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['global-search', query],
    queryFn: () =>
      api.get<{ data: AssetSearchResult[] }>(`/assets?search=${encodeURIComponent(query)}&take=8`),
    enabled: query.trim().length >= 2,
  });
  const results = data?.data ?? [];

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function select(asset: AssetSearchResult) {
    navigate(`/inventory/${asset.id}`);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  const STATUS_COLORS: Record<string, string> = {
    in_storage: 'bg-emerald-100 text-emerald-700',
    deployed: 'bg-orange-100 text-orange-700',
    in_inspection: 'bg-amber-100 text-amber-700',
    receiving: 'bg-blue-100 text-blue-700',
    returning: 'bg-purple-100 text-purple-700',
    disposed: 'bg-gray-100 text-gray-500',
  };

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search serial, model… (Ctrl+K)"
          className="bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none w-full"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">No assets found</div>
          ) : (
            <ul>
              {results.map((asset) => (
                <li key={asset.id}>
                  <button
                    onClick={() => select(asset)}
                    className="w-full text-left px-4 py-2.5 hover:bg-orange-50 transition-colors flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono font-semibold text-gray-900 truncate">
                        {asset.serialNumber}
                        {asset.assetTag && (
                          <span className="ml-2 font-normal text-gray-400 text-xs">
                            {asset.assetTag}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {asset.manufacturer} {asset.model}
                      </div>
                    </div>
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[asset.currentStatus] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {asset.currentStatus.replace(/_/g, ' ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isClientUser = user?.role === 'client_user';

  function handleLogout() {
    logout();
    void navigate('/login');
  }

  return (
    <div className="flex h-screen bg-[#F4F6F8] dark:bg-gray-950">
      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 bg-[#1A2B3C] flex flex-col transition-all duration-200 ${
          collapsed ? 'w-[60px]' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div
          className={`border-b border-white/10 ${collapsed ? 'px-3 py-5 flex justify-center' : 'px-6 py-5'}`}
        >
          {collapsed ? (
            <img src={ivalueLogo} alt="iValue" className="h-8 w-auto" />
          ) : (
            <div className="flex items-center gap-3">
              <img src={ivalueLogo} alt="iValue" className="h-11 w-auto flex-shrink-0" />
              <div>
                <div className="text-white font-bold text-lg tracking-tight">IValue WMS</div>
                <div className="text-[#8AA6BF] text-xs mt-0.5">Warehouse Management</div>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 overflow-y-auto">
          {navGroups.map(({ group, items }) => {
            const visibleItems = items.filter((item) => {
              if (item.adminOnly && !isAdmin && !item.extraRoles?.includes(user?.role ?? '')) {
                return false;
              }
              // client_user: only show dashboard, inventory-related, and the help guide
              if (isClientUser) {
                return ['/', 'inventory', '/inspections', '/end-users', '/billing', '/help'].some(
                  (p) => item.to === p || item.to.startsWith(p + '/'),
                );
              }
              return true;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                {group && !collapsed && (
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#4E6A82]">
                    {group}
                  </div>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                          collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'
                        } ${
                          isActive
                            ? 'bg-[#E86F2C] text-white'
                            : 'text-[#8AA6BF] hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      {!collapsed && label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User + collapse toggle */}
        <div className="px-2 py-3 border-t border-white/10">
          {!collapsed && (
            <div className="px-3 py-2 mb-1">
              <div className="text-white text-xs font-medium truncate">
                {user?.fullName ?? user?.email}
              </div>
              <div className="text-[#8AA6BF] text-xs capitalize">
                {user?.role?.replace('_', ' ')}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            title="Sign out"
            className={`flex w-full items-center gap-3 rounded-lg text-sm text-[#8AA6BF] hover:bg-white/5 hover:text-white transition-colors ${
              collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
            }`}
          >
            <LogOut size={16} className="flex-shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`mt-1 flex w-full items-center gap-3 rounded-lg text-sm text-[#4E6A82] hover:bg-white/5 hover:text-[#8AA6BF] transition-colors ${
              collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
            }`}
          >
            {collapsed ? (
              <ChevronRight size={16} />
            ) : (
              <>
                <ChevronLeft size={16} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center px-6 gap-4">
          <GlobalSearch />
          <div className="flex-1" />
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'Asia/Kolkata',
            })}
          </div>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-6 dark:bg-gray-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
