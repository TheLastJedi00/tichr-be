import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { TurmaService } from '../turma/turma.service';
import { AlocacaoEntity } from './entities/alocacao.entity';
import { AlocacaoRepository } from './alocacao.repository';

@Injectable()
export class AlocacaoService {
  constructor(
    private readonly alocacaoRepo: AlocacaoRepository,
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  private async assertGraduado(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.atendePlano('GRADUADO')) {
      throw new ForbiddenException({
        code: 'PLANO_LOCKED',
        message: 'A alocação de tópicos exige o plano Graduado ou superior.',
        minimo: 'GRADUADO',
      });
    }
  }

  async listar(
    professorId: string,
    turmaId: string,
  ): Promise<AlocacaoEntity[]> {
    await this.assertGraduado(professorId);
    await this.turmaService.buscarTurma(professorId, turmaId); // valida posse
    return this.alocacaoRepo.findByTurma(turmaId);
  }

  /**
   * Aloca (topicoId) ou desaloca (null) um tópico à aula `numeroAula`.
   * Upsert por (turmaId, numeroAula) — uma aula tem no máximo um tópico.
   */
  async definir(
    professorId: string,
    turmaId: string,
    numeroAula: number,
    topicoId: string | null,
  ): Promise<AlocacaoEntity | { removido: true }> {
    await this.assertGraduado(professorId);
    await this.turmaService.buscarTurma(professorId, turmaId);

    const existentes = await this.alocacaoRepo.findByTurma(turmaId);
    const atual = existentes.find((a) => a.numeroAula === numeroAula);

    if (topicoId === null) {
      if (atual) {
        await this.alocacaoRepo.delete(atual.id);
      }
      return { removido: true };
    }

    if (atual) {
      atual.topicoId = topicoId;
      await this.alocacaoRepo.update(atual.id, { topicoId });
      return atual;
    }
    return this.alocacaoRepo.create(
      new AlocacaoEntity({ turmaId, numeroAula, topicoId }),
    );
  }

  /**
   * Regrava o board REGULAR de uma turma (ensino regular): recebe o estado
   * completo das Unidades Eletivas e persiste `unidade`+`ordem` para cada
   * tópico. Idempotente — apaga as alocações regulares atuais e recria a partir
   * do payload. As alocações modulares (por `numeroAula`) ficam intactas.
   */
  async definirRegulares(
    professorId: string,
    turmaId: string,
    unidades: { unidade: number; topicoIds: string[] }[],
  ): Promise<AlocacaoEntity[]> {
    await this.assertGraduado(professorId);
    await this.turmaService.buscarTurma(professorId, turmaId);

    const existentes = await this.alocacaoRepo.findByTurma(turmaId);
    const regularesAtuais = existentes.filter((a) => a.unidade != null);
    await this.alocacaoRepo.deleteMany(regularesAtuais.map((a) => a.id));

    const novas = unidades.flatMap((u) =>
      u.topicoIds.map(
        (topicoId, ordem) =>
          new AlocacaoEntity({ turmaId, topicoId, unidade: u.unidade, ordem }),
      ),
    );
    return this.alocacaoRepo.createMany(novas);
  }
}
