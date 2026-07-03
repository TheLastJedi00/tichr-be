import { ProfessorEntity } from '../professor/entities/professor.entity';
import { AlunoEntity } from './entities/aluno.entity';
import { TurmaEntity } from './entities/turma.entity';
import { XpService } from './xp.service';

/** Pontuação base passiva: concede por aula concluída, idempotente. */
describe('XpService.sincronizarBaseTurma', () => {
  const sessoes = [
    { data: '2000-01-01', status: 'AGENDADA' },
    { data: '2000-02-01', status: 'AGENDADA' },
    { data: '2000-03-01', status: 'CANCELADA' }, // não conta
    { data: '2999-01-01', status: 'AGENDADA' }, // futura
  ];

  const montar = (alunos: AlunoEntity[]) => {
    const updates: Array<Record<string, unknown>> = [];
    const commit = jest.fn().mockResolvedValue(undefined);
    const batch = {
      update: (_ref: unknown, data: Record<string, unknown>) =>
        updates.push(data),
      set: jest.fn(),
      commit,
    };
    const firebase = {
      firestore: { collection: () => ({ doc: () => ({}) }), batch: () => batch },
    };
    const service = new XpService(
      firebase as never,
      {
        findById: jest
          .fn()
          .mockResolvedValue(
            new TurmaEntity({ id: 't1', professorId: 'p1', pontuacaoAtiva: true }),
          ),
      } as never,
      { findByTurma: jest.fn().mockResolvedValue(alunos) } as never,
      {
        getProfile: jest
          .fn()
          .mockResolvedValue(new ProfessorEntity({ planoAtual: 'PHD' })),
      } as never,
      { findByTurma: jest.fn().mockResolvedValue(sessoes) } as never,
    );
    return { service, updates, commit };
  };

  it('recompensa 10 por aula concluida (2 aulas => +20)', async () => {
    const { service, updates, commit } = montar([
      new AlunoEntity({ id: 'a1', turmaId: 't1', xpTotal: 0 }),
    ]);
    await service.sincronizarBaseTurma('t1');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ xpTotal: 20, baseAteSessao: 2 }]);
  });

  it('nao duplica quando a base ja foi concedida (idempotente)', async () => {
    const { service, commit } = montar([
      new AlunoEntity({ id: 'a1', turmaId: 't1', xpTotal: 20, baseAteSessao: 2 }),
    ]);
    await service.sincronizarBaseTurma('t1');
    expect(commit).not.toHaveBeenCalled();
  });

  it('nao concede base quando o professor nao e PhD', async () => {
    const { service, commit } = montar([
      new AlunoEntity({ id: 'a1', turmaId: 't1', xpTotal: 0 }),
    ]);
    // Sobrescreve o professor para MESTRE.
    (service as unknown as { professorService: { getProfile: jest.Mock } })
      .professorService.getProfile = jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: 'MESTRE' }));
    await service.sincronizarBaseTurma('t1');
    expect(commit).not.toHaveBeenCalled();
  });
});
