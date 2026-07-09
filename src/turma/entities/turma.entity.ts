import { addDays, dayOfWeek } from '../../common/date.util';
import { SessaoAulaEntity, StatusSessao } from './sessao-aula.entity';

export type TipoModalidade = 'GRADE_FIXA' | 'MODULO_FECHADO';

/** Horizonte padrao (dias) de projecao de uma grade fixa continua. */
const HORIZONTE_GRADE_FIXA_DIAS = 120;

/** Trava anti-loop para a projecao de modulos. */
const MAX_ITERACOES = 366 * 5;

/**
 * Limiares padrao (XP acumulado) para alcancar cada nivel do aluno. Bronze e o
 * piso (0). Fonte unica de verdade dos defaults; o professor pode sobrescrever
 * por turma. Ordem: Bronze -> Prata -> Ouro -> Diamante -> Platina (topo).
 */
export const NIVEIS_TURMA_DEFAULT = {
  prata: 500,
  ouro: 1000,
  diamante: 2000,
  platina: 4000,
} as const;

/**
 * Turma: agrupa as regras de recorrencia de um conjunto de aulas.
 * As propriedades refletem o documento salvo no Firestore.
 */
export class TurmaEntity {
  id: string;
  professorId: string;
  nome: string;
  tipoModalidade: TipoModalidade;

  /** Dias da semana em que ocorre a aula. 0 = Domingo .. 6 = Sabado. */
  diasSemana: number[];

  /** Data de inicio do ciclo no formato 'YYYY-MM-DD'. */
  dataInicio: string;

  /** Total de aulas — obrigatorio apenas para MODULO_FECHADO. */
  totalAulas?: number;

  /** Data de termino calculada dinamicamente ('YYYY-MM-DD'). */
  dataFimPrevista?: string;

  /** Cor de destaque da turma no calendario (hex, ex.: '#2563eb'). */
  cor?: string;

  /** Disciplina/competencia lecionada nesta turma. */
  disciplina?: string;

  /** Horarios da jornada da turma ('HH:mm'). */
  horaInicio?: string;
  horaFim?: string;

  ativo: boolean;

  /**
   * Arquivamento manual: quando true, a turma nao conta mais para a cota do
   * plano, mesmo que o cronograma ainda nao tenha expirado.
   */
  encerradaManualmente?: boolean;

  /** Se a turma usa pontuacao/gamificacao (default true). */
  pontuacaoAtiva?: boolean;

  /** Nome livre da pontuacao exibido na UI (ex.: 'XP', 'Aura'). */
  nomePontuacao?: string;

  /** Se a turma exibe ranking dos alunos (default true). */
  rankingAtivo?: boolean;

  /** Rotulo do botao de adicionar pontos (ex.: 'Moggar'). */
  rotuloAdicionar?: string;

  /** Rotulo do botao de remover pontos (ex.: 'Punir'). */
  rotuloRemover?: string;

  /** Limiares de nivel (XP para alcancar Prata/Ouro/Diamante/Platina). Bronze = piso 0. */
  nivelPrata?: number;
  nivelOuro?: number;
  nivelDiamante?: number;
  nivelPlatina?: number;

  /** PIN de 6 digitos da turma (portal do aluno); gerado no cadastro. */
  pinTurma?: string;

  constructor(partial: Partial<TurmaEntity> = {}) {
    Object.assign(this, partial);
  }

  get isModulo(): boolean {
    return this.tipoModalidade === 'MODULO_FECHADO';
  }

