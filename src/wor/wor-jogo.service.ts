import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PalavraWor, WorJogoEntity } from './entities/wor-jogo.entity';
import { WorJogoRepository } from './wor-jogo.repository';
import { CreateWorJogoDto, PalavraWorDto } from './dto/create-wor-jogo.dto';

/** CRUD do arsenal (definição de batalhas do Tichr Wor). */
@Injectable()
export class WorJogoService {
  constructor(private readonly repo: WorJogoRepository) {}

  listar(professorId: string): Promise<WorJogoEntity[]> {
    return this.repo.findByProfessor(professorId);
  }

  /** Busca garantindo posse (404 se não existe, 403 se é de outro professor). */
  async obter(professorId: string, id: string): Promise<WorJogoEntity> {
    const jogo = await this.repo.findById(id);
    if (!jogo) throw new NotFoundException('Batalha não encontrada.');
    if (jogo.professorId !== professorId) {
      throw new ForbiddenException('Essa batalha não é sua.');
    }
    return jogo;
  }

  criar(professorId: string, dto: CreateWorJogoDto): Promise<WorJogoEntity> {
    return this.repo.create({
      professorId,
      nome: dto.nome.trim(),
      disciplina: dto.disciplina?.trim(),
      topico: dto.topico.trim(),
      palavras: WorJogoService.normalizarPalavras(dto.palavras),
    } as Omit<WorJogoEntity, 'id'>);
  }

  async atualizar(
    professorId: string,
    id: string,
    dto: CreateWorJogoDto,
  ): Promise<WorJogoEntity> {
    await this.obter(professorId, id);
    await this.repo.update(id, {
      nome: dto.nome.trim(),
      disciplina: dto.disciplina?.trim(),
      topico: dto.topico.trim(),
      palavras: WorJogoService.normalizarPalavras(dto.palavras),
    });
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
