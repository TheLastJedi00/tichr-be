import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Cliente das APIs REST do Firebase que exigem a Web API key. O backend e o dono
 * dessa chave (o front nao tem sessao do Firebase Auth), entao todo login,
 * cadastro, reautenticacao e envio de e-mail passa por aqui.
 *
 * Existe para nao espalhar `fetch` e URL solta pelos services: antes, `SIGN_IN_URL`
 * estava declarada duas vezes (auth.service e admin.service) e cada chamador
 * traduzia os erros do provedor do seu jeito.
 */

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';

export const SIGN_IN_URL = `${IDENTITY_TOOLKIT}/accounts:signInWithPassword`;
export const SIGNUP_URL = `${IDENTITY_TOOLKIT}/accounts:signUp`;
export const SEND_OOB_URL = `${IDENTITY_TOOLKIT}/accounts:sendOobCode`;

/**
 * Troca de refresh token: outro host, outro formato. A Secure Token API nao
 * aceita JSON (so form-urlencoded) e responde em snake_case — por isso ela tem
 * funcao propria em vez de cair no `chamar()` generico.
 */
export const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

/** Sessao autenticada, ja no formato que os services usam. */
export interface TokensFirebase {
  token: string;
  refreshToken: string;
  expiresIn: number;
  uid: string;
  email: string;
}

interface RespostaIdentityToolkit {
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
  email?: string;
  error?: { message?: string };
}

/**
 * Traduz o codigo do provedor para excecao do Nest com `code` estavel — o front
 * decide a microcopia pelo `code`, nunca pela mensagem.
 */
function traduzirErro(codigoBruto: string): HttpException {
  const codigo = codigoBruto.toUpperCase();

  if (codigo === 'EMAIL_EXISTS') {
    return new ConflictException({
      code: 'EMAIL_EM_USO',
      message: 'Esse e-mail ja esta cadastrado.',
    });
  }
  if (codigo.startsWith('WEAK_PASSWORD')) {
    return new BadRequestException({
      code: 'SENHA_FRACA',
      message: 'Senha muito fraca (minimo 6 caracteres).',
    });
  }
  if (codigo.startsWith('TOO_MANY_ATTEMPTS')) {
    return new HttpException(
      {
        code: 'VERIFICACAO_COOLDOWN',
        message: 'Muitas tentativas. Aguarde alguns minutos.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (
    codigo === 'INVALID_ID_TOKEN' ||
    codigo === 'TOKEN_EXPIRED' ||
    codigo === 'USER_NOT_FOUND' ||
    codigo === 'USER_DISABLED' ||
    codigo === 'INVALID_REFRESH_TOKEN'
  ) {
    return new UnauthorizedException({
      code: 'SESSAO_EXPIRADA',
      message: 'Sessao expirada. Entre novamente.',
    });
  }
  if (
    codigo === 'EMAIL_NOT_FOUND' ||
    codigo === 'INVALID_PASSWORD' ||
    codigo === 'INVALID_LOGIN_CREDENTIALS'
  ) {
    return new UnauthorizedException({
      code: 'CREDENCIAL_INVALIDA',
      message: 'Email ou senha invalidos.',
    });
  }
  return new BadRequestException({
    code: 'IDENTITY_TOOLKIT_ERRO',
    message: 'Nao foi possivel completar a operacao.',
  });
}

/** Erro do provedor, cru — para quem precisa decidir pelo codigo (ex.: reset silencioso). */
export class IdentityToolkitError extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
  }
}

/** POST em JSON num endpoint do Identity Toolkit. Lanca `IdentityToolkitError` em falha. */
async function chamar(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<RespostaIdentityToolkit> {
  const resposta = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const dados = (await resposta.json()) as RespostaIdentityToolkit;
  if (!resposta.ok) {
    throw new IdentityToolkitError(dados.error?.message ?? 'ERRO_DESCONHECIDO');
  }
  return dados;
}

/** Converte `IdentityToolkitError` em excecao HTTP; o resto sobe como esta. */
export function comoHttp(erro: unknown): never {
  if (erro instanceof IdentityToolkitError) {
    throw traduzirErro(erro.codigo);
  }
  throw erro;
}

function paraTokens(
  dados: RespostaIdentityToolkit,
  emailFallback: string,
): TokensFirebase {
  return {
    token: dados.idToken ?? '',
    refreshToken: dados.refreshToken ?? '',
    expiresIn: Number(dados.expiresIn ?? 3600),
    uid: dados.localId ?? '',
    email: dados.email ?? emailFallback,
  };
}

/** Autentica email/senha. Usado no login e como reautenticacao em acoes sensiveis. */
export async function signInComSenha(
  apiKey: string,
  email: string,
  senha: string,
  retornarToken = true,
): Promise<TokensFirebase> {
  const dados = await chamar(SIGN_IN_URL, apiKey, {
    email,
    password: senha,
    returnSecureToken: retornarToken,
  });
  return paraTokens(dados, email);
}

/** Cria a conta no Identity Toolkit e ja devolve a sessao (auto-login do cadastro). */
export async function signUpComSenha(
  apiKey: string,
  email: string,
  senha: string,
): Promise<TokensFirebase> {
  const dados = await chamar(SIGNUP_URL, apiKey, {
    email,
    password: senha,
    returnSecureToken: true,
  });
  return paraTokens(dados, email);
}

/**
 * Dispara um e-mail transacional do Firebase (verificacao, reset, troca de e-mail).
 * O `requestType` decide qual: VERIFY_EMAIL, PASSWORD_RESET, VERIFY_AND_CHANGE_EMAIL.
 */
export async function sendOobCode(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<void> {
  await chamar(SEND_OOB_URL, apiKey, body);
}

/**
 * Troca o refresh token por um ID token fresco. Tres diferencas do resto do arquivo:
 * host proprio (securetoken, nao identitytoolkit), corpo form-urlencoded (nao JSON)
 * e resposta em snake_case — normalizada aqui para o resto do codigo nao saber disso.
 */
export async function trocarRefreshToken(
  apiKey: string,
  refreshToken: string,
): Promise<TokensFirebase> {
  const resposta = await fetch(`${SECURE_TOKEN_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  const dados = (await resposta.json()) as {
    id_token?: string;
    refresh_token?: string;
    expires_in?: string;
    user_id?: string;
    error?: { message?: string };
  };

  if (!resposta.ok || !dados.id_token) {
    throw new IdentityToolkitError(
      dados.error?.message ?? 'INVALID_REFRESH_TOKEN',
    );
  }

  return {
    token: dados.id_token,
    refreshToken: dados.refresh_token ?? refreshToken,
    expiresIn: Number(dados.expires_in ?? 3600),
    uid: dados.user_id ?? '',
    email: '',
  };
}
