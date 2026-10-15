// Escolha do canal de abordagem.
//
// POR QUE ISSO EXISTE COMO ARQUIVO SEPARADO:
// Na primeira rodada real, as 5 mensagens sairam marcadas como "email" para
// leads que so tinham telefone. A causa nao era regra de negocio: os dois
// message_templates tinham o mesmo created_at, entao o "order by created_at"
// era instavel e sorteava o template errado — e o canal vinha do template.
// Canal e uma decisao de negocio; nao pode ser efeito colateral de ordenacao.
// Aqui ele passa a sair do contato que a empresa REALMENTE tem.

export type Canal = "whatsapp" | "email" | "phone";

export type ContatoDaEmpresa = {
  main_phone?: unknown;
  main_email?: unknown;
  signals?: unknown;
};

function textoUtil(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Um e-mail so serve como canal se for plausivel. Barra "-", "n/a", lixo. */
export function emailPlausivel(v: unknown): boolean {
  const s = textoUtil(v).toLowerCase();
  if (s.length < 6 || s.length > 254) return false;
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/.test(s);
}

/** Telefone brasileiro util tem 10 ou 11 digitos depois de tirar o +55. */
export function telefonePlausivel(v: unknown): boolean {
  let d = textoUtil(v).replace(/\D+/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return d.length === 10 || d.length === 11;
}

/** Digitos do numero sem o 55 do pais e sem o 0 de tronco. */
function digitosLocais(v: unknown): string {
  let d = textoUtil(v).replace(/\D+/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.replace(/^0+/, "");
}

/**
 * Celular brasileiro: DDD + 9 + 8 digitos. E a MESMA regra do painel
 * (painel/lib/comercial.ts, telefoneWhatsapp) e do banco
 * (public.canal_de_abordagem). As tres precisam andar juntas: quando so o
 * banco achava que fixo era WhatsApp, 14 das 15 mensagens apareciam no painel
 * sem botao de envio.
 */
export function ehCelular(v: unknown): boolean {
  return /^\d{2}9\d{8}$/.test(digitosLocais(v));
}

/** Fixo brasileiro: DDD + 8 digitos comecando de 2 a 5. */
export function ehFixo(v: unknown): boolean {
  return /^\d{2}[2-5]\d{7}$/.test(digitosLocais(v));
}

/**
 * Ordem de preferencia deliberada: WhatsApp/telefone ganha do e-mail.
 * Dois motivos concretos neste projeto:
 *   1. Na varredura real de Olaria, 20% dos estabelecimentos tinham telefone
 *      e quase nenhum tinha e-mail — o e-mail e a excecao, nao a regra.
 *   2. Taxa de resposta de abordagem fria por WhatsApp e ordens de grandeza
 *      maior que por e-mail para comercio de bairro.
 * Sem nenhum contato a empresa nem deveria chegar aqui (o auditor bloqueia);
 * se chegar, devolvemos whatsapp e quem consome decide o que fazer.
 */
export function escolherCanal(empresa: ContatoDaEmpresa): Canal {
  const signals = (empresa.signals ?? {}) as Record<string, unknown>;

  // Celular recebe WhatsApp. Fixo quase nunca: vira ligacao com roteiro.
  // Na base real de 23/09, 14 das 15 mensagens "de WhatsApp" iam para fixo.
  if (ehCelular(empresa.main_phone)) return "whatsapp";
  if (signals.has_whatsapp === true) return "whatsapp";
  if (ehFixo(empresa.main_phone)) return "phone";
  if (emailPlausivel(empresa.main_email)) return "email";
  return "whatsapp";
}

/** Assunto so existe em e-mail. Mandar "assunto" no WhatsApp e ruido. */
export function canalUsaAssunto(canal: Canal): boolean {
  return canal === "email";
}

// -----------------------------------------------------------------------------
// Rodape de LGPD
// -----------------------------------------------------------------------------
//
// Abordagem fria B2B no Brasil se apoia no legitimo interesse (LGPD art. 7, IX).
// O legitimo interesse NAO dispensa transparencia: o art. 9 exige que a pessoa
// saiba quem esta falando e por que, e o art. 18 exige um jeito facil de pedir
// para parar. Uma frase curta resolve os dois e custa quase nada de conversao —
// bem mais barato que um pedido de explicacao no cartorio de dados.
//
// Fica junto do canal de proposito: o texto do rodape MUDA por canal. No
// WhatsApp um bloco formal parece spam; no e-mail, a falta dele e que parece.

export type IdentificacaoRemetente = {
  /** Quem escreve. Ex.: "Estevam" */
  nome?: string;
  /** Como pedir para parar fora do proprio canal. Ex.: um e-mail seu. */
  contato?: string;
};

export function rodapeDoCanal(canal: Canal, quem: IdentificacaoRemetente = {}): string {
  const nome = (quem.nome ?? "").trim();

  // Ligacao nao tem rodape escrito: a saida ("nao volto a ligar") ja esta no
  // proprio roteiro, que e o que o Estevam le em voz alta.
  if (canal === "phone") return "";

  if (canal === "whatsapp") {
    // Curto e humano. Sem repetir o nome: desde 23/09 a primeira linha da
    // mensagem ja diz "Aqui e o Estevam", e assinar de novo no fim soa robotico.
    return `\n\nSe não quiser receber mensagem minha, é só falar que eu não escrevo mais.`;
  }

  const assinatura = nome ? `${nome}\n` : "";
  const contato = (quem.contato ?? "").trim();
  const comoParar = contato
    ? `Se preferir não receber mais contato, responda este e-mail ou escreva para ${contato} — eu removo seus dados na hora.`
    : `Se preferir não receber mais contato, basta responder este e-mail dizendo isso — eu removo seus dados na hora.`;

  return (
    `\n\n—\n${assinatura}` +
    `Escrevi para o endereço comercial publicado pelo próprio estabelecimento em fontes públicas, ` +
    `com base no legítimo interesse previsto na LGPD (art. 7º, IX). ` +
    comoParar
  );
}

/** Evita rodape duplicado se o texto ja trouxer um pedido de descadastro. */
export function jaTemOptOut(corpo: string): boolean {
  const t = corpo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /nao (quiser|queira|receber)|descadastr|remover seus dados|nao escrevo mais|sair da lista/.test(t);
}
