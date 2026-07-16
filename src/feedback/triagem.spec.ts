import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

/**
 * A armadilha desta task: um PATCH parcial nao pode apagar o que nao veio. O
 * admin muda o status e a nota em gestos separados — se o update montasse o
 * objeto com `dto.notaInterna` cru, mover o status para RESOLVIDO zeraria a
 * anotacao que explicava como o bug foi resolvido.
 */

const existente = new FeedbackEntity({
  id: 'fb1',
  professorId: 'uid-1',
  professorNome: 'Joao',
  professorEmail: 'joao@x.com',
  categoria: 'BUG',
  mensagem: 'quebrou',
  rota: '/turmas',
  userAgent: 'UA',
  status: 'PENDENTE',
  criadoEm: '2026-07-16T10:00:00.000Z',
  notaInterna: 'ja reproduzi no Safari',
});

function fakeRepo(achado: FeedbackEntity | null) {
  const updates: Partial<FeedbackEntity>[] = [];
  const repo = {
    findById: async () => achado,
    update: async (_id: string, data: Partial<FeedbackEntity>) => {
      updates.push(data);
    },
  } as unknown as FeedbackRepository;
  return { repo, updates };
}

function service(repo: FeedbackRepository): FeedbackService {
  return new FeedbackService(
    repo,
    {} as unknown as FirebaseService,
    { get: () => undefined } as unknown as ConfigService,
  );
}

describe('FeedbackService.atualizar', () => {
  it('PATCH so de status nao toca a nota interna', async () => {
    const { repo, updates } = fakeRepo(existente);

    const salvo = await service(repo).atualizar('fb1', { status: 'RESOLVIDO' });

    expect(updates[0]).not.toHaveProperty('notaInterna');
    expect(salvo.notaInterna).toBe('ja reproduzi no Safari');
    expect(salvo.status).toBe('RESOLVIDO');
  });

  it('PATCH so de nota nao toca o status', async () => {
    const { repo, updates } = fakeRepo(existente);

    const salvo = await service(repo).atualizar('fb1', { notaInterna: '  corrigido no PR #99  ' });

    expect(updates[0]).not.toHaveProperty('status');
    expect(salvo.status).toBe('PENDENTE');
    expect(salvo.notaInterna).toBe('corrigido no PR #99');
  });

  it('corpo vazio so carimba atualizadoEm', async () => {
    const { repo, updates } = fakeRepo(existente);

    await service(repo).atualizar('fb1', {});

    expect(Object.keys(updates[0])).toEqual(['atualizadoEm']);
  });

  it('id inexistente -> 404', async () => {
    const { repo } = fakeRepo(null);

    await expect(service(repo).atualizar('nao-existe', { status: 'RESOLVIDO' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('nota vazia e apagamento explicito, nao ausencia', async () => {
    const { repo, updates } = fakeRepo(existente);

    await service(repo).atualizar('fb1', { notaInterna: '' });

    expect(updates[0].notaInterna).toBe('');
  });
});
