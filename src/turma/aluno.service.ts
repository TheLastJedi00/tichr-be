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

    // Coleta os PINs ja usados na turma para garantir unicidade.
    const existentes = await this.alunoRepo.findByTurma(turmaId);
    const pinsUsados = new Set(
      existentes.map((a) => a.pinAcesso).filter((p): p is string => !!p),
    );

    return Promise.all(
      limpos.map((nome) => {
        const pinAcesso = this.gerarPinUnico(pinsUsados);
        pinsUsados.add(pinAcesso);
        return this.alunoRepo.create(
          new AlunoEntity({ turmaId, nome, pinAcesso, xpTotal: 0 }),
        );
      }),
    );
  }

  /** Gera um PIN de 4 digitos que ainda nao esteja em uso na turma. */
  private gerarPinUnico(usados: Set<string>): string {
    let pin: string;
    do {
      pin = String(Math.floor(1000 + Math.random() * 9000));
    } while (usados.has(pin));
    return pin;
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
