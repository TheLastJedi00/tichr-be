import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertNaoPausada,
  assertPausavel,
  empurrar,
  tempoPausado,
} from './pausa';

describe('pausa — regras comuns aos três jogos (028 §4)', () => {
  it('só pausa em andamento: LOBBY e ENCERRADO dão 400 PARTIDA_NAO_PAUSAVEL', () => {
    for (const status of ['LOBBY', 'ENCERRADO']) {
      let erro: unknown;
      try {
        assertPausavel(status);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).getResponse()).toMatchObject({
        code: 'PARTIDA_NAO_PAUSAVEL',
      });
    }
    expect(() => assertPausavel('QUESTAO_ATIVA')).not.toThrow();
    expect(() => assertPausavel('EM_ANDAMENTO')).not.toThrow();
  });

  it('pausada, comando dá 409 PARTIDA_PAUSADA', () => {
    let erro: unknown;
    try {
      assertNaoPausada({ pausadaEm: '2026-10-15T12:00:00.000Z' });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      code: 'PARTIDA_PAUSADA',
    });
    expect(() => assertNaoPausada({ pausadaEm: null })).not.toThrow();
    expect(() => assertNaoPausada({})).not.toThrow();
  });

  it('o tempo pausado é agora − pausadaEm (nunca negativo)', () => {
    const agora = Date.parse('2026-10-15T12:00:30.000Z');
    expect(tempoPausado('2026-10-15T12:00:00.000Z', agora)).toBe(30_000);
    expect(tempoPausado('2026-10-15T12:01:00.000Z', agora)).toBe(0);
  });

  it('empurrar avança o marco pelo intervalo e preserva nulos', () => {
    expect(empurrar('2026-10-15T12:00:00.000Z', 30_000)).toBe(
      '2026-10-15T12:00:30.000Z',
    );
    expect(empurrar(null, 30_000)).toBeNull();
    expect(empurrar(undefined, 30_000)).toBeUndefined();
  });
});
