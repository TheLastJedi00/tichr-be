import { BadRequestException, Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import type { ProfessorEntity } from '../professor/entities/professor.entity';
import { CupomRepository } from './cupom.repository';
import { CupomEntity } from './entities/cupom.entity';
import { CreateCupomDto } from './dto/create-cupom.dto';
import { UpdateCupomDto } from './dto/update-cupom.dto';

const MS_POR_MES = 30 * 86_400_000;

export interface ResultadoAplicacao {
  aplicado: true;
  tipo: CupomEntity['tipo'];
  planoAtual?: string;
  cortesiaAte?: string;
}

/**
 * Motor de cupons: CRUD (admin) + aplicacao no checkout (professor).
 * A aplicacao roda numa transacao: revalida o limite e incrementa `usos`
 * junto da concessao ao professor, evitando corrida/uso duplicado.
 */
@Injectable()
export class CupomService {
  constructor(
    private readonly repo: CupomRepository,
    private readonly firebase: FirebaseService,
  ) {}

  listar(): Promise<CupomEntity[]> {
    return this.repo.listarTodos();
  }

  async criar(dto: CreateCupomDto): Promise<CupomEntity> {
    const codigo = CupomEntity.normalizar(dto.codigo);
    const existente = await this.repo.findByCodigo(codigo);
    if (existente) {
      throw new BadRequestException('Ja existe um cupom com esse codigo.');
    }
    return this.repo.create({
      codigo,
      tipo: dto.tipo,
      planoConcedido: dto.planoConcedido,
      meses: dto.meses,
      maxUsos: dto.maxUsos,
      ativo: dto.ativo ?? true,
      usos: 0,
    } as Omit<CupomEntity, 'id'>);
  }

  async atualizar(id: string, dto: UpdateCupomDto): Promise<void> {
    const dados: Partial<CupomEntity> = { ...dto };
    if (dto.codigo) dados.codigo = CupomEntity.normalizar(dto.codigo);
    await this.repo.update(id, dados);
  }

  remover(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  /** Aplica o cupom ao professor autenticado (transacao). */
  async aplicar(uid: string, codigoRaw: string): Promise<ResultadoAplicacao> {
    const codigo = CupomEntity.normalizar(codigoRaw);
    const cupom = await this.repo.findByCodigo(codigo);
    if (!cupom || !cupom.estaValido()) {
      throw new BadRequestException({
        code: 'CUPOM_INVALIDO',
        message: 'Cupom invalido, inativo ou esgotado.',
      });
    }

    const update: Partial<ProfessorEntity> = {};
    if (cupom.planoConcedido) update.planoAtual = cupom.planoConcedido;
    if (cupom.meses && cupom.meses > 0) {
      update.cortesiaAte = new Date(
        Date.now() + cupom.meses * MS_POR_MES,
      ).toISOString();
    }

    const db = this.firebase.firestore;
    await db.runTransaction(async (tx) => {
      const cupomRef = db.collection('cupons').doc(cupom.id);
      const fresh = await tx.get(cupomRef);
      const data = fresh.data() ?? {};
      const usos = (data.usos as number) ?? 0;
      const maxUsos = data.maxUsos as number | undefined;
      if (data.ativo === false || (maxUsos != null && usos >= maxUsos)) {
        throw new BadRequestException({
          code: 'CUPOM_INVALIDO',
          message: 'Cupom invalido, inativo ou esgotado.',
        });
      }
      tx.update(cupomRef, { usos: usos + 1 });
      tx.set(db.collection('professores').doc(uid), update, { merge: true });
    });

    return {
      aplicado: true,
      tipo: cupom.tipo,
      planoAtual: update.planoAtual,
      cortesiaAte: update.cortesiaAte,
    };
  }
}
