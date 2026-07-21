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

  /** Horario de inicio do intervalo/recreio ('HH:mm'). Legado (1 intervalo). */
  inicioIntervalo?: string;

  /** Duracao do intervalo, em minutos. Legado (1 intervalo). */
  duracaoIntervalo?: number;

  /** Intervalos/recreios da grade (formato atual, aceita mais de um). */
  intervalos?: { inicio: string; duracao: number }[];

  constructor(partial: Partial<InstituicaoEntity> = {}) {
    Object.assign(this, partial);
  }

  /**
   * Intervalos efetivos: usa a lista `intervalos` (formato atual) e cai no
   * campo legado de intervalo unico (`inicioIntervalo`/`duracaoIntervalo`)
   * quando a lista nao existe — sem quebrar instituicoes antigas.
   */
  intervalosEfetivos(): { inicio: string; duracao: number }[] {
    if (this.intervalos?.length) {
      return this.intervalos;
    }
    if (this.inicioIntervalo && (this.duracaoIntervalo ?? 0) > 0) {
      return [{ inicio: this.inicioIntervalo, duracao: this.duracaoIntervalo! }];
    }
    return [];
  }

  /**
   * Monta a grade de slots cruzando os parametros: aulas contiguas de
   * `duracaoAula` a partir de `inicioPrimeiroPeriodo`, inserindo cada intervalo
   * na primeira fronteira de slot >= seu inicio (depois do periodo que contem
   * aquele horario). Para quando a proxima aula ultrapassaria `fimUltimoPeriodo`.
   * So os slots do tipo AULA recebem `periodo` (1..N).
   */
  gerarGrade(): GradeSlot[] {
    const inicio = horaParaMinutos(this.inicioPrimeiroPeriodo);
    const fim = horaParaMinutos(this.fimUltimoPeriodo);
    const dur = this.duracaoAula;
    const intervalos = this.intervalosEfetivos()
      .filter((iv) => !!iv.inicio && iv.duracao > 0)
      .map((iv) => ({ inicio: horaParaMinutos(iv.inicio), duracao: iv.duracao }))
      .sort((a, b) => a.inicio - b.inicio);

    const slots: GradeSlot[] = [];
    if (dur <= 0 || fim <= inicio) {
      return slots;
    }

    let cursor = inicio;
    let periodo = 1;
    let idxIntervalo = 0;

    while (slots.length < MAX_SLOTS) {
      const proximo = intervalos[idxIntervalo];
      if (
        proximo &&
        cursor >= proximo.inicio &&
        cursor + proximo.duracao <= fim
      ) {
        slots.push({
          ordem: slots.length,
          tipo: 'INTERVALO',
          rotulo: 'Intervalo',
          horaInicio: minutosParaHora(cursor),
          horaFim: minutosParaHora(cursor + proximo.duracao),
        });
        cursor += proximo.duracao;
        idxIntervalo++;
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
