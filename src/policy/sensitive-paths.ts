const SENSITIVE_PATTERNS = [
  /^\.env$/,
  /^\.env\./,
  /^id_rsa$/,
  /^id_ed25519$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /^credentials\.json$/,
  /^secrets\./
];

export function isSensitivePath(path: string): boolean {
  const filename = path.split(/[\\/]/).at(-1) ?? path;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filename));
}
