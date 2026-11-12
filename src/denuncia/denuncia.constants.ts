/** Regras da denúncia entre alunos (spec 032), ajustáveis. */
export const DENUNCIA = {
  /** Denúncias pendentes por autor (#4). */
  MAX_PENDENTES: 3,
  /** Teto de XP por denúncia, contra erro de digitação (#6). */
  TETO_PONTOS: 10000,
  TEXTO_MAX: 1000,
  /**
   * Teto do multipart. A foto saiu na 033, mas o campo segue aceito para
   * responder 400 IMAGEM_REMOVIDA ao front antigo (que mandava ~300KB).
   */
  IMAGEM_MAX_BYTES: 400 * 1024,
  /** Validade da URL assinada da imagem de legado, só para o professor. */
  URL_IMAGEM_MS: 5 * 60 * 1000,
};
