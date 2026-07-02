import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { ExcecaoEntity } from './entities/excecao.entity';
import { SessaoAulaEntity } from './entities/sessao-aula.entity';
import { TurmaEntity } from './entities/turma.entity';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';

@Injectable()
export class TurmaService {
  constructor(
    private readonly turmaRepo: TurmaRepository,
    private readonly sessaoRepo: SessaoRepository,
    private readonly excecaoRepo: ExcecaoRepository,
  ) {}

  /** Cria a turma, projeta as sessoes e persiste tudo. */
  async criarTurma(
    professorId: string,
    dto: CreateTurmaDto,
  ): Promise<{ turma: TurmaEntity; sessoes: SessaoAulaEntity[] }> {
    const turma = new TurmaEntity({ ...dto, professorId, ativo: true });
    const salva = await this.turmaRepo.create(turma);

    const sessoes = await this.reprojetar(salva, professorId);
    return { turma: salva, sessoes };
  }

  /** Cadastra uma excecao e dispara o recalculo das turmas do professor. */
  async adicionarExcecao(
    professorId: string,
    dto: CreateExcecaoDto,
  ): Promise<{ excecao: ExcecaoEntity; turmasRecalculadas: number }> {
    const excecao = await this.excecaoRepo.create({ ...dto, professorId });
    const turmasRecalculadas = await this.recalcularTurmas(professorId);
    return { excecao, turmasRecalculadas };
  }

  async listarSessoes(professorId: string): Promise<SessaoAulaEntity[]> {
    return this.sessaoRepo.findByProfessor(professorId);
  }

  async listarTurmas(professorId: string): Promise<TurmaEntity[]> {
    return this.turmaRepo.findByProfessor(professorId);
  }

  async buscarTurma(professorId: string, turmaId: string): Promise<TurmaEntity> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    return turma;
  }

  /** Reprojeta todas as turmas ativas do professor com o calendario atual. */
  private async recalcularTurmas(professorId: string): Promise<number> {
    const turmas = await this.turmaRepo.findByProfessor(professorId);
    const ativas = turmas.filter((t) => t.ativo);
    for (const turma of ativas) {
      await this.reprojetar(turma, professorId);
    }
    return ativas.length;
  }

  /**
   * Regenera as sessoes de uma turma: limpa as antigas, projeta com as
   * excecoes vigentes, atualiza a dataFimPrevista e persiste as novas.
   */
  private async reprojetar(
    turma: TurmaEntity,
    professorId: string,
  ): Promise<SessaoAulaEntity[]> {
    const excecoes = await this.carregarExcecoes(professorId);
    const sessoes = turma.projetarSessoes(excecoes);

    await this.sessaoRepo.deleteByTurma(turma.id);

    const fim = turma.calcularFimPrevisto(sessoes.map((s) => s.data));
    if (fim) {
      await this.turmaRepo.update(turma.id, { dataFimPrevista: fim });
      turma.dataFimPrevista = fim;
    }

    const persistidas: SessaoAulaEntity[] = [];
    for (const sessao of sessoes) {
      persistidas.push(await this.sessaoRepo.create(sessao));
    }
    return persistidas;
  }

  private async carregarExcecoes(professorId: string): Promise<Set<string>> {
    const excecoes = await this.excecaoRepo.findByProfessor(professorId);
    return new Set(excecoes.map((e) => e.data));
  }
}
