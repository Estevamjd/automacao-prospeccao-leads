/**
 * Geografia e segmentos da busca (v2, 29/09/2026).
 *
 * As MESMAS chaves do extrator (scripts/cnpj/extrair_cnpj.py) e da reserva no
 * banco (cnpj_reserva.segmento / zona). Mudou aqui, muda lá.
 *
 * Os bairros de cada zona servem para a busca no mapa (OpenStreetMap), que
 * não conhece "zona": ela procura os limites de cada bairro (Rio) ou distrito
 * (São Paulo). Os nomes vão sem acento; a consulta aceita com e sem.
 */

export const UFS: Record<string, string> = {
  RJ: 'RJ · Rio de Janeiro',
  SP: 'SP · São Paulo',
};

export const SEGMENTOS: Record<string, string> = {
  beleza: 'Salão, barbearia e estética',
  petshop: 'Pet shop e veterinária',
  academia: 'Academia e estúdio',
  odonto: 'Dentista',
  clinica: 'Clínica, fisioterapia e psicologia',
  restaurante: 'Restaurante e marmitaria',
  pizzaria: 'Pizzaria',
  lanchonete: 'Lanchonete e café',
  bar: 'Bar',
  padaria: 'Padaria e confeitaria',
  oficina: 'Oficina e serviço automotivo',
  mercado: 'Mercado, açougue e hortifrúti',
  educacao: 'Curso e idiomas',
};

/** Capitais com zona: município (como a reserva grava) -> zonas. */
export const CAPITAIS: Record<string, { uf: string; municipio: string; zonas: Record<string, string> }> = {
  RJ: {
    uf: 'RJ', municipio: 'Rio de Janeiro',
    zonas: { norte: 'Zona Norte', sul: 'Zona Sul', centro: 'Centro', oeste: 'Zona Oeste', barra: 'Barra e Jacarepaguá' },
  },
  SP: {
    uf: 'SP', municipio: 'São Paulo',
    zonas: { centro: 'Centro', norte: 'Zona Norte', sul: 'Zona Sul', leste: 'Zona Leste', oeste: 'Zona Oeste' },
  },
};

export function zonasDe(uf: string, municipio: string | null | undefined): Record<string, string> | null {
  const capital = CAPITAIS[uf];
  if (!capital || !municipio) return null;
  return semAcento(capital.municipio).toLowerCase() === semAcento(municipio).toLowerCase() ? capital.zonas : null;
}

