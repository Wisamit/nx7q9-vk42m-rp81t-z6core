import {parseSystemLocalDateTime} from "./system-date-time.ts";

/**
 * Resolve an appointment wall-clock time against its selected branch zone.
 * Never rely on the browser/server machine timezone when saving appointments.
 *
 * A DST gap has zero possible instants and a DST overlap has two. Reject both
 * rather than silently changing a clinical visit's requested clock time.
 */
export function resolveBranchLocalDateTime(
  localDateTime:string, timeZone:string,
): Date | null {
  const parsed=parseSystemLocalDateTime(localDateTime);
  if(!parsed.date || !parsed.time)return null;
  const wallMs=Date.parse(parsed.date+"T"+parsed.time+":00.000Z");
  if(!Number.isFinite(wallMs))return null;

  let formatter:Intl.DateTimeFormat;
  try {
    formatter=new Intl.DateTimeFormat("en-GB",{
      timeZone,year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23",
    });
  } catch {
    return null;
  }

  const fields=(utcMs:number)=>{
    const parts=formatter.formatToParts(new Date(utcMs));
    const part=(type:Intl.DateTimeFormatPartTypes)=>
      parts.find(item=>item.type===type)?.value ?? "";
    const year=part("year"),month=part("month"),day=part("day");
    const hour=part("hour"),minute=part("minute");
    return {
      wall:year+"-"+month+"-"+day+"T"+hour+":"+minute,
      asUtcMs:Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute)),
    };
  };

  const candidates=new Set<number>();
  try {
    // Probe both sides of the intended wall clock for zone offsets, including
    // DST transitions. All comparisons use real instants and ICU zone rules.
    for(let offsetHours=-36;offsetHours<=36;offsetHours+=6){
      const probeMs=wallMs+offsetHours*60*60_000;
      const offsetMs=fields(probeMs).asUtcMs-probeMs;
      const candidateMs=wallMs-offsetMs;
      if(fields(candidateMs).wall===localDateTime)candidates.add(candidateMs);
    }
  } catch {
    return null;
  }
  if(candidates.size!==1)return null;
  return new Date([...candidates][0]);
}
