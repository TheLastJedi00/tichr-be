import { Injectable } from '@nestjs/common';
import { ProfessorService, ProfessorView } from '../professor/professor.service';
import { TurmaEntity } from '../turma/entities/turma.entity';
import { TurmaService } from '../turma/turma.service';

/** Payload agregado do painel do professor (perfil + turmas numa tacada). */
export interface HomePayload {
  profile: ProfessorView;
  turmas: TurmaEntity[];
}

/**
 * Agregador (BFF) do painel: reune dados de multiplos dominios num unico
 * roundtrip. Buscas independentes rodam em paralelo (Promise.all), entao o
 * tempo total e ditado pela requisicao mais lenta, nao pela soma.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  async carregar(uid: string): Promise<HomePayload> {
    const [profile, turmas] = await Promise.all([
      this.professorService.getProfileView(uid),
      this.turmaService.listarTurmas(uid),
    ]);
    return { profile, turmas };
  }
}
