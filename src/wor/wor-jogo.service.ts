import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProfessorService } from '../professor/professor.service';
import { TurmaService } from '../turma/turma.service';
import { PalavraWor, WorJogoEntity } from './entities/wor-jogo.entity';
import { WorJogoRepository } from './wor-jogo.repository';
import { CreateWorJogoDto, PalavraWorDto } from './dto/create-wor-jogo.dto';

/** CRUD do arsenal (definição de batalhas do Tichr Wor). */
@Injectable()
export class WorJogoService {
  constructor(
    private readonly repo: WorJogoRepository,
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  /** Criar/rodar qualquer jogo é exclusivo do plano PhD (padrão do ecossistema). */
  private async assertPhd(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'WOR_LOCKED',
        message: 'O Tichr Wor é exclusivo do plano PhD.',
      });
    }
  }

  /** Valida a posse de todas as turmas atribuídas (N:N) e devolve os IDs únicos. */
  private async validarTurmas(
    professorId: string,
    dto: { turmaId?: string; turmaIds?: string[] },
  ): Promise<string[]> {
    const ids = [
      ...new Set([
        ...(dto.turmaIds ?? []),
        ...(dto.turmaId ? [dto.turmaId] : []),
      ]),
    ];
    for (const turmaId of ids) {
      await this.turmaService.buscarTurma(professorId, turmaId); // valida posse
    }
    return ids;
  }

  async listar(professorId: string): Promise<WorJogoEntity[]> {
    await this.assertPhd(professorId);
    return this.repo.findByProfessor(professorId);
  }

  /** Busca garantindo posse (404 se não existe, 403 se é de outro professor). */
  async obter(professorId: string, id: string): Promise<WorJogoEntity> {
    await this.assertPhd(professorId);
    const jogo = await this.repo.findById(id);
    if (!jogo) throw new NotFoundException('Batalha não encontrada.');
    if (jogo.professorId !== professorId) {
      throw new ForbiddenException('Essa batalha não é sua.');
    }
    return jogo;
  }

  async criar(professorId: string, dto: CreateWorJogoDto): Promise<WorJogoEntity> {
    await this.assertPhd(professorId);
    const turmaIds = await this.validarTurmas(professorId, dto);
    return this.repo.create(
      new WorJogoEntity({
        professorId,
        nome: dto.nome.trim(),
        disciplina: dto.disciplina?.trim(),
        topicoId: dto.topicoId,
        turmaIds,
        turmaId: turmaIds[0], // mantém o campo legado apontando p/ a 1ª turma
        palavras: WorJogoService.normalizarPalavras(dto.palavras),
      }),
    );
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: CreateWorJogoDto,
  ): Promise<WorJogoEntity> {
    await this.obter(professorId, id);
    const turmaIds = await this.validarTurmas(professorId, dto);
    await this.repo.update(id, {
      nome: dto.nome.trim(),
      disciplina: dto.disciplina?.trim() ?? null,
      topicoId: dto.topicoId ?? null,
      turmaIds,
      turmaId: turmaIds[0] ?? null,
      palavras: WorJogoService.normalizarPalavras(dto.palavras),
    } as Partial<WorJogoEntity>);
    return (await this.repo.findById(id))!;
  }

  async remover(professorId: string, id: string): Promise<void> {
    await this.obter(professorId, id);
    await this.repo.delete(id);
  }

  /** Gera ids, apara textos e limita as dicas a 3 (da mais difícil à mais fácil). */
  static normalizarPalavras(palavras: PalavraWorDto[]): PalavraWor[] {
    return (palavras ?? []).map((p) => ({
      id: randomUUID(),
      palavra: p.palavra.trim(),
      dicas: (p.dicas ?? [])
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .slice(0, 3),
    }));
  }
}
