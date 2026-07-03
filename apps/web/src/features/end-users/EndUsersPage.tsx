import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, X, Pencil, User } from 'lucide-react';

interface Client {
  id: string;
  name: string;
}
interface EndUser {
  id: string;
  name: string;
  employeeId: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  clientId: string;
  client: { id: string; name: string };
  createdAt: string;
}

const EMPTY = {
  name: '',
  employeeId: '',
  email: '',
  phone: '',
  city: '',
  country: 'India',
  clientId: '',
};

export function EndUsersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  const isClientUser = user?.role === 'client_user';
  // editors are scoped to their own client the same way client_users are, but can add/edit
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const canEdit = isAdmin || isManager || isEditor || isClientAdmin;
  const canDeactivate = isAdmin || isClientAdmin;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EndUser | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<EndUser | null>(null);

  const queryParams = new URLSearchParams();
  if (isClientScoped && user?.clientId) queryParams.set('clientId', user.clientId);
  if (search) queryParams.set('search', search);

  const { data: endUsers = [], isLoading } = useQuery({
    queryKey: ['end-users', isClientScoped ? user?.clientId : null, search],
    queryFn: () => api.get<EndUser[]>(`/end-users?${queryParams.toString()}`),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const r = await api.get<{ data: Client[] }>('/clients');
      return r.data;
    },
    enabled: !isClientScoped && (showForm || canEdit),
  });

  function openCreate() {
    setForm({ ...EMPTY, clientId: isClientScoped ? (user?.clientId ?? '') : '' });
    setEditing(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(eu: EndUser) {
    setForm({
      name: eu.name,
      employeeId: eu.employeeId ?? '',
      email: eu.email ?? '',
      phone: eu.phone ?? '',
      city: eu.city ?? '',
      country: eu.country ?? 'India',
      clientId: eu.clientId,
    });
    setEditing(eu);
    setFormError('');
    setShowForm(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        clientId: isClientScoped ? (user?.clientId ?? form.clientId) : form.clientId,
        employeeId: form.employeeId || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        country: form.country || 'India',
      };
      return editing
        ? api.patch(`/end-users/${editing.id}`, payload)
        : api.post('/end-users', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['end-users'] });
      setShowForm(false);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.del(`/end-users/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['end-users'] });
      setConfirmDeactivate(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  function field(k: keyof typeof EMPTY, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">End Users</h1>
          <p className="text-sm text-gray-500 mt-1">Client device recipients and employees</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add End User
          </button>
        )}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {editing ? 'Edit end user' : 'New end user'}
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.name}
                onChange={(e) => field('name', e.target.value)}
                className={inputCls}
                placeholder="Full name"
              />
            </div>

            {/* Client selector (not shown for client-scoped roles) */}
            {!isClientScoped && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.clientId}
                  onChange={(e) => field('clientId', e.target.value)}
                  className={`${inputCls} bg-white`}
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

            {/* Employee ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee ID</label>
              <input
                value={form.employeeId}
                onChange={(e) => field('employeeId', e.target.value)}
                className={inputCls}
                placeholder="e.g. EMP-001"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => field('email', e.target.value)}
                className={inputCls}
                placeholder="employee@company.com"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => field('phone', e.target.value)}
                className={inputCls}
                placeholder="+91 98765 43210"
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                value={form.city}
                onChange={(e) => field('city', e.target.value)}
                className={inputCls}
                placeholder="e.g. Mumbai"
              />
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input
                value={form.country}
                onChange={(e) => field('country', e.target.value)}
                className={inputCls}
                placeholder="India"
              />
            </div>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex gap-3">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || !form.name.trim() || (!isClientScoped && !form.clientId)
              }
              className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors hover:bg-[#D05E1E]"
            >
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create end user'}
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

      {/* Deactivate confirmation */}
      {confirmDeactivate && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-medium text-red-800">
            Deactivate <strong>{confirmDeactivate.name}</strong>? This cannot be undone from the UI.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => deactivateMutation.mutate(confirmDeactivate.id)}
              disabled={deactivateMutation.isPending}
              className="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-red-700"
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Yes, deactivate'}
            </button>
            <button
              onClick={() => setConfirmDeactivate(null)}
              className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or employee ID…"
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3">Employee ID</th>
                  <th className="text-left px-5 py-3">Email</th>
                  <th className="text-left px-5 py-3">Phone</th>
                  <th className="text-left px-5 py-3">City</th>
                  <th className="text-left px-5 py-3">Status</th>
                  {!isClientUser && <th className="text-left px-5 py-3">Client</th>}
                  {canEdit && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody>
                {endUsers.map((eu) => (
                  <tr key={eu.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#E86F2C]/10 flex items-center justify-center flex-shrink-0">
                          <User size={13} className="text-[#E86F2C]" />
                        </div>
                        <span className="font-medium text-gray-900">{eu.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-xs font-mono">
                      {eu.employeeId ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{eu.email ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{eu.phone ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{eu.city ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          eu.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {eu.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    {!isClientUser && (
                      <td className="px-5 py-3 text-gray-500 text-xs">{eu.client.name}</td>
                    )}
                    {canEdit && (
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(eu)}
                            className="p-1.5 text-gray-400 hover:text-[#E86F2C] rounded-lg hover:bg-gray-100 transition-colors"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          {canDeactivate && (
                            <button
                              onClick={() => setConfirmDeactivate(eu)}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {endUsers.length === 0 && (
                  <tr>
                    <td
                      colSpan={isClientUser ? (canEdit ? 6 : 5) : canEdit ? 8 : 7}
                      className="px-5 py-12 text-center text-gray-400 text-sm"
                    >
                      {search
                        ? 'No end users match your search.'
                        : 'No end users yet. Add the first one above.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {endUsers.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
              {endUsers.length} end user{endUsers.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
