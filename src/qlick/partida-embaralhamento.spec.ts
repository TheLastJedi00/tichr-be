import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { PartidaEntity } from './entities/partida.entity';
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

function cenario(over: Partial<PartidaEntity> = {}) {
  const partida = partidaBase(over);
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
    { firestore: {} } as never,
    { creditarPartida: jest.fn() } as never,
  );
  return { service, partida, partidaRepo };
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
