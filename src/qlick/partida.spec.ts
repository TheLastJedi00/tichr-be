import { BadRequestException } from '@nestjs/common';
import { PartidaEntity } from './entities/partida.entity';
import { PartidaService } from './partida.service';

/** Firestore fake em memória para a coleção qlick_respostas. */
function firebaseFake() {
  const store = new Map<string, Record<string, unknown>>();
  const firestore = {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(id), data: () => store.get(id) }),
        set: async (data: Record<string, unknown>) => store.set(id, data),
      }),
      where: (_campo: string, _op: string, valor: unknown) => ({
        get: async () => ({
          docs: [...store.values()]
            .filter((r) => r.partidaId === valor)
            .map((r) => ({ data: () => r })),
        }),
      }),
    }),
  };
  return { firestore } as never;
}

const xpFake = () => ({ creditarPartida: jest.fn() }) as never;

const qlickFake = () =>
  ({
    findById: jest.fn().mockResolvedValue({
      id: 'q1',
      professorId: 'p1',
      qlickId: 'q1',
      duracaoSegundos: 20,
      perguntas: [
        { enunciado: 'P1', alternativas: ['a', 'b'], corretaIndex: 0 },
        { enunciado: 'P2', alternativas: ['c', 'd'], corretaIndex: 1 },
      ],
    }),
  }) as never;

const partidaBase = (over: Partial<PartidaEntity> = {}) =>
  new PartidaEntity({
    id: 'pt1',
    qlickId: 'q1',
    professorId: 'p1',
    turmaId: 't1',
    titulo: 'Quiz',
    status: 'LOBBY',
    perguntaAtual: -1,
    totalPerguntas: 2,
    duracaoSegundos: 20,
    inscritos: [{ alunoId: 'a1', nome: 'Ana' }],
    placar: [],
    ...over,
  });

describe('PartidaService — fluxo CQRS', () => {
  it('iniciar: LOBBY → QUESTAO_ATIVA com a pergunta 0 pública (sem resposta correta)', async () => {
    const partida = partidaBase();
    const repo = {
      findById: jest.fn().mockResolvedValue(partida),
      update: jest.fn(),
    };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    const r = await service.iniciar('p1', 'pt1');
    expect(r.status).toBe('QUESTAO_ATIVA');
    expect(r.perguntaAtual).toBe(0);
    expect(r.perguntaPublica?.enunciado).toBe('P1');
    expect(r.corretaIndex).toBeNull();
  });

  it('iniciar: rejeita sem inscritos', async () => {
    const partida = partidaBase({ inscritos: [] });
    const repo = { findById: jest.fn().mockResolvedValue(partida), update: jest.fn() };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    await expect(service.iniciar('p1', 'pt1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('proxima: rejeita fora de RANKING_PARCIAL', async () => {
    const partida = partidaBase({ status: 'QUESTAO_ATIVA', perguntaAtual: 0 });
    const repo = { findById: jest.fn().mockResolvedValue(partida), update: jest.fn() };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    await expect(service.proxima('p1', 'pt1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('responder: acerto rápido pontua > base e auto-apura quando todos respondem', async () => {
    const partida = partidaBase({
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 0,
      perguntaIniciadaEm: new Date().toISOString(),
      perguntaPublica: { enunciado: 'P1', alternativas: ['a', 'b'] },
    });
    const repo = {
      findById: jest.fn().mockResolvedValue(partida),
      update: jest.fn(),
    };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    const r = await service.responder('a1', 'pt1', 0);
    expect(r.registrada).toBe(true);
    // único inscrito respondeu → apuração automática
    expect(partida.status).toBe('RANKING_PARCIAL');
    expect(partida.corretaIndex).toBe(0);
    expect(partida.placar[0].pontos).toBeGreaterThan(1000);
  });

  it('responder: resposta errada pontua 0', async () => {
    const partida = partidaBase({
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 0,
      perguntaIniciadaEm: new Date().toISOString(),
    });
    const repo = { findById: jest.fn().mockResolvedValue(partida), update: jest.fn() };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    await service.responder('a1', 'pt1', 1);
    expect(partida.placar[0].pontos).toBe(0);
  });

  it('encerrar: monta rankingFinal ordenado com posição', async () => {
    const partida = partidaBase({
      status: 'RANKING_PARCIAL',
      placar: [
        { alunoId: 'a1', nome: 'Ana', pontos: 800 },
        { alunoId: 'a2', nome: 'Bia', pontos: 1500 },
      ],
    });
    const repo = { findById: jest.fn().mockResolvedValue(partida), update: jest.fn() };
    const xp = { creditarPartida: jest.fn() };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xp as never,
    );
    const r = await service.encerrar('p1', 'pt1');
    expect(r.status).toBe('ENCERRADO');
    expect(r.rankingFinal?.[0]).toMatchObject({ posicao: 1, nome: 'Bia' });
    expect(r.rankingFinal?.[1]).toMatchObject({ posicao: 2, nome: 'Ana' });
    // pontos da partida viram XP do portal (motivo QLICK)
    expect(xp.creditarPartida).toHaveBeenCalledWith('t1', [
      { alunoId: 'a1', pontos: 800 },
      { alunoId: 'a2', pontos: 1500 },
    ]);
  });

  it('partidaDaTurma: retorna a partida ativa recém-criada (sem depender do relógio)', async () => {
    const agora = new Date().toISOString();
    const repo = {
      findByTurma: jest.fn().mockResolvedValue([
        partidaBase({ id: 'velha', status: 'ENCERRADO', criadaEm: agora }),
        partidaBase({ id: 'nova', status: 'LOBBY', titulo: 'Quiz', criadaEm: agora }),
      ]),
    };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    const r = await service.partidaDaTurma('t1');
    expect(r).toMatchObject({ partidaId: 'nova', status: 'LOBBY' });
  });

  it('partidaDaTurma: ignora partidas encerradas ou antigas', async () => {
    const repo = {
      findByTurma: jest.fn().mockResolvedValue([
        partidaBase({ id: 'enc', status: 'ENCERRADO', criadaEm: new Date().toISOString() }),
        partidaBase({ id: 'antiga', status: 'LOBBY', criadaEm: '2020-01-01T00:00:00.000Z' }),
      ]),
    };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xpFake(),
    );
    expect(await service.partidaDaTurma('t1')).toBeNull();
  });

  it('encerrar: rejeita partida já encerrada (evita creditar XP em dobro)', async () => {
    const partida = partidaBase({ status: 'ENCERRADO', placar: [] });
    const repo = { findById: jest.fn().mockResolvedValue(partida), update: jest.fn() };
    const xp = { creditarPartida: jest.fn() };
    const service = new PartidaService(
      repo as never,
      qlickFake(),
      {} as never,
      {} as never,
      {} as never,
      firebaseFake(),
      xp as never,
    );
    await expect(service.encerrar('p1', 'pt1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(xp.creditarPartida).not.toHaveBeenCalled();
  });
});
