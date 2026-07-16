import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

/**
 * O que importa travar aqui: a identidade do relato vem do TOKEN, nunca do
 * corpo. Se um refactor deixar o `professorId` (ou o nome/e-mail) ser lido do
 * DTO, qualquer professor abre chamado no nome de outro.
 */

function fakeFirebase(dados: { nomeExibicao?: string } | undefined, email?: string): FirebaseService {
  return {
    firestore: {
      collection: () => ({
        doc: () => ({ get: async () => ({ data: () => dados }) }),
      }),
    },
    auth: {
      getUser: async () => (email ? { email } : {}),
    },
  } as unknown as FirebaseService;
}

function fakeRepo(): { repo: FeedbackRepository; criados: FeedbackEntity[] } {
  const criados: FeedbackEntity[] = [];
  const repo = {
    create: async (data: Omit<FeedbackEntity, 'id'>) => {
      const salvo = new FeedbackEntity({ ...data, id: 'fb1' });
      criados.push(salvo);
      return salvo;
    },
  } as unknown as FeedbackRepository;
  return { repo, criados };
}

const dto = {
  categoria: 'BUG' as const,
  mensagem: '  O botao de salvar nao responde  ',
  rota: '/turmas/abc',
  userAgent: 'Mozilla/5.0',
};

/** Sem RESEND_API_KEY: o alerta e assunto de `alerta.spec.ts`, nao daqui. */
function criarService(repo: FeedbackRepository, firebase: FirebaseService): FeedbackService {
  return new FeedbackService(repo, firebase, { get: () => undefined } as unknown as ConfigService);
}

describe('FeedbackService.criar', () => {
  it('nasce PENDENTE, com criadoEm ISO do servidor', async () => {
    const { repo, criados } = fakeRepo();
    const service = criarService(repo, fakeFirebase({ nomeExibicao: 'Joao' }, 'joao@x.com'));

    await service.criar('uid-1', dto);

    expect(criados[0].status).toBe('PENDENTE');
    expect(criados[0].criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('preenche identidade a partir do uid, nao do corpo', async () => {
    const { repo, criados } = fakeRepo();
    const service = criarService(repo, fakeFirebase({ nomeExibicao: 'Joao' }, 'joao@x.com'));

    // O corpo tenta se passar por outro professor; o DTO nem tem esses campos,
    // mas o teste garante que um extra nao seria aproveitado.
    await service.criar('uid-1', {
      ...dto,
      professorId: 'uid-invasor',
      professorEmail: 'invasor@x.com',
    } as never);

    expect(criados[0].professorId).toBe('uid-1');
    expect(criados[0].professorNome).toBe('Joao');
    expect(criados[0].professorEmail).toBe('joao@x.com');
  });

  it('professor sem nome ou sem e-mail ainda consegue enviar', async () => {
    const { repo, criados } = fakeRepo();
    const service = criarService(repo, fakeFirebase(undefined, undefined));

    await service.criar('uid-2', dto);

    expect(criados[0].professorNome).toBe('');
    expect(criados[0].professorEmail).toBe('');
    expect(criados[0].mensagem).toBe('O botao de salvar nao responde');
  });

  it('nasce sem marca de alerta enviado (quem grava notificadoEm e o disparo)', async () => {
    const { repo, criados } = fakeRepo();
    const service = criarService(repo, fakeFirebase({}, undefined));

    await service.criar('uid-3', dto);

    expect(criados[0].notificadoEm).toBeUndefined();
    expect(criados[0].notaInterna).toBeUndefined();
  });
});

describe('FeedbackEntity', () => {
  it('traduz a categoria para o rotulo humano do e-mail', () => {
    expect(new FeedbackEntity({ categoria: 'BUG' }).rotuloCategoria()).toBe('Relato de Bug');
    expect(new FeedbackEntity({ categoria: 'ELOGIO' }).rotuloCategoria()).toBe('Elogio');
  });

  it('resolvido reflete o status', () => {
    expect(new FeedbackEntity({ status: 'RESOLVIDO' }).resolvido).toBe(true);
    expect(new FeedbackEntity({ status: 'PENDENTE' }).resolvido).toBe(false);
  });
});
