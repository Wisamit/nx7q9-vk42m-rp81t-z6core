import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const manifestPath=path.join(ROOT,"docs/UI_ROUTE_MANIFEST.json");
const stagingHost=/(?:^localhost$|^127\.0\.0\.1$|(?:^|[.-])(?:staging|test|qa|synthetic|preview)(?:[.-]|$))/i;

export const viewports=[
 {id:"desktop-en-light",width:1440,height:900,lang:"en",theme:"light"},
 {id:"desktop-ar-dark",width:1440,height:900,lang:"ar",theme:"dark"},
 {id:"mobile-en-light",width:390,height:844,lang:"en",theme:"light"},
 {id:"mobile-ar-dark",width:390,height:844,lang:"ar",theme:"dark"},
];

export function classifyRoute(route) {
 if(route==="/"||route==="/login"||route==="/setup"||route==="/portal/login"||
    route.startsWith("/verify/report/")||route.startsWith("/queue-display/"))return "PUBLIC";
 if(route==="/portal"||route.startsWith("/portal/"))return "PORTAL";
 return "STAFF";
}
export function assertSyntheticBase(raw) {
 if(!raw)throw Error("UI_QA_BASE_URL is required.");
 let url;
 try{url=new URL(raw);}catch{throw Error("Invalid staging URL.");}
 if(!stagingHost.test(url.hostname))throw Error("Refusing production-like URL: use isolated staging/test/qa/synthetic/preview or localhost.");
 if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname)))
   throw Error("Staging must use HTTPS; localhost may use HTTP.");
 if(url.pathname!=="/"||url.search||url.hash)throw Error("Use staging origin only, without URL path/query.");
 return url.origin;
}
export function resolveFixture(route,fixtures) {
 const actual=route.includes("[")?fixtures[route]:route;
 if(typeof actual!=="string"||!actual.startsWith("/")||actual.startsWith("//")||
   /[\\?#\[\]]/.test(actual)||actual.split("/").includes(".."))throw Error("Missing or unsafe synthetic fixture for "+route);
 const a=route.split("/"),b=actual.split("/");
 if(a.length!==b.length||a.some((part,i)=>!part.startsWith("[")&&part!==b[i]))
   throw Error("Fixture must match the canonical route shape for "+route);
 return actual;
}
export function planScreens(fixtures={}) {
 const source=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
 if(source.expectedRouteCount!==source.routes.length||source.routes.length!==81)throw Error("81-route manifest changed without review.");
 const errors=[];
 const routes=source.routes.map(row=>{
   let pathname;
   try{pathname=resolveFixture(row.route,fixtures);}
   catch(error){errors.push(error.message);}
   return {route:row.route,pathname:pathname||null,kind:classifyRoute(row.route),
    rendered:"NOT_EXECUTED",screenshot:"NOT_CAPTURED",browserReview:"NOT_SIGNED_OFF"};
 });
 for(const extra of Object.keys(fixtures))if(!source.routes.some(row=>row.route===extra))errors.push("Unknown fixture: "+extra);
 return {total:routes.length,viewports,errors,routes};
}

async function login(page,base,profile,kind){
 if(kind==="STAFF"){
  if(!profile?.username||!profile?.password)throw Error("A synthetic staff profile must have username and password.");
  await page.goto(base+"/login");
  await page.locator('input[name="username"]').fill(profile.username);
  await page.locator('input[name="password"]').fill(profile.password);
  await page.locator("form button.primary-button").click();
  await page.waitForURL(url=>url.pathname==="/dashboard",{timeout:12000}).catch(()=>{throw Error("Staff staging login failed or requires MFA; never bypass MFA.");});
 }else if(kind==="PORTAL"){
  if(!profile?.organizationCode||!profile?.login||!profile?.password)throw Error("Synthetic portal credentials missing.");
  await page.goto(base+"/portal/login");
  for(const key of ["organizationCode","login","password"])await page.locator('input[name="'+key+'"]').fill(profile[key]);
  await page.locator("form button.primary-button").click();
  await page.waitForURL(url=>url.pathname==="/portal"||url.pathname==="/portal/change-password",{timeout:12000})
    .catch(()=>{throw Error("Synthetic portal login failed.");});
  if(new URL(page.url()).pathname==="/portal/change-password")
    throw Error("Portal staging account must complete a legitimate mandatory password change before screenshots.");
 }
}
async function setStaffLocale(page,wanted) {
 const shell=page.locator(".system-shell");
 if(!await shell.count())return false;
 const expected=wanted==="ar"?"rtl":"ltr";
 if((await shell.getAttribute("dir"))!==expected){
  const toggle=page.locator(".system-locale-toggle");
  if(!await toggle.count())return false;
  await toggle.click();
  await page.waitForTimeout(850);
 }
 return (await shell.getAttribute("dir"))===expected;
}

export async function executeScreenshots(){
 if(process.env.UI_QA_SYNTHETIC_ATTESTATION!=="ISOLATED_SYNTHETIC_ONLY")
   throw Error("Refusing patient data exposure: certify isolated synthetic-only staging in UI_QA_SYNTHETIC_ATTESTATION.");
 const base=assertSyntheticBase(process.env.UI_QA_BASE_URL);
 const fixtures=JSON.parse(process.env.UI_QA_FIXTURE_ROUTES_JSON||"{}");
 const plan=planScreens(fixtures);
 if(plan.errors.length)throw Error("All 81 routes require valid synthetic fixtures:\n"+plan.errors.join("\n"));
 const staff=JSON.parse(process.env.UI_QA_STAFF_PROFILES_JSON||"[]");
 const portal=JSON.parse(process.env.UI_QA_PORTAL_PROFILE_JSON||"null");
 if(!Array.isArray(staff)||staff.length<2||new Set(staff.map(x=>x.branch)).size<2||
   new Set(staff.map(x=>x.role)).size<2||staff.some(x=>!x.username||!x.password||!x.branch||!x.role))
   throw Error("Require at least two independent synthetic staff roles on two branches.");
 if(!portal?.organizationCode||!portal.login||!portal.password)
   throw Error("A synthetic portal account is required.");
 // Optional in ordinary CI. Real browser evidence is produced ONLY when the
 // separate staging workflow intentionally installs Playwright and calls --run.
 const {chromium}=await import("playwright");
 const out=path.resolve(process.env.UI_QA_OUTPUT_DIR||"ui-evidence/browser-sweep");
 fs.mkdirSync(out,{recursive:true});
 const report={sourceRouteCount:81,generatedAt:new Date().toISOString(),
  status:"NOT_SIGNED_OFF",syntheticOnly:true,records:[],issues:[]};
 const browser=await chromium.launch({headless:true});
 try{
  const profiles=[
   ...staff.map((credentials,i)=>({kind:"STAFF",name:"staff-"+i,credentials})),
   {kind:"PORTAL",name:"portal",credentials:portal},
   {kind:"PUBLIC",name:"public",credentials:null},
  ];
  for(const profile of profiles){
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   const page=await context.newPage();
   try{
    await login(page,base,profile.credentials,profile.kind);
    for(const entry of plan.routes.filter(x=>x.kind===profile.kind)){
     for(const viewport of viewports){
      const item={route:entry.route,profile:profile.name,variant:viewport.id,
       status:"NOT_EXECUTED",reason:null,screenshot:null,overflowPixels:0};
      try{
       await page.setViewportSize({width:viewport.width,height:viewport.height});
       const response=await page.goto(base+entry.pathname,{waitUntil:"domcontentloaded",timeout:25000});
       await page.waitForTimeout(550);
       const finalPath=new URL(page.url()).pathname;
       if(!response||response.status()>=400||finalPath!==entry.pathname){
         item.reason="bad-response-or-redirect";report.issues.push(item);
       }else if(profile.kind==="STAFF"&&!(await setStaffLocale(page,viewport.lang))){
         item.reason="requested-rtl-ltr-not-applied";report.issues.push(item);
       }else if(profile.kind!=="STAFF"&&!(await page.evaluate(expected=>{
         const element=document.querySelector("main[dir],.catalog-shell[dir],.auth-shell[dir]");
         return element?.getAttribute("dir")===(expected==="ar"?"rtl":"ltr");
       },viewport.lang))){
         item.reason="public-or-portal-language-unverified";report.issues.push(item);
       }else{
         await page.evaluate(theme=>{
           window.localStorage.setItem("family-lab-theme",theme);
           document.documentElement.dataset.theme=theme;
         },viewport.theme);
         item.overflowPixels=await page.evaluate(()=>
           Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth));
         const slug=(entry.route==="/"?"root":entry.route.slice(1)).replace(/[^a-zA-Z0-9_-]/g,"-");
         const filename=slug+"-"+profile.name+"-"+viewport.id+".png";
         await page.screenshot({path:path.join(out,filename),fullPage:true,animations:"disabled"});
         item.status="CAPTURED_UNREVIEWED";
         item.screenshot=filename;
         if(item.overflowPixels>2){item.reason="horizontal-overflow";report.issues.push(item);}
        }
      }catch(error){
       item.reason="browser-navigation-or-render-error";
       report.issues.push(item);
      }
      report.records.push(item);
     }
    }
   }finally{await context.close();}
  }
 }finally{
  await browser.close();
  report.total=report.records.length;
  report.captured=report.records.filter(x=>x.status==="CAPTURED_UNREVIEWED").length;
  report.note="Screenshots are NOT qualified visual acceptance, accessibility signoff or clinical release GO.";
  fs.writeFileSync(path.join(out,"browser-audit.json"),JSON.stringify(report,null,2)+"\n");
  console.log("Screenshots: "+report.captured+"/"+report.total+"; issues: "+report.issues.length+
    ". No automatic UI signoff.");
 }
 if(report.issues.length)throw Error("Unresolved synthetic browser smoke issues.");
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes("--plan")){
  const plan=planScreens(JSON.parse(process.env.UI_QA_FIXTURE_ROUTES_JSON||"{}"));
  console.log(JSON.stringify({total:plan.total,missingFixtures:plan.errors,
    allScreensUnreviewed:plan.routes.every(x=>x.rendered==="NOT_EXECUTED"),
    variants:plan.viewports.map(x=>x.id)},null,2));
 }else if(process.argv.includes("--run")){
  executeScreenshots().catch(error=>{console.error(error.message);process.exitCode=1;});
 }else{console.error("Usage: node scripts/ui-browser-acceptance.mjs --plan | --run");process.exitCode=2;}
}
