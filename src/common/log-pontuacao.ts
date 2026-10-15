import { valeRanking } from './vale-ranking';

/**
 * Log de pontuação público do fim de partida (spec 027 §1): de onde veio cada
 * ponto de cada jogador. Gravado só no encerramento, no doc público da partida.
 */
export type FontePontos =
  | 'ACERTO'
  | 'DANO'
  | 'CRITICO'
  | 'CATAPULTA'
  | 'ARRISCAR'
  | 'HP_FINAL'
  | 'FATOR_COLOCACAO';

export interface ItemLogPontos {
  /** Pergunta (Qlick), rodada (Wor) ou noite (Isolateus), 1-based. */
  rodada: number;
  fonte: FontePontos;
  /** Texto pronto para a tela. */
  descricao: string;
  /** Pode ser negativo (o fator de colocação do Wor). */
  pontos: number;
}

export interface LogPontuacaoJogador {
  alunoId: string;
  nome: string;
  /** Pontos de jogo (o mesmo `pontos` do ranking final). */
  totalPartida: number;
  /** XP que de fato entrou no ranking da turma (0 se casual ou sem turma). */
  creditoRanking: number;
  itens: ItemLogPontos[];
}

/**
 * O que vai para o ranking da turma: a fonte única do crédito e do
 * `creditoRanking` do log, para os dois nunca divergirem. Sem turma ou em
 * partida casual, nada.
 */
export function creditosDaPartida(
  partida: { turmaId?: string | null; valeRanking?: boolean },
  ganhos: Array<{ alunoId: string; pontos: number }>,
): Array<{ alunoId: string; pontos: number }> {
  if (!partida.turmaId || !valeRanking(partida)) return [];
  return ganhos;
}

/** O crédito de um aluno, como o `XpService.creditarPartida` o aplica. */
export function creditoDe(
  creditos: Array<{ alunoId: string; pontos: number }>,
  alunoId: string,
): number {
  return creditos
    .filter((c) => c.alunoId === alunoId && c.pontos > 0)
    .reduce((s, c) => s + c.pontos, 0);
}

/** `1250` → `1.250` (a descrição já sai pronta para a tela). */
export function fmtPontos(n: number): string {
  return Math.abs(n).toLocaleString('pt-BR');
}

/**
 * Item de acerto (Qlick e Isolateus): base fixa + bônus de rapidez.
 * Ex.: "Pergunta 3: acertou (+1.000) + rapidez (+340)".
 */
export function itemAcerto(
  rodada: number,
  rotulo: string,
  pontos: number,
  base: number,
): ItemLogPontos {
  const rapidez = Math.max(0, pontos - base);
  const partes = [`acertou (+${fmtPontos(Math.min(base, pontos))})`];
  if (rapidez > 0) partes.push(`rapidez (+${fmtPontos(rapidez)})`);
  return {
    rodada,
    fonte: 'ACERTO',
    descricao: `${rotulo} ${rodada}: ${partes.join(' + ')}`,
    pontos,
  };
}
