/**
 * Proof of login identity ownership must survive the bcrypt delay.
 * Called after acquiring a portal account row lock and reloading current
 * contact fields and all matching tenant owners in the login transaction.
 */
export function portalLoginStillUniquelyOwned(
  account: { id:string; normalizedEmail:string|null; normalizedPhone:string|null },
  login:string,
  matchingAccountIds:readonly string[],
):boolean {
  return (account.normalizedEmail===login || account.normalizedPhone===login) &&
    matchingAccountIds.length===1 && matchingAccountIds[0]===account.id;
}
