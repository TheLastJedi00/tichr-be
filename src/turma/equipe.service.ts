import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hojeISO } from '../common/date.util';
import { embaralhar } from '../common/shuffle.util';
import { AlunoEntity } from './entities/aluno.entity';
import { EquipeEntity } from './entities/equipe.entity';
import { AlunoRepository } from './repositories/aluno.repository';
import { EquipeRepository } from './repositories/equipe.repository';
import { TurmaRepository } from './repositories/turma.repository';

/** Dados de criacao/edicao de equipe. */
export interface DadosEquipe {
  titulo?: string;
  descricao?: string;
  cor?: string;
}

@Injectable()
export class EquipeService {
  constructor(
    private readonly equipeRepo: EquipeRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly turmaRepo: TurmaRepository,
  ) {}

  async listar(professorId: string, turmaId: string): Promise<EquipeEntity[]> {
    await this.assertTurma(professorId, turmaId);
    return this.equipeRepo.findByTurma(turmaId);
  }

  async criar(
    professorId: string,
    turmaId: string,
    dados: DadosEquipe,
  ): Promise<EquipeEntity> {
    await this.assertTurma(professorId, turmaId);
    return this.equipeRepo.create(
      new EquipeEntity({
        turmaId,
        titulo: dados.titulo!.trim(),
        descricao: dados.descricao?.trim() || undefined,
        cor: EquipeEntity.normalizarCor(dados.cor!),
        criadoEm: hojeISO(),
      }),
    );
  }

  async atualizar(
    professorId: string,
    turmaId: string,
    equipeId: string,
    dados: DadosEquipe,
  ): Promise<EquipeEntity> {
    await this.assertTurma(professorId, turmaId);
    const equipe = await this.assertEquipe(turmaId, equipeId);

    if (dados.titulo !== undefined) {
      equipe.titulo = dados.titulo.trim();
    }
    if (dados.descricao !== undefined) {
      equipe.descricao = dados.descricao.trim() || undefined;
    }
    if (dados.cor !== undefined) {
      equipe.cor = EquipeEntity.normalizarCor(dados.cor);
    }

    await this.equipeRepo.update(equipeId, {
      titulo: equipe.titulo,
      descricao: equipe.descricao ?? null,
      cor: equipe.cor,
    } as Partial<EquipeEntity>);
    return equipe;
  }

  /** Remove a equipe e devolve seus alunos ao pool (equipeId -> null). */
  async remover(
    professorId: string,
    turmaId: string,
    equipeId: string,
  ): Promise<{ removido: boolean }> {
    await this.assertTurma(professorId, turmaId);
    await this.assertEquipe(turmaId, equipeId);
    await this.alunoRepo.limparEquipe(equipeId);
    await this.equipeRepo.delete(equipeId);
    return { removido: true };
  }

  /**
   * Distribui todos os alunos da turma pelas equipes existentes de forma
   * balanceada (Fisher-Yates + round-robin). Persiste o equipeId de cada aluno.
   */
  async distribuir(
    professorId: string,
    turmaId: string,
  ): Promise<AlunoEntity[]> {
    await this.assertTurma(professorId, turmaId);
    const equipes = await this.equipeRepo.findByTurma(turmaId);
    if (equipes.length === 0) {
      throw new BadRequestException(
        'Crie ao menos uma equipe antes de distribuir os alunos.',
      );
    }
    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const embaralhados = embaralhar(alunos);
    const n = equipes.length;

    await Promise.all(
      embaralhados.map((aluno, idx) => {
        const equipeId = equipes[idx % n].id;
        aluno.equipeId = equipeId;
        return this.alunoRepo.definirEquipe(aluno.id, equipeId);
      }),
    );

    return embaralhados;
  }

  /** Garante que a turma existe e pertence ao professor autenticado. */
  private async assertTurma(
    professorId: string,
    turmaId: string,
  ): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
  }

  /** Garante que a equipe existe e pertence a turma. */
  private async assertEquipe(
    turmaId: string,
    equipeId: string,
  ): Promise<EquipeEntity> {
    const equipe = await this.equipeRepo.findById(equipeId);
    if (!equipe || equipe.turmaId !== turmaId) {
      throw new NotFoundException('Equipe nao encontrada.');
    }
    return equipe;
  }
}
