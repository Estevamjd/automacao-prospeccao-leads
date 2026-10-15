"use client";

import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import type { Brief } from '@/lib/tipos';
import { montarContinuacao } from '@/lib/continuacao';
import { BotaoCopiar } from '@/components/ui';

export default function Continuacao({ brief, contextoMaps = false, bloqueada = false, abrirPropostas }: {
  brief: Brief | null;
  contextoMaps?: boolean;
  bloqueada?: boolean;
  abrirPropostas?: () => void;
}) {
  const [momento, setMomento] = useState<'interesse' | 'aceite'>('interesse');
  const mensagens = montarContinuacao(brief, contextoMaps);

  return <div className="continuacao">
    <h3>Próximo passo da conversa</h3>
    <div className="continuacao-modos" role="group" aria-label="Resposta do cliente">
      <button type="button" aria-pressed={momento === 'interesse'} onClick={() => setMomento('interesse')}>Demonstrou interesse</button>
      <button type="button" aria-pressed={momento === 'aceite'} onClick={() => setMomento('aceite')}>Aceitou a proposta</button>
    </div>
    <p className="muted">{momento === 'interesse'
      ? 'Confirme a situação atual antes de definir escopo, prazo e valor.'
      : 'Use depois de uma proposta com escopo e valor aceitos, não só de um sinal de interesse.'}</p>
    <pre className="texto-mensagem">{mensagens[momento]}</pre>
    <div className="acoes">
      <BotaoCopiar texto={mensagens[momento]} rotulo="Copiar resposta" desativado={bloqueada}/>
      {momento === 'aceite' && abrirPropostas && <button type="button" className="btn btn-s" onClick={abrirPropostas}><FileCheck2 size={16}/> Ver propostas</button>}
    </div>
  </div>;
}