/** Bairros (Rio) e distritos (São Paulo) de cada zona, para o mapa. */
export const BAIRROS_DA_ZONA: Record<string, Record<string, string[]>> = {
  RJ: {
    centro: ['Centro', 'Lapa', 'Saude', 'Gamboa', 'Santo Cristo', 'Catumbi', 'Rio Comprido', 'Cidade Nova', 'Estacio',
      'Santa Teresa', 'Paqueta'],
    sul: ['Flamengo', 'Gloria', 'Laranjeiras', 'Catete', 'Cosme Velho', 'Botafogo', 'Humaita', 'Urca', 'Leme', 'Copacabana',
      'Ipanema', 'Leblon', 'Lagoa', 'Jardim Botanico', 'Gavea', 'Vidigal', 'Sao Conrado', 'Rocinha'],
    norte: ['Olaria', 'Ramos', 'Penha', 'Penha Circular', 'Bras de Pina', 'Bonsucesso', 'Complexo do Alemao', 'Vila da Penha',
      'Higienopolis', 'Manguinhos', 'Mare', 'Cordovil', 'Parada de Lucas', 'Vigario Geral', 'Jardim America',
      'Vista Alegre', 'Iraja', 'Vila Kosmos', 'Vicente de Carvalho', 'Colegio', 'Meier', 'Jacare', 'Sao Francisco Xavier',
      'Rocha', 'Riachuelo', 'Sampaio', 'Engenho Novo', 'Lins de Vasconcelos', 'Todos os Santos', 'Cachambi',
      'Engenho de Dentro', 'Agua Santa', 'Encantado', 'Piedade', 'Abolicao', 'Pilares', 'Del Castilho', 'Inhauma',
      'Engenho da Rainha', 'Tomas Coelho', 'Jacarezinho', 'Maria da Graca', 'Madureira', 'Campinho', 'Quintino Bocaiuva',
      'Cavalcanti', 'Engenheiro Leal', 'Cascadura', 'Vaz Lobo', 'Turiacu', 'Rocha Miranda', 'Honorio Gurgel',
      'Oswaldo Cruz', 'Bento Ribeiro', 'Marechal Hermes', 'Guadalupe', 'Anchieta', 'Parque Anchieta',
      'Ricardo de Albuquerque', 'Coelho Neto', 'Acari', 'Barros Filho', 'Costa Barros', 'Pavuna', 'Parque Columbia',
      'Ribeira', 'Zumbi', 'Cacuia', 'Pitangueiras', 'Praia da Bandeira', 'Cocota', 'Bancarios', 'Freguesia (Ilha)',
      'Jardim Guanabara', 'Jardim Carioca', 'Taua', 'Monero', 'Portuguesa', 'Galeao', 'Cidade Universitaria', 'Tijuca',
      'Praca da Bandeira', 'Alto da Boa Vista', 'Maracana', 'Vila Isabel', 'Andarai', 'Grajau', 'Sao Cristovao', 'Benfica',
      'Mangueira', 'Caju', 'Vasco da Gama'],
    barra: ['Barra da Tijuca', 'Recreio dos Bandeirantes', 'Jacarepagua', 'Freguesia (Jacarepagua)', 'Pechincha', 'Taquara',
      'Tanque', 'Anil', 'Gardenia Azul', 'Cidade de Deus', 'Curicica', 'Praca Seca', 'Vila Valqueire', 'Itanhanga', 'Joa',
      'Camorim', 'Vargem Grande', 'Vargem Pequena', 'Grumari', 'Barra Olimpica'],
    oeste: ['Bangu', 'Realengo', 'Campo Grande', 'Santa Cruz', 'Guaratiba', 'Barra de Guaratiba', 'Pedra de Guaratiba',
      'Sepetiba', 'Padre Miguel', 'Senador Camara', 'Santissimo', 'Cosmos', 'Inhoaiba', 'Paciencia', 'Jardim Sulacap',
      'Magalhaes Bastos', 'Vila Militar', 'Campo dos Afonsos', 'Deodoro', 'Gericino', 'Senador Vasconcelos'],
  },
  SP: {
    centro: ['Se', 'Republica', 'Bela Vista', 'Bom Retiro', 'Cambuci', 'Consolacao', 'Liberdade', 'Santa Cecilia'],
    norte: ['Anhanguera', 'Brasilandia', 'Cachoeirinha', 'Casa Verde', 'Freguesia do O', 'Jacana', 'Jaragua', 'Limao',
      'Mandaqui', 'Perus', 'Pirituba', 'Santana', 'Sao Domingos', 'Tremembe', 'Tucuruvi', 'Vila Guilherme', 'Vila Maria',
      'Vila Medeiros'],
    leste: ['Agua Rasa', 'Aricanduva', 'Artur Alvim', 'Belem', 'Bras', 'Cangaiba', 'Carrao', 'Cidade Lider',
      'Cidade Tiradentes', 'Ermelino Matarazzo', 'Guaianases', 'Iguatemi', 'Itaim Paulista', 'Itaquera', 'Jardim Helena',
      'Jose Bonifacio', 'Lajeado', 'Mooca', 'Pari', 'Penha', 'Ponte Rasa', 'Sao Lucas', 'Sao Mateus', 'Sao Miguel',
      'Sao Rafael', 'Sapopemba', 'Tatuape', 'Vila Curuca', 'Vila Formosa', 'Vila Jacui', 'Vila Matilde', 'Vila Prudente',
      'Parque do Carmo'],
    sul: ['Campo Belo', 'Campo Grande', 'Campo Limpo', 'Capao Redondo', 'Cidade Ademar', 'Cidade Dutra', 'Cursino',
      'Grajau', 'Ipiranga', 'Jabaquara', 'Jardim Angela', 'Jardim Sao Luis', 'Marsilac', 'Moema', 'Parelheiros',
      'Pedreira', 'Sacoma', 'Santo Amaro', 'Saude', 'Socorro', 'Vila Andrade', 'Vila Mariana'],
    oeste: ['Alto de Pinheiros', 'Barra Funda', 'Butanta', 'Itaim Bibi', 'Jaguara', 'Jaguare', 'Jardim Paulista', 'Lapa',
      'Morumbi', 'Perdizes', 'Pinheiros', 'Raposo Tavares', 'Rio Pequeno', 'Vila Leopoldina', 'Vila Sonia'],
  },
};

export function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
