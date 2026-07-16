import { SetMetadata } from '@nestjs/common';

export const SEM_VERIFICACAO_KEY = 'semVerificacao';

/**
 * Libera a rota para o professor que ainda nao confirmou o e-mail.
 *
 * A trava do AuthGuard bloqueia o painel inteiro ate a confirmacao, mas quem
 * esta na tela de espera precisa de algumas portas abertas — senao nao consegue
 * consultar o proprio status, pedir o reenvio, nem apagar a conta (LGPD: ninguem
 * pode ficar preso numa conta que nao consegue nem excluir).
 *
 * Diferente de `@Public()`: aqui o token continua obrigatorio e valido, so a
 * exigencia de e-mail verificado e dispensada.
 */
export const SemVerificacao = () => SetMetadata(SEM_VERIFICACAO_KEY, true);
