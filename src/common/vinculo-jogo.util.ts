import { BadRequestException } from '@nestjs/common';

/** Um jogo do ponto de vista do vínculo com turma/disciplina. */
export interface VinculoJogo {
  /** Turmas atribuídas explicitamente (N:N + legado). */
  turmas: string[];
  disciplina?: string;
}

/** Uma turma do ponto de vista do vínculo. */
export interface VinculoTurma {
  id: string;
  disciplina?: string;
}

/**
 * Regra ENH-002: ao criar/editar um jogo, **Turma OU Disciplina é obrigatória**.
 * Sem nenhuma das duas, o jogo ficaria sem contexto (poluindo o painel) — então
 * bloqueamos com 400 `TURMA_OU_DISCIPLINA`.
 */
export function assertTurmaOuDisciplina(dto: {
  turmaId?: string;
  turmaIds?: string[];
  disciplina?: string;
}): void {
  const temTurma = !!(dto.turmaId || (dto.turmaIds && dto.turmaIds.length > 0));
  const temDisciplina = !!dto.disciplina?.trim();
  if (!temTurma && !temDisciplina) {
    throw new BadRequestException({
      code: 'TURMA_OU_DISCIPLINA',
      message: 'Informe uma turma ou uma disciplina para o jogo.',
    });
  }
}

/**
 * A turma pode rodar o jogo? Verdadeiro se está atribuída explicitamente **ou**
 * (regra ENH-002 do jogo só-disciplina) se a disciplina da turma bate com a do
 * jogo — nesse caso o jogo vale para todas as turmas daquela disciplina.
 */
export function turmaCasaComJogo(
  turma: VinculoTurma,
  jogo: VinculoJogo,
): boolean {
  if (jogo.turmas.includes(turma.id)) return true;
  return !!jogo.disciplina && !!turma.disciplina && turma.disciplina === jogo.disciplina;
}
