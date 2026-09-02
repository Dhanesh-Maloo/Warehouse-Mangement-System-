import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Plus, Trash2 } from 'lucide-react';

interface RuralPincode {
  id: string;
  pincode: string;
  note: string | null;
  createdAt: string;
}

export function RuralPincodesPage() {
  const qc = useQueryClient();
  const [pincode, setPincode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const { data: pincodes = [], isLoading } = useQuery({
    queryKey: ['rural-pincodes'],
    queryFn: () => api.get<RuralPincode[]>('/logistics/rural-pincodes'),
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/logistics/rural-pincodes', { pincode, note: note || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rural-pincodes'] });
      setPincode('');
      setNote('');
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (p: string) => api.del(`/logistics/rural-pincodes/${p}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rural-pincodes'] });
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pincode)) {
      setError('Pincode must be exactly 6 digits');
      return;
    }
    addMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Rural Pincodes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pincodes on this list are always classified as the &quot;Rural&quot; courier zone for
          Deployment and Retrieval orders, overriding the automatic intra-state/inter-state
          comparison.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-wrap items-end gap-3"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
          <input
            type="text"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="e.g. 396001"
            className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Note <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. courier partner flagged as rural"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          <Plus size={16} />
          Add
        </button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Pincode</th>
                <th className="text-left px-5 py-3">Note</th>
                <th className="text-left px-5 py-3">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {pincodes.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-5 py-3 font-mono">{p.pincode}</td>
                  <td className="px-5 py-3 text-gray-600">{p.note ?? '-'}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(p.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => removeMutation.mutate(p.pincode)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {pincodes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No rural pincodes configured yet.
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
