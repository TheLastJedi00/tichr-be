import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { CategoriaFeedback } from '../entities/feedback.entity';

/**
 * O que o cliente pode mandar — e so isso.
 *
 * Nao ha `userId`/`userName`/`userEmail` aqui de proposito: identidade vinda do
 * corpo e spoofavel (bastaria editar o POST para abrir chamado no nome de
 * outro). Ela sai do token, no service. Sobra o que so o navegador sabe: a rota
 * em que o professor estava e o User-Agent.
 *
 * Com `forbidNonWhitelisted: true` no ValidationPipe global, qualquer campo
 * extra aqui e 400 — inclusive uma tentativa de mandar `professorId`.
 */
export class CreateFeedbackDto {
  @IsIn(['BUG', 'SUGESTAO', 'DUVIDA', 'ELOGIO'])
  categoria: CategoriaFeedback;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  mensagem: string;

  @IsString()
  @MaxLength(200)
  rota: string;

  @IsString()
  @MaxLength(300)
  userAgent: string;
}
