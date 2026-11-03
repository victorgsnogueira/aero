import { useState } from 'react';
import { parseMoneyToCents } from '@aero/shared';

export function MoneyInput({ id, cents, onChange, placeholder }: { id: string; cents: number | null; onChange: (cents: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));
  const [invalid, setInvalid] = useState(false);
  return (
    <input
      id={id}
      inputMode="decimal"
      className={`input w-full tabular-nums ${invalid ? 'input-error' : ''}`}
      value={text}
      placeholder={placeholder ?? '0,00'}
      aria-invalid={invalid}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) {
          setInvalid(false);
          onChange(null);
          return;
        }
        const v = parseMoneyToCents(e.target.value);
        setInvalid(v === null || v < 0);
        if (v !== null && v >= 0) onChange(v);
      }}
    />
  );
}
