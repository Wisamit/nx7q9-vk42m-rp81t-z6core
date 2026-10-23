/**
 * CAS guard shared by incorrect-code accounting and successful OTP claiming.
 * Pre-read checks are advisory: a simultaneous request can consume or exhaust
 * the challenge during bcrypt comparison. MariaDB must enforce every limit
 * in the actual UPDATE, including expiration evaluated after comparison.
 */
export function portalOtpAttemptGuard(challenge: {
  id:string;
  portalAccountId:string;
  codeHash:string;
  destination:string;
  maxAttempts:number;
}, now:Date) {
  return {
    id:challenge.id,
    portalAccountId:challenge.portalAccountId,
    purpose:"VERIFY_CONTACT" as const,
    codeHash:challenge.codeHash,
    destination:challenge.destination,
    consumedAt:null,
    expiresAt:{gt:now},
    attempts:{lt:challenge.maxAttempts},
  };
}
