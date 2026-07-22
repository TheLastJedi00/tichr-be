/**
 * Alocacao de um Topico numa turma. Dois modos coexistem na mesma colecao:
 *
 * - MODULAR (padrao): ancorada no NUMERO da aula (`numeroAula`). Como a
 *   reprojecao regenera as sessoes mantendo o `numero`, o topico "desliza"
 *   junto com a aula automaticamente. Uma aula tem no maximo um topico.
 *
 * - REGULAR (ensino regular / escola): ancorada numa UNIDADE ELETIVA
 *   (`unidade` 1..4) com uma `ordem` sequencial dentro dela. Uma unidade
 *   guarda varios topicos ordenados; a numeracao (1., 2., 3.) e derivada da
 *   `ordem`. Nao usa `numeroAula`.
 *
 * Os campos sao opcionais para os dois modos conviverem sem migracao.
 */
export class AlocacaoEntity {
  id: string;
  turmaId: string;
  topicoId: string;
  /** Modo modular: numero da aula a que o topico esta ancorado. */
  numeroAula?: number;
  /** Modo regular: unidade eletiva (1..4). */
  unidade?: number;
  /** Modo regular: posicao do topico dentro da unidade (0-based). */
  ordem?: number;

  constructor(partial: Partial<AlocacaoEntity> = {}) {
    Object.assign(this, partial);
  }
}
