import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nomeExibicao?: string;

  /** Handle publico: 3-30 chars, minusculas/numeros/ponto/underscore. */
  @IsOptional()
  @Matches(/^@?[a-z0-9._]{3,30}$/, {
    message:
      'username deve ter 3-30 caracteres (letras minusculas, numeros, ponto ou _)',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  /** URL publica da foto de perfil (devolvida pelo Firebase Storage). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  avatarUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  disciplinas?: string[];
}