  /** Config de pontuacao com defaults aplicados (fonte unica de verdade). */
  get configPontuacao(): {
    pontuacaoAtiva: boolean;
    nomePontuacao: string;
    rankingAtivo: boolean;
    rotuloAdicionar: string;
    rotuloRemover: string;
    niveis: { prata: number; ouro: number; diamante: number; platina: number };
  } {
    const d = NIVEIS_TURMA_DEFAULT;
    // Normalizacao ascendente defensiva: prata < ouro < diamante < platina.
    const prata = Math.max(1, this.nivelPrata ?? d.prata);
    const ouro = Math.max(prata + 1, this.nivelOuro ?? d.ouro);
    const diamante = Math.max(ouro + 1, this.nivelDiamante ?? d.diamante);
    const platina = Math.max(diamante + 1, this.nivelPlatina ?? d.platina);
    return {
      pontuacaoAtiva: this.pontuacaoAtiva ?? true,
      nomePontuacao: this.nomePontuacao?.trim() || 'XP',
      rankingAtivo: this.rankingAtivo ?? true,
      rotuloAdicionar: this.rotuloAdicionar?.trim() || 'Adicionar',
      rotuloRemover: this.rotuloRemover?.trim() || 'Remover',
      niveis: { prata, ouro, diamante, platina },
    };
  }

  /**
   * Uma turma conta para o limite do plano se nao foi encerrada manualmente e
   * seu cronograma ainda esta vigente. Modulos deixam de contar quando a
   * dataFimPrevista passa; grades fixas (ou modulos sem fim) contam sempre.
   */
  contaComoAtiva(hojeISO: string): boolean {
    if (this.encerradaManualmente) {
      return false;
    }
    if (this.isModulo && this.dataFimPrevista) {
      return this.dataFimPrevista >= hojeISO;
    }
    return true;
  }

  /**
   * Deriva a data de fim prevista a partir das datas ja projetadas.
   * Para modulos, e a data da ultima aula; para grade fixa fica indefinida.
   */
  calcularFimPrevisto(datasProjetadas: string[]): string | undefined {
    if (!this.isModulo || datasProjetadas.length === 0) {
      return undefined;
    }
    return datasProjetadas[datasProjetadas.length - 1];
  }

  /**
   * Motor de Agendamento: projeta as sessoes da turma cruzando a regra de
   * recorrencia (diasSemana + dataInicio) com o conjunto de excecoes.
   *
   * - MODULO_FECHADO: deslizamento. Ao cair numa excecao, a aula NAO e gerada
   *   e desliza para a proxima data valida, empurrando todas as seguintes.
   *   Gera exatamente `totalAulas` sessoes AGENDADAS.
   * - GRADE_FIXA: rigido. A aula que cai numa excecao e marcada CANCELADA,
   *   sem deslizar; as demais seguem o calendario ate `dataFimLetivo`.
   *
   * @param excecoes conjunto de datas bloqueadas ('YYYY-MM-DD').
   * @param dataFimLetivo fim da projecao para grade fixa (default: inicio + 120 dias).
   */
  projetarSessoes(
    excecoes: Set<string>,
    dataFimLetivo?: string,
  ): SessaoAulaEntity[] {
    const dias = new Set(this.diasSemana);
    const sessoes: SessaoAulaEntity[] = [];
    let cursor = this.dataInicio;
    let numero = 1;

    if (this.isModulo) {
      const total = this.totalAulas ?? 0;
      let iteracoes = 0;
      while (sessoes.length < total && iteracoes < MAX_ITERACOES) {
        if (dias.has(dayOfWeek(cursor)) && !excecoes.has(cursor)) {
          sessoes.push(this.novaSessao(numero++, cursor, 'AGENDADA'));
        }
        cursor = addDays(cursor, 1);
        iteracoes++;
      }
      return sessoes;
    }

    const fim = dataFimLetivo ?? addDays(this.dataInicio, HORIZONTE_GRADE_FIXA_DIAS);
    while (cursor <= fim) {
      if (dias.has(dayOfWeek(cursor))) {
        const status: StatusSessao = excecoes.has(cursor)
          ? 'CANCELADA'
          : 'AGENDADA';
        sessoes.push(this.novaSessao(numero++, cursor, status));
      }
      cursor = addDays(cursor, 1);
    }
    return sessoes;
  }

  private novaSessao(
    numero: number,
    data: string,
    status: StatusSessao,
  ): SessaoAulaEntity {
    return new SessaoAulaEntity({
      turmaId: this.id,
      professorId: this.professorId,
      numero,
      data,
      status,
    });
  }
}
