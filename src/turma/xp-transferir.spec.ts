import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { XpService } from './xp.service';

/**
 * `XpService.transferir` (spec 032 #2): transferência real, numa transação.
 * Sai do doador no máximo o que ele tem, e o recebedor ganha exatamente isso.
 */
function fakeDb(xp: Record<string, number>) {
  const logs: Array<Record<string, unknown>> = [];
  const extra: string[] = [];
  let logSeq = 0;
  const docRef = (col: string, id: string) => ({ col, id });
  const db = {
    collection: (col: string) => ({
      doc: (id?: string) => docRef(col, id ?? `log${++logSeq}`),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      let escreveu = false;
      const tx = {
        get: async (ref: { col: string; id: string }) => {
          if (escreveu) throw new Error('leitura depois de escrita');
          return { data: () => ({ xpTotal: xp[ref.id] }) };
        },
        update: (
          ref: { col: string; id: string },
          data: { xpTotal: number },
        ) => {
          escreveu = true;
          writes.push(() => {
            if (ref.col === 'alunos') xp[ref.id] = data.xpTotal;
            else extra.push(ref.id);
          });
        },
        set: (_ref: unknown, data: Record<string, unknown>) => {
          escreveu = true;
          writes.push(() => logs.push(data));
        },
      };
      const r = await fn(tx);
      writes.forEach((w) => w());
      return r;
    },
  };
  return { db, logs, extra };
}

function montar(xp: Record<string, number>) {
  const { db, logs, extra } = fakeDb(xp);
  const alunos: Record<string, { id: string; turmaId: string }> = {
    a1: { id: 'a1', turmaId: 't1' },
    a2: { id: 'a2', turmaId: 't1' },
    a3: { id: 'a3', turmaId: 't1' },
    a4: { id: 'a4', turmaId: 't1' },
    x9: { id: 'x9', turmaId: 'outra' },
  };
  const service = new XpService(
    { firestore: db } as unknown as FirebaseService,
    {} as TurmaRepository,
    {
      findById: async (id: string) => alunos[id] ?? null,
    } as unknown as AlunoRepository,
    {} as ProfessorService,
    {} as SessaoRepository,
  );
  return { service, logs, extra };
}

describe('XpService.transferir', () => {
  it('transfere o que o doador tem e grava os dois logs', async () => {
    const xp = { a1: 100, a2: 500 };
    const { service, logs } = montar(xp);
    const t = await service.transferir({
      turmaId: 't1',
      deAlunoId: 'a2',
      paraAlunoId: 'a1',
      pontos: 2000,
      motivo: 'DENUNCIA',
    });
    expect(t).toBe(500);
    expect(xp).toEqual({ a1: 600, a2: 0 });
    expect(logs.map((l) => [l.alunoId, l.pontos, l.motivo])).toEqual([
      ['a2', -500, 'DENUNCIA'],
      ['a1', 500, 'DENUNCIA'],
    ]);
  });

  it('doador sem XP: nada muda e não grava log', async () => {
    const xp = { a1: 100, a2: 0 };
    const { service, logs } = montar(xp);
    expect(
      await service.transferir({
        turmaId: 't1',
        deAlunoId: 'a2',
        paraAlunoId: 'a1',
        pontos: 50,
        motivo: 'DENUNCIA',
      }),
    ).toBe(0);
    expect(xp).toEqual({ a1: 100, a2: 0 });
    expect(logs).toEqual([]);
  });

  it('lê e grava o extra no mesmo commit (ler antes de escrever)', async () => {
    const xp = { a1: 0, a2: 300 };
    const { service, extra } = montar(xp);
    const ordem: string[] = [];
    await service.transferir({
      turmaId: 't1',
      deAlunoId: 'a2',
      paraAlunoId: 'a1',
      pontos: 100,
      motivo: 'DENUNCIA',
      noMesmoCommit: {
        ler: async () => {
          ordem.push('ler');
        },
        gravar: (tx, t) => {
          ordem.push(`gravar:${t}`);
          (tx as { update: (r: unknown, d: unknown) => void }).update(
            { col: 'denuncias', id: 'd1' },
            {},
          );
        },
      },
    });
    expect(ordem).toEqual(['ler', 'gravar:100']);
    expect(extra).toEqual(['d1']);
  });

  it('o extra pode abortar (nada é gravado)', async () => {
    const xp = { a1: 0, a2: 300 };
    const { service, logs } = montar(xp);
    await expect(
      service.transferir({
        turmaId: 't1',
        deAlunoId: 'a2',
        paraAlunoId: 'a1',
        pontos: 100,
        motivo: 'DENUNCIA',
        noMesmoCommit: {
          ler: async () => {
            throw new Error('ja resolvida');
          },
          gravar: () => undefined,
        },
      }),
    ).rejects.toThrow('ja resolvida');
    expect(xp).toEqual({ a1: 0, a2: 300 });
    expect(logs).toEqual([]);
  });

  it('aluno de outra turma é 404', async () => {
    const { service } = montar({ a1: 0, x9: 10 });
    await expect(
      service.transferir({
        turmaId: 't1',
        deAlunoId: 'x9',
        paraAlunoId: 'a1',
        pontos: 5,
        motivo: 'DENUNCIA',
      }),
    ).rejects.toThrow(/nao encontrado/);
  });
});

describe('XpService.transferirParaVarios (033)', () => {
  it('tira uma vez do doador e divide igual; a sobra vai aos primeiros', async () => {
    const xp = { a1: 0, a2: 5000, a3: 10, a4: 0 };
    const { service, logs } = montar(xp);
    const r = await service.transferirParaVarios({
      turmaId: 't1',
      deAlunoId: 'a2',
      paraAlunoIds: ['a1', 'a3', 'a4'],
      pontos: 1000,
      motivo: 'DENUNCIA',
    });
    expect(r.transferido).toBe(1000);
    expect(r.partes).toEqual([
      { alunoId: 'a1', pontos: 334 },
      { alunoId: 'a3', pontos: 333 },
      { alunoId: 'a4', pontos: 333 },
    ]);
    expect(xp).toEqual({ a1: 334, a2: 4000, a3: 343, a4: 333 });
    expect(logs.map((l) => [l.alunoId, l.pontos, l.motivo])).toEqual([
      ['a2', -1000, 'DENUNCIA'],
      ['a1', 334, 'DENUNCIA'],
      ['a3', 333, 'DENUNCIA'],
      ['a4', 333, 'DENUNCIA'],
    ]);
  });

  it('doador com menos XP: divide o que saiu; parte zero não gera log', async () => {
    const xp = { a1: 0, a2: 2, a3: 0, a4: 0 };
    const { service, logs } = montar(xp);
    const r = await service.transferirParaVarios({
      turmaId: 't1',
      deAlunoId: 'a2',
      paraAlunoIds: ['a1', 'a3', 'a4'],
      pontos: 900,
      motivo: 'DENUNCIA',
    });
    expect(r.transferido).toBe(2);
    expect(xp).toEqual({ a1: 1, a2: 0, a3: 1, a4: 0 });
    expect(logs).toHaveLength(3);
  });

  it('entrega o total e as partes ao extra, no mesmo commit', async () => {
    const xp = { a1: 0, a2: 100, a3: 0 };
    const { service, extra } = montar(xp);
    const visto: unknown[] = [];
    await service.transferirParaVarios({
      turmaId: 't1',
      deAlunoId: 'a2',
      paraAlunoIds: ['a1', 'a3'],
      pontos: 51,
      motivo: 'DENUNCIA',
      noMesmoCommit: {
        ler: async () => undefined,
        gravar: (tx, t, partes) => {
          visto.push(t, partes);
          (tx as { update: (r: unknown, d: unknown) => void }).update(
            { col: 'denuncia_grupos', id: 'g1' },
            {},
          );
        },
      },
    });
    expect(visto).toEqual([
      51,
      [
        { alunoId: 'a1', pontos: 26 },
        { alunoId: 'a3', pontos: 25 },
      ],
    ]);
    expect(extra).toEqual(['g1']);
  });

  it('autor de outra turma é 404 e nada muda', async () => {
    const xp = { a1: 0, a2: 100, x9: 0 };
    const { service, logs } = montar(xp);
    await expect(
      service.transferirParaVarios({
        turmaId: 't1',
        deAlunoId: 'a2',
        paraAlunoIds: ['a1', 'x9'],
        pontos: 10,
        motivo: 'DENUNCIA',
      }),
    ).rejects.toThrow(/nao encontrado/);
    expect(logs).toEqual([]);
  });
});
