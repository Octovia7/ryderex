import { FileText, Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

// Mirrors the backend's multer config: 5 MB, JPEG/PNG/PDF checked by magic
// bytes server-side. Enforcing the same limits here turns a wasted upload
// and a 413 into instant feedback.
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'application/pdf'];
const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.pdf';

interface FileUploadProps {
  label: string;
  hint?: string;
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({ label, hint, value, onChange, disabled = false }: FileUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function accept(file: File | undefined) {
    if (file === undefined) return;

    if (!ACCEPTED.includes(file.type)) {
      setError('Upload a JPEG, PNG or PDF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is 5 MB.`);
      return;
    }

    setError(null);
    onChange(file);
  }

  if (value !== null) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">{label}</p>
        <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-surface p-3">
          <FileText className="size-5 shrink-0 text-accent-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{value.name}</p>
            <p className="text-xs text-ink-faint">{formatBytes(value.size)}</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            aria-label="Remove file"
            onClick={() => {
              onChange(null);
              if (inputRef.current !== null) inputRef.current.value = '';
            }}
            className="rounded p-1 text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>

      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-accent-700 bg-accent-50' : 'border-border-strong bg-canvas',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <Upload className="mb-2 size-6 text-ink-faint" aria-hidden />
        <span className="text-sm text-ink">
          <span className="font-medium text-accent-700">Choose a file</span> or drag it here
        </span>
        <span className="mt-1 text-xs text-ink-faint">JPEG, PNG or PDF · up to 5 MB</span>
      </label>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files?.[0]);
        }}
      />

      {error !== null && <p className="text-xs text-red-600">{error}</p>}
      {error === null && hint !== undefined && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
