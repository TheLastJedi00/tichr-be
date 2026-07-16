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
