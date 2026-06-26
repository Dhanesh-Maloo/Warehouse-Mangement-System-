import { useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { DocumentsPanel } from '../../components/DocumentsPanel';
import { AuthImage } from '../../components/AuthImage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Camera,
  Trash2,
  Clock,
  XOctagon,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Photo {
  id: string;
  s3Key: string;
}

interface InspectionDetail {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  conditionGrade: string | null;
  scratchesOnCasing: boolean | null;
  lidClosingOk: boolean | null;
  scratchesOnScreen: boolean | null;
  keyboardIssues: boolean | null;
  missingFeet: boolean | null;
  chargerDamage: boolean | null;
  allAccessoriesPresent: boolean | null;
  webcamOk: boolean | null;
  speakersOk: boolean | null;
  bluetoothOk: boolean | null;
  batteryCharges: boolean | null;
  screenOk: boolean | null;
  keyboardOk: boolean | null;
  trackpadOk: boolean | null;
  portsOk: boolean | null;
  powersOnOk: boolean | null;
  imagesUploaded: boolean | null;
  sanitization: boolean | null;
  factoryReset: boolean | null;
  notes: string | null;
  slaMinutes: number | null;
  photos: Photo[];
  asset: {
    id: string;
    serialNumber: string;
    model: string;
    manufacturer: string;
    category: string;
    clientId: string;
  };
}

type Grade = 'A' | 'B' | 'C' | 'D';

// ─── Checklist definition ─────────────────────────────────────────────────────

interface ChecklistItem {
  key: keyof InspectionDetail;
  label: string;
  // true = "Yes" answer is the GOOD outcome (e.g. webcam works)
  // false = "No" answer is the GOOD outcome (e.g. no scratches)
  yesIsGood: boolean;
  threeWay?: boolean; // adds N/A option
}

const CHECKLIST_SECTIONS: { title: string; items: ChecklistItem[] }[] = [
  {
    title: 'Physical Appearance',
    items: [
      {
        key: 'scratchesOnCasing',
        label: 'Visible scratches on the outer casing',
        yesIsGood: false,
      },
      { key: 'lidClosingOk', label: 'Lid closing properly (no gap at hinge)', yesIsGood: true },
      { key: 'scratchesOnScreen', label: 'Visible scratches on the screen', yesIsGood: false },
      {
        key: 'keyboardIssues',
        label: 'Loose, missing or unidentified keys on keyboard',
        yesIsGood: false,
      },
      { key: 'missingFeet', label: 'Missing rubber feet (bottom of laptop)', yesIsGood: false },
      {
        key: 'chargerDamage',
        label: 'Damage to adapter / charger (exposed wire, etc.)',
        yesIsGood: false,
      },
      {
        key: 'allAccessoriesPresent',
        label: 'Returned with all accessories (AC Adapter & Headset)',
        yesIsGood: true,
      },
    ],
  },
  {
    title: 'Functional Checks',
    items: [
      { key: 'webcamOk', label: 'Webcam in working condition', yesIsGood: true },
      { key: 'speakersOk', label: 'Speakers in working condition', yesIsGood: true },
      { key: 'bluetoothOk', label: 'Bluetooth in working condition', yesIsGood: true },
      { key: 'batteryCharges', label: 'Battery could be charged', yesIsGood: true },
      { key: 'screenOk', label: 'Screen fully lit with no missing pixels', yesIsGood: true },
      { key: 'keyboardOk', label: 'Keyboards in working condition', yesIsGood: true },
      { key: 'trackpadOk', label: 'Trackpad in working condition', yesIsGood: true },
      { key: 'portsOk', label: 'All ports in working condition', yesIsGood: true },
      { key: 'powersOnOk', label: 'Unit powered on without any hardware errors', yesIsGood: true },
      { key: 'imagesUploaded', label: 'Uploaded 3 images (top, bottom, front)', yesIsGood: true },
    ],
  },
  {
    title: 'Process',
    items: [
      { key: 'sanitization', label: 'Sanitization', yesIsGood: true, threeWay: true },
      {
        key: 'factoryReset',
        label: 'Factory Reset (done by User)',
        yesIsGood: true,
        threeWay: true,
      },
    ],
  },
];

const ALL_ITEMS = CHECKLIST_SECTIONS.flatMap((s) => s.items);

function isPass(item: ChecklistItem, value: boolean | null): boolean {
  if (value === null) return true; // N/A counts as not a failure
  return item.yesIsGood ? value === true : value === false;
}

// ─── Grade config ─────────────────────────────────────────────────────────────

const GRADE_LABELS: Record<Grade, { label: string; description: string; color: string }> = {
  A: {
    label: 'Grade A',
    description: 'Like new — all checks pass',
    color: 'border-emerald-500 bg-emerald-50 text-emerald-700',
  },
  B: {
    label: 'Grade B',
    description: 'Good — minor cosmetic wear',
    color: 'border-blue-500 bg-blue-50 text-blue-700',
  },
  C: {
    label: 'Grade C',
    description: 'Fair — visible wear, functional',
    color: 'border-amber-500 bg-amber-50 text-amber-700',
  },
  D: {
    label: 'Grade D',
    description: 'Poor — significant damage',
    color: 'border-red-500 bg-red-50 text-red-700',
  },
};

// ─── Image compression ───────────────────────────────────────────────────────

async function compressImage(file: File, maxBytes = 900_000): Promise<Blob> {
  if (file.size <= maxBytes) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const scale = Math.sqrt(maxBytes / file.size);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.82);
    };
    img.src = url;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

