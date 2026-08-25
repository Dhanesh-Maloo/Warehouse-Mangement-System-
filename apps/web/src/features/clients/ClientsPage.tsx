import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Building2, Plus, X, Pencil, Trash2 } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  slug: string;
  gstin: string | null;
  isActive: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const EMPTY = {
  name: '',
  slug: '',
  gstin: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

export function ClientsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<Client | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients'),
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setFormError('');
    setShowForm(true);
  }
  function openEdit(c: Client) {
    setForm({
      name: c.name,
      slug: c.slug,
      gstin: c.gstin ?? '',
      contactName: c.contactName ?? '',
      contactEmail: c.contactEmail ?? '',
      contactPhone: c.contactPhone ?? '',
    });
    setEditing(c);
    setFormError('');
    setShowForm(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (form.gstin && !GSTIN_RE.test(form.gstin))
        throw new Error('Invalid GSTIN format (must be 15 chars, e.g. 29AABCE1234F1Z5)');
      const payload = {
        name: form.name,
        slug: form.slug,
        gstin: form.gstin || undefined,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
      };
      return editing ? api.patch(`/clients/${editing.id}`, payload) : api.post('/clients', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      setShowForm(false);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.del(`/clients/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      setConfirmDeactivate(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  function field(k: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Warehouse tenants</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New client
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {editing ? 'Edit client' : 'New client'}
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Client name', key: 'name', required: true },
              { label: 'Slug (URL-safe)', key: 'slug', required: true },
              { label: 'GSTIN', key: 'gstin', placeholder: '29AABCE1234F1Z5' },
              { label: 'Contact name', key: 'contactName' },
              { label: 'Contact email', key: 'contactEmail', type: 'email' },
              { label: 'Contact phone', key: 'contactPhone' },
            ].map(({ label, key, required, placeholder, type }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                  {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <input
                  type={type ?? 'text'}
                  required={required}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => field(key as keyof typeof form, e.target.value)}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            ))}
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create client'}
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

      {confirmDeactivate && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-medium text-red-800">
            Deactivate <strong>{confirmDeactivate.name}</strong>? Their assets, ledger history, and
            users are kept - this only hides them from active use and cannot be undone from the UI.
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

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.data ?? []).map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-[#1A2B3C]/5 rounded-lg">
                  <Building2 size={18} className="text-[#1A2B3C]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{c.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{c.slug}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1 text-gray-400 hover:text-[#E86F2C]"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  {isAdmin && c.isActive && (
                    <button
                      onClick={() => setConfirmDeactivate(c)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="Deactivate client"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-600">
                <div>
                  <div className="text-gray-400 mb-0.5">GSTIN</div>
                  <div className="font-mono">{c.gstin ?? '-'}</div>
                </div>
                {c.contactEmail && (
                  <div className="col-span-2">
                    <div className="text-gray-400 mb-0.5">Contact</div>
                    <div>
                      {c.contactName} · {c.contactEmail}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {(data?.data ?? []).length === 0 && (
            <div className="col-span-3 text-center py-12 text-gray-400 text-sm">
              No clients yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
