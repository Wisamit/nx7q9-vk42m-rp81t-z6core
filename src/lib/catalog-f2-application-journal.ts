import {createHmac,timingSafeEqual} from "node:crypto";
import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";

const PURPOSE="family-lab/catalog-f2-application-journal/v1\n";
const SHA=/^[0-9a-f]{64}$/;
const record=(v:unknown):v is Record<string,unknown>=>
  !!v && typeof v==="object"&&!Array.isArray(v);
/**
 * HMAC every full before/after version record and the batch closeout.
 * A plain SHA digest of values does not authenticate database audit history.
 * The signing key is server-owned, independent of row identifiers.
 */
export function signF2ApplicationJournal(
  values:Record<string,unknown>,secret:string,
):Record<string,unknown>{
  if(!secret||Buffer.byteLength(secret,"utf8")<32||
     Object.hasOwn(values,"seal"))throw Error("f2_journal_invalid_sign_input");
  const signature=createHmac("sha256",secret).update(PURPOSE)
    .update(canonicalJson(values as Json)).digest("hex");
  return {...values,seal:{version:1,algorithm:"HMAC-SHA256",signature}};
}
export function verifyF2ApplicationJournal(
  input:unknown,secret:string,
):Record<string,unknown>|null{
  if(!record(input)||!record(input.seal)||
     Object.keys(input.seal).sort().join(",")!=="algorithm,signature,version"||
     input.seal.version!==1||input.seal.algorithm!=="HMAC-SHA256"||
     typeof input.seal.signature!=="string"||!SHA.test(input.seal.signature)||
     !secret||Buffer.byteLength(secret,"utf8")<32)
    return null;
  const unsigned=Object.fromEntries(
    Object.entries(input).filter(([k])=>k!=="seal"));
  try{
    const check=signF2ApplicationJournal(unsigned,secret).seal as {signature:string};
    return timingSafeEqual(Buffer.from(input.seal.signature,"hex"),
      Buffer.from(check.signature,"hex"))?unsigned:null;
  }catch{return null;}
}
