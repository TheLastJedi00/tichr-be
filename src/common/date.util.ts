/**
 * Utilitarios de data operando sobre strings 'YYYY-MM-DD'.
 *
 * Trabalhamos em UTC para eliminar off-by-one causado por fuso/horario de
 * verao — a data e sempre tratada como um "dia de calendario", nao um instante.
 */

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string): boolean {
  if (!ISO_REGEX.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Dia da semana: 0 = Domingo .. 6 = Sabado. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso: string, amount: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + amount);
  return toISO(date);
}

export function toISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
