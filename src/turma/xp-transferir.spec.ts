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
