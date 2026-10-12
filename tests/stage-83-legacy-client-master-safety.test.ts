import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LEGACY_MASTER_COLUMNS,
  LegacyMasterImportError,
  legacyMasterFingerprint,
  parseLegacyMasterCsv,
} from "../src/lib/legacy-master-data-import.ts";
import { createLegacyMasterRecords } from "../src/lib/legacy-master-import-commit.ts";

const header = "code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days";

test("Stage 83: bilingual clients retain exact explicit type, optional terms and contact/address details", () => {
  assert.equal(LEGACY_MASTER_COLUMNS.CLIENT.join(","),header);
  const [company,insurer] = parseLegacyMasterCsv("CLIENT",
    "\uFEFF"+header+"\r\n"+
    'HOSP_A,"Specialist, LLC",شركة طبية,COMPANY,+971500000000,INFO@Example.com,"Office, Block A",مكتب المركز,30\r\n'+
    'INS_B,Insurer B,شركة تأمين,INSURANCE,,,,,');
  assert.equal(company.code,"HOSP_A");
  assert.equal(company.nameEn,"Specialist, LLC");
  assert.equal(company.nameAr,"شركة طبية");
  assert.equal(company.clientType,"COMPANY");
  assert.equal(company.email,"info@example.com");
  assert.equal(company.addressEn,"Office, Block A");
  assert.equal(company.addressAr,"مكتب المركز");
  assert.equal(company.paymentTermsDays,30);
  assert.equal(insurer.clientType,"INSURANCE");
  assert.equal(insurer.paymentTermsDays,null);
  assert.equal(insurer.addressEn,null);
  assert.equal(insurer.phone,null);
});

test("Stage 83: no implicit financial terms or guessed client type; invalid lines fail before commit", () => {
  const row=(type:string,days:string,code="CLIENT1",extra="") =>
    header+"\n"+code+",Test,عميل,"+type+",,,,,"+days+extra;
  const invalid:Array<[string,string]> = [
    [row("UNKNOWN","30"),"invalid_client_type_row_2"],
    [row("","30"),"invalid_client_type_row_2"],
    [row("COMPANY","-1"),"invalid_payment_terms_row_2"],
    [row("COMPANY","3.5"),"invalid_payment_terms_row_2"],
    [row("COMPANY","3651"),"invalid_payment_terms_row_2"],
    [row("COMPANY","1e3"),"invalid_payment_terms_row_2"],
    [row("COMPANY","003"),"invalid_payment_terms_row_2"],
    [row("COMPANY","5",",EXTRA"),"column_count_mismatch_row_2"],
    [header+"\nA,X,,COMPANY,,,,,30\na,Y,,COMPANY,,,,,30","duplicate_code_in_csv_row_3"],
  ];
  for(const [csv,reason] of invalid)
    assert.throws(()=>parseLegacyMasterCsv("CLIENT",csv),(err:unknown)=>
      err instanceof LegacyMasterImportError && err.reason===reason,reason);
  assert.equal(parseLegacyMasterCsv("CLIENT",row("OTHER","0"))[0].paymentTermsDays,0);
  assert.equal(parseLegacyMasterCsv("CLIENT",row("INDIVIDUAL",""))[0].paymentTermsDays,null);
  assert.notEqual(
    legacyMasterFingerprint("ORG-A","CLIENT",parseLegacyMasterCsv("CLIENT",row("OTHER","30"))),
    legacyMasterFingerprint("ORG-A","CLIENT",parseLegacyMasterCsv("CLIENT",row("OTHER","90"))),
  );
  assert.notEqual(
    legacyMasterFingerprint("ORG-A","CLIENT",parseLegacyMasterCsv("CLIENT",row("OTHER","30"))),
    legacyMasterFingerprint("ORG-B","CLIENT",parseLegacyMasterCsv("CLIENT",row("OTHER","30"))),
  );
});

test("Stage 83: production write dispatch creates ONLY tenant client master fields, never contracts or financial transactions",async()=>{
  const record={id:randomUUID(),...parseLegacyMasterCsv("CLIENT",
    header+"\nC03,Care Group,مجموعة رعاية,HOSPITAL,05000000,hello@example.com,Office,المكتب,45")[0]};
  let created:Array<Record<string,unknown>> = [];
  const tx={client:{createMany:async({data}:{data:Array<Record<string,unknown>>})=>{
    created=data;return {count:data.length};
  }}};
  await createLegacyMasterRecords(tx as never,"CLIENT","TENANT-83",[record]);
  assert.equal(created.length,1);
  assert.equal(created[0].id,record.id);
  assert.equal(created[0].organizationId,"TENANT-83");
  assert.equal(created[0].type,"HOSPITAL");
  assert.equal(created[0].paymentTermsDays,45);
  assert.equal(created[0].addressAr,"المكتب");
  for(const unsafe of ["contractId","priceListId","openingBalance","creditLimit","invoiceTotal","referrerId"]){
    assert.equal(Object.hasOwn(created[0],unsafe),false,unsafe);
  }
});

test("Stage 83: server permission, explicit finance consent, preview and atomic audit are enforced",()=>{
  const route=readFileSync("src/app/api/legacy/master-data-import/route.ts","utf8");
  const ui=readFileSync("src/components/legacy-master-data-import.tsx","utf8");
  const page=readFileSync("src/app/catalog/legacy-master-data/page.tsx","utf8");
  const helper=readFileSync("src/lib/legacy-master-import-commit.ts","utf8");
  assert.match(route,/CLIENT: "clients.manage"/);
  assert.match(route,/db\.client\.findMany/);
  assert.match(route,/permissions\.has\(allowed\[kind\]\)/);
  assert.match(route,/CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS/);
  assert.match(route,/input\.expectedFingerprint !== fingerprint/);
  assert.match(route,/if \(mode === "PREVIEW"\)/);
  assert.match(route,/await prisma\.\$transaction\(async tx =>/);
  assert.match(route,/existingCodes\(tx, kind, organizationId, codes\)/);
  assert.match(route,/LEGACY_MASTER_DATA_IMPORT_COMMITTED/);
  assert.match(route,/LEGACY_MASTER_RECORD_CREATED/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(ui,/CLIENT: "code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days"/);
  assert.match(ui,/row\.paymentTermsDays/);
  assert.match(ui,/row\.clientType/);
  assert.match(ui,/CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS/);
  assert.match(page,/grants\.has\("clients.manage"\)/);
  assert.match(helper,/tx\.client\.createMany/);
  assert.doesNotMatch(helper,/tx\.client\.update/);
  assert.doesNotMatch(helper,/skipDuplicates:\s*true/);
});
