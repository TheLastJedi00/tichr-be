import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  aplicarDescontoNoLog,
  ehOcioso,
  limiteOciosidade,
  marcarNoLog,
  ociosos,
  planejarDesconto,
  registrarFaltas,
} from './ociosidade';
import { LogPontuacaoJogador } from './log-pontuacao';

describe('ociosidade (032 §3) — contagem', () => {
  it('soma uma falta a quem era esperado e não agiu, sem mutar o mapa', () => {
    const antes = { a: 1 };
    const depois = registrarFaltas(antes, ['a', 'b', 'c'], ['c']);
    expect(depois).toEqual({ a: 2, b: 1 });
    expect(antes).toEqual({ a: 1 });
  });

  it('esperado repetido conta uma vez por fase', () => {
    expect(registrarFaltas({}, ['a', 'a'], [])).toEqual({ a: 1 });
  });

  it('limite padrão por jogo e o da partida', () => {
    expect(limiteOciosidade({}, 'QLICK')).toBe(3);
    expect(limiteOciosidade({}, 'WOR')).toBe(2);
    expect(limiteOciosidade({}, 'ISOLATEUS')).toBe(2);
    expect(limiteOciosidade({ limiteOciosidade: 5 }, 'WOR')).toBe(5);
  });

  it('ocioso a partir do limite (contagem total)', () => {
    const m = { a: 2, b: 1 };
    expect(ehOcioso(m, 'a', 2)).toBe(true);
    expect(ehOcioso(m, 'b', 2)).toBe(false);
    expect(ociosos(m, 2)).toEqual(['a']);
  });

  it('marca o log final só de quem teve falta', () => {
    const log = [
      { alunoId: 'a', nome: 'A', totalPartida: 10, creditoRanking: 10, itens: [] },
      { alunoId: 'b', nome: 'B', totalPartida: 10, creditoRanking: 10, itens: [] },
    ];
    const r = marcarNoLog(log, (id) => (id === 'a' ? 3 : 0), 2);
    expect(r[0]).toMatchObject({ faltasOciosidade: 3, ocioso: true });
    expect(r[1]).not.toHaveProperty('ocioso');
  });
});

describe('ociosidade (032 §3.4) — desconto', () => {
  const log: LogPontuacaoJogador[] = [
    {
      alunoId: 'a',
      nome: 'A',
      totalPartida: 500,
      creditoRanking: 500,
      itens: [{ rodada: 4, fonte: 'ACERTO', descricao: 'x', pontos: 500 }],
      faltasOciosidade: 3,
      ocioso: true,
    },
    { alunoId: 'b', nome: 'B', totalPartida: 0, creditoRanking: 0, itens: [] },
  ];
  const partida = { status: 'ENCERRADO', turmaId: 't1', logPontuacao: log };

  it('zerar devolve o crédito da partida; valor, o pedido', () => {
    expect(planejarDesconto(partida, { alunoId: 'a', modo: 'ZERAR_PARTIDA' })).toBe(500);
    expect(planejarDesconto(partida, { alunoId: 'a', modo: 'VALOR', pontos: 120 })).toBe(120);
  });

  it('recusa partida em andamento, casual, sem turma, não marcado e repetido', () => {
    const d = { alunoId: 'a', modo: 'ZERAR_PARTIDA' as const };
    expect(() => planejarDesconto({ ...partida, status: 'EM_ANDAMENTO' }, d)).toThrow(BadRequestException);
    expect(() => planejarDesconto({ ...partida, valeRanking: false }, d)).toThrow(/casual/);
    expect(() => planejarDesconto({ ...partida, turmaId: null }, d)).toThrow(BadRequestException);
    expect(() => planejarDesconto(partida, { ...d, alunoId: 'b' })).toThrow(/não foi marcado/);
    expect(() => planejarDesconto({ ...partida, descontosOciosidade: { a: 10 } }, d)).toThrow(ConflictException);
  });

  it('valor sem pontos é recusado', () => {
    expect(() => planejarDesconto(partida, { alunoId: 'a', modo: 'VALOR' })).toThrow(/Informe/);
  });

  it('aplica no log: item negativo, crédito reduzido e o desconto registrado', () => {
    const r = aplicarDescontoNoLog(partida, 'a', 500);
    const a = r.logPontuacao.find((l) => l.alunoId === 'a')!;
    expect(a.creditoRanking).toBe(0);
    expect(a.itens.at(-1)).toMatchObject({ fonte: 'OCIOSIDADE', pontos: -500, rodada: 4 });
    expect(a.itens.reduce((s, i) => s + i.pontos, 0)).toBe(0);
    expect(r.descontosOciosidade).toEqual({ a: 500 });
  });
});
