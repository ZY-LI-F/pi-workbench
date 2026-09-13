/** GUI transport metadata only; the official Pi payload is never rewritten. */
export interface RuntimeScope {
  readonly generation: string;
  readonly scope: number;
  readonly sequence: number;
  readonly cwd: string;
  readonly sessionId?: string;
  readonly sessionFile?: string;
}

export function sameRuntimeScope(a: RuntimeScope, b: RuntimeScope): boolean {
  return a.generation === b.generation && a.scope === b.scope;
}