type CheckState = Record<string, boolean | null>;

function buildInitialChecks(): CheckState {
  const state: CheckState = {};
  for (const item of ALL_ITEMS) {
    state[item.key as string] = item.threeWay ? null : false;
  }
  return state;
}

export function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [checks, setChecks] = useState<CheckState>(buildInitialChecks);
  const [grade, setGrade] = useState<Grade | ''>('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [error, setError] = useState('');

  const { data: inspection, isLoading } = useQuery({
    queryKey: ['inspection', id],
    queryFn: () => api.get<InspectionDetail>(`/inspections/${id ?? ''}`),
    enabled: !!id,
  });

  function setCheck(key: string, value: boolean | null) {
    setChecks((prev) => ({ ...prev, [key]: value }));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const compressed = await Promise.all(
      files.map(async (f) => {
        const blob = await compressImage(f);
        return {
          file: new File([blob], f.name, { type: blob.type }),
          preview: URL.createObjectURL(blob),
        };
      }),
    );
    setPhotos((prev) => [...prev, ...compressed]);
    e.target.value = '';
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => api.patch(`/inspections/${id ?? ''}/cancel`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspection', id] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', inspection?.asset.id] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['pending-inspections-dashboard'] });
      navigate('/inspections');
    },
    onError: (err: Error) => setError(err.message),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      setUploadingPhotos(true);
      const photoKeys: string[] = [];
      for (const { file } of photos) {
        const form = new FormData();
        form.append('file', file);
        const token = localStorage.getItem('wh_token');
        const res = await fetch(`/api/v1/inspections/${id ?? ''}/photos`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (!res.ok) throw new Error('Photo upload failed');
        const { key } = (await res.json()) as { key: string };
        photoKeys.push(key);
      }
      setUploadingPhotos(false);

      return api.patch(`/inspections/${id ?? ''}/complete`, {
        conditionGrade: grade,
        ...checks,
        notes: notes.trim() || undefined,
        photoKeys,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspection', id] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', inspection?.asset.id] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['pending-inspections-dashboard'] });
      navigate('/inspections');
    },
    onError: (err: Error) => {
      setUploadingPhotos(false);
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!grade) {
      setError('Select a condition grade.');
      return;
    }
    // Ensure all non-threeWay items have been answered (not left as false by default is fine,
    // but check that user has interacted — for now we allow defaults)
    completeMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
    );
  }
  if (!inspection) {
    return (
      <div className="text-center py-16 text-gray-500">
        Inspection not found.{' '}
        <Link to="/inspections" className="text-[#E86F2C] underline">
          Back
        </Link>
      </div>
    );
  }

  const isComplete = inspection.status !== 'in_progress';

  const passCount = ALL_ITEMS.filter((item) => {
    const val = isComplete
      ? (inspection[item.key] as boolean | null)
      : (checks[item.key as string] as boolean | null);
    return isPass(item, val);
  }).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Inspections', to: '/inspections' },
          { label: inspection.asset.serialNumber },
        ]}
      />

      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/inspections')}
          className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">
              {inspection.asset.serialNumber}
            </h1>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${
                inspection.status === 'in_progress'
                  ? 'bg-amber-100 text-amber-700'
                  : inspection.status === 'completed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              {inspection.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {inspection.asset.manufacturer} {inspection.asset.model} ·{' '}
            <span className="capitalize">{inspection.type}</span> inspection · Started{' '}
            {new Date(inspection.startedAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        {isComplete && inspection.conditionGrade && (
          <span
            className={`px-3 py-1 rounded-lg text-sm font-bold border ${GRADE_LABELS[inspection.conditionGrade as Grade]?.color}`}
          >
            Grade {inspection.conditionGrade}
          </span>
        )}
        {!isComplete && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            <XOctagon size={15} />
            Cancel inspection
          </button>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <XOctagon size={20} className="text-red-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Cancel inspection?</h2>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              This will mark the inspection as cancelled and return the asset to storage. This
              cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Keep inspection
              </button>
              <button
                onClick={() => {
                  setShowCancelConfirm(false);
                  cancelMutation.mutate();
                }}
                disabled={cancelMutation.isPending}
                className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-40"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Completed read-only view ── */}
      {isComplete ? (
        <div className="space-y-4">
          {CHECKLIST_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700">{section.title}</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500 w-full">
                      Item
                    </th>
                    <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                      Yes
                    </th>
                    <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                      No
                    </th>
                    {section.items.some((i) => i.threeWay) && (
                      <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                        N/A
                      </th>
                    )}
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 text-center">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {section.items.map((item) => {
                    const val = inspection[item.key] as boolean | null;
                    const pass = isPass(item, val);
                    return (
                      <tr key={item.key as string} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-700">{item.label}</td>
                        <td className="px-4 py-3 text-center">
                          {val === true && (
                            <span className="inline-block w-4 h-4 rounded-full bg-[#E86F2C]" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {val === false && (
                            <span className="inline-block w-4 h-4 rounded-full bg-gray-400" />
                          )}
                        </td>
                        {section.items.some((i) => i.threeWay) && (
                          <td className="px-4 py-3 text-center">
                            {item.threeWay && val === null && (
                              <span className="inline-block w-4 h-4 rounded-full bg-gray-300" />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-center">
                          {val === null ? (
                            <MinusCircle size={16} className="text-gray-300 mx-auto" />
                          ) : pass ? (
                            <CheckCircle2 size={16} className="text-emerald-500 mx-auto" />
                          ) : (
                            <XCircle size={16} className="text-red-400 mx-auto" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {inspection.notes && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Notes</h2>
              <p className="text-sm text-gray-600">{inspection.notes}</p>
            </div>
          )}

          {inspection.photos.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                Photos ({inspection.photos.length})
              </h2>
              <div className="flex flex-wrap gap-3">
                {inspection.photos.map((p) => {
                  const parts = p.s3Key.split('/');
                  const filename = parts[parts.length - 1];
                  const src = `/api/v1/inspections/photos/${inspection.id}/${filename}`;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={async () => {
                        const token = localStorage.getItem('wh_token');
                        const res = await fetch(src, {
                          headers: token ? { Authorization: `Bearer ${token}` } : {},
                        });
                        if (!res.ok) return;
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                      }}
                      className="w-24 h-24 rounded-lg bg-gray-100 overflow-hidden block border border-gray-200 hover:border-[#E86F2C] transition-colors"
                    >
                      <AuthImage
                        src={src}
                        alt="Inspection photo"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {inspection.slaMinutes !== null && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-3">
              <Clock size={18} className="text-gray-400" />
              <span className="text-sm text-gray-600">
                Completed in{' '}
                <span className="font-semibold text-gray-900">
                  {inspection.slaMinutes} business minutes
                </span>
                {inspection.slaMinutes > 1440 && (
                  <span className="ml-2 text-xs text-red-600 font-medium">
                    SLA breached (target: 1440 min)
                  </span>
                )}
              </span>
            </div>
          )}

          <DocumentsPanel entityType="inspection" entityId={inspection.id} readOnly={false} />
        </div>
      ) : (
        /* ── In-progress form ── */
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Condition grade */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Condition grade <span className="text-red-500">*</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(Object.keys(GRADE_LABELS) as Grade[]).map((g) => {
                const { label, description, color } = GRADE_LABELS[g];
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${grade === g ? color : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <div className="font-bold text-sm">{label}</div>
                    <div className="text-xs mt-0.5 opacity-80">{description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Checklist sections */}
          {CHECKLIST_SECTIONS.map((section) => {
            const hasThreeWay = section.items.some((i) => i.threeWay);
            return (
              <div
                key={section.title}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">{section.title}</h2>
                  <span className="text-xs text-gray-400">
                    {
                      section.items.filter(
                        (i) =>
                          checks[i.key as string] !== undefined &&
                          checks[i.key as string] !== (i.threeWay ? undefined : false),
                      ).length
                    }
                    /{section.items.length} answered
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">
                        Item
                      </th>
                      <th className="text-center px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        Yes
                      </th>
                      <th className="text-center px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        No
                      </th>
                      {hasThreeWay && (
                        <th className="text-center px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          N/A
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {section.items.map((item) => {
                      const current = checks[item.key as string];
                      return (
                        <tr
                          key={item.key as string}
                          className="hover:bg-orange-50/30 transition-colors"
                        >
                          <td className="px-5 py-3.5 text-gray-700">{item.label}</td>
                          {/* Yes */}
                          <td className="px-5 py-3.5 text-center">
                            <input
                              type="radio"
                              name={item.key as string}
                              checked={current === true}
                              onChange={() => setCheck(item.key as string, true)}
                              className="w-4 h-4 accent-[#E86F2C] cursor-pointer"
                            />
                          </td>
                          {/* No */}
                          <td className="px-5 py-3.5 text-center">
                            <input
                              type="radio"
                              name={item.key as string}
                              checked={current === false}
                              onChange={() => setCheck(item.key as string, false)}
                              className="w-4 h-4 accent-[#E86F2C] cursor-pointer"
                            />
                          </td>
                          {/* N/A — only for three-way items */}
                          {hasThreeWay && (
                            <td className="px-5 py-3.5 text-center">
                              {item.threeWay ? (
                                <input
                                  type="radio"
                                  name={item.key as string}
                                  checked={current === null}
                                  onChange={() => setCheck(item.key as string, null)}
                                  className="w-4 h-4 accent-[#E86F2C] cursor-pointer"
                                />
                              ) : (
                                <span className="text-gray-200">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          {/* Photos */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Photos</h2>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-[#E86F2C] hover:underline"
              >
                <Camera size={14} />
                Add photos
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {photos.length === 0 ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-200 rounded-lg py-8 text-center text-sm text-gray-400 hover:border-[#E86F2C] hover:text-[#E86F2C] transition-colors"
              >
                <Camera size={20} className="mx-auto mb-1" />
                Upload 3 images — top, bottom, front
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {photos.map((p, idx) => (
                  <div key={idx} className="relative w-20 h-20 group">
                    <img
                      src={p.preview}
                      alt=""
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full hidden group-hover:flex items-center justify-center"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-gray-400 hover:border-[#E86F2C] hover:text-[#E86F2C] transition-colors"
                >
                  <Camera size={18} />
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Observations, discrepancies, or anything relevant…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] resize-none"
            />
          </div>

          {/* Documents */}
          <DocumentsPanel entityType="inspection" entityId={id ?? ''} />

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-gray-500">
              {passCount}/{ALL_ITEMS.length} items pass · {photos.length} photo
              {photos.length !== 1 ? 's' : ''}
            </span>
            <button
              type="submit"
              disabled={completeMutation.isPending || uploadingPhotos}
              className="bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploadingPhotos
                ? 'Uploading photos…'
                : completeMutation.isPending
                  ? 'Saving…'
                  : 'Complete inspection'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
