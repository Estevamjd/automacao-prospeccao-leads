-- C3 (23/09, complemento): pergunta de abertura do odonto sem pressupor problema.
--
-- "Quantos pacientes por semana acabam faltando sem avisar?" parte do principio
-- de que faltam, e o dentista ouve isso como critica ao consultorio. A nova
-- pergunta so pede para ele contar como funciona hoje; a falta, se existir,
-- aparece na resposta dele, e ai a segunda mensagem entra.
update public.niche_playbooks
   set opening_questions = array_replace(
         opening_questions,
         'Quantos pacientes por semana acabam faltando sem avisar?',
         'Como vocês fazem hoje para confirmar as consultas?'
       )
 where slug = 'odonto';
