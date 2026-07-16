import { ConfigService } from '@nestjs/config';

/**
 * URL publica do app, sem barra no fim.
 *
 * Era um metodo privado do AuthService (o `continueUrl` dos e-mails de
 * verificacao/reset). Subiu para ca quando o alerta de feedback passou a
 * precisar da mesma base para o link do painel admin — dois donos e o momento
 * de extrair, nao de copiar as tres linhas.
 */
export function appBaseUrl(config: ConfigService): string {
  return (config.get<string>('APP_BASE_URL') ?? 'https://tichr.com.br').replace(
    /\/$/,
    '',
  );
}
