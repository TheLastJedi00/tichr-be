import { horaParaMinutos, minutosParaHora } from '../../common/hora.util';

/** Um bloco da grade horaria da instituicao. */
export interface GradeSlot {
  /** Ordem do slot na grade (0-based), incluindo o intervalo. */
  ordem: number;
  tipo: 'AULA' | 'INTERVALO';
  /** Numero do horario de aula (1-based). Ausente no intervalo. */
  periodo?: number;
  /** Rotulo exibido: '1º Horário' / 'Intervalo'. */
  rotulo: string;
  horaInicio: string; // 'HH:mm'
  horaFim: string; // 'HH:mm'
}

/** Trava anti-loop na geracao da grade. */
const MAX_SLOTS = 40;

/**
 * Instituicao (escola) do ensino regular. Guarda apenas os parametros da grade;
 * os slots (1º Horário, Intervalo, ...) sao **calculados** por {@link gerarGrade}
 * — fonte unica de verdade sao os parametros, evitando drift de dados.
 */
export class InstituicaoEntity {
  id: string;
  professorId: string;
  nome: string;

  /** Horario de inicio do primeiro periodo ('HH:mm'). */
  inicioPrimeiroPeriodo: string;

  /** Horario de termino do ultimo periodo ('HH:mm'). */
  fimUltimoPeriodo: string;

  /** Duracao padrao de cada aula, em minutos. */
  duracaoAula: number;

  /** Horario de inicio do intervalo/recreio ('HH:mm'). Opcional. */
  inicioIntervalo?: string;

  /** Duracao do intervalo, em minutos. Opcional. */
  duracaoIntervalo?: number;

  constructor(partial: Partial<InstituicaoEntity> = {}) {
    Object.assign(this, partial);
  }

  /**
   * Monta a grade de slots cruzando os parametros: aulas contiguas de
   * `duracaoAula` a partir de `inicioPrimeiroPeriodo`, inserindo o intervalo na
   * primeira fronteira de slot >= `inicioIntervalo` (ou seja, depois do periodo
   * que contem aquele horario). Para quando a proxima aula ultrapassaria
   * `fimUltimoPeriodo`. So os slots do tipo AULA recebem `periodo` (1..N).
   */
  gerarGrade(): GradeSlot[] {
    const inicio = horaParaMinutos(this.inicioPrimeiroPeriodo);
    const fim = horaParaMinutos(this.fimUltimoPeriodo);
    const dur = this.duracaoAula;
    const temIntervalo =
      !!this.inicioIntervalo && (this.duracaoIntervalo ?? 0) > 0;
    const intInicio = temIntervalo
      ? horaParaMinutos(this.inicioIntervalo!)
      : null;
    const intDur = this.duracaoIntervalo ?? 0;

    const slots: GradeSlot[] = [];
    if (dur <= 0 || fim <= inicio) {
      return slots;
    }

    let cursor = inicio;
    let periodo = 1;
    let intervaloInserido = false;

    while (slots.length < MAX_SLOTS) {
      if (
        intInicio !== null &&
        !intervaloInserido &&
        cursor >= intInicio &&
        cursor + intDur <= fim
      ) {
        slots.push({
          ordem: slots.length,
          tipo: 'INTERVALO',
          rotulo: 'Intervalo',
          horaInicio: minutosParaHora(cursor),
          horaFim: minutosParaHora(cursor + intDur),
        });
        cursor += intDur;
        intervaloInserido = true;
        continue;
      }
      if (cursor + dur > fim) {
        break;
      }
      slots.push({
        ordem: slots.length,
        tipo: 'AULA',
        periodo,
        rotulo: `${periodo}º Horário`,
        horaInicio: minutosParaHora(cursor),
        horaFim: minutosParaHora(cursor + dur),
      });
      cursor += dur;
      periodo++;
    }

    return slots;
  }
}
