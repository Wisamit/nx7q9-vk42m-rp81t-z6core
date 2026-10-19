import { readFileSync } from "node:fs";
const data = readFileSync("package-lock.json", "utf8");
const length = 2800;
const parts = Math.ceil(data.length / length);
console.log("FAMILY_LAB_LOCK_BEGIN|" + parts + "|" + data.length);
for (let i=0;i<parts;i++) {
  const part=data.slice(i*length,(i+1)*length);
  console.log("FAMILY_LAB_LOCK_CHUNK|" + i + "|" + JSON.stringify(part));
}
console.log("FAMILY_LAB_LOCK_END|" + parts);
