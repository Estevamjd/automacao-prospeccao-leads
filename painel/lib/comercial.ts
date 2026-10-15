export const ETAPAS: Record<string, string> = {
  new: 'Novo', researching: 'Em pesquisa', qualified: 'Qualificado',
  ready_for_outreach: 'Pronto para contato', contacted: 'Contato feito',
  responded: 'Respondeu', meeting_scheduled: 'Reunião marcada',
  won: 'Contrato fechado', lost: 'Não fechou', rejected: 'Descartado',
};
export const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
export const dataLocal = (valor?: string | null) => valor ? new Date(valor.length === 10 ? `${valor}T12:00:00` : valor).toLocaleDateString('pt-BR') : 'Não informado';
export function urlSegura(valor?: string | null) {
  try { const url = new URL(valor ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
/** Digitos do numero sem o 55 do pais e sem o 0 de tronco. Mesma regra de _shared/canal.ts. */
function digitosLocais(valor?: string | null) {
  const n = (valor ?? '').replace(/\D/g, '');
  return (n.length > 11 && n.startsWith('55') ? n.slice(2) : n).replace(/^0+/, '');
}

/**
 * Link do WhatsApp so para CELULAR (DDD + 9 + 8 digitos). E a mesma regra do
 * banco (canal_de_abordagem) e da Edge Function (_shared/canal.ts): as tres
 * precisam andar juntas.
 */
export function telefoneWhatsapp(valor?: string | null) {
  const local = digitosLocais(valor);
  return /^\d{2}9\d{8}$/.test(local) ? `https://wa.me/55${local}` : null;
}

/**
 * Link do WhatsApp para qualquer numero brasileiro valido. Usado so quando o
 * banco ja decidiu que o canal e WhatsApp (ex.: fixo com WhatsApp Business
 * confirmado). Para decidir o canal, use telefoneWhatsapp.
 */
export function whatsappDoNumero(valor?: string | null) {
  const local = digitosLocais(valor);
  return /^\d{10,11}$/.test(local) ? `https://wa.me/55${local}` : null;
}

/** Link tel: com +55, para o botao "Ligar" funcionar no celular. */
export function linkLigar(valor?: string | null) {
  const local = digitosLocais(valor);
  return /^\d{10,11}$/.test(local) ? `tel:+55${local}` : null;
}

/**
 * Procurar o WhatsApp de quem so tem fixo na fonte. O OpenStreetMap quase
 * nunca traz o celular; o Google e o Maps costumam trazer (perfil da empresa,
 * Instagram, cardapio). Nao raspa nada: abre a busca para o Estevam olhar.
 */
export function buscasWhatsapp(nome: string, cidade?: string | null, bairro?: string | null) {
  const onde = [bairro?.trim(), cidade?.trim() || 'Rio de Janeiro'].filter(Boolean).join(' ');
  return {
    // Sem aspas: o nome fantasia do CNPJ quase nunca é escrito igual ao do Google.
    google: `https://www.google.com/search?q=${encodeURIComponent(`${nome} ${onde} whatsapp`)}`,
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nome} ${onde}`)}`,
  };
}

const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/**
 * Onde olhar antes de escrever (30/09). Muita empresa do CNPJ não tem perfil
 * no Google com o mesmo nome: por isso, além do nome, vão o endereço (abre o
 * ponto no mapa, dá para ver a fachada) e o número do CNPJ (costuma achar a
 * empresa em listas e redes com outros telefones). Só abre buscas; não raspa nada.
 */
export function buscasEmpresa(e: { name: string; city: string | null; address_line: string | null; metadata: { bairro?: string | null; cnpj?: string } | null }) {
  const cidade = e.city?.trim() || 'Rio de Janeiro';
  const bairro = e.metadata?.bairro?.trim() ?? '';
  const rua = (e.address_line ?? '').split(' - ')[0].trim();
  const cnpj = (e.metadata?.cnpj ?? '').replace(/\D/g, '');
  return {
    google: google(`${e.name} ${bairro} ${cidade}`.replace(/\s+/g, ' ')),
    maps: maps(`${e.name} ${bairro} ${cidade}`.replace(/\s+/g, ' ')),
    endereco: rua ? maps(`${rua}, ${bairro ? `${bairro}, ` : ''}${cidade}`) : null,
    cnpj: cnpj.length === 14
      ? google(`"${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}"`)
      : null,
  };
}

/**
 * Sugestoes rapidas de motivo. O banco exige motivo para "Contrato fechado" e
 * "Nao fechou" (salvar_acompanhamento_v2); sem ele o formulario falhava.
 * Sao so atalhos: o campo aceita qualquer texto de ate 200 caracteres.
 */
export const MOTIVOS: Record<'won' | 'lost', string[]> = {
  won: ['Resolveu uma dor clara', 'Preço coube no orçamento', 'Indicação', 'Confiança na conversa'],
  lost: ['Sem orçamento agora', 'Já tem uma solução', 'Não viu necessidade', 'Parou de responder', 'Decisão não é na loja'],
};
