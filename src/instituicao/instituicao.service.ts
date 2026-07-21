import { Injectable, NotFoundException } from '@nestjs/common';
import { paraPlano } from '../common/plain.util';
import { CreateInstituicaoDto } from './dto/create-instituicao.dto';
import { UpdateInstituicaoDto } from './dto/update-instituicao.dto';
import {
  GradeSlot,
  GradeTurno,
  InstituicaoEntity,
} from './entities/instituicao.entity';
import { InstituicaoRepository } from './repositories/instituicao.repository';

/** Instituicao com as grades por turno anexadas (o que o front consome). */
export interface InstituicaoView extends InstituicaoEntity {
  /** Grades por turno (formato atual). */
  grades: GradeTurno[];
  /** Grade do primeiro turno (compat com consumidores de grade unica). */
  grade: GradeSlot[];
}

@Injectable()
export class InstituicaoService {
  constructor(private readonly repo: InstituicaoRepository) {}

  async listar(professorId: string): Promise<InstituicaoView[]> {
    const instituicoes = await this.repo.findByProfessor(professorId);
    return instituicoes.map((i) => this.comGrades(i));
  }

  async buscar(professorId: string, id: string): Promise<InstituicaoView> {
    return this.comGrades(await this.assertPosse(professorId, id));
  }

  async criar(
    professorId: string,
    dto: CreateInstituicaoDto,
  ): Promise<InstituicaoView> {
    const instituicao = await this.repo.create(
      new InstituicaoEntity({
        ...dto,
        professorId,
        // DTOs viram objetos planos — o Firestore recusa prototipos de classe.
        turnos: paraPlano(dto.turnos),
        intervalos: paraPlano(dto.intervalos),
      }),
    );
    return this.comGrades(instituicao);
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: UpdateInstituicaoDto,
  ): Promise<InstituicaoView> {
    const instituicao = await this.assertPosse(professorId, id);
    const campos: Partial<InstituicaoEntity> = {
      nome: dto.nome ?? instituicao.nome,
      turnos: dto.turnos ? paraPlano(dto.turnos) : instituicao.turnos,
      inicioPrimeiroPeriodo:
        dto.inicioPrimeiroPeriodo ?? instituicao.inicioPrimeiroPeriodo,
      fimUltimoPeriodo: dto.fimUltimoPeriodo ?? instituicao.fimUltimoPeriodo,
      duracaoAula: dto.duracaoAula ?? instituicao.duracaoAula,
      intervalos: dto.intervalos
        ? paraPlano(dto.intervalos)
        : instituicao.intervalos,
      inicioIntervalo: dto.inicioIntervalo ?? instituicao.inicioIntervalo,
      duracaoIntervalo: dto.duracaoIntervalo ?? instituicao.duracaoIntervalo,
    };
    Object.assign(instituicao, campos);
    await this.repo.update(id, campos);
    return this.comGrades(instituicao);
  }

  async remover(professorId: string, id: string): Promise<void> {
    await this.assertPosse(professorId, id);
    await this.repo.delete(id);
  }

  private comGrades(instituicao: InstituicaoEntity): InstituicaoView {
    const grades = instituicao.gerarGrades();
    return Object.assign(instituicao, {
      grades,
      grade: grades[0]?.slots ?? [],
    });
  }

  private async assertPosse(
    professorId: string,
    id: string,
  ): Promise<InstituicaoEntity> {
    const instituicao = await this.repo.findById(id);
    if (!instituicao || instituicao.professorId !== professorId) {
      throw new NotFoundException('Instituicao nao encontrada.');
    }
    return instituicao;
  }
}
