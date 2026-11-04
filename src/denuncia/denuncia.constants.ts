/** Regras da denúncia entre alunos (spec 032), ajustáveis. */
export const DENUNCIA = {
  /** Denúncias pendentes por autor (#4). */
  MAX_PENDENTES: 3,
  /** Teto de XP por denúncia, contra erro de digitação (#6). */
  TETO_PONTOS: 10000,
  TEXTO_MAX: 1000,
  /** A imagem chega comprimida pelo front (~300KB); a folga cobre o JPEG. */
  IMAGEM_MAX_BYTES: 400 * 1024,
  /** Validade da URL assinada da imagem, só para o professor. */
  URL_IMAGEM_MS: 5 * 60 * 1000,
};
