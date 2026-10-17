import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, extractVariables } from './template.ts';
import { parseMoneyToCents, sumByCurrency, formatMoney } from './money.ts';

test('renderTemplate substitui variáveis e aponta ausentes e desconhecidas', () => {
  const r = renderTemplate('Olá! Sou {{remetente_nome}}, da {{remetente_empresa}}. {{foo}} {{empresa_lead}}', {
    remetente_nome: 'Ana',
    remetente_empresa: '',
  });
  assert.equal(r.text, 'Olá! Sou Ana, da {{remetente_empresa}}. {{foo}} {{empresa_lead}}');
  assert.deepEqual(r.missing.sort(), ['empresa_lead', 'remetente_empresa']);
  assert.deepEqual(r.unknown, ['foo']);
});

test('extractVariables lista variáveis únicas', () => {
  assert.deepEqual(extractVariables('{{a}} {{ b }} {{a}}'), ['a', 'b']);
});

test('parseMoneyToCents aceita formatos BR e US sem float', () => {
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents('1234.5'), 123450);
  assert.equal(parseMoneyToCents('R$ 990'), 99000);
  assert.equal(parseMoneyToCents('0,1'), 10);
  assert.equal(parseMoneyToCents(''), null);
});

test('sumByCurrency não mistura moedas', () => {
  assert.deepEqual(
    sumByCurrency([
      { amountCents: 100, currency: 'BRL' },
      { amountCents: 50, currency: 'USD' },
      { amountCents: 25, currency: 'BRL' },
    ]),
    { BRL: 125, USD: 50 },
  );
  assert.match(formatMoney(123456, 'BRL'), /1\.234,56/);
});
