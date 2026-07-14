import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { TurmaService } from '../turma/turma.service';
import { CreateIsolateusJogoDto } from './dto/create-isolateus-jogo.dto';
import { IsolateusJogoEntity } from './entities/isolateus-jogo.entity';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';

/** Gate padrão do ecossistema: todo jogo é exclusivo do plano PhD. */
export const ISOLATEUS_LOCKED = {
  code: 'ISOLATEUS_LOCKED',
  message: 'O Tichr Isolateus é exclusivo do plano PhD.',
};

@Injectable()
export class IsolateusJogoService {
  constructor(
    private readonly repo: IsolateusJogoRepository,
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  /** Criar/rodar o Isolateus é exclusivo do plano PhD. */
  private async assertPhd(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException(ISOLATEUS_LOCKED);
    }
  }

  /** Valida a estrutura das questões (corretaIndex dentro do range). */
  private validarQuestoes(dto: CreateIsolateusJogoDto): void {
    dto.questoes.forEach((q, i) => {
      if (q.corretaIndex >= q.alternativas.length) {
        throw new BadRequestException(
          `Questão ${i + 1}: corretaIndex fora do intervalo de alternativas.`,
        );
      }
    });
  }

  /**
   * Converte os `QuestaoDto` (protótipo do class-transformer) em objetos
   * literais — o Firestore recusa objetos com protótipo customizado.
   */
  private questoesPlanas(dto: CreateIsolateusJogoDto) {
    return dto.questoes.map((q) => ({
      enunciado: q.enunciado,
      alternativas: [...q.alternativas],
      corretaIndex: q.corretaIndex,
    }));
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

  async listar(professorId: string): Promise<IsolateusJogoEntity[]> {
    await this.assertPhd(professorId);
    return this.repo.findByProfessor(professorId);
  }

  async obter(professorId: string, id: string): Promise<IsolateusJogoEntity> {
    await this.assertPhd(professorId);
    const jogo = await this.repo.findById(id);
    if (!jogo || jogo.professorId !== professorId) {
      throw new NotFoundException('Investigação nao encontrada.');
    }
    return jogo;
  }

  async criar(
    professorId: string,
    dto: CreateIsolateusJogoDto,
  ): Promise<IsolateusJogoEntity> {
    await this.assertPhd(professorId);
    this.validarQuestoes(dto);
    const turmaIds = await this.validarTurmas(professorId, dto);
    return this.repo.create(
      new IsolateusJogoEntity({
        professorId,
        nome: dto.nome.trim(),
        disciplina: dto.disciplina,
        topicoId: dto.topicoId,
        turmaIds,
        turmaId: turmaIds[0], // mantém o campo legado apontando p/ a 1ª turma
        duracaoSegundos: dto.duracaoSegundos ?? 60,
        questoes: this.questoesPlanas(dto),
      }),
    );
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: CreateIsolateusJogoDto,
  ): Promise<IsolateusJogoEntity> {
    const jogo = await this.obter(professorId, id);
    this.validarQuestoes(dto);
    const turmaIds = await this.validarTurmas(professorId, dto);
    const dados = {
      nome: dto.nome.trim(),
      disciplina: dto.disciplina ?? null,
      topicoId: dto.topicoId ?? null,
      turmaIds,
      turmaId: turmaIds[0] ?? null,
      duracaoSegundos: dto.duracaoSegundos ?? 60,
      questoes: this.questoesPlanas(dto),
    };
    await this.repo.update(id, dados as Partial<IsolateusJogoEntity>);
    Object.assign(jogo, dados);
    return jogo;
  }

  async remover(
    professorId: string,
    id: string,
  ): Promise<{ removido: boolean }> {
    await this.obter(professorId, id);
    await this.repo.delete(id);
    return { removido: true };
  }
}
