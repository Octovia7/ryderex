import { useEffect, useRef, useState } from 'react';
import { autocompletePlaces, PlacesUnavailableError } from '../api/places';
import type { PlaceSuggestion } from '../api/places';
import { cn } from '../lib/cn';

export interface LocationValue {
  label: string;
  lat: number | null;
  lng: number | null;
}

interface LocationFieldProps {
  label: string;
  placeholder: string;
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  dotColor: 'accent' | 'accent-2';
  dotShape: 'circle' | 'square';
}

const DEBOUNCE_MS = 300;

export function LocationField({
  label,
  placeholder,
  value,
  onChange,
  dotColor,
  dotShape,
}: LocationFieldProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function handleTextChange(text: string) {
    // Typing invalidates any previously selected coordinates — a selection
    // must come from the suggestion list, never be inferred from free text.
    onChange({ label: text, lat: null, lng: null });

    clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      autocompletePlaces(text, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setOpen(true);
          setUnavailable(false);
        })
        .catch((error) => {
          if (error instanceof PlacesUnavailableError) {
            setUnavailable(true);
          }
          if (error?.name !== 'AbortError') {
            setSuggestions([]);
          }
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
  }

  function selectSuggestion(suggestion: PlaceSuggestion) {
    onChange({ label: suggestion.label, lat: suggestion.lat, lng: suggestion.lon });
    setSuggestions([]);
    setOpen(false);
  }

  const dotColorClass = dotColor === 'accent' ? 'bg-accent-700' : 'bg-violet-500';
  const dotShadow =
    dotColor === 'accent' ? '0 0 10px rgba(15,118,110,.6)' : '0 0 10px rgba(139,92,246,.6)';

  return (
    <div className="relative">
      <label className="flex items-center gap-3.5 py-3">
        <span
          className={cn('size-2.5 shrink-0', dotColorClass, dotShape === 'circle' ? 'rounded-full' : 'rounded-sm')}
          style={{ boxShadow: dotShadow }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-ink-muted">{label}</span>
          <input
            type="text"
            value={value.label}
            onChange={(event) => handleTextChange(event.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder}
            className="w-full border-0 bg-transparent p-0 text-sm font-medium text-ink outline-none"
          />
        </span>
        {loading && <span className="font-mono text-[10px] text-ink-muted">…</span>}
      </label>

      {open && suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-[220px] overflow-y-auto rounded-xl border border-border-strong bg-surface p-1.5 shadow-lg">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId}>
              <button
                type="button"
                onClick={() => selectSuggestion(suggestion)}
                className="w-full rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium text-ink"
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {unavailable && (
        <p className="mt-1 text-xs text-red-600">Location search isn't available right now.</p>
      )}
    </div>
  );
}
