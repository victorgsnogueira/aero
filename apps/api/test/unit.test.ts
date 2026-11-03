import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply } from '../src/modules/automation/classifier.ts';
import { normalizePhone, jidToE164 } from '../src/lib/phone.ts';
import { isWithinWindow, nextWindowStart } from '../src/lib/schedule.ts';
import { parseScraperCsv, usableCoordinate, domainFromUrl } from '../src/integrations/scraper/csv.ts';
import { signWebhookBody, verifyWebhookSignature, webhookEventKey } from '../src/integrations/wa/webhook.ts';
import { HttpError } from '../src/lib/http.ts';
import { fixture } from './helpers.ts';

describe('classificador de respostas', () => {
  const first = (t: string) => classifyReply(t, 'first_contact').kind;
  const qual = (t: string) => classifyReply(t, 'qualification').kind;

  test('recusas têm prioridade, inclusive com "sim" no texto', () => {
    assert.equal(first('Não tenho interesse'), 'refusal');
    assert.equal(first('nao obrigado'), 'refusal');
    assert.equal(first('Por favor me remova da lista'), 'refusal');
    assert.equal(first('sim, pode parar de mandar mensagem'), 'refusal');
    assert.equal(first('Não'), 'refusal');
    assert.equal(first('STOP'), 'refusal');
    assert.equal(first('Já temos site, obrigado'), 'refusal');
  });

  test('"sim" no meio de outra frase não é autorização', () => {
    assert.notEqual(first('Assim fica difícil, quem é você?'), 'affirmative');
    assert.notEqual(first('Sim, mas quanto custa?'), 'affirmative');
    assert.equal(first('Sim, mas quanto custa?'), 'question');
    assert.notEqual(first('Sim, sou o dono, mas agora estou ocupado demais para isso e depois vejo'), 'affirmative');
  });

  test('afirmativas curtas e inequívocas', () => {
    for (const t of ['Sim', 'Pode mandar', 'pode sim!', 'Ok, pode enviar', 'Bom dia, pode mandar sim', 'Claro', 'Tenho interesse', 'manda 👍']) {
      assert.equal(first(t), 'affirmative', t);
    }
  });

  test('mensagens automáticas do destinatário', () => {
    assert.equal(first('Olá! Obrigado por entrar em contato. Em breve retornaremos.'), 'auto_reply');
    assert.equal(first('Nosso horário de atendimento é de seg a sex, 8h às 18h.'), 'auto_reply');
    assert.equal(first('Seja bem-vindo à Clínica X! Como podemos ajudar?'), 'auto_reply');
  });

  test('fora do roteiro vai para humano', () => {
    assert.equal(first('Quem te passou meu número?'), 'question');
    assert.equal(first('Me liga amanhã'), 'unrecognized');
    assert.equal(first(''), 'unrecognized');
  });

  test('na qualificação, "não" é resposta — exceto opt-out explícito', () => {
    assert.equal(qual('Não'), 'answer');
    assert.equal(qual('Ainda não tenho fotos'), 'answer');
    assert.equal(qual('Quero receber pedidos de orçamento'), 'answer');
    assert.equal(qual('Quanto fica?'), 'question');
    assert.equal(qual('Qual o valor da mensalidade'), 'question');
    assert.equal(qual('Não quero mais, pode parar'), 'refusal');
  });
});

describe('normalização de telefone', () => {
  test('celular BR com contexto de país', () => {
    const n = normalizePhone('(11) 98765-4321', 'BR');
    assert.equal(n.formatStatus, 'valid');
    assert.equal(n.e164, '+5511987654321');
  });
  test('não inventa DDD: número local sem DDD fica para revisão ou inválido', () => {
    const n = normalizePhone('8765-4321', 'BR');
    assert.notEqual(n.formatStatus, 'valid');
    assert.equal(n.e164, null);
  });
  test('sem país de contexto e sem DDI: revisão, nunca válido', () => {
    const n = normalizePhone('11987654321', null);
    assert.equal(n.formatStatus, 'needs_review');
    assert.equal(n.e164, null);
  });
  test('formato internacional dispensa o país de contexto', () => {
    const n = normalizePhone('+1 201-555-0123', 'BR');
    assert.equal(n.e164, '+12015550123');
  });
  test('curto demais é inválido', () => {
    assert.equal(normalizePhone('12345', 'BR').formatStatus, 'invalid');
  });
  test('JID pessoal ↔ E.164', () => {
    assert.equal(jidToE164('5511987654321@s.whatsapp.net'), '+5511987654321');
    assert.equal(jidToE164('5511987654321:12@s.whatsapp.net'), '+5511987654321');
    assert.equal(jidToE164('123456789@lid'), null);
  });
});

