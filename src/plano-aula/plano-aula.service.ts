import { ForbiddenException, Injectable } from '@nestjs/common';
import { PlanoAtual } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import { PlanoAulaEntity } from './entities/plano-aula.entity';
import { PlanoAulaRepository } from './plano-aula.repository';

@Injectable()
export class PlanoAulaService {
  constructor(
    private readonly repo: PlanoAulaRepository,
    private readonly professorService: ProfessorService,
  ) {}

  /** Garante que o professor tem plano suficiente para o recurso. */
  private async assertPlano(
    professorId: string,
    minimo: PlanoAtual,
  ): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.atendePlano(minimo)) {
      throw new ForbiddenException({
        code: 'PLANO_LOCKED',
        message: `Este recurso exige o plano ${minimo} ou superior.`,
        minimo,
      });
    }
  }

  async listar(professorId: string): Promise<PlanoAulaEntity[]> {
    await this.assertPlano(professorId, 'GRADUADO');
    return this.repo.findByProfessor(professorId);
  }

  /** Upsert do escopo geral de uma disciplina (um plano por disciplina). */
  async upsert(
    professorId: string,
    disciplina: string,
    contextoGeral: string,
  ): Promise<PlanoAulaEntity> {
    await this.assertPlano(professorId, 'GRADUADO');
    const nome = disciplina.trim();
    const existente = await this.repo.findByDisciplina(professorId, nome);
    if (existente) {
      existente.contextoGeral = contextoGeral;
      await this.repo.update(existente.id, { contextoGeral });
      return existente;
    }
    return this.repo.create(
      new PlanoAulaEntity({ professorId, disciplina: nome, contextoGeral }),
    );
  }
}
