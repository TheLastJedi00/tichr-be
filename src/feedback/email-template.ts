/**
 * Escapa texto para interpolacao segura em HTML.
 *
 * O projeto nunca precisou disto: o backend nao renderiza HTML em lugar nenhum
 * (quem escapa e o Angular), e o Firestore nao tem injecao de SQL — as queries
 * sao `.where(campo, '==', valor)` parametrizadas. O template de e-mail da Task
 * 6 e a PRIMEIRA superficie de HTML do Tichr, e ela monta markup com texto que
 * um professor escreveu.
 *
 * Sem isto, um `${mensagem}` cru deixaria qualquer professor injetar markup no
 * e-mail que o admin abre confiando — um link de phishing com a marca do Tichr,
 * no minimo.
 *
 * Nota sobre o que a spec chama de "sanitizar": nada aqui muda o que e GRAVADO.
 * O relato e salvo exatamente como o professor digitou — mutila-lo corromperia o
 * proprio produto do canal. O escape acontece so na fronteira do HTML.
 *
 * A ordem importa: `&` PRIMEIRO. Escapa-lo depois dos outros transformaria o
 * `&` que o proprio escape acabou de introduzir, e `<` viraria `&amp;lt;`.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Azul do Tichr (`--primary` do design system do front). */
const AZUL = '#2563eb';
const BORDA = '#cbd5e1';
const TEXTO = '#0f172a';
const MUTED = '#64748b';

/**
 * Inter e a fonte do Tichr, mas cliente de e-mail nao carrega webfont — o
 * fallback e que vai ser usado na pratica, e por isso ele e explicito.
 */
const FONTE = "'Inter', -apple-system, 'Segoe UI', Arial, sans-serif";

/** Uma linha de metadado da tabela tecnica. */
function linha(rotulo: string, valor: string): string {
  return `
    <tr>
      <td style="padding:6px 0;color:${MUTED};font-size:13px;white-space:nowrap;vertical-align:top;">${escaparHtml(rotulo)}</td>
      <td style="padding:6px 0 6px 16px;color:${TEXTO};font-size:13px;word-break:break-word;">${escaparHtml(valor)}</td>
    </tr>`;
}

export interface FeedbackParaEmail {
  id: string;
  professorNome: string;
  professorEmail: string;
  mensagem: string;
  rota: string;
  userAgent: string;
  criadoEm: string;
  rotuloCategoria(): string;
}

/**
 * Monta o alerta que a equipe recebe quando um feedback chega.
 *
 * HTML de tabela com estilo inline, de proposito: cliente de e-mail nao e
 * navegador — nao ha <style> externo confiavel, nem flex, nem grid. E o oposto
 * do que se escreve no front, e esta certo assim.
 *
 * TODA interpolacao passa pelo escaparHtml, inclusive nome e rota: sao strings
 * de cliente igual a mensagem.
 */
export function montarEmailFeedback(
  feedback: FeedbackParaEmail,
  appBaseUrl: string,
): { assunto: string; html: string } {
  const rotulo = feedback.rotuloCategoria();
  const nome = feedback.professorNome || 'Professor sem nome';
  const assunto = `[Tichr] ${rotulo} - ${nome}`;

  // O CTA que a spec pede: link direto para o ticket, nao para a inbox inteira.
  // A pagina le o ?id= e ja abre este card.
  const link = `${appBaseUrl}/admin/feedbacks?id=${encodeURIComponent(feedback.id)}`;

  const html = `
<div style="margin:0;padding:24px 12px;background:#f8fafc;font-family:${FONTE};">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${BORDA};border-radius:8px;overflow:hidden;">

    <div style="padding:16px 24px;border-bottom:1px solid ${BORDA};">
      <span style="font-size:18px;font-weight:700;color:${AZUL};">Tichr</span>
      <span style="font-size:13px;color:${MUTED};margin-left:8px;">${escaparHtml(rotulo)}</span>
    </div>

    <div style="padding:24px;">
      <p style="margin:0 0 4px;font-size:15px;color:${TEXTO};">
        <strong>${escaparHtml(nome)}</strong> enviou um feedback.
      </p>
      <p style="margin:0 0 20px;font-size:13px;color:${MUTED};">${escaparHtml(feedback.professorEmail || 'sem e-mail')}</p>

      <div style="padding:16px;background:#f8fafc;border-left:3px solid ${AZUL};border-radius:4px;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${TEXTO};white-space:pre-wrap;">${escaparHtml(feedback.mensagem)}</p>
      </div>

      <table style="width:100%;margin-top:20px;border-collapse:collapse;">
        ${linha('Tela', feedback.rota)}
        ${linha('Navegador', feedback.userAgent)}
        ${linha('Enviado em', feedback.criadoEm)}
      </table>

      <a href="${escaparHtml(link)}" style="display:inline-block;margin-top:24px;padding:11px 20px;background:${AZUL};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Acessar Painel Admin</a>
    </div>

  </div>
</div>`;

  return { assunto, html };
}
