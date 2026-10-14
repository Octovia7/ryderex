import { useEffect, useRef, useState } from 'react';
import { autocompletePlaces, PlacesUnavailableError } from '../api/places';
import type { PlaceSuggestion } from '../api/places';

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

  const dotStyle =
    dotShape === 'circle'
      ? { borderRadius: '50%' }
      : { borderRadius: 3 };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' }}>
        <span
          style={{
            width: 10,
            height: 10,
            flexShrink: 0,
            background: `var(--${dotColor})`,
            boxShadow: `0 0 10px var(--${dotColor})`,
            ...dotStyle,
          }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '.14em',
              color: 'var(--text-muted)',
            }}
          >
            {label}
          </span>
          <input
            type="text"
            value={value.label}
            onChange={(event) => handleTextChange(event.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder}
            style={{
              background: 'transparent',
              border: 0,
              outline: 'none',
              color: 'var(--text)',
              font: '500 15px var(--font-ui)',
              padding: 0,
              width: '100%',
            }}
          />
        </span>
        {loading && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
            …
          </span>
        )}
      </label>

      {open && suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            zIndex: 10,
            margin: '4px 0 0',
            padding: 6,
            listStyle: 'none',
            borderRadius: 16,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: '0 18px 40px rgba(0,0,0,.35)',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId}>
              <button
                type="button"
                onClick={() => selectSuggestion(suggestion)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: 0,
                  background: 'transparent',
                  color: 'var(--text)',
                  font: '500 14px var(--font-ui)',
                  cursor: 'pointer',
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {unavailable && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--warning)' }}>
          Location search isn't available right now.
        </p>
      )}
    </div>
  );
}
