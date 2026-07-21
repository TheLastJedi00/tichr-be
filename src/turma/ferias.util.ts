import { expandirIntervalo } from '../common/date.util';

/** Ferias com escopo (turma > instituicao > global). */
export interface FeriasEscopo {
  turmaId?: string;
  instituicaoId?: string;
  dataInicio: string;
  dataFim: string;
}

/**
 * Monta o bloqueador de datas por turma cruzando excecoes + ferias com o escopo
 * correto. Isolamento (BUG-ENH-011): ferias por instituicao so bloqueiam as
 * turmas daquela escola; ferias por turma so aquela turma; globais bloqueiam
 * todas. `instDaTurma` mapeia turmaId -> instituicaoId (undefined se nenhuma).
 */
export function montarBloqueador(
  datasExcecao: string[],
  ferias: FeriasEscopo[],
  instDaTurma: Map<string, string | undefined>,
): (turmaId: string) => Set<string> {
  const base = new Set(datasExcecao);
  const porTurma = new Map<string, string[]>();
  const porInstituicao = new Map<string, string[]>();

  for (const f of ferias) {
    const dias = expandirIntervalo(f.dataInicio, f.dataFim);
    if (f.turmaId) {
      porTurma.set(f.turmaId, [...(porTurma.get(f.turmaId) ?? []), ...dias]);
    } else if (f.instituicaoId) {
      porInstituicao.set(f.instituicaoId, [
        ...(porInstituicao.get(f.instituicaoId) ?? []),
        ...dias,
      ]);
    } else {
      for (const d of dias) base.add(d); // global
    }
  }

  return (turmaId: string) => {
    const inst = instDaTurma.get(turmaId);
    const daInstituicao = inst ? (porInstituicao.get(inst) ?? []) : [];
    return new Set([
      ...base,
      ...(porTurma.get(turmaId) ?? []),
      ...daInstituicao,
    ]);
  };
}
