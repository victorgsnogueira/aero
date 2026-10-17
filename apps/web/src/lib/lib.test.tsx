import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { intFromInput } from './numbers';
import { offerPrice } from './offer';
import { qs } from './api';
import { Pagination } from '../components/ui';

describe('utilitários', () => {
  it('intFromInput protege contra vazio e texto inválido', () => {
    expect(intFromInput('12', 5)).toBe(12);
    expect(intFromInput('', 5)).toBe(5);
    expect(intFromInput('abc', 5)).toBe(5);
  });

  it('offerPrice respeita o tipo de preço', () => {
    expect(offerPrice({ priceType: 'custom_quote', priceCents: null, currency: 'BRL' })).toBe('Orçamento personalizado');
    expect(offerPrice({ priceType: 'starting_at', priceCents: 99000, currency: 'BRL' })).toMatch(/^A partir de R\$\s?990,00$/);
  });

  it('qs ignora valores vazios', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: false })).toBe('?a=1&d=false');
  });
});

describe('Pagination', () => {
  it('navega entre páginas pelo teclado/mouse', async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageSize={50} total={120} onChange={onChange} />);
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
