/** Regras da pergunta do aluno ao professor (spec 037 #7, #14), ajustáveis. */
export const PERGUNTA = {
  TITULO_MAX: 120,
  TEXTO_MAX: 2000,
  /** Perguntas ABERTAS por aluno na turma. */
  MAX_ABERTAS: 5,
  /** Mensagens por pergunta (a 1ª, do aluno, conta). */
  MAX_MENSAGENS: 50,
  /** A API roda na Vercel, que corta a requisição em ~4,5 MB. */
  ARQUIVO_MAX_BYTES: 4 * 1024 * 1024,
  NOME_ARQUIVO_MAX: 100,
  /** Validade da URL assinada de download do anexo. */
  URL_ANEXO_MS: 5 * 60 * 1000,
};
