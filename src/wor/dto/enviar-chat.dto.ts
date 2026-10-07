import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnviarChatDto {
  /** O limite fino (1–200 depois do trim) é revalidado no serviço. */
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  texto: string;
}
