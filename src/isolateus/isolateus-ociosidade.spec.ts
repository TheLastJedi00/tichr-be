import { ConflictException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 032 §3 — ociosidade no Isolateus. Falta = fase com ação esperada que o
 * RELÓGIO fechou sem ação do aluno. Fica no COFRE, nunca no doc público: os
 * NPCs não "faltam", e um contador por habitante entregaria quem é NPC.
 * Vila padrão: reais a1..a5 (h1..h5), Ameaças a1 e a2.
 */
const VENCIDO = new Date(Date.now() - 10 * 60_000).toISOString();

describe('Isolateus 032 — faltas por fase', () => {
  it('noite por tempo: quem não confirmou a posição falta; a Ameaça, também sem a jogada', async () => {
    const { service, partida, segredo } = vilaComAmeacas({ npcs: 2 });
    partida.faseIniciadaEm = VENCIDO;
    segredo.confirmacoesNoite = ['a1', 'a3'];
    await service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(segredo.ociosidade).toEqual({ a1: 1, a2: 1, a4: 1, a5: 1 });
  });

  it('questão por tempo: falta quem não respondeu, inclusive abduzido e preso', async () => {
    const { service, partida, segredo, repo } = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
    });
    partida.faseIniciadaEm = VENCIDO;
    partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
    partida.habitantes.find((h) => h.id === 'h4')!.preso = true;
    await repo.registrarResposta('p1', 0, {
      alunoId: 'a1',
      alternativaIndex: 1,
      correta: true,
      pontos: 1000,
    });
    await service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(segredo.ociosidade).toEqual({ a2: 1, a3: 1, a4: 1, a5: 1 });
  });

  it('o doc público nunca recebe a contagem', async () => {
    const { service, partida, segredo } = vilaComAmeacas({ npcs: 2 });
    partida.faseIniciadaEm = VENCIDO;
    await service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(segredo.ociosidade).toBeDefined();
    expect(partida).not.toHaveProperty('ociosidade');
  });

  it('pular a fase (professor) não conta falta', async () => {
    const { service, partida, segredo } = vilaComAmeacas();
    partida.faseIniciadaEm = VENCIDO;
    await service.pularFase('prof', 'p1');
    expect(segredo.ociosidade ?? {}).toEqual({});
  });

  it('a mesma fase não conta duas vezes', async () => {
    const { service, partida, segredo } = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
    });
    partida.faseIniciadaEm = VENCIDO;
    const internos = service as unknown as {
      contarFaltasDaFase: (p: unknown, s: unknown) => Promise<void>;
    };
    await internos.contarFaltasDaFase(partida, segredo);
    await internos.contarFaltasDaFase(partida, segredo);
    expect(segredo.ociosidade?.a1).toBe(1);
  });
});

describe('Isolateus 032 — alerta, fim e desconto', () => {
  it('o painel traz as faltas do próprio aluno e o limite', async () => {
    const { service, segredo } = vilaComAmeacas();
    segredo.ociosidade = { a3: 2, a4: 1 };
    expect((await service.painel('a3', 'p1')).ociosidade).toEqual({
      faltas: 2,
      limite: 2,
      ocioso: true,
    });
    expect((await service.painel('a4', 'p1')).ociosidade).toEqual({
      faltas: 1,
      limite: 2,
      ocioso: false,
    });
  });

  it('no encerramento, o log marca o ocioso pelo aluno (o cofre se abre)', async () => {
    const { service, partida, segredo } = vilaComAmeacas();
    segredo.ociosidade = { a3: 2 };
    await service.encerrarPeloProfessor('prof', 'p1');
    const a3 = partida.logPontuacao!.find((l) => l.alunoId === 'a3')!;
    expect(a3).toMatchObject({ faltasOciosidade: 2, ocioso: true });
  });

  it('desconto do ocioso uma vez, com o motivo do Isolateus', async () => {
    const { service, partida, penalizar } = vilaComAmeacas();
    penalizar.mockResolvedValue(400);
    Object.assign(partida, {
      status: 'ENCERRADO',
      logPontuacao: [
        {
          alunoId: 'a3',
          nome: 'Real 3',
          totalPartida: 900,
          creditoRanking: 900,
          itens: [],
          faltasOciosidade: 3,
          ocioso: true,
        },
      ],
    });
    await service.descontarOciosidade('prof', 'p1', {
      alunoId: 'a3',
      modo: 'VALOR',
      pontos: 600,
    });
    expect(penalizar).toHaveBeenCalledWith('t1', 'a3', 600, 'ISOLATEUS_OCIOSIDADE');
    expect(partida.descontosOciosidade).toEqual({ a3: 400 });
    await expect(
      service.descontarOciosidade('prof', 'p1', { alunoId: 'a3', modo: 'VALOR', pontos: 1 }),
    ).rejects.toThrow(ConflictException);
  });
});
