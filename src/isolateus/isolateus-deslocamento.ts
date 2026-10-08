/**
 * Funções puras da movimentação em tempo real (spec 026): os avisos de saída
 * da noite, a agenda dos NPCs e as saídas e chegadas do amanhecer.
 *
 * Ficam fora do `IsolateusGameService` porque não tocam em Firestore. O
 * Despertar (`IsolateusMatchService`) e a virada da noite (`avancarNoite`)
 * sorteiam a agenda pelo MESMO código: NPC parado na primeira noite seria pista.
 */
import {
  Deslocamento,
  Habitante,
  ISOLATEUS,
} from './entities/isolateus-match.entity';
import { vizinhosDe } from './isolateus.data';

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

/** Um aviso agendado de NPC; `para: null` = desistiu de sair. */
export interface AvisoNpc {
  habitanteId: string;
  para: string | null;
  em: string;
}

/**
 * Sorteia, na abertura da noite, os avisos de saída dos NPCs (026 §2.3).
 *
 * Cada NPC vivo e livre anda com `CHANCE_MOVER_NPC`, para um vizinho sorteado,
 * e avisa num horário dentro de `NPC_AVISO_JANELA_MS`. Com
 * `CHANCE_NPC_MUDAR_IDEIA`, ganha um segundo aviso depois do primeiro: outro
 * vizinho ou `null` (desiste). O destino final é o do último aviso.
 *
 * Devolve em ordem de horário, para a liberação ler do começo.
 */
export function sortearAgendaNpc(
  habitantes: Habitante[],
  npcIds: string[],
  inicio: number,
  rnd: () => number = Math.random,
): AvisoNpc[] {
  const npcs = new Set(npcIds);
  const [min, max] = ISOLATEUS.NPC_AVISO_JANELA_MS;
  const sorteia = <T>(opcoes: T[]): T =>
    opcoes[Math.min(opcoes.length - 1, Math.floor(rnd() * opcoes.length))];
  const em = (ms: number) => new Date(inicio + ms).toISOString();

  const agenda: AvisoNpc[] = [];
  for (const h of habitantes) {
    if (!npcs.has(h.id) || !h.vivo || h.preso) continue;
    if (rnd() >= ISOLATEUS.CHANCE_MOVER_NPC) continue;
    const destinos = vizinhosDe(h.setorId);
    if (!destinos.length) continue;

    const para = sorteia(destinos);
    const t1 = min + Math.floor(rnd() * (max - min));
    agenda.push({ habitanteId: h.id, para, em: em(t1) });

    if (rnd() < ISOLATEUS.CHANCE_NPC_MUDAR_IDEIA && max - t1 > 1) {
      const outra = sorteia<string | null>([
        ...destinos.filter((d) => d !== para),
        null,
      ]);
      const t2 = t1 + 1 + Math.floor(rnd() * (max - t1 - 1));
      agenda.push({ habitanteId: h.id, para: outra, em: em(t2) });
    }
  }
  return agenda.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
}
