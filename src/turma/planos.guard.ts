import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { ProfessorService } from '../professor/professor.service';
import { TurmaService } from './turma.service';

/**
 * Guarda de cota de plano. Roda depois do AuthGuard global (que preenche
 * request.user) e barra a criacao de turma quando o professor ja atingiu o
 * limite de turmas ativas do seu nivel academico.
 *
 * Limite = base do plano (2 Estagiario / 5 Graduado / ilimitado Mestre e PhD)
 * + slots avulsos comprados. Ao estourar, lanca 403 com code 'LIMIT_REACHED'.
 */
@Injectable()
export class PlanosGuard implements CanActivate {
  constructor(
    private readonly professorService: ProfessorService,
    private readonly turmaService: TurmaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const uid = (request['user'] as DecodedIdToken).uid;

    const profile = await this.professorService.getProfile(uid);
    const limite = profile.limiteTurmas;

    // Planos ilimitados (Mestre/PhD) nunca esbarram na cota.
    if (limite === Infinity) {
      return true;
    }

    const ativas = await this.turmaService.contarTurmasAtivas(uid);
    if (ativas >= limite) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        message:
          'Voce atingiu o limite de turmas ativas do seu plano. Compre uma vaga avulsa ou faca upgrade.',
        limite,
        ativas,
        plano: profile.planoAtual,
      });
    }

    return true;
  }
}
