/**
 * Utilitarios de horario operando sobre strings 'HH:mm' (relogio de 24h).
 * Convertem para minutos desde a meia-noite para facilitar aritmetica de grade.
 */

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHora(value: string): boolean {
  return HORA_REGEX.test(value);
}

/** 'HH:mm' -> minutos desde a meia-noite. */
export function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** minutos desde a meia-noite -> 'HH:mm'. */
export function minutosParaHora(min: number): string {
  const total = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
