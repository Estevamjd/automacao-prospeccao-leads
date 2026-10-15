/**
 * Utilidades do cadastro de CNPJ. Segmentos, estados e zonas ficam em
 * lib/geografia.ts (desde 29/09/2026, junto com a busca no mapa).
 */

/** Formata 14 digitos como 00.000.000/0000-00. */
export function formatarCnpj(valor?: string | null) {
  const d = (valor ?? '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null;
}
