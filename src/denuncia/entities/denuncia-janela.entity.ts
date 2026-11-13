/**
 * Janela de denúncia (spec 033 #12): o intervalo em que o professor deixou a
 * turma denunciar. Cada abertura cria uma; fechar só grava o fim. A denúncia
 * guarda o `janelaId` em que foi feita, para o professor saber de qual aula veio.
 */
export class DenunciaJanelaEntity {
  id: string;
  turmaId: string;
  professorId: string;
  abertaEm: string;
  fechadaEm?: string;

  constructor(partial: Partial<DenunciaJanelaEntity> = {}) {
    Object.assign(this, partial);
  }
}
