export const PI_SKILL_INSTALL_SCOPES = ["project", "user"] as const;
export type PiSkillInstallScope = (typeof PI_SKILL_INSTALL_SCOPES)[number];

export interface InstalledPiSkill {
  readonly name: string;
  readonly description: string;
  readonly scope: PiSkillInstallScope;
  readonly destination: string;
}

export type PiSkillInstallResult =
  | { readonly cancelled: true }
  | {
      readonly cancelled: false;
      readonly skill: InstalledPiSkill;
      readonly reloadedAt: string;
    };

export function isPiSkillInstallScope(value: unknown): value is PiSkillInstallScope {
  return typeof value === "string" && (PI_SKILL_INSTALL_SCOPES as readonly string[]).includes(value);
}
