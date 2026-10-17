import type { Service } from '@aero/shared';
import type { QualificationQuestion } from '../../db/schema.ts';

// Textos iniciais EDITÁVEIS. São copiados para a campanha na criação e, a partir
// daí, vivem no banco — não há conteúdo comercial fixo no fluxo de envio.

export const DEFAULT_FIRST_MESSAGE: Record<Service, string> = {
  landing_page: [
    'Olá! Sou {{remetente_nome}}, da {{remetente_empresa}}. Encontrei o contato comercial da {{empresa_lead}} no Google Maps.',
    '',
    'Criamos páginas para apresentar serviços e facilitar pedidos de orçamento pelo WhatsApp.',
    '',
    'Posso enviar uma breve apresentação? Se não tiver interesse, é só me avisar.',
  ].join('\n'),
  micro_saas: [
    'Olá! Sou {{remetente_nome}}, da {{remetente_empresa}}. Encontrei o contato comercial da {{empresa_lead}} no Google Maps.',
    '',
    'Desenvolvemos pequenos sistemas sob medida — por exemplo, para organizar agendamentos, pedidos, cadastros ou controles que hoje ficam em planilhas e papel.',
    '',
    'Posso enviar uma breve apresentação? Se não tiver interesse, é só me avisar.',
  ].join('\n'),
};

export const DEFAULT_PRESENTATION: Record<Service, string> = {
  landing_page: [
    'Obrigado pelo retorno! Em resumo: criamos uma página na internet para a {{empresa_lead}}, com seus serviços, fotos, localização e um botão que leva o cliente direto para o seu WhatsApp.',
    'Oferta atual: {{oferta_nome}} — {{oferta_preco}}.',
    '',
    'Para eu entender se faz sentido, posso fazer algumas perguntas rápidas?',
  ].join('\n'),
  micro_saas: [
    'Obrigado pelo retorno! Em resumo: criamos um sistema simples, feito para a rotina da {{empresa_lead}}, acessível pelo navegador ou celular.',
    'Oferta atual: {{oferta_nome}} — {{oferta_preco}}.',
    '',
    'Para eu entender se faz sentido, posso fazer algumas perguntas rápidas?',
  ].join('\n'),
};

export const DEFAULT_QUESTIONS: Record<Service, QualificationQuestion[]> = {
  landing_page: [
    { key: 'objetivo', text: 'Qual seria o principal objetivo da página? (ex.: receber pedidos de orçamento, divulgar um serviço, captar agendamentos)' },
    { key: 'oferta', text: 'Qual serviço ou produto você mais gostaria de destacar?' },
    { key: 'publico', text: 'Quem é o cliente que você quer atrair?' },
    { key: 'trafego', text: 'Como as pessoas chegariam até a página? (Instagram, Google, anúncios, indicação…)' },
    { key: 'materiais', text: 'Você já tem fotos, logotipo e textos, ou precisaria de ajuda com isso?' },
    { key: 'prazo', text: 'Para quando você precisaria da página?' },
    { key: 'orcamento', text: 'Você já tem uma faixa de investimento em mente?' },
  ],
  micro_saas: [
    { key: 'problema', text: 'Qual tarefa ou problema do dia a dia você gostaria de resolver com um sistema?' },
    { key: 'processo_atual', text: 'Como isso é feito hoje? (planilha, caderno, WhatsApp, outro sistema…)' },
    { key: 'usuarios', text: 'Quantas pessoas usariam o sistema e quem são elas?' },
    { key: 'funcionalidades', text: 'Quais são as 2 ou 3 funções indispensáveis?' },
    { key: 'integracoes', text: 'Precisa se conectar com algo que você já usa? (pagamentos, agenda, nota fiscal…)' },
    { key: 'cobranca', text: 'O sistema precisaria cobrar assinaturas ou pagamentos de clientes?' },
    { key: 'prazo', text: 'Para quando você precisaria?' },
    { key: 'orcamento', text: 'Você já tem uma faixa de investimento em mente?' },
  ],
};

export const DEFAULT_QUALIFICATION_DONE =
  'Obrigado pelas respostas! Vou analisar e te retorno pessoalmente com uma proposta. Se quiser adiantar alguma informação, fique à vontade.';

export const DEFAULT_DECLINE_ACK = 'Tudo bem, obrigado pelo retorno! Não enviaremos mais mensagens.';

/** Domingo=0 … Sábado=6. Padrão: dias úteis. */
export const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5];
