import { BadRequestException } from '@nestjs/common';
import { PartidaEntity } from './entities/partida.entity';
import { PartidaService } from './partida.service';

/**
 * Spec 032 §3 — ociosidade no Qlick: falta = pergunta apurada sem resposta do
 * inscrito (o cronômetro correu até o fim). Padrão: marcado a partir da 3ª.
 */
describe('PartidaService — ociosidade', () => {
  function cenario(over: Partial<PartidaEntity> = {}) {
    const partida = new PartidaEntity({
      id: 'pt1',
      qlickId: 'q1',
      professorId: 'p1',
      turmaId: 't1',
      titulo: 'Quiz',
      status: 'QUESTAO_ATIVA',
      perguntaAtual: 0,
      totalPerguntas: 3,
      duracaoSegundos: 20,
      inscritos: [
        { alunoId: 'a1', nome: 'Ana' },
        { alunoId: 'a2', nome: 'Bia' },
      ],
      placar: [],
      ...over,
    });
    const respostas: Array<Record<string, unknown>> = [];
    const repo = {
      findById: jest.fn(async () => partida),
      update: jest.fn(async (_id: string, d: Partial<PartidaEntity>) => {
        Object.assign(partida, d);
      }),
    };
    const qlick = {
      findById: jest.fn().mockResolvedValue({
        id: 'q1',
        perguntas: [0, 1, 2].map((i) => ({
          enunciado: `P${i}`,
          alternativas: ['a', 'b'],
          corretaIndex: 0,
        })),
      }),
    };
    const firestore = {
      collection: () => ({
        where: () => ({
          get: async () => ({ docs: respostas.map((r) => ({ data: () => r })) }),
        }),
      }),
    };
    const xp = {
      creditarPartida: jest.fn(),
      penalizarJogo: jest.fn(async (_t: string, _a: string, p: number) => p),
    };
    const service = new PartidaService(
      repo as never,
      qlick as never,
      {} as never,
      {} as never,
      {} as never,
      { firestore } as never,
      xp as never,
    );
    const respondeu = (alunoId: string, perguntaIndex: number) =>
      respostas.push({
        partidaId: 'pt1',
        alunoId,
        perguntaIndex,
        alternativaIndex: 0,
        correta: true,
        pontos: 1000,
      });
    return { service, partida, respondeu, xp };
  }

  it('quem não respondeu a pergunta apurada ganha uma falta', async () => {
    const { service, partida, respondeu } = cenario();
    respondeu('a1', 0);
    await service.apurarComando('p1', 'pt1');
    expect(partida.ociosidade).toEqual({ a2: 1 });
  });

  it('a 3ª falta marca o ocioso no log final', async () => {
    const { service, partida, respondeu } = cenario({
      ociosidade: { a2: 2 },
    });
    respondeu('a1', 0);
    await service.apurarComando('p1', 'pt1');
    await service.encerrar('p1', 'pt1');
    const a2 = partida.logPontuacao!.find((l) => l.alunoId === 'a2');
    expect(a2).toMatchObject({ faltasOciosidade: 3, ocioso: true });
  });

  it('limite no lobby; fora do lobby, 400', async () => {
    const { service, partida } = cenario({ status: 'LOBBY' });
    await service.definirLimiteOciosidade('p1', 'pt1', 5);
    expect(partida.limiteOciosidade).toBe(5);
    partida.status = 'QUESTAO_ATIVA';
    await expect(service.definirLimiteOciosidade('p1', 'pt1', 2)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('desconto do ocioso: zera o crédito da partida e registra no log', async () => {
    const { service, partida, xp } = cenario({
      status: 'ENCERRADO',
      logPontuacao: [
        {
          alunoId: 'a2',
          nome: 'Bia',
          totalPartida: 700,
          creditoRanking: 700,
          itens: [],
          faltasOciosidade: 3,
          ocioso: true,
        },
      ],
    });
    await service.descontarOciosidade('p1', 'pt1', {
      alunoId: 'a2',
      modo: 'ZERAR_PARTIDA',
    });
    expect(xp.penalizarJogo).toHaveBeenCalledWith('t1', 'a2', 700, 'QLICK_OCIOSIDADE');
    expect(partida.descontosOciosidade).toEqual({ a2: 700 });
    expect(partida.logPontuacao![0].creditoRanking).toBe(0);
  });
});
