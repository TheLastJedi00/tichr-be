/**
 * Alocacao de um Topico a uma aula, ancorada no NUMERO da aula (nao na data).
 * Como a reprojecao regenera as sessoes mantendo o `numero`, o topico
 * "desliza" junto com a aula automaticamente.
 */
export class AlocacaoEntity {
  id: string;
  turmaId: string;
  numeroAula: number;
  topicoId: string;

  constructor(partial: Partial<AlocacaoEntity> = {}) {
    Object.assign(this, partial);
  }
}
