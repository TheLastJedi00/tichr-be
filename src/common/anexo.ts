import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
/**
 * Limites do anexo de aluno (037 #14, 038 #9), compartilhados por perguntas e
 * trabalhos. A API roda na Vercel, que corta a requisição em ~4,5 MB.
 */
export const ANEXO = {
  ARQUIVO_MAX_BYTES: 4 * 1024 * 1024,
  NOME_ARQUIVO_MAX: 100,
  /** Validade da URL assinada de download. */
  URL_MS: 5 * 60 * 1000,
};

export type ExtensaoAnexo = 'html' | 'htm' | 'css' | 'pdf' | 'doc' | 'docx';

export interface AnexoValidado {
  nome: string;
  extensao: ExtensaoAnexo;
  tamanho: number;
  /**
   * Tipo com que o arquivo é guardado e baixado. HTML e CSS vão como texto
   * simples para nunca serem renderizados no navegador (037 #15).
   */
  contentType: string;
}

const TEXTO = 'text/plain; charset=utf-8';

/** Assinatura de conteúdo de cada tipo: o mimetype do navegador é ignorado. */
const TIPOS: Record<
  ExtensaoAnexo,
  { contentType: string; confere: (b: Buffer) => boolean }
> = {
  pdf: {
    contentType: 'application/pdf',
    confere: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  docx: {
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    confere: (b) => comeca(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  doc: {
    contentType: 'application/msword',
    confere: (b) => comeca(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  html: { contentType: TEXTO, confere: textoUtf8 },
  htm: { contentType: TEXTO, confere: textoUtf8 },
  css: { contentType: TEXTO, confere: textoUtf8 },
};

function comeca(b: Buffer, bytes: number[]): boolean {
  return b.length >= bytes.length && bytes.every((x, i) => b[i] === x);
}

function textoUtf8(b: Buffer): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

function recusar(): never {
  throw new BadRequestException({
    code: 'TIPO_ARQUIVO_NAO_ACEITO',
    message: 'Envie um arquivo HTML, CSS, PDF ou Word (.doc/.docx).',
  });
}

/** Tira pastas e caracteres estranhos; preserva a extensão ao encurtar. */
function limparNome(nome: string, ext: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[^\p{L}\p{N} ._()-]/gu, '_').trim();
  if (limpo.length <= ANEXO.NOME_ARQUIVO_MAX) return limpo;
  const sufixo = `.${ext}`;
  return limpo.slice(0, ANEXO.NOME_ARQUIVO_MAX - sufixo.length) + sufixo;
}

/**
 * Valida o anexo do aluno (037 #13, #14; 038 #9): extensão aceita, conteúdo que
 * confere com ela e no máximo 4 MB. Imagens nunca passam.
 */
export function validarAnexo(nome: string, buffer: Buffer): AnexoValidado {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim());
  const ext = m?.[1].toLowerCase() as ExtensaoAnexo | undefined;
  const tipo = ext ? TIPOS[ext] : undefined;
  if (!ext || !tipo) recusar();
  if (buffer.length === 0) {
    throw new BadRequestException({
      code: 'ARQUIVO_VAZIO',
      message: 'O arquivo está vazio.',
    });
  }
  if (buffer.length > ANEXO.ARQUIVO_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'ARQUIVO_GRANDE',
      message: 'O arquivo pode ter até 4 MB.',
    });
  }
  if (!tipo.confere(buffer)) recusar();
  return {
    nome: limparNome(nome, ext),
    extensao: ext,
    tamanho: buffer.length,
    contentType: tipo.contentType,
  };
}

/** Tipo de download de um anexo já gravado (o mesmo da validação). */
export function contentTypeDe(ext: ExtensaoAnexo): string {
  return TIPOS[ext].contentType;
}
