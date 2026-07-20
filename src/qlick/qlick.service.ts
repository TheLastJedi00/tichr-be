import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { TurmaService } from '../turma/turma.service';
import { CreateQlickDto } from './dto/create-qlick.dto';
import { QlickEntity } from './entities/qlick.entity';
import { QlickRepository } from './qlick.repository';
import { assertTurmaOuDisciplina } from '../common/vinculo-jogo.util';

@Injectable()
export class QlickService {
  constructor(
    private readonly repo: QlickRepository,
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  /** Criar/rodar Qlick é exclusivo do plano PhD. */
  private async assertPhd(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'QLICK_LOCKED',
        message: 'O Tichr Qlick é exclusivo do plano PhD.',
      });
    }
  }

  /** Valida a estrutura das perguntas (corretaIndex dentro do range). */
  private validarPerguntas(dto: CreateQlickDto): void {
    dto.perguntas.forEach((p, i) => {
      if (p.corretaIndex >= p.alternativas.length) {
        throw new BadRequestException(
          `Pergunta ${i + 1}: corretaIndex fora do intervalo de alternativas.`,
        );
      }
    });
  }

  /**
   * Converte os `PerguntaDto` (protótipo do class-transformer) em objetos
   * literais — o Firestore recusa objetos com protótipo customizado.
   */
  private perguntasPlanas(dto: CreateQlickDto) {
    return dto.perguntas.map((p) => ({
      enunciado: p.enunciado,
      alternativas: [...p.alternativas],
      corretaIndex: p.corretaIndex,
    }));
  }

  async listar(professorId: string): Promise<QlickEntity[]> {
    await this.assertPhd(professorId);
    return this.repo.findByProfessor(professorId);
  }

  async obter(professorId: string, id: string): Promise<QlickEntity> {
    await this.assertPhd(professorId);
    const qlick = await this.repo.findById(id);
    if (!qlick || qlick.professorId !== professorId) {
      throw new NotFoundException('Qlick nao encontrado.');
    }
    return qlick;
  }

  async criar(professorId: string, dto: CreateQlickDto): Promise<QlickEntity> {
    await this.assertPhd(professorId);
    assertTurmaOuDisciplina(dto);
    this.validarPerguntas(dto);
    const turmaIds = await this.validarTurmas(professorId, dto);
    return this.repo.create(
      new QlickEntity({
        professorId,
        titulo: dto.titulo.trim(),
        disciplina: dto.disciplina,
        topicoId: dto.topicoId,
        numeroAula: dto.numeroAula,
        turmaIds,
        turmaId: turmaIds[0], // mantém o campo legado apontando p/ a 1ª turma
        duracaoSegundos: dto.duracaoSegundos ?? 60,
        perguntas: this.perguntasPlanas(dto),
      }),
    );
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

  /** Atribui (substitui) as turmas do Qlick — usado pelo "Adicionar Jogo" da turma. */
  async atribuirTurmas(
    professorId: string,
    id: string,
    turmaIds: string[],
  ): Promise<QlickEntity> {
    const qlick = await this.obter(professorId, id); // valida posse do Qlick
    const ids = await this.validarTurmas(professorId, { turmaIds });
    await this.repo.update(id, {
      turmaIds: ids,
      turmaId: ids[0] ?? null,
    } as Partial<QlickEntity>);
    qlick.turmaIds = ids;
    qlick.turmaId = ids[0];
    return qlick;
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: CreateQlickDto,
  ): Promise<QlickEntity> {
    const qlick = await this.obter(professorId, id);
    assertTurmaOuDisciplina(dto);
    this.validarPerguntas(dto);
    const turmaIds = await this.validarTurmas(professorId, dto);
    const dados = {
      titulo: dto.titulo.trim(),
      disciplina: dto.disciplina ?? null,
      topicoId: dto.topicoId ?? null,
      numeroAula: dto.numeroAula ?? null,
      turmaIds,
      turmaId: turmaIds[0] ?? null,
      duracaoSegundos: dto.duracaoSegundos ?? 60,
      perguntas: this.perguntasPlanas(dto),
    };
    await this.repo.update(id, dados as Partial<QlickEntity>);
    Object.assign(qlick, dados);
    return qlick;
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
