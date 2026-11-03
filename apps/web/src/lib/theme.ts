import { useCallback, useSyncExternalStore } from 'react';

export type ThemeChoice = 'aero' | 'aero-dark' | 'system';
const KEY = 'aero-theme';
const listeners = new Set<() => void>();

function systemTheme(): 'aero' | 'aero-dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'aero-dark' : 'aero';
}

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'aero' || v === 'aero-dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice = readChoice()): void {
  document.documentElement.setAttribute('data-theme', choice === 'system' ? systemTheme() : choice);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (readChoice() === 'system') applyTheme('system');
    cb();
  };
  mq.addEventListener('change', onChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onChange);
  };
}

function persistChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    return;
  }
}

function readResolvedTheme(): 'aero' | 'aero-dark' {
  const choice = readChoice();
  return choice === 'system' ? systemTheme() : choice;
}

export function useResolvedTheme(): 'aero' | 'aero-dark' {
  return useSyncExternalStore(subscribe, readResolvedTheme, () => 'aero');
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readChoice, () => 'system' as ThemeChoice);
  const set = useCallback((c: ThemeChoice) => {
    persistChoice(c);
    applyTheme(c);
    listeners.forEach((l) => l());
  }, []);
  return [choice, set];
}
