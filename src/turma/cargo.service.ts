import { Injectable, NotFoundException } from '@nestjs/common';
import { AlunoEntity } from './entities/aluno.entity';
import { CargoEntity } from './entities/cargo.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { CargoRepository } from './repositories/cargo.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class CargoService {
  constructor(
    private readonly cargoRepo: CargoRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly turmaRepo: TurmaRepository,
  ) {}

  async listar(professorId: string, turmaId: string): Promise<CargoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    return this.cargoRepo.findByTurma(turmaId);
  }

  /** Cadastra em lote: um cargo por nome (ignora vazios/repetidos). */
  async adicionar(
    professorId: string,
    turmaId: string,
    nomes: string[],
  ): Promise<CargoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    const limpos = [
      ...new Set(nomes.map((n) => n.trim()).filter((n) => n.length > 0)),
    ];
    return Promise.all(
      limpos.map((nome) =>
        this.cargoRepo.create(new CargoEntity({ turmaId, nome })),
      ),
    );
  }

  /** Remove o cargo e o desatribui de todos os alunos da turma. */
  async remover(
    professorId: string,
    turmaId: string,
    cargoId: string,
  ): Promise<{ removido: boolean }> {
    await this.assertTurma(professorId, turmaId);
    await this.assertCargo(turmaId, cargoId);
    await this.alunoRepo.limparCargo(turmaId, cargoId);
    await this.cargoRepo.delete(cargoId);
    return { removido: true };
  }

  /**
   * Define o conjunto final de responsáveis por um cargo (N↔N). Para cada aluno
   * da turma, garante o cargoId presente sse estiver em `alunoIds` — idempotente.
   */
  async atribuir(
    professorId: string,
    turmaId: string,
    cargoId: string,
    alunoIds: string[],
  ): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    await this.assertCargo(turmaId, cargoId);
    const alvo = new Set(alunoIds);
    const alunos = await this.alunoRepo.findByTurma(turmaId);

    await Promise.all(
      alunos.map((aluno) => {
        const tem = aluno.cargoIds?.includes(cargoId) ?? false;
        const deve = alvo.has(aluno.id);
        if (tem === deve) {
          return Promise.resolve();
        }
        const atuais = aluno.cargoIds ?? [];
        const novos = deve
          ? [...atuais, cargoId]
          : atuais.filter((c) => c !== cargoId);
        aluno.cargoIds = novos;
        return this.alunoRepo.definirCargos(aluno.id, novos);
      }),
    );

    return alunos;
  }

  private async assertTurma(
    professorId: string,
    turmaId: string,
  ): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
  }

  private async assertCargo(
    turmaId: string,
    cargoId: string,
  ): Promise<CargoEntity> {
    const cargo = await this.cargoRepo.findById(cargoId);
    if (!cargo || cargo.turmaId !== turmaId) {
      throw new NotFoundException('Cargo nao encontrado.');
    }
    return cargo;
  }
}
