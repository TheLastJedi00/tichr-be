import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { validarAnexo } from './anexo';
import { PERGUNTA } from './pergunta.constants';
import { PerguntaEntity } from './entities/pergunta.entity';
import { PerguntaMensagemEntity } from './entities/pergunta-mensagem.entity';

/**
 * Spec 037 — pergunta do aluno ao professor. Trava as regras puras:
 * limites (#7), status e quem a pergunta espera (#4, #5, #8) e os tipos de
 * anexo aceitos (#13, #14): só HTML, CSS, PDF e Word, nunca imagem.
 */

const AGORA = new Date('2026-11-24T14:00:00.000Z');

function nova(abertas = 0): PerguntaEntity {
  return PerguntaEntity.criar(
    {
      turmaId: 't1',
      professorId: 'p1',
      alunoId: 'a1',
      titulo: '  Dúvida da prova  ',
    },
    abertas,
    AGORA,
  );
}

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    const r = (e as { getResponse?: () => unknown }).getResponse?.();
    return (r as { code?: string })?.code;
  }
  return undefined;
}

describe('PerguntaEntity', () => {
  it('nasce aberta, esperando o professor, com a 1ª mensagem contada', () => {
    const p = nova();
    expect(p.titulo).toBe('Dúvida da prova');
    expect(p.status).toBe('ABERTA');
    expect(p.totalMensagens).toBe(1);
    expect(p.ultimaMensagemPor).toBe('ALUNO');
    expect(p.criadaEm).toBe(AGORA.toISOString());
    expect(p.atualizadaEm).toBe(AGORA.toISOString());
    expect(p.aguardando).toBe('AGUARDANDO_PROFESSOR');
  });

  it('título obrigatório e até 120 caracteres', () => {
    const base = { turmaId: 't1', professorId: 'p1', alunoId: 'a1' };
    expect(() => PerguntaEntity.criar({ ...base, titulo: '  ' }, 0)).toThrow(
      BadRequestException,
    );
    expect(
      codigo(() =>
        PerguntaEntity.criar(
          { ...base, titulo: 'x'.repeat(PERGUNTA.TITULO_MAX + 1) },
          0,
        ),
      ),
    ).toBe('TITULO_INVALIDO');
  });

  it('recusa a 6ª pergunta aberta do aluno', () => {
    expect(() => nova(PERGUNTA.MAX_ABERTAS - 1)).not.toThrow();
    expect(() => nova(PERGUNTA.MAX_ABERTAS)).toThrow(ConflictException);
    expect(codigo(() => nova(PERGUNTA.MAX_ABERTAS))).toBe('LIMITE_PERGUNTAS');
  });

  it('a resposta do professor passa a esperar o aluno', () => {
    const p = nova();
    const depois = new Date('2026-11-24T14:05:00.000Z');
    p.registrarMensagem('PROFESSOR', depois);
    expect(p.totalMensagens).toBe(2);
    expect(p.ultimaMensagemPor).toBe('PROFESSOR');
    expect(p.atualizadaEm).toBe(depois.toISOString());
    expect(p.aguardando).toBe('AGUARDANDO_ALUNO');
  });

  it('não aceita mensagem em pergunta encerrada', () => {
    const p = nova();
    p.encerrar('ALUNO', AGORA);
    expect(codigo(() => p.registrarMensagem('PROFESSOR'))).toBe(
      'PERGUNTA_ENCERRADA',
    );
    expect(p.aguardando).toBeNull();
  });

  it('recusa a 51ª mensagem', () => {
    const p = nova();
    p.totalMensagens = PERGUNTA.MAX_MENSAGENS;
    expect(codigo(() => p.registrarMensagem('ALUNO'))).toBe('LIMITE_MENSAGENS');
  });

  it('encerrar registra quem e quando; repetir não muda nada', () => {
    const p = nova();
    p.encerrar('PROFESSOR', AGORA);
    expect(p.status).toBe('ENCERRADA');
    expect(p.encerradaPor).toBe('PROFESSOR');
    expect(p.encerradaEm).toBe(AGORA.toISOString());
    p.encerrar('ALUNO', new Date('2026-11-25T00:00:00.000Z'));
    expect(p.encerradaPor).toBe('PROFESSOR');
  });

  it('reabrir só a encerrada, limpando o encerramento', () => {
    const p = nova();
    expect(codigo(() => p.reabrir())).toBe('PERGUNTA_ABERTA');
    p.encerrar('ALUNO', AGORA);
    p.reabrir();
    expect(p.status).toBe('ABERTA');
    expect(p.encerradaEm).toBeNull();
    expect(p.encerradaPor).toBeNull();
  });
});

