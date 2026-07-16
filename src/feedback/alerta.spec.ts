import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

/**
 * O contrato desta task: salvar o feedback e alertar a equipe sao coisas
 * independentes. O alerta nunca pode derrubar o envio (o professor ja recebeu
 * 201), e a falha dele nunca pode ser silenciosa (senao o relato existe e
 * ninguem sabe).
 */
describe('alerta de feedback', () => {
  afterEach(() => jest.restoreAllMocks());

  function fakeFirebase(): FirebaseService {
    return {
      firestore: {
        collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ nomeExibicao: 'Joao' }) }) }) }),
      },
      auth: { getUser: async () => ({ email: 'joao@x.com' }) },
    } as unknown as FirebaseService;
  }

  function fakeRepo() {
    const updates: { id: string; data: Partial<FeedbackEntity> }[] = [];
    const repo = {
      create: async (data: Omit<FeedbackEntity, 'id'>) => new FeedbackEntity({ ...data, id: 'fb-1' }),
      update: async (id: string, data: Partial<FeedbackEntity>) => {
        updates.push({ id, data });
      },
    } as unknown as FeedbackRepository;
    return { repo, updates };
  }

  function fakeConfig(vals: Record<string, string | undefined>): ConfigService {
    return { get: (k: string) => vals[k] } as unknown as ConfigService;
  }

  function mockFetch(ok = true, body: unknown = { id: 'msg-1' }) {
    const mock = jest.fn().mockResolvedValue({ ok, json: async () => body });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  const dto = {
    categoria: 'BUG' as const,
    mensagem: 'quebrou',
    rota: '/turmas',
    userAgent: 'UA',
  };

  const configCompleta = {
    RESEND_API_KEY: 're_123',
    ADMIN_NOTIFICATION_EMAILS: ' eu@tichr.com.br , suporte@tichr.com.br ',
    APP_BASE_URL: 'https://tichr.com.br',
  };

  /** O disparo nao e aguardado; deixa a microtask do `void` drenar. */
  const drenar = () => new Promise((r) => setImmediate(r));

  it('sem RESEND_API_KEY, o feedback e salvo e nenhum e-mail sai', async () => {
    const fetchMock = mockFetch();
    const { repo } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig({}));

    const salvo = await service.criar('uid-1', dto);
    await drenar();

    expect(salvo.id).toBe('fb-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem destinatarios, idem — nao tenta enviar para ninguem', async () => {
    const fetchMock = mockFetch();
    const { repo } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig({ RESEND_API_KEY: 're_123' }));

    await service.criar('uid-1', dto);
    await drenar();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com tudo configurado, envia para a lista da env (aparada)', async () => {
    const fetchMock = mockFetch();
    const { repo } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig(configCompleta));

    await service.criar('uid-1', dto);
    await drenar();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { to: string[]; subject: string };
    expect(corpo.to).toEqual(['eu@tichr.com.br', 'suporte@tichr.com.br']);
    expect(corpo.subject).toBe('[Tichr] Relato de Bug - Joao');
  });

  it('envio bem-sucedido carimba notificadoEm', async () => {
    mockFetch();
    const { repo, updates } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig(configCompleta));

    await service.criar('uid-1', dto);
    await drenar();

    expect(updates[0].id).toBe('fb-1');
    expect(updates[0].data.notificadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('erro da Resend NAO rejeita o criar() — e o feedback fica sem notificadoEm', async () => {
    // Se alguem "consertar" pondo um await no notificar(), este teste quebra: e
    // exatamente a regressao que ele existe para impedir.
    mockFetch(false, { name: 'domain_not_verified' });
    const { repo, updates } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig(configCompleta));
    const erro = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    const salvo = await service.criar('uid-1', dto);
    await drenar();

    expect(salvo.id).toBe('fb-1');
    expect(updates).toHaveLength(0);
    expect(erro).toHaveBeenCalled();
  });

  it('rede caindo tambem nao derruba o envio', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    const { repo } = fakeRepo();
    const service = new FeedbackService(repo, fakeFirebase(), fakeConfig(configCompleta));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(service.criar('uid-1', dto)).resolves.toBeInstanceOf(FeedbackEntity);
    await drenar();
  });
});