describe('janelas de envio com fuso explícito', () => {
  const w = { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  test('respeita o fuso da campanha, não o do computador', () => {
    assert.equal(isWithinWindow(new Date('2026-10-14T13:00:00Z'), w), true);
    assert.equal(isWithinWindow(new Date('2026-10-14T22:00:00Z'), w), false);
    assert.equal(isWithinWindow(new Date('2026-10-17T13:00:00Z'), w), false);
  });
  test('próximo início de janela', () => {
    const next = nextWindowStart(new Date('2026-10-16T22:30:00Z'), w);
    assert.equal(next?.toISOString(), '2026-10-19T12:00:00.000Z');
  });
  test('fuso de outra região', () => {
    const lisboa = { ...w, timezone: 'Europe/Lisbon' };
    assert.equal(isWithinWindow(new Date('2026-10-14T08:30:00Z'), lisboa), true);
    assert.equal(isWithinWindow(new Date('2026-10-14T08:30:00Z'), w), false);
  });
});

describe('CSV do scraper', () => {
  test('interpreta colunas e descarta coordenadas inutilizáveis', () => {
    const places = parseScraperCsv(fixture('scraper-sample.csv'));
    assert.equal(places.length, 8);
    const noPhone = places.find((p) => p.placeId === 'ChIJ_test_p4')!;
    assert.equal(noPhone.phone, null);
    assert.equal(noPhone.latitude, null, '(0,0) não é coordenada real');
    assert.equal(places[0]!.completeAddress?.city, 'São Paulo');
  });
  test('rejeita CSV sem colunas esperadas', () => {
    assert.throws(() => parseScraperCsv('a,b\n1,2\n'), /colunas esperadas/);
  });
  test('utilitários', () => {
    assert.equal(usableCoordinate(91, 10), false);
    assert.equal(domainFromUrl('https://www.Exemplo.com/x'), 'exemplo.com');
  });
});

describe('webhook do gateway', () => {
  test('assinatura HMAC sobre o corpo bruto', () => {
    const body = JSON.stringify({ event: 'test' });
    const sig = signWebhookBody(body, 's3gredo');
    assert.equal(verifyWebhookSignature(body, sig, 's3gredo'), true);
    assert.equal(verifyWebhookSignature(body + ' ', sig, 's3gredo'), false);
    assert.equal(verifyWebhookSignature(body, sig, 'outro'), false);
    assert.equal(verifyWebhookSignature(body, undefined, 's3gredo'), false);
  });
  test('chave de deduplicação estável', () => {
    const p = { event: 'message.received', sessionId: 's', timestamp: 't1', data: { key: { id: 'ABC' } } };
    assert.equal(webhookEventKey(p), webhookEventKey({ ...p, timestamp: 't2' }));
    const s1 = { event: 'message.status', sessionId: 's', timestamp: 't', data: { keyId: 'K', status: 'DELIVERED' } };
    const s2 = { ...s1, data: { keyId: 'K', status: 'READ' } };
    assert.notEqual(webhookEventKey(s1), webhookEventKey(s2));
  });
});

test('classificação de falhas HTTP: timeout é resultado desconhecido; conexão recusada não', () => {
  assert.equal(new HttpError('timeout', 'x').outcomeUnknown, true);
  assert.equal(new HttpError('http', 'x', 502).outcomeUnknown, true);
  assert.equal(new HttpError('connect', 'x').outcomeUnknown, false);
  assert.equal(new HttpError('http', 'x', 400).outcomeUnknown, false);
});
