import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { User, Plus, X } from 'lucide-react';

interface Client {
  id: string;
  name: string;
}
interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  clientId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-purple-100 text-purple-700',
  operator: 'bg-blue-100 text-blue-700',
  client_user: 'bg-gray-100 text-gray-700',
  editor: 'bg-amber-100 text-amber-700',
  client_admin: 'bg-teal-100 text-teal-700',
};

const CLIENT_SCOPED_ROLES = new Set(['client_user', 'editor', 'client_admin']);

const EMPTY = { email: '', password: '', fullName: '', phone: '', role: 'operator', clientId: '' };

export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const isAdmin = me?.role === 'admin';
  const isClientAdmin = me?.role === 'client_admin';
  // a client_admin manages accounts, but only ones fenced to their own client
  const canManageUsers = isAdmin || isClientAdmin;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ data: UserRecord[]; total: number }>('/users'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const r = await api.get<{ data: Client[] }>('/clients');
      return r.data;
    },
    enabled: showForm && isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/users', {
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone || undefined,
        role: form.role,
        clientId: CLIENT_SCOPED_ROLES.has(form.role)
          ? isClientAdmin
            ? (me?.clientId ?? undefined)
            : form.clientId
          : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm(EMPTY);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/users/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  function field(k: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">Platform user accounts</p>
        </div>
        {canManageUsers && (
          <button
            onClick={() => {
              setForm(isClientAdmin ? { ...EMPTY, role: 'client_user' } : EMPTY);
              setShowForm(true);
              setFormError('');
            }}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New user
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">New user</h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.fullName}
                onChange={(e) => field('fullName', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => field('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => field('password', e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => field('phone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role <span className="text-red-500">*</span>
              </label>
              <select
                value={form.role}
                onChange={(e) => field('role', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
              >
                {isAdmin && <option value="operator">Operator</option>}
                {isAdmin && <option value="manager">Manager</option>}
                {isAdmin && <option value="admin">Admin</option>}
                <option value="client_user">Client user</option>
                <option value="editor">Editor (add/edit only, no delete — single client)</option>
                <option value="client_admin">
                  Client admin (full control, incl. delete — single client)
                </option>
              </select>
            </div>
            {CLIENT_SCOPED_ROLES.has(form.role) && !isClientAdmin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.clientId}
                  onChange={(e) => field('clientId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="">Select client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create user'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Role</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Last login</th>
                {canManageUsers && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#1A2B3C]/10 flex items-center justify-center flex-shrink-0">
                        <User size={13} className="text-[#1A2B3C]" />
                      </div>
                      <span className="font-medium text-gray-900">{u.fullName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{u.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })
                      : 'Never'}
                  </td>
                  {canManageUsers && (
                    <td className="px-5 py-3 text-right">
                      {u.id !== me?.id && (!isClientAdmin || CLIENT_SCOPED_ROLES.has(u.role)) && (
                        <button
                          onClick={() =>
                            statusMutation.mutate({
                              id: u.id,
                              status: u.status === 'active' ? 'suspended' : 'active',
                            })
                          }
                          className={`text-xs font-medium px-3 py-1 rounded-lg border transition-colors ${u.status === 'active' ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                        >
                          {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
