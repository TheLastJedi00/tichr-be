import { CookieOptions, Response } from 'express';

/**
 * O refresh token da sessao do professor, num cookie HttpOnly.
 *
 * Por que cookie e nao corpo da resposta: o refresh token e de vida longa, e se
 * ele chegasse ao JavaScript um XSS o exfiltraria e teria a conta em carater
 * indefinido. No cookie HttpOnly, o pior caso e o ID token de ~1h que fica no
 * localStorage. O ID token continua indo no corpo, porque e ele que o front
 * manda no header `Authorization`.
 *
 * Isto so e possivel porque o FE (tichr.com.br) e a API (api.tichr.com.br)
 * compartilham o dominio registravel: sao MESMO SITE, e o `SameSite=Lax` deixa
 * o cookie passar. Enquanto a API respondia em `tichr-be.vercel.app` isso era
 * impossivel — `vercel.app` esta na Public Suffix List, o cookie nascia
 * third-party e morria no Safari.
 */
export const COOKIE_REFRESH = 'tichr_rt';

/** Firebase nao expira refresh token por tempo; 1 ano cobre a sessao "lembrada". */
const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

function opcoes(): CookieOptions {
  return {
    httpOnly: true,
    // Same-site (tichr.com.br -> api.tichr.com.br), entao Lax basta e ainda
    // barra o cookie em requisicao cross-site. `None` exigiria third-party.
    sameSite: 'lax',
    // Em http://localhost o `Secure` impede o cookie de ser gravado no dev.
    secure: process.env.NODE_ENV === 'production',
    // O cookie so precisa existir nas rotas de sessao; o resto da API usa Bearer.
    path: '/auth',
    // Sem `domain`: host-only em api.tichr.com.br e mais apertado que
    // `.tichr.com.br`, que compartilharia o cookie com todo subdominio.
  };
}

export function gravarCookieRefresh(res: Response, refreshToken: string): void {
  res.cookie(COOKIE_REFRESH, refreshToken, { ...opcoes(), maxAge: UM_ANO_MS });
}

/** Os atributos precisam bater com os da gravacao, senao o browser ignora. */
export function limparCookieRefresh(res: Response): void {
  res.clearCookie(COOKIE_REFRESH, opcoes());
}
