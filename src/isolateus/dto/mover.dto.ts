import { IsIn, IsString } from 'class-validator';
import { SETOR_IDS } from '../isolateus.data';

export class MoverDto {
  /**
   * O setor de destino. A adjacência é revalidada no serviço — aqui só barramos
   * id que nem existe no mapa, para o motor não precisar tratar lixo.
   */
  @IsString()
  @IsIn(SETOR_IDS)
  setorId: string;
}
