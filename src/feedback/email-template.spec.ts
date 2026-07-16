import { escaparHtml } from './email-template';

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
