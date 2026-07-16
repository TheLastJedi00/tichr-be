/**
 * Cliente da Resend — o primeiro e-mail com HTML proprio do Tichr.
 *
 * Todo e-mail que o projeto mandava ate aqui era do Firebase: o backend chamava
 * `sendOobCode` e o corpo da mensagem vinha do Console. Alerta de feedback nao
 * cabe naquele fluxo (nao e um oobCode), entao entra um provedor.
 *
 * Sem SDK de proposito: a Resend expoe um POST JSON, e o repo ja tem o molde de
 * cliente HTTP externo — `identity-toolkit.ts`, funcoes puras + fetch + erro
 * tipado. Uma dependencia a menos para atualizar, e o teste sai no mesmo padrao
 * (mock de global.fetch).
 *
 * Diferenca deliberada em relacao ao identity-toolkit: ele traduz erro do
 * provedor para excecao HTTP (`comoHttp`), porque la sempre ha uma request
 * esperando resposta. Aqui nao ha — o disparo e assincrono e o professor ja
 * recebeu o 201. O erro sobe cru e quem chama decide o que fazer com ele.
 */

export const RESEND_URL = 'https://api.resend.com/emails';

export interface EmailResend {
  /** Remetente (precisa ser de um dominio verificado na Resend). */
  de: string;
  para: string[];
  assunto: string;
  html: string;
}

/** Falha do provedor, crua. */
export class ResendError extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
  }
}

interface RespostaResend {
  id?: string;
  message?: string;
  name?: string;
}

/** Envia um e-mail. Lanca `ResendError` em falha; devolve o id da mensagem. */
export async function enviarEmail(
  apiKey: string,
  email: EmailResend,
): Promise<string> {
  const resposta = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: email.de,
      to: email.para,
      subject: email.assunto,
      html: email.html,
    }),
  });

  const dados = (await resposta.json()) as RespostaResend;
  if (!resposta.ok) {
    throw new ResendError(dados.name ?? dados.message ?? 'RESEND_ERRO');
  }
  return dados.id ?? '';
}
