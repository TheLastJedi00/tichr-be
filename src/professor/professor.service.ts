import { ConflictException, Injectable } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PlanoAtual, ProfessorEntity } from './entities/professor.entity';
import { ProfessorRepository } from './professor.repository';

@Injectable()
export class ProfessorService {
  constructor(private readonly repo: ProfessorRepository) {}

  /** Retorna o perfil do professor, ou um perfil vazio (so uid) se ainda nao existir. */
  async getProfile(uid: string): Promise<ProfessorEntity> {
    return (await this.repo.findByUid(uid)) ?? new ProfessorEntity({ uid });
  }

  /** Normaliza o handle: remove '@' inicial e baixa a caixa. */
  static normalizarUsername(raw: string): string {
    return raw.trim().replace(/^@/, '').toLowerCase();
  }

  /** Disponibilidade de um username (livre ou ja pertence ao proprio professor). */
  async checkUsername(
    uid: string,
    raw: string,
  ): Promise<{ username: string; disponivel: boolean }> {
    const username = ProfessorService.normalizarUsername(raw);
    const dono = await this.repo.findByUsername(username);
    return { username, disponivel: !dono || dono.uid === uid };
  }

  async updateProfile(
    uid: string,
    dto: UpdateProfileDto,
  ): Promise<ProfessorEntity> {
    const dados: Partial<ProfessorEntity> = { ...dto };
    if (dto.username !== undefined) {
      const username = ProfessorService.normalizarUsername(dto.username);
      const dono = await this.repo.findByUsername(username);
      if (dono && dono.uid !== uid) {
        throw new ConflictException('Esse @username ja esta em uso.');
      }
      dados.username = username;
    }
    return this.repo.upsert(uid, dados);
  }

  /** Compra uma vaga avulsa: incrementa slotsAdicionaisComprados em +1. */
  async comprarSlotAvulso(uid: string): Promise<ProfessorEntity> {
    const atual = await this.getProfile(uid);
    return this.repo.upsert(uid, {
      slotsAdicionaisComprados: (atual.slotsAdicionaisComprados ?? 0) + 1,
    });
  }

  /** Faz upgrade/downgrade do nivel academico do professor. */
  async alterarPlano(uid: string, plano: PlanoAtual): Promise<ProfessorEntity> {
    return this.repo.upsert(uid, { planoAtual: plano });
  }
}
