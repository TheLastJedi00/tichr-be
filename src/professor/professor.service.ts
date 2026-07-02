import { Injectable } from '@nestjs/common';
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

  updateProfile(uid: string, dto: UpdateProfileDto): Promise<ProfessorEntity> {
    return this.repo.upsert(uid, dto);
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
