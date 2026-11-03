import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeadSortField, SortDirection } from '@aero/shared';
import type { LeadRow } from '../lib/types';
import { LeadTable } from './LeadTable';

afterEach(cleanup);

const items: LeadRow[] = [1, 2].map((id) => ({
  id,
  name: `Empresa ${id}`,
  category: null,
  city: null,
  state: null,
  countryCode: 'BR',
  hasCoords: false,
  latitude: null,
  longitude: null,
  isDemo: false,
  phoneId: null,
  phoneE164: null,
  phoneRaw: null,
  formatStatus: null,
  waStatus: null,
  waCheckedAt: null,
  phoneCount: 0,
  sharedPhone: false,
  suppressed: false,
  activeParticipations: 0,
  opportunityStage: null,
  lastSeenAt: '2026-10-17T12:00:00Z',
}));

function TableHarness() {
  const [selected, setSelected] = useState(new Set([999]));
  const [sort, setSort] = useState<{ field: LeadSortField; direction: SortDirection }>({ field: 'recent', direction: 'desc' });
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <output aria-label="Total selecionado">{selected.size}</output>
      <LeadTable
        items={items}
        selected={selected}
        sort={sort.field}
        direction={sort.direction}
        onToggle={toggle}
        onOpen={() => {}}
        onSelectPage={(checked) =>
          setSelected((current) => {
            const next = new Set(current);
            items.forEach((item) => {
              if (checked) next.add(item.id);
              else next.delete(item.id);
            });
            return next;
          })
        }
        onSort={(field) => setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }))}
      />
    </>
  );
}

describe('tabela de leads', () => {
  it('seleciona a página, indica seleção parcial e preserva a seleção de outras páginas', async () => {
    const user = userEvent.setup();
    render(<TableHarness />);
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar todos desta página' }));
    expect(screen.getByLabelText('Total selecionado').textContent).toBe('3');
    expect((screen.getByRole('checkbox', { name: 'Selecionar Empresa 1' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Empresa 1' }));
    const master = screen.getByRole('checkbox', { name: 'Selecionar todos desta página' }) as HTMLInputElement;
    expect(master.indeterminate).toBe(true);
    expect(master.getAttribute('aria-checked')).toBe('mixed');
    await user.click(master);
    await user.click(screen.getByRole('checkbox', { name: 'Desmarcar todos desta página' }));
    expect(screen.getByLabelText('Total selecionado').textContent).toBe('1');
    expect((screen.getByRole('checkbox', { name: 'Selecionar Empresa 2' }) as HTMLInputElement).checked).toBe(false);
  });

  it('alterna a direção e anuncia qual coluna está ordenada', async () => {
    const user = userEvent.setup();
    render(<TableHarness />);
    expect(screen.getByRole('columnheader', { name: 'Visto em' }).getAttribute('aria-sort')).toBe('descending');
    await user.click(screen.getByRole('button', { name: 'Empresa' }));
    expect(screen.getByRole('columnheader', { name: 'Empresa' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Visto em' }).getAttribute('aria-sort')).toBe('none');
    await user.click(screen.getByRole('button', { name: 'Empresa' }));
    expect(screen.getByRole('columnheader', { name: 'Empresa' }).getAttribute('aria-sort')).toBe('descending');
    await user.click(screen.getByRole('button', { name: 'Telefone' }));
    expect(screen.getByRole('columnheader', { name: 'Telefone' }).getAttribute('aria-sort')).toBe('ascending');
  });
});
