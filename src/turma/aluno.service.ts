import { Injectable, NotFoundException } from '@nestjs/common';
import { AlunoEntity } from './entities/aluno.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class AlunoService {
  constructor(
    private readonly alunoRepo: AlunoRepository,
    private readonly turmaRepo: TurmaRepository,
  ) {}

  /** Garante que a turma existe e pertence ao professor autenticado. */
  private async assertTurma(professorId: string, turmaId: string): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
  }

  async listar(professorId: string, turmaId: string): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    return this.alunoRepo.findByTurma(turmaId);
  }

  /** Cadastra em lote: cria um aluno por nome (ignorando nomes vazios/repetidos). */
  async adicionar(
    professorId: string,
    turmaId: string,
    nomes: string[],
  ): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    const limpos = [
      ...new Set(nomes.map((n) => n.trim()).filter((n) => n.length > 0)),
    ];
    return Promise.all(
      limpos.map((nome) =>
        this.alunoRepo.create(new AlunoEntity({ turmaId, nome })),
      ),
    );
  }

  async remover(
    professorId: string,
    turmaId: string,
    alunoId: string,
  ): Promise<{ removido: boolean }> {
    await this.assertTurma(professorId, turmaId);
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }
    await this.alunoRepo.delete(alunoId);
    return { removido: true };
  }
}
