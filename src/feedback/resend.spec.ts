import { enviarEmail, RESEND_URL, ResendError } from './resend';

/**
 * Cliente HTTP fino: o que importa e a forma da chamada (a Resend recusa em
 * silencio o que nao estiver no shape dela) e o erro subir CRU — se ele virasse
 * excecao HTTP como no identity-toolkit, o disparo assincrono acabaria
 * derrubando a request que ja respondeu 201.
 */
describe('resend', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockFetch(ok: boolean, body: unknown) {
    const mock = jest.fn().mockResolvedValue({ ok, json: async () => body });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  const email = {
    de: 'Tichr <nao-responda@tichr.com.br>',
    para: ['admin@tichr.com.br', 'dev@tichr.com.br'],
    assunto: '[Tichr] Relato de Bug - Joao',
    html: '<p>oi</p>',
  };

  it('POST com Bearer e o corpo no shape da Resend', async () => {
    const fetchMock = mockFetch(true, { id: 'msg-1' });

    const id = await enviarEmail('re_123', email);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: email.de,
      to: email.para,
      subject: email.assunto,
      html: email.html,
    });
    expect(id).toBe('msg-1');
  });

  it('resposta de erro vira ResendError com o codigo do provedor', async () => {
    mockFetch(false, { name: 'validation_error', message: 'domain not verified' });

    await expect(enviarEmail('re_123', email)).rejects.toBeInstanceOf(ResendError);
    await expect(enviarEmail('re_123', email)).rejects.toMatchObject({
      codigo: 'validation_error',
    });
  });

  it('erro sem `name` cai na mensagem, e sem nenhum dos dois num codigo generico', async () => {
    mockFetch(false, { message: 'rate limited' });
    await expect(enviarEmail('k', email)).rejects.toMatchObject({ codigo: 'rate limited' });

    mockFetch(false, {});
    await expect(enviarEmail('k', email)).rejects.toMatchObject({ codigo: 'RESEND_ERRO' });
  });
});
