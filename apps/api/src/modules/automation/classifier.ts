import type { ReplyClass } from '@aero/shared';

export type ClassifyContext = 'first_contact' | 'qualification';

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}|\u{FE0F}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(norm: string): string[] {
  return norm
    .replace(/[^a-z0-9?\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const STRONG_OPT_OUT: RegExp[] = [
  /\b(pare|parem|parar|para de|pode parar)\b/,
  /\b(sair|me tira|me tire|tira meu|remove|remover|remova|removam|exclua|excluir)\b/,
  /\bdescadastr/,
  /\b(nao|n) (me )?(mande|mandem|envie|envia|enviem|chame|chamem|incomode|incomodem|ligue|perturbe)\b/,
  /\bnao (tenho|temos) (nenhum )?interesse\b/,
  /\bsem interesse\b/,
  /\bnao (quero|queremos|preciso|precisamos)( mais)?\b(?!.{0,20}\b(saber|entender|ver)\b)/,
  /\b(spam|bloquear|bloqueado|denunciar|denuncia)\b/,
  /\b(stop|unsubscribe)\b/,
  /\bdesisti/,
  /\bnao (obrigad|obg)/,
  /\bnao,? obrigad/,
  /\bnao tenho tempo\b/,
  /\bja (tenho|temos) (site|pagina|sistema|landing|fornecedor)\b/,
];

const SOFT_NEGATIVE: RegExp[] = [/^(nao|n|nop|nope|negativo|agora nao|nao agora|no momento nao|nao por enquanto|por enquanto nao)[.! ]*$/, /^(nao|n)[,.!]? obrigad/];

const AUTO_REPLY: RegExp[] = [
  /mensagem automatica/,
  /resposta automatica/,
  /(obrigad[oa]|agradecemos) (por|pelo|o) (seu |sua |o )?(contato|mensagem)/,
  /agradecemos (seu|o) contato/,
  /(em breve|logo) (retornaremos|responderemos|um atendente)/,
  /retornaremos (em breve|o mais breve|assim que)/,
  /(nosso )?horario de (atendimento|funcionamento)/,
  /fora do (nosso )?horario/,
  /(seja )?bem[- ]vind[oa] (a|ao|à)/,
  /como (podemos|posso) (te )?ajudar/,
  /no momento (nao )?(estamos|estou) (disponive|indisponive|ausente)/,
  /estamos (ausentes|fechados)/,
  /digite (o )?(numero|uma das opcoes|1)/,
];

const GREETING = new Set(['oi', 'ola', 'opa', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'e', 'ai', 'eai', 'hello', 'hi', 'prezado', 'prezada', 'amigo', 'amiga']);
const AFFIRM_STRONG = new Set(['sim', 's', 'pode', 'manda', 'mande', 'envia', 'envie', 'enviar', 'mandar', 'quero', 'claro', 'ok', 'okay', 'okey', 'interesse', 'aguardo', 'gostaria', 'yes', 'sure', 'beleza', 'blz', 'show', 'positivo', 'certeza', 'bora']);
const AFFIRM_FILLER = new Set([
  'sim', 's', 'pode', 'manda', 'mande', 'envia', 'envie', 'enviar', 'mandar', 'quero', 'claro', 'ok', 'okay', 'okey', 'interesse', 'aguardo', 'gostaria',
  'yes', 'sure', 'beleza', 'blz', 'show', 'positivo', 'certeza', 'bora', 'tenho', 'temos', 'por', 'favor', 'pf', 'pfv', 'sim,', 'ser', 'com', 'pra', 'para', 'mim',
  'me', 'a', 'o', 'apresentacao', 'fico', 'no', 'de', 'receber', 'sim.', 'vamos', 'la', 'ver', 'conhecer', 'saber', 'mais', 'tambem', 'obrigado', 'obrigada', 'obg', 'vlw', 'valeu', 'sim!', 'gostaria', 'sem', 'problema', 'problemas', 'perfeito', 'otimo', 'legal',
]);
const NEGATION = new Set(['nao', 'n', 'nem', 'nunca', 'jamais', 'negativo']);
const QUESTION_START = /^(quanto|qual|quais|como|quem|onde|quando|o que|por que|porque|pq|cade|voces|vcs|e o|e a|e quanto)\b/;
const PRICE_WORDS = /\b(preco|custa|custo|quanto|desconto|parcela|parcelar|negociar|caro)\b/;

export interface Classification {
  kind: ReplyClass;
  reason: string;
}

export function classifyReply(text: string | null | undefined, context: ClassifyContext): Classification {
  const raw = (text ?? '').trim();
  if (!raw) return { kind: 'unrecognized', reason: 'Mensagem sem texto (mídia, figurinha ou vazia)' };
  const norm = normalizeText(raw);

  for (const re of STRONG_OPT_OUT) if (re.test(norm)) return { kind: 'refusal', reason: `Recusa explícita (${re.source})` };
  if (context === 'first_contact') {
    for (const re of SOFT_NEGATIVE) if (re.test(norm)) return { kind: 'refusal', reason: 'Negativa à primeira abordagem' };
  }
  for (const re of AUTO_REPLY) if (re.test(norm)) return { kind: 'auto_reply', reason: 'Padrão de resposta automática' };

  const hasQuestion = raw.includes('?') || QUESTION_START.test(norm);
  if (hasQuestion || (context === 'qualification' && PRICE_WORDS.test(norm))) {
    return { kind: 'question', reason: hasQuestion ? 'Pergunta do contato' : 'Assunto comercial (preço/negociação)' };
  }

  if (context === 'qualification') {
    return { kind: 'answer', reason: 'Resposta à pergunta de qualificação' };
  }

  const toks = tokens(norm).filter((t) => !GREETING.has(t));
  if (toks.length === 0) return { kind: 'unrecognized', reason: 'Apenas saudação' };
  if (toks.some((t) => NEGATION.has(t))) return { kind: 'unrecognized', reason: 'Contém negação; requer leitura humana' };
  const isShort = toks.length <= 8;
  const allKnown = toks.every((t) => AFFIRM_FILLER.has(t));
  const hasStrong = toks.some((t) => AFFIRM_STRONG.has(t));
  if (isShort && allKnown && hasStrong) return { kind: 'affirmative', reason: 'Autorização curta e inequívoca' };
  return { kind: 'unrecognized', reason: 'Fora do roteiro' };
}
