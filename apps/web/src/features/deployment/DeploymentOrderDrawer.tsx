import { Link } from 'react-router-dom';
import { Download, Pencil, X } from 'lucide-react';
import { formatPaise } from '../../lib/money';
import {
  type DeploymentOrder,
  STATUS_COLORS,
  STATUS_LABELS,
  ZONE_LABELS,
  formatDeliveryAddress,
} from './deployment-order';

interface DrawerProps {
  order: DeploymentOrder;
  onClose: () => void;
  onDownloadChallan: (orderId: string) => void;
  /** Present when the user may edit; opens the edit panel. */
  onEdit?: (orderId: string) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-800 whitespace-pre-line break-words">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-gray-400">—</span>;

export function DeploymentOrderDrawer({ order, onClose, onDownloadChallan, onEdit }: DrawerProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-label="Deployment details"
    >
      <button
        type="button"
        aria-label="Close deployment details"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 cursor-default"
      />
      <aside className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Deployment details</h2>
            <span
              className={`inline-block mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}
            >
              {STATUS_LABELS[order.status]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(order.id)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800"
              >
                <Pencil size={14} />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <dl className="px-6 py-5 space-y-5">
          <Field label={order.items.length > 1 ? `Assets (${order.items.length})` : 'Asset'}>
            {order.items.map(({ asset }) => (
              <span key={asset.id} className="block mb-1.5 last:mb-0">
                <Link
                  to={`/inventory/${asset.id}`}
                  className="font-mono font-semibold text-[#E86F2C] hover:underline"
                >
                  {asset.serialNumber}
                </Link>
                <span className="block text-gray-500">{asset.model}</span>
              </span>
            ))}
          </Field>
          <Field label="End user">
            {order.endUser?.name ?? <span className="text-gray-400 italic">Not assigned</span>}
          </Field>
          <Field label="Delivery address">{formatDeliveryAddress(order.deliveryAddress)}</Field>
          <Field label="Contact name">{order.contactName || EMPTY}</Field>
          <Field label="Contact phone">{order.contactPhone || EMPTY}</Field>
          <Field label="Courier zone">{ZONE_LABELS[order.courierZone]}</Field>
          <Field label="Transport charge">
            {Number(order.transportChargePaise) > 0 ? (
              formatPaise(order.transportChargePaise)
            ) : (
              <span className="text-gray-400">Not entered yet</span>
            )}
          </Field>
          <Field label="Bundle">
            {order.bundleType === 'full_prep' ? 'Full prep' : 'Standard'}
            {order.requiresLabeling && <span className="block text-gray-500">Labeling</span>}
            {order.requiresRepacking && <span className="block text-gray-500">Repacking</span>}
          </Field>
          <Field label="IValue ticket / invoice #">{order.ivalueTicketNumber || EMPTY}</Field>
          <Field label="Client ticket #">{order.clientTicketNumber || EMPTY}</Field>
          <Field label="Tracking no.">{order.trackingNumber || EMPTY}</Field>
          <Field label="Requested">{new Date(order.requestedAt).toLocaleDateString('en-IN')}</Field>
          <Field label="Notes">{order.notes || EMPTY}</Field>
        </dl>

        {order.status === 'delivered' && (
          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={() => onDownloadChallan(order.id)}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-2 hover:text-[#E86F2C] hover:border-[#E86F2C]"
            >
              <Download size={14} />
              Download delivery challan
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
