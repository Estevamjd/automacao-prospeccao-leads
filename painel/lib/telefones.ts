/**
 * Todos os números de uma empresa (30/09).
 *
 * As fontes trazem mais de um número: o cadastro de CNPJ tem até 2 e o mapa
 * pode trazer outros. A junção no banco guarda todos em metadata.telefones;
 * o principal (main_phone) é para onde a mensagem vai. Aqui eles viram uma
 * lista única, sem repetição, com o tipo de cada um e o resultado do teste
 * de WhatsApp daquele número (metadata.whatsapp_numeros).
 */
import type { Empresa } from '@/lib/tipos';

export type Telefone = {
  /** Dígitos com DDD, sem +55: "21999990001". */
  digitos: string;
  /** "(21) 99999-0001" */
  formatado: string;
  tipo: 'celular' | 'fixo';
  principal: boolean;
  /** Resultado do teste de WhatsApp deste número: true, false ou null (não testado). */
  whatsapp: boolean | null;
  /**
   * O cadastro de CNPJ trouxe este celular no formato antigo (8 dígitos) e o
   * 9 foi acrescentado pela regra da Anatel (01/10). É celular, mas pode ter
   * mudado de dono: confira o nome no WhatsApp antes de mandar.
   */
  inferido: boolean;
};

/** Mesma regra de normalize_phone_br (banco) e _shared/canal.ts. */
export function digitosBr(valor?: string | null): string | null {
  let d = (valor ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return /^\d{10,11}$/.test(d) ? d : null;
}

export function formatar(d: string) {
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export function telefonesDe(e: Pick<Empresa, 'main_phone' | 'metadata' | 'signals'> | null | undefined): Telefone[] {
  if (!e) return [];
  const principal = digitosBr(e.main_phone);
  const testados = (e.metadata?.whatsapp_numeros ?? {}) as Record<string, boolean>;
  const lista = [principal, ...(e.metadata?.telefones ?? []).map(t => digitosBr(t))].filter((x): x is string => !!x);
  const unicos = [...new Set(lista)];
  const zapPrincipal = e.signals?.has_whatsapp === true ? true : e.signals?.has_whatsapp === false ? false : null;
  const inferidos = new Set((e.metadata?.telefones_inferidos ?? []).map(t => digitosBr(t)).filter(Boolean));
  return unicos.map(d => ({
    digitos: d,
    formatado: formatar(d),
    tipo: /^\d{2}9\d{8}$/.test(d) ? 'celular' as const : 'fixo' as const,
    principal: d === principal,
    whatsapp: d in testados ? !!testados[d] : d === principal ? zapPrincipal : null,
    inferido: inferidos.has(d),
  }))
    // Principal primeiro, depois celulares, depois fixos.
    .sort((a, b) => Number(b.principal) - Number(a.principal) || Number(b.tipo === 'celular') - Number(a.tipo === 'celular'));
}

/** Números em que dá para mandar WhatsApp: celular, ou fixo com WhatsApp confirmado. */
export function podeWhatsapp(t: Telefone) {
  return t.tipo === 'celular' || t.whatsapp === true;
}
