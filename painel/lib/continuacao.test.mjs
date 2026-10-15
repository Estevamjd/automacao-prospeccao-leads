import assert from 'node:assert/strict';
import test from 'node:test';
import { montarContinuacao } from './continuacao.ts';

const brief = codigo => ({ oferta_principal: { codigo, titulo: 'Oferta de teste' } });

test('interesse em agenda traz entrega e pergunta concretas', () => {
  const r = montarContinuacao(brief('agendamento_link'));
  assert.match(r.interesse, /horários disponíveis/);
  assert.match(r.interesse, /Como vocês controlam os horários/);
  assert.doesNotMatch(r.interesse, /\[cole aqui|http/i);
});

test('outros serviços usam o plano correspondente', () => {
  assert.match(montarContinuacao(brief('cardapio_whatsapp')).interesse, /cardápio em link/);
  assert.match(montarContinuacao(brief('orcamento_whatsapp')).interesse, /orçamento mais demora/);
  assert.match(montarContinuacao(brief('confirmacao_consulta')).interesse, /lembretes e confirmações/);
});

test('observação do Maps prevalece sobre outra oferta sem prometer posição', () => {
  const r = montarContinuacao(brief('agendamento_link'), true);
  assert.match(r.interesse, /verificar se já existe um Perfil da Empresa/);
  assert.doesNotMatch(r.interesse, /primeiro lugar|garant/i);
});

test('aceite pede acordo por escrito e acesso por convite', () => {
  const r = montarContinuacao(null);
  assert.match(r.aceite, /entregas, valor, prazo e início/);
  assert.match(r.aceite, /por convite, sem compartilhar senhas/);
  assert.match(r.interesse, /Qual é a maior dificuldade/);
});
