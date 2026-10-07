import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModeracaoService } from '../moderacao/moderacao.service';
import { WorChatRepository } from './wor-chat.repository';
import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { MensagemChat, WorChatEntity } from './entities/wor-chat.entity';

interface Contexto {
  match: WorMatchEntity;
  team: WorTeamEntity;
  teams: WorTeamEntity[];
}

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

  private async contexto(matchId: string, alunoId: string): Promise<Contexto> {
    const match = await this.matches.buscar(matchId);
    if (!match) throw new NotFoundException('Partida não encontrada.');
    const teams = await this.matches.listarTeams(matchId);
    const team = teams.find((t) =>
      t.membros.some((m) => m.alunoId === alunoId),
    );
    if (!team) throw new ForbiddenException('Você não está em nenhuma equipe.');
    return { match, team, teams };
  }

  /** O canal da equipe do aluno (criado na hora, se ainda não existir). */
  async canal(alunoId: string, matchId: string): Promise<{ canalId: string }> {
    const { team, teams } = await this.contexto(matchId, alunoId);
    return { canalId: await this.canalDaEquipe(matchId, team, teams) };
  }

  /** Publica uma mensagem no chat da equipe do aluno. */
  async enviar(
    alunoId: string,
    matchId: string,
    texto: string,
  ): Promise<MensagemChat> {
    const { match, team, teams } = await this.contexto(matchId, alunoId);
    if (match.status !== 'EM_ANDAMENTO') {
      throw new BadRequestException(
        'O chat só funciona com a batalha em andamento.',
      );
    }
    const limpo = (texto ?? '').trim();
    if (!limpo || limpo.length > WOR.CHAT_MAX_CARACTERES) {
      throw new BadRequestException(
        `A mensagem precisa ter de 1 a ${WOR.CHAT_MAX_CARACTERES} caracteres.`,
      );
    }

    // A mensagem ofensiva nunca chega à equipe: é barrada aqui e cobrada.
    if (this.moderacao.contemPalavrao(limpo)) {
      await this.game.penalizarModeracao(matchId, alunoId);
      throw new UnprocessableEntityException({
        code: 'MENSAGEM_BLOQUEADA',
        message: `Mensagem bloqueada: linguagem imprópria. Sua equipe perdeu ${WOR.PENALIDADE_HP} HP e você perdeu ${WOR.PENALIDADE_XP} XP.`,
      });
    }

    const canalId = await this.canalDaEquipe(matchId, team, teams);
    const mensagem: MensagemChat = {
      id: randomUUID(),
      alunoId,
      nome: team.membros.find((m) => m.alunoId === alunoId)?.nome ?? 'Aluno',
      texto: limpo,
      em: new Date().toISOString(),
    };
    await this.chats.atualizarMensagens(canalId, (atuais) =>
      WorChatEntity.anexar(atuais, mensagem),
    );
    return mensagem;
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
