/** Regras do envio de trabalhos (spec 038 #2, #8, #9, #14), ajustáveis. */
export const TRABALHO = {
  TITULO_MAX: 120,
  DESCRICAO_MAX: 2000,
  /** Até 5 dígitos. */
  VALOR_MAX: 99999,
  VALOR_PADRAO: 100,
  /** Caracteres do canva. */
  TEXTO_MAX: 10000,
  /** Arquivos por entrega (cada um com os limites de `ANEXO`). */
  MAX_ARQUIVOS: 5,
  NOTA_MAX: 10,
  COMENTARIO_MAX: 2000,
};
