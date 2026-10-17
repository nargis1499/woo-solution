/**
 * Password rules and the generator behind the dashboard's "New user" dialog.
 *
 * `PASSWORD_MIN` is the rule the server enforces; the generator produces something much
 * longer than that (20 characters, one from each character class), using `crypto` so the
 * value cannot be predicted from the clock or a seeded PRNG.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_LENGTH = 20;

// Look-alike characters (0/O, 1/l/I) are left out – a password that has to be read out
// loud or typed from a note is better off without them.
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";

/** One character from `set`, unbiased: bytes above the last whole multiple are redrawn. */
function pick(set: string): string {
  const floor = Math.floor(256 / set.length) * set.length;
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= floor);
  return set[bytes[0] % set.length];
}

/** Fisher–Yates, so the guaranteed classes are not always the first four characters. */
function shuffle(value: string[]): string[] {
  const bytes = new Uint32Array(value.length);
  crypto.getRandomValues(bytes);
  for (let i = value.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [value[i], value[j]] = [value[j], value[i]];
  }
  return value;
}

/** A strong random password: `length` characters, at least one of every class. */
export function generatePassword(length = PASSWORD_LENGTH): string {
  const mandatory = [LOWER, UPPER, DIGITS, SYMBOLS].map(pick);
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const rest = Array.from({ length: Math.max(0, length - mandatory.length) }, () => pick(all));
  return shuffle([...mandatory, ...rest]).join("");
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; tone: "destructive" | "warning" | "success" | "muted" };

/**
 * A deliberately simple strength read-out for the dialog: length does most of the work,
 * character variety adds the rest. It is advice, not a gate – the server only enforces
 * `PASSWORD_MIN` plus a letter and a number.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "", tone: "muted" };

  let score = 0;
  if (password.length >= PASSWORD_MIN) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) score++;
  if (password.length < PASSWORD_MIN) score = Math.min(score, 1);

  const level = Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
  const labels: Record<1 | 2 | 3 | 4, string> = { 1: "Weak", 2: "Fair", 3: "Good", 4: "Strong" };
  const tones: Record<1 | 2 | 3 | 4, PasswordStrength["tone"]> = { 1: "destructive", 2: "warning", 3: "success", 4: "success" };
  return { score: level, label: labels[level], tone: tones[level] };
}

/** Server-side rule: long enough, with at least one letter and one digit. */
export function passwordProblem(password: string): string | null {
  if (!password) return "Enter a password.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Mix letters and numbers.";
  return null;
}
