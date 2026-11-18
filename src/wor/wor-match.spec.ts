import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';
import { WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorMatchService } from './wor-match.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';

const professorFake = (plano: 'PHD' | 'MESTRE' = 'PHD') =>
  ({
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: plano })),
  }) as never;

const turmaRepoFake = (turma: unknown = { id: 't1', professorId: 'p1' }) =>
  ({ findById: jest.fn().mockResolvedValue(turma) }) as never;

describe('Tichr Wor — partida (Fase 3)', () => {
  describe('WorMatchEntity', () => {
    it('normaliza letras (maiúscula, sem acento)', () => {
      expect(WorMatchEntity.normalizar('á')).toBe('A');
      expect(WorMatchEntity.normalizar('ç')).toBe('C');
    });

    it('mascara ocultando letras e preservando espaços', () => {
      const m = WorMatchEntity.mascarar('REI ARTUR', new Set(['R']));
      expect(m).toEqual(['R', '_', '_', ' ', '_', 'R', '_', '_', 'R']);
      expect(WorMatchEntity.estaCompleta(m)).toBe(false);
    });

    it('detecta palavra completa', () => {
      const m = WorMatchEntity.mascarar('REI', new Set(['R', 'E', 'I']));
      expect(WorMatchEntity.estaCompleta(m)).toBe(true);
    });

    it('revela todas as ocorrências de uma letra (acento normalizado)', () => {
      const m = WorMatchEntity.mascarar('ÁRVORE', new Set(['R']));
      // Á oculto, R revelado (2x), demais ocultos
      expect(m).toEqual(['_', 'R', '_', '_', 'R', '_']);
    });
  });

  describe('WorTeamEntity', () => {
    it('aplica dano até 0 e vira Horda ao cair', () => {
      const t = new WorTeamEntity({ id: 'a', hp: 10, isHorde: false });
      expect(t.aplicarDano(5)).toBe(false);
      expect(t.hp).toBe(5);
      expect(t.aplicarDano(20)).toBe(true); // caiu agora
      expect(t.hp).toBe(0);
      expect(t.isHorde).toBe(true);
      expect(t.aplicarDano(5)).toBe(false); // já era horda
    });

    it('cura respeitando o teto de HP inicial (1000)', () => {
      const t = new WorTeamEntity({ id: 'a', hp: 980 });
      t.curar(40);
      expect(t.hp).toBe(1000);
    });
  });

  describe('WorMatchService.distribuir (tamanho automático)', () => {
    it('4 alunos → 2 duplas (tamanho automático por headcount)', async () => {
      const match = new WorMatchEntity({
        id: 'm1',
        professorId: 'p1',
        status: 'LOBBY',
        inscritos: [
          { alunoId: 'a1', nome: 'A' },
          { alunoId: 'a2', nome: 'B' },
          { alunoId: 'a3', nome: 'C' },
          { alunoId: 'a4', nome: 'D' },
        ],
      });
      const criados: Array<{ teamId: string; membros: unknown[] }> = [];
      const repo = {
        buscar: jest.fn().mockResolvedValue(match),
        criarTeam: jest.fn(
          (_m: string, teamId: string, data: { membros: unknown[] }) => {
            criados.push({ teamId, membros: data.membros });
            return Promise.resolve({});
          },
        ),
        atualizar: jest.fn().mockResolvedValue(undefined),
        listarTeams: jest.fn().mockResolvedValue([]),
      } as unknown as WorMatchRepository;

      const service = new WorMatchService(
        {} as WorJogoRepository,
        repo,
        professorFake('PHD'),
        turmaRepoFake(),
      );
      await service.distribuir('p1', 'm1');

      expect(criados).toHaveLength(2); // 4 alunos / 2 (dupla) = 2 equipes
      criados.forEach((c) => expect(c.membros).toHaveLength(2));
      expect(repo.atualizar).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ ordemEquipes: ['equipe-1', 'equipe-2'] }),
      );
    });

    it('rejeita com menos de 2 alunos na sala', async () => {
      const match = new WorMatchEntity({
        id: 'm1',
        professorId: 'p1',
        status: 'LOBBY',
        inscritos: [{ alunoId: 'a1', nome: 'A' }],
      });
      const repo = {
        buscar: jest.fn().mockResolvedValue(match),
      } as unknown as WorMatchRepository;
      const service = new WorMatchService(
        {} as WorJogoRepository,
        repo,
        professorFake('PHD'),
        turmaRepoFake(),
      );
      await expect(service.distribuir('p1', 'm1')).rejects.toThrow();
    });
  });

  describe('WorMatchService.criar (turma derivada + PhD, como no Qlick)', () => {
    const jogo = new WorJogoEntity({
      id: 'j1',
      professorId: 'p1',
      nome: 'Batalha',
      palavras: [{ id: 'w', palavra: 'REI', dicas: ['dica'] }],
      turmaIds: ['t1'],
    });

    const build = (
      overrides: {
        jogo?: unknown;
        plano?: 'PHD' | 'MESTRE';
        turma?: unknown;
        criar?: jest.Mock;
      } = {},
    ) => {
      const criar =
        overrides.criar ?? jest.fn().mockResolvedValue({ id: 'm1' });
      const jogos = {
        findById: jest.fn().mockResolvedValue(overrides.jogo ?? jogo),
      } as unknown as WorJogoRepository;
      const matches = { criar } as unknown as WorMatchRepository;
      const service = new WorMatchService(
        jogos,
        matches,
        professorFake(overrides.plano ?? 'PHD'),
        turmaRepoFake(overrides.turma ?? { id: 't1', professorId: 'p1' }),
      );
      return { service, criar };
    };

    it('bloqueia criar partida para não-PhD (403 WOR_LOCKED)', async () => {
      const { service } = build({ plano: 'MESTRE' });
      await expect(service.criar('p1', 'j1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('deriva a única turma da batalha quando nenhuma é informada', async () => {
      const { service, criar } = build();
      await service.criar('p1', 'j1');
      expect(criar).toHaveBeenCalledWith(
        expect.objectContaining({ turmaId: 't1' }),
      );
    });

    it('rejeita turma não atribuída à batalha (TURMA_NAO_ATRIBUIDA)', async () => {
      const { service } = build({ turma: { id: 'outra', professorId: 'p1' } });
      await expect(service.criar('p1', 'j1', 'outra')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('aceita turma da mesma disciplina numa batalha só-disciplina (ENH-002)', async () => {
      const { service, criar } = build({
        jogo: new WorJogoEntity({
          id: 'j1',
          professorId: 'p1',
          nome: 'Batalha',
          palavras: [{ id: 'w', palavra: 'REI', dicas: ['dica'] }],
          disciplina: 'História',
        }),
        turma: { id: 't9', professorId: 'p1', disciplina: 'História' },
      });
      await service.criar('p1', 'j1', 't9');
      expect(criar).toHaveBeenCalledWith(
        expect.objectContaining({ turmaId: 't9' }),
      );
    });

    it('rejeita turma encerrada (TURMA_ENCERRADA)', async () => {
      const { service } = build({
        turma: { id: 't1', professorId: 'p1', encerradaManualmente: true },
      });
      await expect(service.criar('p1', 'j1', 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

describe('Tichr Wor — cronômetro de entrada (035)', () => {
  function make(match: WorMatchEntity, teams: WorTeamEntity[] = []) {
    const repo = {
      buscar: jest.fn(async () => match),
      atualizar: jest.fn(async (_id: string, d: Partial<WorMatchEntity>) => {
        Object.assign(match, d);
      }),
      listarTeams: jest.fn(async () => teams),
      criarTeam: jest.fn(
        async (_m: string, id: string, d: Partial<WorTeamEntity>) => {
          teams.push(new WorTeamEntity({ ...d, id }));
        },
      ),
      atualizarTeam: jest.fn(
        async (_m: string, id: string, d: Partial<WorTeamEntity>) => {
          Object.assign(
            teams.find((t) => t.id === id)!,
            d,
          );
        },
      ),
      reivindicarEntrada: jest.fn(async () => {
        const venceu =
          match.status === 'LOBBY' &&
          !!match.entradaEncerraEm &&
          Date.parse(match.entradaEncerraEm) <= Date.now() + 1000;
        if (venceu) match.entradaEncerraEm = null;
        return venceu;
      }),
    } as unknown as WorMatchRepository;
    const service = new WorMatchService(
      {} as WorJogoRepository,
      repo,
      professorFake('PHD'),
      turmaRepoFake(),
    );
    return { service, repo, teams };
  }
  const lobby = (n: number, over: Partial<WorMatchEntity> = {}) =>
    new WorMatchEntity({
      id: 'm1',
      professorId: 'p1',
      turmaId: 't1',
      status: 'LOBBY',
      inscritos: Array.from({ length: n }, (_, i) => ({
        alunoId: `a${i + 1}`,
        nome: `A${i + 1}`,
      })),
      ...over,
    });

  it('liga e cancela o cronômetro só no lobby', async () => {
    const match = lobby(2);
    const { service } = make(match);
    await service.definirCronometro('p1', 'm1', 120);
    expect(Date.parse(match.entradaEncerraEm!)).toBeGreaterThan(Date.now());
    await service.definirCronometro('p1', 'm1', null);
    expect(match.entradaEncerraEm).toBeNull();

    match.status = 'EM_ANDAMENTO';
    await expect(service.definirCronometro('p1', 'm1', 60)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('o início manual zera o cronômetro', async () => {
    const match = lobby(4, {
      entradaEncerraEm: new Date(Date.now() + 60_000).toISOString(),
    });
    const { service } = make(match);
    await service.distribuir('p1', 'm1');
    await service.iniciar('p1', 'm1');
    expect(match.status).toBe('EM_ANDAMENTO');
    expect(match.entradaEncerraEm).toBeNull();
  });
});
