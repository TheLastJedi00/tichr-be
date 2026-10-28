import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { PartidaEntity } from './entities/partida.entity';
import { QlickSegredoEntity } from './entities/qlick-segredo.entity';
import { QlickEntity } from './entities/qlick.entity';
import { PartidaService } from './partida.service';

/** Embaralhamento de perguntas e alternativas por aluno (spec 031). */

const qlick = () =>
  new QlickEntity({
    id: 'q1',
    professorId: 'p1',
    titulo: 'Quiz',
    duracaoSegundos: 20,
    perguntas: [
      { enunciado: 'P1', alternativas: ['a', 'b'], corretaIndex: 0 },
      { enunciado: 'P2', alternativas: ['c', 'd', 'e'], corretaIndex: 2 },
    ],
    turmaIds: ['t1'],
  });

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
    inscritos: [
      { alunoId: 'a1', nome: 'Ana' },
      { alunoId: 'a2', nome: 'Bruno' },
    ],
    placar: [],
    ...over,
  });

/** Firestore fake em memória para a coleção qlick_respostas. */
function firebaseFake() {
  const store = new Map<string, Record<string, unknown>>();
  const firestore = {
    collection: () => ({
      doc: (id: string) => ({
        get: () =>
          Promise.resolve({ exists: store.has(id), data: () => store.get(id) }),
        set: (data: Record<string, unknown>) =>
          Promise.resolve(store.set(id, data)),
      }),
      where: (_campo: string, _op: string, valor: unknown) => ({
        get: () =>
          Promise.resolve({
            docs: [...store.values()]
              .filter((r) => r.partidaId === valor)
              .map((r) => ({ data: () => r })),
          }),
      }),
    }),
  };
  return { firebase: { firestore } as never, store };
}

function cenario(
  over: Partial<PartidaEntity> = {},
  cofreInicial: QlickSegredoEntity | null = null,
) {
  const partida = partidaBase(over);
  let cofre = cofreInicial;
  const segredoRepo = {
    gravar: jest.fn((_id: string, s: QlickSegredoEntity) => {
      cofre = s;
      return Promise.resolve();
    }),
    findById: jest.fn(() => Promise.resolve(cofre)),
  };
  const { firebase, store } = firebaseFake();
  const partidaRepo = {
    findById: jest.fn(() => Promise.resolve(partida)),
    create: jest.fn((p: PartidaEntity) => Promise.resolve(p)),
    update: jest.fn((_id: string, d: Partial<PartidaEntity>) => {
      // o contador é um sentinel do Firestore: não aplica no objeto local
      const { respondidosRodada, ...resto } = d;
      if (typeof respondidosRodada === 'number') {
        Object.assign(partida, { respondidosRodada });
      }
      Object.assign(partida, resto);
      return Promise.resolve();
    }),
  };
  const qlickRepo = { findById: jest.fn().mockResolvedValue(qlick()) };
  const turmaRepo = {
    findById: jest.fn().mockResolvedValue({ id: 't1', professorId: 'p1' }),
  };
  const professorService = {
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: 'PHD' })),
  };
  const service = new PartidaService(
    partidaRepo as never,
    qlickRepo as never,
    turmaRepo as never,
    {} as never,
    professorService as never,
    firebase,
    { creditarPartida: jest.fn() } as never,
    segredoRepo as never,
  );
  return { service, partida, partidaRepo, segredoRepo, store };
}

