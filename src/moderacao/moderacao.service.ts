import { Injectable } from '@nestjs/common';
import Piii from 'piii';
import piiiFilters from 'piii-filters';

/**
 * Palavrões que o dicionário da `piii` não cobre (ele só traz seis raízes).
 * Formato da `piii`: `[raiz, sufixos?]`, só letras ASCII — a acentuação é
 * removida por ela antes de comparar, então "desgraçado" casa com "desgracad".
 */
const COMPLEMENTO: Array<[string] | [string, string[]]> = [
  ['merd', ['a', 'as', 'inha']],
  ['bost', ['a', 'as']],
  ['arrombad', ['o', 'a', 'os', 'as']],
  ['desgracad', ['o', 'a', 'os', 'as']],
  ['otari', ['o', 'a', 'os', 'as']],
  ['babac', ['a', 'as']],
  ['viad', ['o', 'os', 'inho']],
  ['pirok', ['a']],
  ['picu', ['a']],
  ['buceta'],
  ['cacete'],
  ['fdp'],
  ['vsf'],
  ['tnc'],
  ['pqp'],
];

/** Leet speak: número/símbolo no lugar da letra ("p0rra", "m3rda"). */
const ALIASES = {
  a: ['4', '@'],
  e: ['3'],
  i: ['1', '!'],
  o: ['0'],
  s: ['5', '$'],
};

/**
 * Filtro de linguagem imprópria para textos livres dos alunos. A decisão é só
 * do servidor: o cliente nunca é consultado sobre o que é ou não palavrão.
 *
 * Isolado em módulo próprio para servir a outros textos livres (debate do
 * Isolateus, por exemplo) sem acoplar ao Wor.
 */
@Injectable()
export class ModeracaoService {
  private readonly filtro = new Piii({
    filters: [...Object.values(piiiFilters), ...COMPLEMENTO],
    aliases: ALIASES,
  });

  contemPalavrao(texto: string): boolean {
    if (!texto?.trim()) return false;
    return this.filtro.has(texto);
  }
}
