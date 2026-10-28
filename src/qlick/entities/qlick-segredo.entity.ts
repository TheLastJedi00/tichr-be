import { randomInt } from 'crypto';

/**
 * A ordem de um aluno na partida (spec 031). Firestore não aceita array
 * aninhado, por isso as alternativas ficam num mapa indexado pela rodada.
 */
export interface OrdemAluno {
  /** perguntas[rodada] = índice da pergunta no cadastro do Qlick. */
  perguntas: number[];
  /** alternativas[rodada][posicaoExibida] = índice original da alternativa. */
  alternativas: Record<string, number[]>;
}

export interface OpcoesEmbaralhamento {
  perguntas: boolean;
  alternativas: boolean;
}

/** Sorteia um inteiro em [0, max). Trocável nos testes. */
export type Sorteador = (max: number) => number;

/** Permutação de 0..n-1 (Fisher-Yates). */
function permutacao(n: number, sortear: Sorteador): number[] {
  const p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = sortear(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

const identidade = (n: number) => [...Array(n).keys()];

/**
 * Cofre do Qlick (coleção `qlick_segredos`, fechada ao cliente): a ordem das
 * perguntas e das alternativas de cada aluno. O doc público nunca a carrega;
 * o aluno recebe só a sua pergunta por REST.
 */
export class QlickSegredoEntity {
  id: string; // = partidaId
  ordens: Record<string, OrdemAluno>;

  constructor(partial: Partial<QlickSegredoEntity> = {}) {
    Object.assign(this, partial);
  }

  /**
   * Uma ordem independente por aluno. A dimensão desligada sai como
   * identidade, para a tradução seguir um caminho só.
   */
  static sortear(
    alunoIds: string[],
    perguntas: Array<{ alternativas: string[] }>,
    opcoes: OpcoesEmbaralhamento,
    sortear: Sorteador = randomInt,
  ): QlickSegredoEntity {
    const ordens: Record<string, OrdemAluno> = {};
    for (const alunoId of alunoIds) {
      const ordemPerguntas = opcoes.perguntas
        ? permutacao(perguntas.length, sortear)
        : identidade(perguntas.length);
      const alternativas: Record<string, number[]> = {};
      ordemPerguntas.forEach((p, rodada) => {
        const n = perguntas[p].alternativas.length;
        alternativas[String(rodada)] = opcoes.alternativas
          ? permutacao(n, sortear)
          : identidade(n);
      });
      ordens[alunoId] = { perguntas: ordemPerguntas, alternativas };
    }
    return new QlickSegredoEntity({ ordens });
  }

  /** Índice no cadastro da pergunta que o aluno responde na rodada. */
  perguntaDe(alunoId: string, rodada: number): number {
    return this.ordens?.[alunoId]?.perguntas[rodada] ?? rodada;
  }

  /** Posição exibida → índice original. `undefined` fora do intervalo. */
  originalDe(
    alunoId: string,
    rodada: number,
    posicao: number,
  ): number | undefined {
    const alt = this.alternativasDe(alunoId, rodada);
    if (!alt) return posicao;
    return alt[posicao];
  }

  /** Índice original → posição exibida para o aluno. */
  exibidaDe(alunoId: string, rodada: number, original: number): number {
    const alt = this.alternativasDe(alunoId, rodada);
    return alt ? alt.indexOf(original) : original;
  }

  private alternativasDe(
    alunoId: string,
    rodada: number,
  ): number[] | undefined {
    return this.ordens?.[alunoId]?.alternativas[String(rodada)];
  }
}
