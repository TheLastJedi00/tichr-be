/**
 * Funções puras da movimentação dos NPCs (026, revista na 036): a agenda de
 * travessias da noite.
 *
 * Ficam fora do `IsolateusGameService` porque não tocam em Firestore. O
 * Despertar (`IsolateusMatchService`) e a virada da noite (`avancarNoite`)
 * sorteiam a agenda pelo MESMO código: NPC parado na primeira noite seria pista.
 */
import { Habitante, ISOLATEUS } from './entities/isolateus-match.entity';
import { vizinhosDe } from './isolateus.data';

/**
 * Uma travessia agendada de NPC (036 #15): no horário `em`, o NPC passa pela
 * porta para `para` (vizinho do setor onde ele estiver). `para: null` só
 * existe em partidas anteriores à 036 (o antigo "desistiu").
 */
export interface AvisoNpc {
  habitanteId: string;
  para: string | null;
  em: string;
}

/**
 * Sorteia, na abertura da noite, as travessias dos NPCs (036 #15).
 *
 * Cada NPC vivo e livre atravessa com `CHANCE_MOVER_NPC`, para um vizinho
 * sorteado, num horário dentro de `NPC_JANELA_FRACAO` da noite. Com
 * `CHANCE_NPC_MUDAR_IDEIA`, ganha uma segunda travessia (a partir do setor
 * novo) pelo menos `NPC_INTERVALO_TRAVESSIAS_MS` depois: os reais andam de
 * vizinho em vizinho, e NPC que só atravessa uma vez seria pista.
 *
 * Devolve em ordem de horário, para a liberação ler do começo.
 */
export function sortearAgendaNpc(
  habitantes: Habitante[],
  npcIds: string[],
  inicio: number,
  limiteMs: number = ISOLATEUS.LIMITE_DESLOCAMENTO_MS,
  rnd: () => number = Math.random,
): AvisoNpc[] {
  const npcs = new Set(npcIds);
  // A janela acompanha a duração da noite da partida (036 #15).
  const [fMin, fMax] = ISOLATEUS.NPC_JANELA_FRACAO;
  const min = Math.round(limiteMs * fMin);
  const max = Math.round(limiteMs * fMax);
  const intervalo = ISOLATEUS.NPC_INTERVALO_TRAVESSIAS_MS;
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

    if (rnd() < ISOLATEUS.CHANCE_NPC_MUDAR_IDEIA && max - t1 > intervalo) {
      const depois = sorteia(vizinhosDe(para));
      const t2 = t1 + intervalo + Math.floor(rnd() * (max - t1 - intervalo));
      agenda.push({ habitanteId: h.id, para: depois, em: em(t2) });
    }
  }
  return agenda.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
}
