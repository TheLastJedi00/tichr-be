/**
 * Funções puras da movimentação em tempo real (spec 026): os avisos de saída
 * da noite, a agenda dos NPCs e as saídas e chegadas do amanhecer.
 *
 * Ficam fora do `IsolateusGameService` porque não tocam em Firestore. O
 * Despertar (`IsolateusMatchService`) e a virada da noite (`avancarNoite`)
 * sorteiam a agenda pelo MESMO código: NPC parado na primeira noite seria pista.
 */
import { Deslocamento } from './entities/isolateus-match.entity';

/**
 * O aviso de saída de um habitante: trocar de destino substitui, voltar à
 * origem (ou `para = null`) remove. A lista é substituída inteira, nunca
 * mutada: o doc público é gravado com `merge`.
 */
export function aplicarAviso(
  avisos: Deslocamento[],
  habitanteId: string,
  para: string | null,
  origem: string,
): Deslocamento[] {
  const outros = avisos.filter((a) => a.habitanteId !== habitanteId);
  return para && para !== origem ? [...outros, { habitanteId, para }] : outros;
}
