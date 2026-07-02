export type TipoModalidade = 'GRADE_FIXA' | 'MODULO_FECHADO';

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

  ativo: boolean;

  constructor(partial: Partial<TurmaEntity> = {}) {
    Object.assign(this, partial);
  }

  get isModulo(): boolean {
    return this.tipoModalidade === 'MODULO_FECHADO';
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
}
