import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DURACOES_ENTRADA,
  DefinirCronometroDto,
  assertLobbyCronometro,
  falhaDeEntrada,
  prazoDaEntrada,
  prazoVencido,
  reivindicarEntrada,
} from './entrada';

describe('Cronômetro de entrada (035 §1)', () => {
  const agora = Date.parse('2026-11-18T12:00:00.000Z');

  it('durações fixas: 30s, 1, 2, 3 e 5 min', () => {
    expect(DURACOES_ENTRADA).toEqual([30, 60, 120, 180, 300]);
  });

  it('DTO aceita as durações da lista e null; recusa o resto', () => {
    const ok = (v: unknown) =>
      validateSync(plainToInstance(DefinirCronometroDto, { segundos: v }))
        .length === 0;
    expect(ok(30)).toBe(true);
    expect(ok(300)).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok(45)).toBe(false);
    expect(ok('60')).toBe(false);
  });

  it('prazoDaEntrada: agora + segundos (ISO); null cancela', () => {
    expect(prazoDaEntrada(120, agora)).toBe('2026-11-18T12:02:00.000Z');
    expect(prazoDaEntrada(null, agora)).toBeNull();
  });

  it('prazoVencido: sem cronômetro nunca vence; tolera 1s de relógio', () => {
    expect(prazoVencido(null, agora)).toBe(false);
    expect(prazoVencido(undefined, agora)).toBe(false);
    expect(prazoVencido('2026-11-18T12:00:05.000Z', agora)).toBe(false);
    expect(prazoVencido('2026-11-18T12:00:00.800Z', agora)).toBe(true);
    expect(prazoVencido('2026-11-18T11:59:00.000Z', agora)).toBe(true);
  });

  it('cronômetro só no LOBBY (code PARTIDA_INICIADA)', () => {
    expect(() => assertLobbyCronometro('LOBBY')).not.toThrow();
    try {
      assertLobbyCronometro('EM_ANDAMENTO');
      fail('deveria recusar');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: 'PARTIDA_INICIADA',
      });
    }
  });

  it('falhaDeEntrada registra quantos havia e o mínimo', () => {
    expect(falhaDeEntrada(1, 2, agora)).toEqual({
      motivo: 'POUCOS_INSCRITOS',
      inscritos: 1,
      minimo: 2,
      em: '2026-11-18T12:00:00.000Z',
    });
  });

  describe('reivindicarEntrada (transação)', () => {
    function firestoreFake(doc: Record<string, unknown> | null) {
      const escritas: Record<string, unknown>[] = [];
      const ref = { id: 'x' };
      const firestore = {
        runTransaction: async <R>(
          fn: (tx: {
            get: (r: unknown) => Promise<unknown>;
            update: (r: unknown, d: Record<string, unknown>) => void;
          }) => Promise<R>,
        ) =>
          fn({
            get: () => Promise.resolve({ exists: !!doc, data: () => doc }),
            update: (_r, d) => {
              escritas.push(d);
              Object.assign(doc!, d);
            },
          }),
      };
      return { firestore, ref, escritas };
    }

    it('LOBBY com prazo vencido: zera o cronômetro e ganha o início', async () => {
      const doc = { status: 'LOBBY', entradaEncerraEm: '2026-11-18T11:59:00Z' };
      const { firestore, ref, escritas } = firestoreFake(doc);
      expect(
        await reivindicarEntrada(firestore as never, ref as never, agora),
      ).toBe(true);
      expect(escritas).toEqual([{ entradaEncerraEm: null }]);
    });

    it('segundo disparo (já zerado) não ganha: inicia uma vez só', async () => {
      const doc = { status: 'LOBBY', entradaEncerraEm: '2026-11-18T11:59:00Z' };
      const { firestore, ref } = firestoreFake(doc);
      const a = await reivindicarEntrada(
        firestore as never,
        ref as never,
        agora,
      );
      const b = await reivindicarEntrada(
        firestore as never,
        ref as never,
        agora,
      );
      expect([a, b]).toEqual([true, false]);
    });

    it('prazo no futuro ou partida já iniciada: não ganha e não escreve', async () => {
      for (const doc of [
        { status: 'LOBBY', entradaEncerraEm: '2026-11-18T12:01:00Z' },
        { status: 'EM_ANDAMENTO', entradaEncerraEm: '2026-11-18T11:59:00Z' },
      ]) {
        const { firestore, ref, escritas } = firestoreFake(doc);
        expect(
          await reivindicarEntrada(firestore as never, ref as never, agora),
        ).toBe(false);
        expect(escritas).toEqual([]);
      }
    });
  });
});
