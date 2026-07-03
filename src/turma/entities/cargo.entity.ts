/**
 * Cargo (tarefa/papel) de uma turma, atribuível a membros das equipes.
 * Relação N↔N com alunos via AlunoEntity.cargoIds. Cadastrado em lote, como
 * a lista de chamada.
 */
export class CargoEntity {
  id: string;
  turmaId: string;
  nome: string;

  constructor(partial: Partial<CargoEntity> = {}) {
    Object.assign(this, partial);
  }
}
