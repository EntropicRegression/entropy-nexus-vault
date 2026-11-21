/**
 * Masks text that looks like a key, token or password, with the same rules the console applies before it writes a
 * memory (console repo src/main/memory-write.ts maskSecrets). Used for the rainbow award reason (M5c review B6).
 */
export const secretMask = '[已遮罩]';

const secretPatterns: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];
/** "password = xxx", "api_key: xxx", "密碼:xxx": the key stays, only the value is masked. */
const secretKeyValue = /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token|密碼|金鑰|權杖)\s*[:=：]\s*)(["']?)([A-Za-z0-9_\-+/=.~!@#$%^&*]{6,})\2/gi;

export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = String(text ?? '');
  for (const pattern of secretPatterns) out = out.replace(pattern, () => { masked++; return secretMask; });
  out = out.replace(secretKeyValue, (_match, key: string, quote: string) => { masked++; return key + quote + secretMask + quote; });
  return { text: out, masked };
}
