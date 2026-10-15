/**
 * "Nota de oportunidade" do passo Qualificar: 7 critérios simples, cada um
 * com o porquê à vista. Não substitui o score das regras (que ordena a
 * lista); explica em linguagem de gente por que vale (ou não) contatar.
 *
 * Três estados por critério: sim (conta ponto), não, e "?" quando a fonte
 * não informou — "não sabemos" não é "não tem" (mesma regra do consultor).
 */
import type { Empresa } from '@/lib/tipos';
import { telefoneWhatsapp } from '@/lib/comercial';

export type Criterio = { chave: string; rotulo: string; estado: 'sim' | 'nao' | 'talvez'; ajuda: string };

const sinal = (e: Empresa, k: string) => {
  const v = e.signals?.[k];
  return v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
};

function anosDeCnpj(e: Empresa): number | null {
  const inicio = e.metadata?.inicio_atividade;
  if (!inicio) return null;
  const d = new Date(`${inicio}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function criterios(e: Empresa): Criterio[] {
  const celular = !!telefoneWhatsapp(e.main_phone);
  const zapConfirmado = sinal(e, 'has_whatsapp') === true;
  const site = !!e.website_url || sinal(e, 'has_website') === true;
  const insta = !!e.instagram_url || sinal(e, 'has_instagram') === true;
  const anos = anosDeCnpj(e);
  const rede = sinal(e, 'is_chain') === true;
  return [
    { chave: 'whatsapp', rotulo: zapConfirmado ? 'WhatsApp confirmado' : 'Celular', estado: celular || zapConfirmado ? 'sim' : 'nao',
      ajuda: zapConfirmado ? 'WhatsApp confirmado pela fonte ou pela equipe.' : 'Celular disponível; confira se o número tem WhatsApp antes de enviar.' },
    { chave: 'email', rotulo: 'e-mail', estado: e.main_email ? 'sim' : 'nao',
      ajuda: 'Um segundo canal, se o WhatsApp não responder.' },
    { chave: 'sem_site', rotulo: site ? 'site encontrado' : 'site não informado', estado: site ? 'nao' : 'talvez',
      ajuda: site ? 'Há um endereço de site nas fontes.' : 'As fontes não informaram site; isso não prova que a empresa não tenha um.' },
    { chave: 'nova', rotulo: 'empresa nova', estado: anos === null ? 'talvez' : anos <= 3 ? 'sim' : 'nao',
      ajuda: 'CNPJ de até 3 anos: negócio ainda montando a presença digital.' },
    { chave: 'roteiro', rotulo: 'roteiro do segmento', estado: e.advisor_brief?.playbook_slug ? 'sim' : e.advisor_brief ? 'nao' : 'talvez',
      ajuda: 'O segmento tem pergunta e oferta prontas (playbook). Sem isso, a mensagem é genérica.' },
    { chave: 'instagram', rotulo: 'Instagram', estado: insta ? 'sim' : 'talvez',
      ajuda: 'Dá para olhar antes de escrever e citar algo real na mensagem.' },
    { chave: 'local', rotulo: 'decisão local', estado: rede ? 'nao' : 'talvez',
      ajuda: rede ? 'Há indício de rede ou franquia.' : 'Ainda não sabemos quem decide a contratação.' },
  ];
}

export function nota(e: Empresa) {
  return criterios(e).filter(c => c.estado === 'sim').length;
}

export function prioridade(e: Empresa): { rotulo: string; classe: string; motivo: string } {
  const score = e.score ?? 0;
  const rotulo = score >= 70 ? 'Alta' : score >= 45 ? 'Média' : 'Baixa';
  const classe = score >= 70 ? 'alta' : score >= 45 ? 'media' : 'baixa';
  const contato = e.main_phone
    ? telefoneWhatsapp(e.main_phone) ? 'celular para conferir no WhatsApp' : 'telefone para ligação'
    : e.main_email ? 'e-mail disponível' : 'contato não informado';
  const site = e.website_url ? 'site encontrado' : 'site não informado nas fontes';
  const segmento = e.advisor_brief?.segmento ?? e.category ?? 'segmento a confirmar';
  return { rotulo, classe, motivo: `${segmento}; ${contato}; ${site}.` };
}

export function fontesDe(e: Empresa): string {
  const f = new Set(e.metadata?.fontes ?? []);
  if (e.metadata?.fonte === 'receita_cnpj') f.add('cnpj');
  if (!f.size) f.add('mapa');
  return [...f].map(x => (x === 'cnpj' ? 'CNPJ' : x === 'mapa' ? 'mapa' : x)).join(' + ');
}
