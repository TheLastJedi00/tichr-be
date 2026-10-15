import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PartidaEntity } from './entities/partida.entity';
import { PartidaService } from './partida.service';

/** Pausar e retomar o Qlick (028 §4). Relógio mockado. */
describe('PartidaService — pausa', () => {
  const T0 = Date.parse('2026-10-15T12:00:00.000Z');

  function cenario(over: Partial<PartidaEntity> = {}) {
    const partida = new PartidaEntity({
      id: 'pt1',
      qlickId: 'q1',
      professorId: 'p1',
      turmaId: 't1',
      titulo: 'Quiz',
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 0,
      totalPerguntas: 2,
      duracaoSegundos: 20,
      perguntaIniciadaEm: new Date(T0 - 5_000).toISOString(),
      inscritos: [{ alunoId: 'a1', nome: 'Ana' }],
      placar: [],
      ...over,
    });
    const repo = {
      findById: jest.fn(async () => partida),
      update: jest.fn(async (_id: string, d: Partial<PartidaEntity>) => {
        Object.assign(partida, d);
      }),
    };
    const qlick = {
      findById: jest.fn().mockResolvedValue({
        id: 'q1',
        perguntas: [
          { enunciado: 'P1', alternativas: ['a', 'b'], corretaIndex: 0 },
          { enunciado: 'P2', alternativas: ['c', 'd'], corretaIndex: 1 },
        ],
      }),
    };
    const service = new PartidaService(
      repo as never,
      qlick as never,
      {} as never,
      {} as never,
      {} as never,
      { firestore: {} } as never,
      { creditarPartida: jest.fn() } as never,
    );
    return { service, partida, repo };
  }

  let agora = T0;
  beforeEach(() => {
    agora = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });
  afterEach(() => jest.restoreAllMocks());

  it('pausar grava pausadaEm; pausar de novo é idempotente', async () => {
    const { service, partida } = cenario();
    await service.pausar('p1', 'pt1');
    expect(partida.pausadaEm).toBe(new Date(T0).toISOString());

    agora = T0 + 10_000;
    await service.pausar('p1', 'pt1');
    expect(partida.pausadaEm).toBe(new Date(T0).toISOString());
  });

  it('retomar zera pausadaEm e empurra perguntaIniciadaEm pelo tempo pausado', async () => {
    const { service, partida } = cenario();
    await service.pausar('p1', 'pt1');
    agora = T0 + 42_000;
    await service.retomar('p1', 'pt1');

    expect(partida.pausadaEm).toBeNull();
    expect(partida.perguntaIniciadaEm).toBe(
      new Date(T0 - 5_000 + 42_000).toISOString(),
    );
  });

  it('retomar sem pausa não mexe no relógio', async () => {
    const { service, partida } = cenario();
    const antes = partida.perguntaIniciadaEm;
    await service.retomar('p1', 'pt1');
    expect(partida.perguntaIniciadaEm).toBe(antes);
  });

  it('fora de andamento: 400 PARTIDA_NAO_PAUSAVEL', async () => {
    for (const status of ['LOBBY', 'ENCERRADO'] as const) {
      const { service } = cenario({ status });
      await expect(service.pausar('p1', 'pt1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('só o dono', async () => {
    const { service } = cenario();
    await expect(service.pausar('outro', 'pt1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.retomar('outro', 'pt1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('o bônus de rapidez usa o relógio empurrado: o tempo pausado não conta', async () => {
    const { service, partida } = cenario({
      perguntaIniciadaEm: new Date(T0).toISOString(),
    });
    await service.pausar('p1', 'pt1');
    agora = T0 + 60_000;
    await service.retomar('p1', 'pt1');
    // Respondida logo após retomar: 0s corridos de pergunta.
    expect(partida.perguntaIniciadaEm).toBe(
      new Date(T0 + 60_000).toISOString(),
    );
  });
});
