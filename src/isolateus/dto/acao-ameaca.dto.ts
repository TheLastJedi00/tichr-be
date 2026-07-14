import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class AcaoAmeacaDto {
  @IsIn(['SABOTAR', 'ABDUZIR'])
  tipo: 'SABOTAR' | 'ABDUZIR';

  /** Id do setor (SABOTAR) ou do habitante (ABDUZIR). */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  alvoId: string;
}
