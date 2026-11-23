import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import { ChatVilaDto } from './dto/responder-isolateus.dto';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * 036 — Chat da vila: um canal só, a partida inteira. Vivos e soltos escrevem
 * (a Ameaça também); abduzidos e presos só leem. O filtro de palavrão é o da
 * 028 (−1000 XP, nada gravado).
 */

const codigo = (e: unknown) =>
  ((e as HttpException).getResponse() as { code?: string }).code;

let agora = Date.parse('2026-11-23T12:00:00.000Z');
const avancar = (ms: number) => {
  agora += ms;
  jest.setSystemTime(agora);
};
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  agora = Date.parse('2026-11-23T12:00:00.000Z');
  jest.setSystemTime(agora);
});
afterEach(() => jest.useRealTimers());

describe('Isolateus 036 — chat da vila (Task 6)', () => {
  it('grava a mensagem com o nome do habitante, nunca o nome real nem o id', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.falarNoChat('a3', 'p1', '  Vi alguém na Energia  ');
    expect(ctx.partida.chat).toEqual([
      {
        id: expect.any(String) as unknown,
        autorNome: 'Real 3',
        texto: 'Vi alguém na Energia',
        em: new Date(agora).toISOString(),
      },
    ]);
    const json = JSON.stringify(ctx.partida.chat);
    expect(json).not.toContain('a3');
    expect(json).not.toContain('h3');
  });

  it('vale em todas as fases da partida, não só na noite', async () => {
    for (const status of [
      'DESLOCAMENTO',
      'QUESTAO_ATIVA',
      'RESULTADO_RODADA',
      'QUARENTENA_VOTO',
      'RESGATE_VOTO',
    ] as const) {
      const ctx = vilaComAmeacas({ status });
      await ctx.service.falarNoChat('a3', 'p1', 'oi');
      expect(ctx.partida.chat).toHaveLength(1);
    }
  });

  it('fora da partida (lobby ou encerrada) o chat está fechado', async () => {
    for (const status of ['LOBBY', 'ENCERRADO'] as const) {
      const ctx = vilaComAmeacas({ status });
      const e = await ctx.service
        .falarNoChat('a3', 'p1', 'oi')
        .catch((x: unknown) => x);
      expect(codigo(e)).toBe('CHAT_FECHADO');
    }
  });

  it('a Ameaça também fala', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.falarNoChat('a1', 'p1', 'eu estava na Saúde');
    expect(ctx.partida.chat[0].autorNome).toBe('Real 1');
  });

  it('abduzido ou preso só lê: 403 FORA_DA_VILA', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    ctx.partida.habitantes.find((h) => h.id === 'h4')!.preso = true;
    for (const a of ['a3', 'a4']) {
      const e = await ctx.service
        .falarNoChat(a, 'p1', 'oi')
        .catch((x: unknown) => x);
      expect((e as HttpException).getStatus()).toBe(403);
      expect(codigo(e)).toBe('FORA_DA_VILA');
    }
    expect(ctx.partida.chat ?? []).toEqual([]);
  });

  it('palavrão: 422, −1000 XP para quem escreveu e nada gravado', async () => {
    const ctx = vilaComAmeacas();
    const e = await ctx.service
      .falarNoChat('a3', 'p1', 'seu merda')
      .catch((x: unknown) => x);
    expect((e as HttpException).getStatus()).toBe(422);
    expect(codigo(e)).toBe('MENSAGEM_BLOQUEADA');
    expect(ctx.penalizar).toHaveBeenCalledWith(
      't1',
      'a3',
      ISOLATEUS.PENALIDADE_XP,
      'ISOLATEUS_MODERACAO',
    );
    expect(ctx.partida.chat ?? []).toEqual([]);
  });

  it('429 CHAT_RAPIDO abaixo de 2s entre duas mensagens do mesmo aluno', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.falarNoChat('a3', 'p1', 'um');
    avancar(1_000);
    const e = await ctx.service
      .falarNoChat('a3', 'p1', 'dois')
      .catch((x: unknown) => x);
    expect((e as HttpException).getStatus()).toBe(429);
    expect(codigo(e)).toBe('CHAT_RAPIDO');
    // Outro aluno fala no mesmo instante.
    await ctx.service.falarNoChat('a4', 'p1', 'eu');
    avancar(1_001);
    await ctx.service.falarNoChat('a3', 'p1', 'dois');
    expect(ctx.partida.chat.map((m) => m.texto)).toEqual(['um', 'eu', 'dois']);
  });

  it('guarda só as últimas 80 mensagens', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.chat = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      autorNome: 'X',
      texto: `${i}`,
      em: new Date(agora).toISOString(),
    }));
    await ctx.service.falarNoChat('a3', 'p1', 'nova');
    expect(ctx.partida.chat).toHaveLength(80);
    expect(ctx.partida.chat[0].texto).toBe('1');
    expect(ctx.partida.chat[79].texto).toBe('nova');
  });

  it('pausada, ninguém fala', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.pausadaEm = new Date(agora).toISOString();
    await expect(
      ctx.service.falarNoChat('a3', 'p1', 'oi'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(ctx.partida.chat ?? []).toEqual([]);
  });

  it('só espaços: 400 MENSAGEM_VAZIA', async () => {
    const ctx = vilaComAmeacas();
    const e = await ctx.service
      .falarNoChat('a3', 'p1', '   ')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('MENSAGEM_VAZIA');
  });

  it('a DTO aceita de 1 a 200 caracteres', () => {
    const erros = (texto: unknown) =>
      validateSync(plainToInstance(ChatVilaDto, { texto })).length;
    expect(erros('a')).toBe(0);
    expect(erros('a'.repeat(200))).toBe(0);
    expect(erros('')).toBeGreaterThan(0);
    expect(erros('a'.repeat(201))).toBeGreaterThan(0);
    expect(erros(42)).toBeGreaterThan(0);
  });
});

describe('Isolateus 036 — o debate sai (Task 7)', () => {
  it('convocada, a Quarentena vai direto para a votação', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h3: 'comunicacao' } });
    ctx.partida.faseIniciadaEm = new Date(agora - 1000).toISOString();
    await ctx.service.convocarQuarentena('p1', 'a3');
    await ctx.service.pularFase('prof', 'p1'); // amanhecer → questão
    await ctx.service.pularFase('prof', 'p1'); // fim da questão → reunião
    expect(ctx.partida.status).toBe('QUARENTENA_VOTO');
  });

  it('mesmo em partida antiga com debateHabilitado ligado', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h3: 'comunicacao' } });
    ctx.partida.debateHabilitado = true;
    await ctx.service.convocarQuarentena('p1', 'a3');
    await ctx.service.pularFase('prof', 'p1');
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.partida.status).toBe('QUARENTENA_VOTO');
  });

  it('partida parada no debate no deploy: o relógio leva ao voto', async () => {
    const ctx = vilaComAmeacas({ status: 'QUARENTENA_DEBATE' });
    ctx.partida.faseIniciadaEm = new Date(agora - 200_000).toISOString();
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.status).toBe('QUARENTENA_VOTO');
  });

  it('as rotas de debater e pular debate não existem mais', () => {
    const s = ctx0().service as unknown as Record<string, unknown>;
    expect(s.debater).toBeUndefined();
    expect(s.pularDebate).toBeUndefined();
  });
});

function ctx0() {
  return vilaComAmeacas();
}
