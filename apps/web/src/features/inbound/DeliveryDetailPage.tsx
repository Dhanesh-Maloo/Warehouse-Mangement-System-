import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ArrowLeft, PackagePlus, Download } from 'lucide-react';

interface DeliveryItem {
  id: string;
  category: string;
  model: string;
  manufacturer: string;
  quantity: number;
  receivedQuantity: number;
}

interface Grn {
  id: string;
  grnNumber: string | null;
  receivedAt: string;
  deviceCount: number;
  courierRef: string | null;
}

interface Delivery {
  id: string;
  purchaseOrderRef: string;
  expectedArrivalDate: string;
  status: string;
  notes: string | null;
  items: DeliveryItem[];
  grns: Grn[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  partially_received: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: delivery, isLoading } = useQuery({
    queryKey: ['delivery', id],
    queryFn: () => api.get<Delivery>(`/inbound/deliveries/${id ?? ''}`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
    );
  }

  if (!delivery) {
    return (
      <div className="text-center py-16 text-gray-500">
        Delivery not found.{' '}
        <Link to="/inbound" className="text-[#E86F2C] underline">
          Back to inbound
        </Link>
      </div>
    );
  }

  const totalExpected = delivery.items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = delivery.grns.reduce((s, g) => s + g.deviceCount, 0);
  const canReceive = delivery.status !== 'cancelled' && delivery.status !== 'completed';

  async function downloadGrnPdf(grnId: string, grnNumber: string) {
    const token = localStorage.getItem('wh_token');
    const res = await fetch(`/api/v1/inbound/grns/${grnId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${grnNumber ?? 'grn'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        crumbs={[{ label: 'Inbound', to: '/inbound' }, { label: delivery.purchaseOrderRef }]}
      />
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/inbound')}
          className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">
              {delivery.purchaseOrderRef}
            </h1>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${
                STATUS_COLORS[delivery.status] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {delivery.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Expected{' '}
            {new Date(delivery.expectedArrivalDate).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {delivery.notes && <> · {delivery.notes}</>}
          </p>
        </div>
        {canReceive && (
          <Link
            to={`/inbound/${delivery.id}/receive`}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            <PackagePlus size={16} />
            Receive devices
          </Link>
        )}
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span className="font-medium">Receipt progress</span>
          <span>
            <span className="font-bold text-gray-900">{totalReceived}</span> of {totalExpected}{' '}
            devices received
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full">
          <div
            className="h-2 bg-emerald-500 rounded-full transition-all"
            style={{
              width: totalExpected > 0 ? `${(totalReceived / totalExpected) * 100}%` : '0%',
            }}
          />
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Expected items</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-5 py-3">Category</th>
              <th className="text-left px-5 py-3">Model</th>
              <th className="text-left px-5 py-3">Manufacturer</th>
              <th className="text-right px-5 py-3">Expected</th>
              <th className="text-right px-5 py-3">Received</th>
            </tr>
          </thead>
          <tbody>
            {delivery.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="px-5 py-3.5 capitalize text-gray-700">{item.category}</td>
                <td className="px-5 py-3.5 font-medium text-gray-900">{item.model}</td>
                <td className="px-5 py-3.5 text-gray-600">{item.manufacturer}</td>
                <td className="px-5 py-3.5 text-right text-gray-700">{item.quantity}</td>
                <td className="px-5 py-3.5 text-right font-semibold text-emerald-600">
                  {item.receivedQuantity}
                </td>
              </tr>
            ))}
            {delivery.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                  No line items on this delivery.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* GRNs received so far */}
      {delivery.grns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Receipts recorded</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">GRN number</th>
                <th className="text-left px-5 py-3">Received at</th>
                <th className="text-left px-5 py-3">Courier ref</th>
                <th className="text-right px-5 py-3">Devices</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {delivery.grns.map((grn) => (
                <tr key={grn.id} className="border-b border-gray-50">
                  <td className="px-5 py-3.5 font-mono text-sm font-semibold text-gray-900">
                    {grn.grnNumber ?? grn.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-5 py-3.5 text-gray-700">
                    {new Date(grn.receivedAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">{grn.courierRef ?? '—'}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-gray-900">
                    {grn.deviceCount}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => downloadGrnPdf(grn.id, grn.grnNumber ?? 'grn')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E86F2C] hover:text-[#D05E1E] border border-[#E86F2C]/30 hover:border-[#E86F2C] px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Download size={12} />
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
