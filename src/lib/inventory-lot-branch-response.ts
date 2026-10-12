export const lotResponseActions=["NOTICE_RECEIVED","STOCK_ISOLATED","ESCALATED_TO_QUALITY"] as const;
export type LotResponseAction=typeof lotResponseActions[number];
export function validLotResponse(value:unknown):value is LotResponseAction {
 return typeof value==="string"&&lotResponseActions.some(a=>a===value);
}
export function lotResponseNote(value:unknown):string|null {
 if(typeof value!=="string"||value!==value.trim()||value.length<20||value.length>1000||
   /[\u0000-\u001f\u007f]/.test(value))return null;
 return value;
}
