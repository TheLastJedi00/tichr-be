import { AdminService } from './admin.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ConfigService } from '@nestjs/config';

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

function snap(docs: FakeDoc[]) {
  return {
    size: docs.length,
    docs: docs.map((d) => ({ id: d.id, data: () => d.data, ref: { id: d.id } })),
  };
}

/** Firestore falso: devolve o snapshot da colecao (get simples). */
function fakeFirebase(cols: Record<string, FakeDoc[]>): FirebaseService {
  return {
    firestore: {
      collection: (name: string) => ({ get: async () => snap(cols[name] ?? []) }),
    },
    auth: {
      getUsers: async (ids: Array<{ uid: string }>) => ({
        users: ids.map((i) => ({ uid: i.uid, email: `${i.uid}@x.com` })),
      }),
    },
  } as unknown as FirebaseService;
}

describe('AdminService — metricas e CRM', () => {
  const config = {} as ConfigService;

  it('metrics: total, distribuicao por plano, ativos e desativados', async () => {
    const svc = new AdminService(
      fakeFirebase({
        professores: [
          { id: 'p1', data: { planoAtual: 'ESTAGIARIO' } },
          { id: 'p2', data: { planoAtual: 'PHD' } },
          { id: 'p3', data: { planoAtual: 'PHD', desativadoEm: '2026-01-01' } },
        ],
        turmas: [
          // p1 tem turma ativa (grade fixa conta sempre); p2 encerrada (nao conta)
          { id: 't1', data: { professorId: 'p1', tipoModalidade: 'GRADE_FIXA' } },
          {
            id: 't2',
            data: {
              professorId: 'p2',
              tipoModalidade: 'GRADE_FIXA',
              encerradaManualmente: true,
            },
          },
        ],
      }),
      config,
    );

    const m = await svc.metrics();
    expect(m.totalProfessores).toBe(3);
    expect(m.porPlano).toEqual({ ESTAGIARIO: 1, GRADUADO: 0, MESTRE: 0, PHD: 2 });
    expect(m.desativados).toBe(1);
    expect(m.ativos).toBe(1); // apenas p1
  });

  it('listarUsuarios: agrega turmas ativas, alunos e qlicks por professor', async () => {
    const svc = new AdminService(
      fakeFirebase({
        professores: [
          { id: 'p1', data: { nomeExibicao: 'Marina', planoAtual: 'PHD' } },
          { id: 'p2', data: { nomeExibicao: 'Bruno', planoAtual: 'ESTAGIARIO' } },
        ],
        turmas: [
          { id: 't1', data: { professorId: 'p1', tipoModalidade: 'GRADE_FIXA' } },
          { id: 't2', data: { professorId: 'p1', tipoModalidade: 'GRADE_FIXA' } },
        ],
        alunos: [
          { id: 'a1', data: { turmaId: 't1' } },
          { id: 'a2', data: { turmaId: 't1' } },
          { id: 'a3', data: { turmaId: 't2' } },
        ],
        qlicks: [{ id: 'q1', data: { professorId: 'p1' } }],
      }),
      config,
    );

    const lista = await svc.listarUsuarios();
    const marina = lista.find((u) => u.uid === 'p1')!;
    expect(marina.uso).toEqual({ turmasAtivas: 2, alunos: 3, qlicks: 1 });
    expect(marina.email).toBe('p1@x.com');

    const bruno = lista.find((u) => u.uid === 'p2')!;
    expect(bruno.uso).toEqual({ turmasAtivas: 0, alunos: 0, qlicks: 0 });
  });

  it('listarUsuarios: filtra pela busca (nome/username/email)', async () => {
    const svc = new AdminService(
      fakeFirebase({
        professores: [
          { id: 'p1', data: { nomeExibicao: 'Marina', username: 'marina' } },
          { id: 'p2', data: { nomeExibicao: 'Bruno', username: 'bruno' } },
        ],
      }),
      config,
    );
    const r = await svc.listarUsuarios('mari');
    expect(r).toHaveLength(1);
    expect(r[0].uid).toBe('p1');
  });
});
