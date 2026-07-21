import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateInstituicaoDto } from './dto/create-instituicao.dto';
import { UpdateInstituicaoDto } from './dto/update-instituicao.dto';
import { GradeSlot, InstituicaoEntity } from './entities/instituicao.entity';
import { InstituicaoRepository } from './repositories/instituicao.repository';

/** Instituicao com a grade calculada anexada (o que o front consome). */
export interface InstituicaoView extends InstituicaoEntity {
  grade: GradeSlot[];
}

@Injectable()
export class InstituicaoService {
  constructor(private readonly repo: InstituicaoRepository) {}

  async listar(professorId: string): Promise<InstituicaoView[]> {
    const instituicoes = await this.repo.findByProfessor(professorId);
    return instituicoes.map((i) => this.comGrade(i));
  }

  async buscar(professorId: string, id: string): Promise<InstituicaoView> {
    return this.comGrade(await this.assertPosse(professorId, id));
  }

  async criar(
    professorId: string,
    dto: CreateInstituicaoDto,
  ): Promise<InstituicaoView> {
    const instituicao = await this.repo.create(
      new InstituicaoEntity({ ...dto, professorId }),
    );
    return this.comGrade(instituicao);
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: UpdateInstituicaoDto,
  ): Promise<InstituicaoView> {
    const instituicao = await this.assertPosse(professorId, id);
    const campos: Partial<InstituicaoEntity> = {
      nome: dto.nome ?? instituicao.nome,
      inicioPrimeiroPeriodo:
        dto.inicioPrimeiroPeriodo ?? instituicao.inicioPrimeiroPeriodo,
      fimUltimoPeriodo: dto.fimUltimoPeriodo ?? instituicao.fimUltimoPeriodo,
      duracaoAula: dto.duracaoAula ?? instituicao.duracaoAula,
      inicioIntervalo: dto.inicioIntervalo ?? instituicao.inicioIntervalo,
      duracaoIntervalo: dto.duracaoIntervalo ?? instituicao.duracaoIntervalo,
    };
    Object.assign(instituicao, campos);
    await this.repo.update(id, campos);
    return this.comGrade(instituicao);
  }

  async remover(professorId: string, id: string): Promise<void> {
    await this.assertPosse(professorId, id);
    await this.repo.delete(id);
  }

  private comGrade(instituicao: InstituicaoEntity): InstituicaoView {
    return Object.assign(instituicao, { grade: instituicao.gerarGrade() });
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
