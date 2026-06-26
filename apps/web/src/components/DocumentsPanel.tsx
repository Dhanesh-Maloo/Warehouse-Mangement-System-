import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { FileText, Upload, Trash2, Download, AlertCircle } from 'lucide-react';

interface AssetDocument {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; fullName: string };
}

interface DocumentsPanelProps {
  entityType: 'asset' | 'inspection';
  entityId: string;
  readOnly?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentsPanel({ entityType, entityId, readOnly = false }: DocumentsPanelProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const queryKey = [entityType === 'asset' ? 'asset-docs' : 'inspection-docs', entityId];
  const listUrl =
    entityType === 'asset' ? `/assets/${entityId}/documents` : `/inspections/${entityId}/documents`;

  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<AssetDocument[]>(listUrl),
    enabled: !!entityId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== 'application/pdf') {
        throw new Error('Only PDF files are accepted');
      }
      const form = new FormData();
      form.append('file', file);
      const token = localStorage.getItem('wh_token');
      const uploadUrl = `/api/v1${listUrl}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      setUploadError('');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/documents/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError('');
    uploadMutation.mutate(files[0]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">
            Documents{' '}
            {docs.length > 0 && <span className="text-gray-400 font-normal">({docs.length})</span>}
          </h2>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-medium text-[#E86F2C] hover:text-[#D05E1E] disabled:opacity-50 transition-colors"
          >
            <Upload size={13} />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload PDF'}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="p-5 space-y-3">
        {!readOnly && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-lg py-6 text-center transition-colors ${
              isDragging
                ? 'border-[#E86F2C] bg-[#E86F2C]/5 text-[#E86F2C]'
                : 'border-gray-200 text-gray-400 hover:border-[#E86F2C] hover:text-[#E86F2C]'
            }`}
          >
            <Upload size={20} className="mx-auto mb-1.5" />
            <p className="text-sm">Drag & drop or click to upload PDF</p>
            <p className="text-xs mt-0.5 opacity-70">Max 20 MB · PDF only</p>
          </div>
        )}

        {uploadError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            {uploadError}
          </div>
        )}

        {isLoading ? (
          <div className="py-4 text-center text-sm text-gray-400">Loading…</div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-2">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.originalName}</p>
                  <p className="text-xs text-gray-400">
                    {formatBytes(doc.sizeBytes)} · {fmtDate(doc.uploadedAt)} ·{' '}
                    {doc.uploadedBy.fullName}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <a
                    href={`/api/v1/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-[#E86F2C] hover:bg-[#E86F2C]/5 transition-colors"
                    title="Download"
                  >
                    <Download size={14} />
                  </a>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(doc.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
