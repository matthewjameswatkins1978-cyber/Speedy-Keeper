/**
 * Secret and bulk-output guards.
 * The core rejects obvious secrets and oversized bodies instead of storing
 * raw sensitive tool output. Patterns are deliberately high-signal to avoid
 * false positives on ordinary engineering notes.
 */

export const MAX_TITLE_CHARS = 300;
export const MAX_BODY_CHARS = 8000;
export const MAX_SOURCES = 50;
export const MAX_SOURCE_CHARS = 500;
export const MAX_TASK_SCOPE_CHARS = 200;

interface SecretPattern {
  name: string;
  re: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { name: 'github-token', re: /\bgh[pous]_[A-Za-z0-9]{8,}\b/ },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{10,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws-secret-key', re: /aws_secret_access_key\s*[:=]\s*\S+/i },
  { name: 'slack-token', re: /\bxox[bpas]-[A-Za-z0-9-]{8,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z\-_]{20,}\b/ },
  { name: 'bearer-token', re: /bearer\s+[A-Za-z0-9\-._~+/]{20,}/i },
  { name: 'password-assignment', re: /\bpassword\s*[:=]\s*\S{4,}/i },
];

/** Returns the matched pattern name, or null when the text looks safe. */
export function containsSecret(text: string): string | null {
  for (const p of PATTERNS) {
    if (p.re.test(text)) return p.name;
  }
  return null;
}

/**
 * Throws an Error naming the offending pattern class (never echoing the
 * secret itself) when any field looks like it carries a secret.
 */
export function assertNoSecrets(fields: Array<string | null | undefined>): void {
  const joined = fields.filter((f): f is string => typeof f === 'string').join('\n');
  const hit = containsSecret(joined);
  if (hit !== null) {
    throw new Error(
      `secret-rejected: input looks like it contains a ${hit}; ` +
        `store a reference to where the secret lives, not the secret itself`,
    );
  }
}
