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
    this.validarPerguntas(dto);
    if (dto.turmaId) {
      await this.turmaService.buscarTurma(professorId, dto.turmaId); // valida posse
    }
    return this.repo.create(
      new QlickEntity({
        professorId,
        titulo: dto.titulo.trim(),
        disciplina: dto.disciplina,
        topicoId: dto.topicoId,
        turmaId: dto.turmaId,
        duracaoSegundos: dto.duracaoSegundos ?? 60,
        perguntas: dto.perguntas,
      }),
    );
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: CreateQlickDto,
  ): Promise<QlickEntity> {
    const qlick = await this.obter(professorId, id);
    this.validarPerguntas(dto);
    if (dto.turmaId) {
      await this.turmaService.buscarTurma(professorId, dto.turmaId);
    }
    const dados = {
      titulo: dto.titulo.trim(),
      disciplina: dto.disciplina ?? null,
      topicoId: dto.topicoId ?? null,
      turmaId: dto.turmaId ?? null,
      duracaoSegundos: dto.duracaoSegundos ?? 60,
      perguntas: dto.perguntas,
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
