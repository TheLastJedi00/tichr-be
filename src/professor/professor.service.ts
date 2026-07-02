import { Injectable } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfessorEntity } from './entities/professor.entity';
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
}
