export const COLUNAS_EMPRESA = 'id,name,status,score,city,state,category,main_phone,main_email,address_line,website_url,instagram_url,outcome_reason,manual_overrides,fit_summary,recommended_offer,advisor_brief,opt_out_at,updated_at,metadata,signals,data_source_url,data_collected_at';

export function diaNoRio(data: Date | string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(data));
}
