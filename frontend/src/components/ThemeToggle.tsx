import { useTheme } from '../theme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      style={{
        height: 44,
        minWidth: 44,
        padding: '0 16px',
        borderRadius: 'var(--radius-chip)',
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        color: 'var(--text)',
        font: '600 13px var(--font-ui)',
        cursor: 'pointer',
      }}
    >
      {theme === 'dark' ? 'Dark' : 'Light'} theme
    </button>
  );
}