describe('PartidaService — embaralhamento: lobby (031 §2.1)', () => {
  it('criar liga as duas opções e zera o contador', async () => {
    const { service } = cenario();
    const p = await service.criar('p1', 'q1', 't1');
    expect(p.embaralharPerguntas).toBe(true);
    expect(p.embaralharAlternativas).toBe(true);
    expect(p.respondidosRodada).toBe(0);
  });

  it('definirEmbaralhamento altera só o campo enviado', async () => {
    const { service, partida, partidaRepo } = cenario({
      embaralharPerguntas: true,
      embaralharAlternativas: true,
    });
    await service.definirEmbaralhamento('p1', 'pt1', {
      embaralharAlternativas: false,
    });
    expect(partidaRepo.update).toHaveBeenCalledWith('pt1', {
      embaralharAlternativas: false,
    });
    expect(partida.embaralharPerguntas).toBe(true);
    expect(partida.embaralharAlternativas).toBe(false);
  });

  it('definirEmbaralhamento recusa corpo sem nenhum dos dois campos', async () => {
    const { service } = cenario();
    await expect(
      service.definirEmbaralhamento('p1', 'pt1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('definirEmbaralhamento recusa fora do LOBBY', async () => {
    const { service } = cenario({ status: 'QUESTAO_ATIVA', perguntaAtual: 0 });
    await expect(
      service.definirEmbaralhamento('p1', 'pt1', {
        embaralharPerguntas: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('definirEmbaralhamento recusa professor que não é o dono', async () => {
    const { service } = cenario();
    await expect(
      service.definirEmbaralhamento('outro', 'pt1', {
        embaralharPerguntas: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PartidaService — embaralhamento: rodada (031 §2.2, §2.3, §2.5)', () => {
  it('iniciar com perguntas embaralhadas grava o cofre e esconde o enunciado', async () => {
    const { service, segredoRepo } = cenario({
      embaralharPerguntas: true,
      embaralharAlternativas: true,
    });
    const r = await service.iniciar('p1', 'pt1');
    expect(segredoRepo.gravar).toHaveBeenCalledTimes(1);
    const [id, cofre] = segredoRepo.gravar.mock.calls[0];
    expect(id).toBe('pt1');
    expect(Object.keys(cofre.ordens).sort()).toEqual(['a1', 'a2']);
    expect(r.status).toBe('QUESTAO_ATIVA');
    expect(r.perguntaPublica).toBeNull();
    expect(r.corretaIndex).toBeNull();
  });

  it('iniciar com só as alternativas embaralhadas grava o cofre e mantém o enunciado', async () => {
    const { service, segredoRepo } = cenario({
      embaralharPerguntas: false,
      embaralharAlternativas: true,
    });
    const r = await service.iniciar('p1', 'pt1');
    expect(segredoRepo.gravar).toHaveBeenCalledTimes(1);
    const cofre = segredoRepo.gravar.mock.calls[0][1];
    expect(cofre.ordens.a1.perguntas).toEqual([0, 1]);
    expect(r.perguntaPublica?.enunciado).toBe('P1');
  });

  it('iniciar com as duas opções desligadas não grava cofre', async () => {
    const { service, segredoRepo } = cenario({
      embaralharPerguntas: false,
      embaralharAlternativas: false,
    });
    const r = await service.iniciar('p1', 'pt1');
    expect(segredoRepo.gravar).not.toHaveBeenCalled();
    expect(r.perguntaPublica?.enunciado).toBe('P1');
  });

  it('partida antiga (sem os campos) não embaralha', async () => {
    const { service, segredoRepo } = cenario();
    const r = await service.iniciar('p1', 'pt1');
    expect(segredoRepo.gravar).not.toHaveBeenCalled();
    expect(r.perguntaPublica?.enunciado).toBe('P1');
  });

  it('próxima rodada zera o contador de respostas', async () => {
    const { service, partida } = cenario({
      status: 'RANKING_PARCIAL',
      perguntaAtual: 0,
      respondidosRodada: 2,
    });
    await service.proxima('p1', 'pt1');
    expect(partida.respondidosRodada).toBe(0);
  });

  it('apurar com perguntas embaralhadas não revela a correta', async () => {
    const { service, partida } = cenario({
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 0,
      embaralharPerguntas: true,
      perguntaPublica: null,
    });
    await service.apurarComando('p1', 'pt1');
    expect(partida.status).toBe('RANKING_PARCIAL');
    expect(partida.corretaIndex).toBeNull();
  });

  it('apurar com só as alternativas embaralhadas revela a correta no índice do cadastro', async () => {
    const { service, partida } = cenario({
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 1,
      embaralharPerguntas: false,
      embaralharAlternativas: true,
    });
    await service.apurarComando('p1', 'pt1');
    expect(partida.corretaIndex).toBe(2);
  });
});
