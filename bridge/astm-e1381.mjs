/**
 * ASTM E1381 low-level frame integrity checker.
 *
 * This module checks a complete set of already assembled frames. It does NOT
 * drive serial ENQ/ACK/NAK/EOT or send ACKs to the analyzer. That state machine,
 * retry timer and device-specific electrical/serial parameters belong to a
 * separate approved transport adapter.
 */
const STX=0x02, ETX=0x03, ETB=0x17, CR=0x0d, LF=0x0a;
function invalid(reason){const error=new Error(reason);error.code=reason;throw error;}

export function parseE1381Frame(frame) {
  if(!Buffer.isBuffer(frame) || frame.length<7 || frame[0]!==STX) invalid("ASTM_FRAME_INVALID");
  if(frame.at(-2)!==CR || frame.at(-1)!==LF) invalid("ASTM_FRAME_TERMINATOR_INVALID");
  const mark=frame.length-5;
  const terminal=frame[mark];
  if(terminal!==ETX && terminal!==ETB) invalid("ASTM_FRAME_END_MARKER_INVALID");
  const number=frame[1]-0x30;
  if(number<0||number>7)invalid("ASTM_FRAME_NUMBER_INVALID");
  const submitted=frame.subarray(mark+1,mark+3).toString("ascii");
  if(!/^[0-9A-Fa-f]{2}$/.test(submitted))invalid("ASTM_FRAME_CHECKSUM_ENCODING_INVALID");
  let sum=0;
  for(const byte of frame.subarray(1,mark+1))sum=(sum+byte)&0xff;
  const expected=sum.toString(16).toUpperCase().padStart(2,"0");
  if(submitted.toUpperCase()!==expected)invalid("ASTM_FRAME_CHECKSUM_INVALID");
  return {frameNumber:number,final:terminal===ETX,payload:frame.subarray(2,mark)};
}

export function decodeE1381Message(frames,{firstFrameNumber=1,maxBytes=1000000}={}) {
  if(!Array.isArray(frames)||frames.length===0||frames.length>4096)invalid("ASTM_FRAME_COUNT_INVALID");
  if(!Number.isInteger(firstFrameNumber)||firstFrameNumber<0||firstFrameNumber>7)invalid("ASTM_FIRST_FRAME_INVALID");
  const payloads=[];
  let size=0,expectedNumber=firstFrameNumber;
  for(let i=0;i<frames.length;i++){
    const frame=parseE1381Frame(frames[i]);
    if(frame.frameNumber!==expectedNumber)invalid("ASTM_FRAME_SEQUENCE_INVALID");
    if(frame.final !== (i===frames.length-1))invalid("ASTM_FRAME_FINALITY_INVALID");
    expectedNumber=(expectedNumber+1)%8;
    size+=frame.payload.length;
    if(size>maxBytes)invalid("ASTM_FRAME_PAYLOAD_TOO_LARGE");
    payloads.push(frame.payload);
  }
  const buffer=Buffer.concat(payloads);
  // Binary/proprietary character encodings must be handled by an approved
  // vendor decoder, never by lossy U+FFFD replacement.
  const raw=new TextDecoder("utf-8",{fatal:true}).decode(buffer);
  if(!raw.startsWith("H|") || !raw.trimEnd().endsWith("L|1")) invalid("ASTM_MESSAGE_RECORD_SEQUENCE_INVALID");
  return raw;
}
