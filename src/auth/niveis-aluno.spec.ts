import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NIVEIS_TURMA_DEFAULT } from '../turma/entities/turma.entity';

/**
 * Os limiares de nivel vivem no doc da TURMA, mas o painel do aluno nunca os
 * recebia — caia nos defaults e exibia uma patente que nao era a configurada
 * pelo professor. O login do aluno passa a hidratar `niveis`.
 */
function fakeAuth(turma: Record<string, unknown>) {
  const alunos = {
    docs: [
      {
        id: 'al1',
        data: () => ({ nome: 'Ana', pinAcesso: '1234', xpTotal: 1200 }),
      },
    ],
  };
  const firestore = {
    collection: (nome: string) => ({
      where: () => ({ get: async () => alunos }),
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => (nome === 'turmas' ? turma : {}),
        }),
      }),
      get: async () => alunos,
    }),
  };
  const firebase = { firestore } as unknown as FirebaseService;
  const jwt = { signAsync: async () => 'tok' } as unknown as JwtService;
  return new AuthService(firebase, {} as ConfigService, jwt);
}

describe('Login do aluno — limiares de nivel da turma', () => {
  it('hidrata os cortes que o professor configurou', async () => {
    const service = fakeAuth({
      nome: 'Turma A',
      nivelPrata: 800,
      nivelOuro: 1600,
      nivelDiamante: 3200,
      nivelPlatina: 6400,
    });

    const { turma } = await service.loginAluno('t1', '1234');

    expect(turma.niveis).toEqual({
      prata: 800,
      ouro: 1600,
      diamante: 3200,
      platina: 6400,
    });
  });

  it('turma sem config cai nos defaults (mesma fonte de verdade do professor)', async () => {
    const service = fakeAuth({ nome: 'Turma B' });

    const { turma } = await service.loginAluno('t1', '1234');

    expect(turma.niveis).toEqual(NIVEIS_TURMA_DEFAULT);
  });

  it('a mesma config vai na tela de login (info da turma)', async () => {
    const service = fakeAuth({ nome: 'Turma C', nivelPrata: 300 });

    const { config } = await service.infoTurmaLogin('t1');

    expect(config.niveis.prata).toBe(300);
  });
});
