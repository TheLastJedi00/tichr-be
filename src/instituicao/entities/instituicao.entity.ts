import { horaParaMinutos, minutosParaHora } from '../../common/hora.util';

/** Um bloco da grade horaria de um turno. */
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

export type TipoTurno = 'MATUTINO' | 'VESPERTINO' | 'NOTURNO';

/** Um turno (matutino/vespertino/noturno) com seus horarios e recreios. */
export interface TurnoInstituicao {
  tipo: TipoTurno;
  inicioPrimeiroPeriodo: string; // 'HH:mm'
  fimUltimoPeriodo: string; // 'HH:mm'
  duracaoAula: number; // minutos
  intervalos?: { inicio: string; duracao: number }[];
}

/** A grade calculada de um turno. */
export interface GradeTurno {
  turno: TipoTurno;
  slots: GradeSlot[];
}

/** Trava anti-loop na geracao da grade. */
const MAX_SLOTS = 40;

export const TIPOS_TURNO: TipoTurno[] = ['MATUTINO', 'VESPERTINO', 'NOTURNO'];

/**
 * Monta os slots de um turno: aulas contiguas de `dur` a partir de `inicio`,
 * inserindo cada intervalo na primeira fronteira de slot >= seu inicio. Para
 * quando a proxima aula ultrapassaria `fim`. So os slots AULA recebem `periodo`.
 */
export function gerarSlots(
  inicioPrimeiroPeriodo: string,
  fimUltimoPeriodo: string,
  duracaoAula: number,
  intervalos: { inicio: string; duracao: number }[] = [],
): GradeSlot[] {
  const inicio = horaParaMinutos(inicioPrimeiroPeriodo);
  const fim = horaParaMinutos(fimUltimoPeriodo);
  const dur = duracaoAula;
  const ivs = intervalos
    .filter((iv) => !!iv.inicio && iv.duracao > 0)
    .map((iv) => ({ inicio: horaParaMinutos(iv.inicio), duracao: iv.duracao }))
    .sort((a, b) => a.inicio - b.inicio);

  const slots: GradeSlot[] = [];
  if (!dur || dur <= 0 || fim <= inicio) {
    return slots;
  }

  let cursor = inicio;
  let periodo = 1;
  let idx = 0;

  while (slots.length < MAX_SLOTS) {
    const proximo = ivs[idx];
    if (proximo && cursor >= proximo.inicio && cursor + proximo.duracao <= fim) {
      slots.push({
        ordem: slots.length,
        tipo: 'INTERVALO',
        rotulo: 'Intervalo',
        horaInicio: minutosParaHora(cursor),
        horaFim: minutosParaHora(cursor + proximo.duracao),
      });
      cursor += proximo.duracao;
      idx++;
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

/**
 * Instituicao (escola) do ensino regular. Guarda apenas os parametros dos
 * turnos; as grades (1º Horário, Intervalo, ...) sao **calculadas** por
 * {@link gerarGrades} — fonte unica de verdade sao os parametros.
 */
export class InstituicaoEntity {
  id: string;
  professorId: string;
  nome: string;

  /** Turnos da escola (formato atual). Cada um gera a propria grade. */
  turnos?: TurnoInstituicao[];

  // ===== Legado — instituicao de turno unico (compat) =====
  /** Horario de inicio do primeiro periodo ('HH:mm'). */
  inicioPrimeiroPeriodo?: string;
  /** Horario de termino do ultimo periodo ('HH:mm'). */
  fimUltimoPeriodo?: string;
  /** Duracao padrao de cada aula, em minutos. */
  duracaoAula?: number;
  /** Intervalos/recreios (legado — turno unico). */
  intervalos?: { inicio: string; duracao: number }[];
  /** Intervalo unico legado (formato mais antigo ainda). */
  inicioIntervalo?: string;
  duracaoIntervalo?: number;

  constructor(partial: Partial<InstituicaoEntity> = {}) {
    Object.assign(this, partial);
  }

  private intervalosLegado(): { inicio: string; duracao: number }[] {
    if (this.intervalos?.length) {
      return this.intervalos;
    }
    if (this.inicioIntervalo && (this.duracaoIntervalo ?? 0) > 0) {
      return [{ inicio: this.inicioIntervalo, duracao: this.duracaoIntervalo! }];
    }
    return [];
  }

  /**
   * Turnos efetivos: usa `turnos` (formato atual) e cai nos campos legados de
   * turno unico (sintetiza um MATUTINO) quando a lista nao existe — sem quebrar
   * instituicoes antigas.
   */
  turnosEfetivos(): TurnoInstituicao[] {
    if (this.turnos?.length) {
      return this.turnos;
    }
    if (this.inicioPrimeiroPeriodo && this.fimUltimoPeriodo && this.duracaoAula) {
      return [
        {
          tipo: 'MATUTINO',
          inicioPrimeiroPeriodo: this.inicioPrimeiroPeriodo,
          fimUltimoPeriodo: this.fimUltimoPeriodo,
          duracaoAula: this.duracaoAula,
          intervalos: this.intervalosLegado(),
        },
      ];
    }
    return [];
  }

  /** Grades por turno (o que o front consome). */
  gerarGrades(): GradeTurno[] {
    return this.turnosEfetivos().map((t) => ({
      turno: t.tipo,
      slots: gerarSlots(
        t.inicioPrimeiroPeriodo,
        t.fimUltimoPeriodo,
        t.duracaoAula,
        t.intervalos ?? [],
      ),
    }));
  }

  /** Grade do primeiro turno (compat com consumidores de grade unica). */
  gerarGrade(): GradeSlot[] {
    return this.gerarGrades()[0]?.slots ?? [];
  }
}
