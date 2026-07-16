import { FeedbackEntity } from './entities/feedback.entity';
import { escaparHtml, montarEmailFeedback } from './email-template';

/**
 * Teste de guarda: e o unico escape do backend inteiro, e protege o e-mail que o
 * admin abre confiando. Um refactor que "simplifique" a ordem das substituicoes
 * quebra o escape sem quebrar nada visivel.
 */
describe('escaparHtml', () => {
  it('neutraliza script na mensagem do professor', () => {
    expect(escaparHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapa & uma vez so — a ordem das substituicoes importa', () => {
    // Se `&` fosse escapado por ultimo, o `&` que o proprio escape introduziu em
    // `&lt;` seria reprocessado e o resultado viraria `&amp;lt;`.
    expect(escaparHtml('<a>')).toBe('&lt;a&gt;');
    expect(escaparHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escaparHtml('&lt;')).toBe('&amp;lt;');
  });

  it('aspas nao escapam do atributo', () => {
    const perigoso = '" onmouseover="steal()';
    const html = `<td title="${escaparHtml(perigoso)}">`;
    expect(html).not.toContain('onmouseover="steal()"');
    expect(html).toBe('<td title="&quot; onmouseover=&quot;steal()">');
  });

  it('nao mexe em texto comum', () => {
    expect(escaparHtml('O botao de salvar nao responde no Safari')).toBe(
      'O botao de salvar nao responde no Safari',
    );
  });

  it('trata acentos e emoji sem estragar (nao e o trabalho dele)', () => {
    expect(escaparHtml('Sugestão: adicionar ícone 🎯')).toBe('Sugestão: adicionar ícone 🎯');
  });
});

describe('montarEmailFeedback', () => {
  const base = new FeedbackEntity({
    id: 'fb-1',
    professorNome: 'Joao Silva',
    professorEmail: 'joao@x.com',
    categoria: 'BUG',
    mensagem: 'O botao de salvar nao responde',
    rota: '/turmas/abc',
    userAgent: 'Mozilla/5.0 (iPhone)',
    criadoEm: '2026-07-16T10:00:00.000Z',
  });

  it('assunto traz a categoria e o nome, como a spec pede', () => {
    const { assunto } = montarEmailFeedback(base, 'https://tichr.com.br');
    expect(assunto).toBe('[Tichr] Relato de Bug - Joao Silva');
  });

  it('CTA aponta para o ticket especifico, nao para a inbox', () => {
    const { html } = montarEmailFeedback(base, 'https://tichr.com.br');
    expect(html).toContain('https://tichr.com.br/admin/feedbacks?id=fb-1');
    expect(html).toContain('Acessar Painel Admin');
  });

  it('corpo traz a transcricao e os metadados tecnicos', () => {
    const { html } = montarEmailFeedback(base, 'https://tichr.com.br');
    expect(html).toContain('O botao de salvar nao responde');
    expect(html).toContain('/turmas/abc');
    expect(html).toContain('Mozilla/5.0 (iPhone)');
    expect(html).toContain('joao@x.com');
  });

  it('a data vai legivel, no fuso de quem le — nao o ISO cru do banco', () => {
    const { html } = montarEmailFeedback(base, 'https://tichr.com.br');
    // 10:00Z = 07:00 em Sao_Paulo (UTC-3).
    expect(html).toContain('16/07/2026, 07:00');
    expect(html).not.toContain('2026-07-16T10:00:00.000Z');
  });

  it('markup na mensagem sai escapado — nao vira HTML no e-mail do admin', () => {
    const malicioso = new FeedbackEntity({
      ...base,
      mensagem: '<a href="http://phishing.example">Clique para validar sua conta</a>',
    });
    const { html } = montarEmailFeedback(malicioso, 'https://tichr.com.br');

    expect(html).not.toContain('<a href="http://phishing.example"');
    expect(html).toContain('&lt;a href=&quot;http://phishing.example&quot;&gt;');
  });

  it('nome tambem e escapado (e string de cliente igual a mensagem)', () => {
    const malicioso = new FeedbackEntity({ ...base, professorNome: '<img src=x onerror=alert(1)>' });
    const { assunto, html } = montarEmailFeedback(malicioso, 'https://tichr.com.br');

    expect(html).not.toContain('<img src=x');
    // O assunto e texto puro no cliente de e-mail, entao vai cru mesmo.
    expect(assunto).toContain('<img src=x onerror=alert(1)>');
  });

  it('professor sem nome nao gera assunto quebrado', () => {
    const anonimo = new FeedbackEntity({ ...base, professorNome: '' });
    expect(montarEmailFeedback(anonimo, 'https://tichr.com.br').assunto).toBe(
      '[Tichr] Relato de Bug - Professor sem nome',
    );
  });
});
