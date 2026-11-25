import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { XpService } from './xp.service';

/**
 * `XpService.ajustarNoMesmoCommit` (spec 038 #15, #16): a nota do trabalho
 * vira XP na mesma transação da avaliação; o XP nunca fica negativo.
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

describe('XpService.ajustarNoMesmoCommit', () => {
  function op(pontos: number, gravados: number[], alunoId = 'a1') {
    return {
      turmaId: 't1',
      alunoId,
      motivo: 'TRABALHO',
      ler: async (tx: unknown) => {
        // o chamador lê o próprio doc antes do XP (regra do Firestore)
        await (tx as { get: (r: unknown) => Promise<unknown> }).get({
          col: 'entregas',
          id: 'e1',
        });
        return { pontos, contexto: 'ctx' };
      },
      gravar: (_tx: unknown, aplicado: number, contexto: string) => {
        expect(contexto).toBe('ctx');
        gravados.push(aplicado);
      },
    };
  }

  it('credita e grava o log com o motivo', async () => {
    const xp = { a1: 10 };
    const { service, logs } = montar(xp);
    const gravados: number[] = [];
    const r = await service.ajustarNoMesmoCommit(op(80, gravados));
    expect(r.aplicado).toBe(80);
    expect(xp.a1).toBe(90);
    expect(gravados).toEqual([80]);
    expect(logs).toEqual([
      expect.objectContaining({
        alunoId: 'a1',
        turmaId: 't1',
        pontos: 80,
        motivo: 'TRABALHO',
      }),
    ]);
  });

  it('débito nunca deixa o XP negativo e registra o que saiu', async () => {
    const xp = { a1: 15 };
    const { service, logs } = montar(xp);
    const gravados: number[] = [];
    const r = await service.ajustarNoMesmoCommit(op(-40, gravados));
    expect(r.aplicado).toBe(-15);
    expect(xp.a1).toBe(0);
    expect(gravados).toEqual([-15]);
    expect(logs[0]).toMatchObject({ pontos: -15 });
  });

  it('delta zero não grava log, mas o chamador grava', async () => {
    const xp = { a1: 15 };
    const { service, logs } = montar(xp);
    const gravados: number[] = [];
    await service.ajustarNoMesmoCommit(op(0, gravados));
    expect(logs).toHaveLength(0);
    expect(gravados).toEqual([0]);
  });

  it('aluno de outra turma: 404', async () => {
    const { service } = montar({ x9: 0 });
    await expect(
      service.ajustarNoMesmoCommit(op(10, [], 'x9')),
    ).rejects.toThrow('Aluno nao encontrado.');
  });
});
