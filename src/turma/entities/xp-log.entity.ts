/**
 * Registro (event sourcing) de uma transacao de XP. Cada distribuicao de
 * pontos pelo professor gera um documento em `xp_logs`; o `xpTotal` do aluno
 * e a soma materializada desses eventos.
 */
export class XpLogEntity {
  id: string;
  alunoId: string;
  turmaId: string;
  pontos: number;
  motivo?: string;
  data: string; // ISO datetime

  constructor(partial: Partial<XpLogEntity> = {}) {
    Object.assign(this, partial);
  }
}
