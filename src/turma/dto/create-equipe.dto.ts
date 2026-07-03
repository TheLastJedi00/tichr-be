import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateEquipeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  descricao?: string;

  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'cor deve ser um hex #RRGGBB' })
  cor: string;
}
