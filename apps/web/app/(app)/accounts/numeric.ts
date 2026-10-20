/** True for a finished number typed into a form field: not empty, not "12abc". */
export const isNumeric = (s: string) => s.trim() !== "" && Number.isFinite(Number(s));
