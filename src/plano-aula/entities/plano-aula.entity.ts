/**
 * Plano de Aula no nivel da DISCIPLINA (Syllabus / escopo macro).
 * Um por (professor, disciplina). O texto livre concentra objetivos, ementa e
 * bibliografia. Planos Mestre/PhD atomizam esse escopo em Topicos (outra colecao).
 */
export class PlanoAulaEntity {
  id: string;
  professorId: string;
  disciplina: string;
  contextoGeral: string;

  constructor(partial: Partial<PlanoAulaEntity> = {}) {
    Object.assign(this, partial);
  }
}
