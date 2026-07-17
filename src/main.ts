import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

/**
 * Origens autorizadas. Vem de env (e nao de constante) porque os preview deploys
 * da Vercel mudam de URL a cada branch e precisam ser liberados por ambiente sem
 * alterar codigo. Sem `CORS_ORIGINS` configurada em producao nenhuma origem
 * passa e o app inteiro para — e o preco de nao poder mais usar `origin: '*'`.
 */
function origensPermitidas(): string[] {
  const bruto = process.env.CORS_ORIGINS;
  if (!bruto) {
    // Dev: o `ng serve` do front.
    return ['http://localhost:4200'];
  }
  return bruto
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap() {
  // `rawBody: true` guarda o corpo cru das requisicoes — o webhook do gateway
  // confere a assinatura HMAC sobre os bytes originais (quando o header vem).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // O refresh token da sessao viaja em cookie HttpOnly; sem o parser ele nao e lido.
  app.use(cookieParser());
  // `origin: '*'` (o default do enableCors sem argumento) e INCOMPATIVEL com
  // credentials — o browser recusa a resposta. Por isso a lista e explicita.
  app.enableCors({ origin: origensPermitidas(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
