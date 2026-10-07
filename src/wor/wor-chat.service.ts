import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModeracaoService } from '../moderacao/moderacao.service';
import { WorChatRepository } from './wor-chat.repository';
import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorTeamEntity } from './entities/wor-team.entity';

/**
 * O chat privado de cada equipe. O cliente lê as mensagens direto no Firestore
 * (`wor_chats/{canalId}`), mas só chega lá com o `canalId` que esta classe
 * entrega a quem é da equipe. Toda mensagem passa pelo filtro aqui, no servidor.
 */
@Injectable()
export class WorChatService {
  constructor(
    private readonly matches: WorMatchRepository,
    private readonly chats: WorChatRepository,
    private readonly moderacao: ModeracaoService,
    private readonly game: WorGameService,
  ) {}

  private async equipeDoAluno(
    matchId: string,
    alunoId: string,
  ): Promise<{ team: WorTeamEntity; teams: WorTeamEntity[] }> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    const teams = await this.matches.listarTeams(matchId);
    const team = teams.find((t) =>
      t.membros.some((m) => m.alunoId === alunoId),
    );
    if (!team) throw new ForbiddenException('Você não está em nenhuma equipe.');
    return { team, teams };
  }

  /** O canal da equipe do aluno (criado na hora, se ainda não existir). */
  async canal(alunoId: string, matchId: string): Promise<{ canalId: string }> {
    const { team, teams } = await this.equipeDoAluno(matchId, alunoId);
    return { canalId: await this.canalDaEquipe(matchId, team, teams) };
  }

  private async canalDaEquipe(
    matchId: string,
    team: WorTeamEntity,
    teams: WorTeamEntity[],
  ): Promise<string> {
    const canais = await this.chats.garantirCanais(
      matchId,
      teams.map((t) => t.id),
    );
    return canais.find((c) => c.teamId === team.id)!.canalId;
  }
}