describe('PerguntaMensagemEntity', () => {
  const base = { perguntaId: 'q1', turmaId: 't1', autor: 'ALUNO' as const };

  it('precisa de texto ou anexo', () => {
    expect(codigo(() => PerguntaMensagemEntity.criar({ ...base }))).toBe(
      'MENSAGEM_VAZIA',
    );
    expect(
      codigo(() => PerguntaMensagemEntity.criar({ ...base, texto: '   ' })),
    ).toBe('MENSAGEM_VAZIA');
    const so = PerguntaMensagemEntity.criar({
      ...base,
      anexo: { path: 'x', nome: 'a.pdf', extensao: 'pdf', tamanho: 10 },
    });
    expect(so.texto).toBeUndefined();
  });

  it('texto até 2.000 caracteres, sem espaço nas pontas', () => {
    const m = PerguntaMensagemEntity.criar({ ...base, texto: ' oi ' }, AGORA);
    expect(m.texto).toBe('oi');
    expect(m.criadaEm).toBe(AGORA.toISOString());
    expect(
      codigo(() =>
        PerguntaMensagemEntity.criar({
          ...base,
          texto: 'x'.repeat(PERGUNTA.TEXTO_MAX + 1),
        }),
      ),
    ).toBe('TEXTO_LONGO');
  });
});

describe('validarAnexo', () => {
  const pdf = Buffer.from('%PDF-1.7\n...conteúdo');
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
  const html = Buffer.from('<!doctype html><h1>Olá</h1>', 'utf8');
  const css = Buffer.from('body { color: red; }', 'utf8');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

  it.each([
    ['trabalho.pdf', pdf, 'pdf', 'application/pdf'],
    [
      'relatorio.DOCX',
      docx,
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['antigo.doc', doc, 'doc', 'application/msword'],
    ['index.html', html, 'html', 'text/plain; charset=utf-8'],
    ['pagina.htm', html, 'htm', 'text/plain; charset=utf-8'],
    ['estilo.css', css, 'css', 'text/plain; charset=utf-8'],
  ])('aceita %s', (nome, buf, ext, tipo) => {
    const a = validarAnexo(nome, buf);
    expect(a.extensao).toBe(ext);
    expect(a.tamanho).toBe(buf.length);
    expect(a.contentType).toBe(tipo);
  });

  it.each([
    ['foto.png', png],
    ['foto.jpg', jpg],
    ['script.exe', Buffer.from('MZ')],
    ['sem-extensao', pdf],
    ['planilha.xlsx', docx],
  ])('recusa o tipo de %s', (nome, buf) => {
    expect(codigo(() => validarAnexo(nome, buf))).toBe(
      'TIPO_ARQUIVO_NAO_ACEITO',
    );
  });

  it('recusa imagem renomeada (conteúdo não confere)', () => {
    expect(codigo(() => validarAnexo('foto.pdf', png))).toBe(
      'TIPO_ARQUIVO_NAO_ACEITO',
    );
    expect(codigo(() => validarAnexo('foto.docx', jpg))).toBe(
      'TIPO_ARQUIVO_NAO_ACEITO',
    );
    expect(codigo(() => validarAnexo('foto.html', png))).toBe(
      'TIPO_ARQUIVO_NAO_ACEITO',
    );
  });

  it('HTML/CSS precisam ser texto UTF-8 sem byte nulo', () => {
    expect(
      codigo(() => validarAnexo('a.css', Buffer.from([0x61, 0x00, 0x62]))),
    ).toBe('TIPO_ARQUIVO_NAO_ACEITO');
    expect(
      codigo(() => validarAnexo('a.html', Buffer.from([0xc3, 0x28]))),
    ).toBe('TIPO_ARQUIVO_NAO_ACEITO');
  });

  it('recusa vazio e acima de 4 MB', () => {
    expect(codigo(() => validarAnexo('a.pdf', Buffer.alloc(0)))).toBe(
      'ARQUIVO_VAZIO',
    );
    const grande = Buffer.concat([
      Buffer.from('%PDF-'),
      Buffer.alloc(PERGUNTA.ARQUIVO_MAX_BYTES),
    ]);
    expect(() => validarAnexo('a.pdf', grande)).toThrow(
      PayloadTooLargeException,
    );
    expect(codigo(() => validarAnexo('a.pdf', grande))).toBe('ARQUIVO_GRANDE');
  });

  it('limpa o nome: sem pasta, sem caractere estranho, até 100', () => {
    expect(validarAnexo('C:\\fake\\..\\meu trab<1>.pdf', pdf).nome).toBe(
      'meu trab_1_.pdf',
    );
    expect(validarAnexo('../../etc/x.pdf', pdf).nome).toBe('x.pdf');
    const longo = validarAnexo(`${'a'.repeat(300)}.pdf`, pdf).nome;
    expect(longo.length).toBeLessThanOrEqual(100);
    expect(longo.endsWith('.pdf')).toBe(true);
  });
});
