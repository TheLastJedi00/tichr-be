/**
 * Equipe de uma turma: agrupamento persistente de alunos (Plano Mestre).
 * Diferente do sorteio efemero de squads (AgrupamentoService), a equipe e
 * salva no Firestore e o vinculo do aluno vive em AlunoEntity.equipeId.
 */
export class EquipeEntity {
  id: string;
  turmaId: string;
  titulo: string;
  descricao?: string;

  /** Cor de destaque em hex (ex.: '#6366f1'). */
  cor: string;

  /** Data de criacao 'YYYY-MM-DD'. */
  criadoEm: string;

  constructor(partial: Partial<EquipeEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Normaliza a cor: garante o '#' inicial e caixa baixa. */
  static normalizarCor(cor: string): string {
    const limpo = cor.trim().toLowerCase();
    return limpo.startsWith('#') ? limpo : `#${limpo}`;
  }
}
