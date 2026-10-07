import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorChatService } from './wor-chat.service';
import { WorChatRepository } from './wor-chat.repository';
import { WorMatchRepository } from './wor-match.repository';
import { WorGameService } from './wor-game.service';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { CanalEquipe, MensagemChat } from './entities/wor-chat.entity';
import { ModeracaoService } from '../moderacao/moderacao.service';

/**
 * O chat privado da equipe. A privacidade vem do `canalId`: um UUID que só os
 * membros recebem e que nunca aparece no estado público da partida.
 */
function cenario(status: WorMatchEntity['status'] = 'EM_ANDAMENTO') {
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    professorId: 'p1',
    turmaId: 't1',
    status,
  });
  const teams = [
    new WorTeamEntity({
      id: 'equipe-1',
      nome: 'Equipe Azul',
      membros: [
        { alunoId: 'a1', nome: 'Ana' },
        { alunoId: 'a2', nome: 'Bia' },
      ],
    }),
    new WorTeamEntity({
      id: 'equipe-2',
      nome: 'Equipe Vermelha',
      membros: [{ alunoId: 'b1', nome: 'Caio' }],
    }),
  ];
  const canais: CanalEquipe[] = [];
  const mensagens: Record<string, MensagemChat[]> = {};
  let sequencia = 0;

  const matches = {
    buscar: async (id: string) =>
      id === 'm1' ? new WorMatchEntity({ ...match }) : null,
    listarTeams: async () => teams.map((t) => new WorTeamEntity({ ...t })),
  } as unknown as WorMatchRepository;
  const chats = {
    garantirCanais: jest.fn(async (_m: string, teamIds: string[]) => {
      for (const teamId of teamIds) {
        if (!canais.some((c) => c.teamId === teamId)) {
          canais.push({ teamId, canalId: `uuid-${++sequencia}` });
          mensagens[`uuid-${sequencia}`] = [];
        }
      }
      return [...canais];
    }),
    atualizarMensagens: jest.fn(
      async (
        canalId: string,
        mudar: (atuais: MensagemChat[]) => MensagemChat[],
      ) => {
        mensagens[canalId] = mudar(mensagens[canalId] ?? []);
      },
    ),
  } as unknown as WorChatRepository;
  const moderacao = new ModeracaoService();
  const game = {
    penalizarModeracao: jest.fn(async () => undefined),
  } as unknown as WorGameService;

  const service = new WorChatService(matches, chats, moderacao, game);
  return { service, match, canais, mensagens, chats, game };
}

describe('WorChatService — canal da equipe (Task 2)', () => {
  it('entrega ao aluno o canal da própria equipe', async () => {
    const { service, canais } = cenario();
    const { canalId } = await service.canal('a1', 'm1');
    expect(canais.find((c) => c.teamId === 'equipe-1')?.canalId).toBe(canalId);
  });

  it('colegas de equipe recebem o mesmo canal; rivais, outro', async () => {
    const { service } = cenario();
    const ana = await service.canal('a1', 'm1');
    const bia = await service.canal('a2', 'm1');
    const caio = await service.canal('b1', 'm1');
    expect(bia.canalId).toBe(ana.canalId);
    expect(caio.canalId).not.toBe(ana.canalId);
  });

  it('cria os canais na hora, de forma idempotente (partidas antigas)', async () => {
    const { service, canais } = cenario();
    await service.canal('a1', 'm1');
    await service.canal('a1', 'm1');
    expect(canais).toHaveLength(2);
  });

  it('recusa quem não está em nenhuma equipe', async () => {
    const { service } = cenario();
    await expect(service.canal('intruso', 'm1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 para partida inexistente', async () => {
    const { service } = cenario();
    await expect(service.canal('a1', 'nao-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('o canalId nunca vai para o estado público da partida', async () => {
    const { service, match } = cenario();
    const { canalId } = await service.canal('a1', 'm1');
    expect(JSON.stringify(match)).not.toContain(canalId);
  });
});
