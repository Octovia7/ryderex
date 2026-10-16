import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

interface TabsContextValue {
  baseId: string;
  active: string;
}

const Context = createContext<TabsContextValue | null>(null);

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  children: ReactNode;
  className?: string;
}

// Follows the ARIA tabs pattern: exactly one tab is in the tab order
// (roving tabindex) and Arrow keys move between them.
export function Tabs({ value, onValueChange, items, children, className }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const wrapped = (index + items.length) % items.length;
    const target = items[wrapped];
    if (target === undefined) return;
    onValueChange(target.value);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-index="${String(wrapped)}"]`)
      ?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTab(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={className}>
      <div ref={listRef} role="tablist" className="flex gap-1 border-b border-border-subtle">
        {items.map((item, index) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              data-tab-index={index}
              onClick={() => {
                onValueChange(item.value);
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
              className={cn(
                'relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                selected
                  ? 'border-accent-700 text-accent-700'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className="ml-1.5 text-ink-faint">({item.count})</span>
              )}
            </button>
          );
        })}
      </div>
      <Context.Provider value={{ baseId, active: value }}>{children}</Context.Provider>
    </div>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const context = useContext(Context);
  if (context === null) throw new Error('TabPanel must be used inside Tabs');

  if (context.active !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${context.baseId}-panel-${value}`}
      aria-labelledby={`${context.baseId}-tab-${value}`}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  'aria-label': string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => {
            onValueChange(option.value);
          }}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.value ? 'bg-accent-700 text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
