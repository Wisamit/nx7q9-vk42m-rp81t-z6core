export type ChallengeFinalization = {
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  passwordChangedAt: Date | null;
  userStatus: string;
  organizationStatus: string;
  mfaEnabled: boolean;
  hasSecret: boolean;
};

/** A challenge cannot outlive a password rotation or be consumed twice. */
export function canFinalizeMfaChallenge(value: ChallengeFinalization, now: Date): boolean {
  return value.consumedAt === null &&
    value.expiresAt.getTime() > now.getTime() &&
    value.createdAt.getTime() <= now.getTime() &&
    (value.passwordChangedAt === null ||
      value.createdAt.getTime() > value.passwordChangedAt.getTime()) &&
    value.userStatus === "ACTIVE" &&
    value.organizationStatus === "ACTIVE" &&
    value.mfaEnabled && value.hasSecret;
}
