export const TEMPLATE_VARIABLES = {
  remetente_nome: 'Seu nome (Configurações)',
  remetente_empresa: 'Nome da sua empresa (Configurações)',
  empresa_lead: 'Nome do estabelecimento',
  categoria_lead: 'Categoria do estabelecimento',
  cidade_lead: 'Cidade do estabelecimento',
  oferta_nome: 'Nome da oferta da campanha',
  oferta_preco: 'Preço formatado da oferta',
  oferta_implantacao: 'Valor de implantação',
  oferta_mensalidade: 'Mensalidade',
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
export type TemplateValues = Partial<Record<TemplateVariable, string | null | undefined>>;

const VARIABLE_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export interface RenderResult {
  text: string;

  missing: string[];

  unknown: string[];
}

export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VARIABLE_RE)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function renderTemplate(template: string, values: TemplateValues): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = template.replace(VARIABLE_RE, (whole, name: string) => {
    if (!(name in TEMPLATE_VARIABLES)) {
      unknown.add(name);
      return whole;
    }
    const value = values[name as TemplateVariable];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.add(name);
      return whole;
    }
    return String(value);
  });
  return { text: text.trim(), missing: [...missing], unknown: [...unknown] };
}
