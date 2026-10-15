import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsolateusMatchEntity } from '../isolateus/entities/isolateus-match.entity';
import { IsolateusMatchRepository } from '../isolateus/isolateus-match.repository';
import { IsolateusMatchService } from '../isolateus/isolateus-match.service';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { PartidaEntity } from '../qlick/entities/partida.entity';
import { PartidaService } from '../qlick/partida.service';
import { WorMatchEntity } from '../wor/entities/wor-match.entity';
import { WorJogoRepository } from '../wor/wor-jogo.repository';
import { WorMatchRepository } from '../wor/wor-match.repository';
import { WorMatchService } from '../wor/wor-match.service';
import { DefinirValeRankingDto, valeRanking } from './vale-ranking';

/**
 * Partida casual (spec 027 §3): o professor desmarca "Vale para o ranking da
 * turma" no lobby. Só o dono muda, e só antes de a partida começar.
 */
describe('vale-ranking — partida casual', () => {
  describe('regra comum', () => {
    it('partida sem o campo (antiga) vale para o ranking', () => {
      expect(valeRanking({})).toBe(true);
      expect(valeRanking({ valeRanking: undefined })).toBe(true);
      expect(valeRanking({ valeRanking: true })).toBe(true);
      expect(valeRanking({ valeRanking: false })).toBe(false);
    });

    it('a DTO só aceita booleano', async () => {
      const erros = async (valor: unknown) =>
        (
          await validate(
            plainToInstance(DefinirValeRankingDto, { valeRanking: valor }),
          )
        ).length;
      expect(await erros(true)).toBe(0);
      expect(await erros(false)).toBe(0);
      expect(await erros('false')).toBeGreaterThan(0);
      expect(await erros(undefined)).toBeGreaterThan(0);
    });
  });

  describe('Qlick', () => {
    const servico = (partida: PartidaEntity) => {
      const repo = {
        findById: jest.fn().mockResolvedValue(partida),
        update: jest.fn((_id: string, dados: Partial<PartidaEntity>) => {
          Object.assign(partida, dados);
          return Promise.resolve();
        }),
      };
      return new PartidaService(
        repo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    };
    const lobby = () =>
      new PartidaEntity({ id: 'pt1', professorId: 'p1', status: 'LOBBY' });

    it('o professor desmarca no lobby', async () => {
      const partida = lobby();
      const r = await servico(partida).definirValeRanking('p1', 'pt1', false);
      expect(partida.valeRanking).toBe(false);
      expect(r.valeRanking).toBe(false);
    });

    it('fora do lobby → 400 PARTIDA_INICIADA', async () => {
      const partida = lobby();
      partida.status = 'QUESTAO_ATIVA';
      await expect(
        servico(partida).definirValeRanking('p1', 'pt1', false),
      ).rejects.toMatchObject({
        response: { code: 'PARTIDA_INICIADA' },
      });
      expect(partida.valeRanking).toBeUndefined();
    });

    it('outro professor → 404', async () => {
      await expect(
        servico(lobby()).definirValeRanking('outro', 'pt1', false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Wor', () => {
    const servico = (match: WorMatchEntity) => {
      const repo = {
        buscar: jest.fn().mockResolvedValue(match),
        atualizar: jest.fn((_id: string, dados: Partial<WorMatchEntity>) => {
          Object.assign(match, dados);
          return Promise.resolve();
        }),
        listarTeams: jest.fn().mockResolvedValue([]),
      } as unknown as WorMatchRepository;
      const professores = {
        getProfile: jest
          .fn()
          .mockResolvedValue(new ProfessorEntity({ planoAtual: 'PHD' })),
      } as never;
      return new WorMatchService({} as WorJogoRepository, repo, professores, {
        findById: jest.fn(),
      } as never);
    };
    const lobby = () =>
      new WorMatchEntity({ id: 'm1', professorId: 'p1', status: 'LOBBY' });

    it('a partida nasce valendo para o ranking', () => {
      expect(lobby().valeRanking).toBe(true);
    });

    it('o professor desmarca no lobby', async () => {
      const match = lobby();
      const view = await servico(match).definirValeRanking('p1', 'm1', false);
      expect(match.valeRanking).toBe(false);
      expect(view.match.valeRanking).toBe(false);
    });

    it('fora do lobby → 400 PARTIDA_INICIADA', async () => {
      const match = lobby();
      match.status = 'EM_ANDAMENTO';
      const r = servico(match).definirValeRanking('p1', 'm1', false);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toMatchObject({
        response: { code: 'PARTIDA_INICIADA' },
      });
      expect(match.valeRanking).toBe(true);
    });

    it('só o dono da partida altera (403, como o multiplicador)', async () => {
      await expect(
        servico(lobby()).definirValeRanking('outro', 'm1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Isolateus', () => {
    const servico = (partida: IsolateusMatchEntity) => {
      const repo = {
        buscar: jest.fn().mockResolvedValue(partida),
        commitPartida: jest.fn(
          (_id: string, publico: Partial<IsolateusMatchEntity>) => {
            Object.assign(partida, publico);
            return Promise.resolve();
          },
        ),
      } as unknown as IsolateusMatchRepository;
      return new IsolateusMatchService(
        repo,
        {} as never,
        {} as never,
        {} as never,
      );
    };
    const lobby = () =>
      new IsolateusMatchEntity({
        id: 'i1',
        professorId: 'p1',
        status: 'LOBBY',
      });

    it('o professor desmarca no lobby', async () => {
      const partida = lobby();
      const r = await servico(partida).definirValeRanking('p1', 'i1', false);
      expect(partida.valeRanking).toBe(false);
      expect(r.valeRanking).toBe(false);
    });

    it('fora do lobby → 400 PARTIDA_INICIADA', async () => {
      const partida = lobby();
      partida.status = 'DESLOCAMENTO';
      await expect(
        servico(partida).definirValeRanking('p1', 'i1', false),
      ).rejects.toMatchObject({
        response: { code: 'PARTIDA_INICIADA' },
      });
    });

    it('outro professor → 404', async () => {
      await expect(
        servico(lobby()).definirValeRanking('outro', 'i1', false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
