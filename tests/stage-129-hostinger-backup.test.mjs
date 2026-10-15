import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, chmod, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { backupEncryptionKey, encryptBackupStream, verifyEncryptedBackup, decryptBackupToSink } from "../scripts/operations/backup-archive.mjs";
import { parseBackupDatabaseUrl, dumpDefaultsFile, backupOffsiteLocation, createBackup, verifyBackupArchive } from "../scripts/operations/create-encrypted-backup.mjs";
import { recoveryDatabaseName } from "../scripts/operations/restore-isolated-backup.mjs";

const KEY = randomBytes(32).toString("hex");
test("Stage 129: encrypted SQL archive authenticates metadata, contents, and rejects any bit flip", async t => {
  const dir = await mkdtemp(join(tmpdir(),"fl129-archive-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const target=join(dir,"synthetic.flbak");
  const sql=Buffer.from("CREATE TABLE restore_probe (id INT);\\nINSERT INTO restore_probe VALUES (5);\\n");
  const meta=await encryptBackupStream(Readable.from([sql]),target,backupEncryptionKey(KEY));
  assert.ok(meta.sizeBytes>32);
  assert.equal((await verifyEncryptedBackup(target,backupEncryptionKey(KEY),meta)).plainBytes,sql.length);
  const collected=[];
  await decryptBackupToSink(target,backupEncryptionKey(KEY),new Writable({
    write(chunk,_encoding,done){collected.push(Buffer.from(chunk));done();}
  }));
  assert.deepEqual(Buffer.concat(collected),sql);
  const ciphertext=await readFile(target);
  assert.equal(ciphertext.includes(Buffer.from("restore_probe")),false);
  await assert.rejects(verifyEncryptedBackup(target,backupEncryptionKey(randomBytes(32).toString("hex")),meta));
  await assert.rejects(verifyEncryptedBackup(target,backupEncryptionKey(KEY),{...meta,sizeBytes:0}),/BACKUP_MANIFEST_MISMATCH/);
  ciphertext[ciphertext.length-24]^=0x01;
  await writeFile(target,ciphertext);
  await assert.rejects(verifyEncryptedBackup(target,backupEncryptionKey(KEY),meta),/BACKUP_ARCHIVE_HASH_MISMATCH/);
  await assert.rejects(verifyEncryptedBackup(target,backupEncryptionKey(KEY)));
  assert.throws(()=>backupEncryptionKey("bad"),/BACKUP_KEY_32_BYTE_HEX_REQUIRED/);
  assert.throws(()=>backupEncryptionKey("0".repeat(64)),/BACKUP_KEY_WEAK/);
});
test("Stage 129: database credentials never enter argv, and remote host requires verified TLS CA",()=>{
  const dsn=parseBackupDatabaseUrl("mysql://backup:p%40ss%22test@127.0.0.1:3306/family_lab_ci");
  assert.equal(dsn.password,'p@ss"test');
  const cnf=dumpDefaultsFile(dsn);
  assert.ok(cnf.includes("password="));
  assert.ok(cnf.includes('\\\\\\"'));
  assert.throws(()=>parseBackupDatabaseUrl("mysql://backup:test@db.example.org:3306/production"),/BACKUP_REMOTE_DATABASE_CA_REQUIRED/);
  assert.throws(()=>parseBackupDatabaseUrl("mysql://backup:test@127.0.0.1:3306/x;DROP"),/BACKUP_DATABASE_URL_INVALID/);
  assert.throws(()=>parseBackupDatabaseUrl("mysql://backup:bad%0Ahost@127.0.0.1:3306/clinical"),/BACKUP_DATABASE_CREDENTIAL_INVALID/);
  const file="family-lab-2026-10-15T10-45-00-000Z-00000000-0000-4000-8000-000000000001.flbak";
  assert.equal(backupOffsiteLocation("secure-remote:lab/backups",file),"secure-remote:lab/backups/"+file);
  assert.throws(()=>backupOffsiteLocation("backup:../../webroot",file),/BACKUP_OFFSITE_REMOTE_INVALID/);
  assert.throws(()=>backupOffsiteLocation("backup:lab/backups","../../.env"),/BACKUP_ARCHIVE_NAME_INVALID/);
});
test("Stage 129: local-only encrypted backup requires explicit opt-in, verifiable but never claims restore",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"fl129-runner-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const fake=join(dir,"synthetic-mariadb-dump");
  const sink=join(dir,"private-backup");
  await writeFile(fake, "#!/usr/bin/env node\n"+
    "process.stdout.write('CREATE TABLE synthetic_only(id INT);\\\\nINSERT INTO synthetic_only VALUES(1);\\\\n');\n");
  await chmod(fake,0o700);
  const env={DATABASE_URL:"mysql://synthetic:fixture@127.0.0.1:3306/family_lab_ci",
    FAMILY_LAB_BACKUP_KEY:KEY,FAMILY_LAB_BACKUP_DIR:sink,
    FAMILY_LAB_DUMP_BINARY:fake};
  await assert.rejects(createBackup(env),/BACKUP_OFFSITE_REQUIRED/);
  const result=await createBackup({...env,FAMILY_LAB_BACKUP_ALLOW_LOCAL_ONLY:"true"});
  assert.equal(result.status,"LOCAL_ONLY_DEVELOPMENT");
  assert.equal(result.restored,false);
  const archive=join(sink,result.archiveName);
  const info=await verifyBackupArchive(archive,env);
  assert.equal(info.status,"DECRYPTION_VERIFIED_NOT_RESTORED");
  assert.equal(info.restored,false);
  const names=await readdir(sink);
  assert.deepEqual(names.sort(),[result.archiveName,result.archiveName+".manifest.json"].sort());
  if(process.platform!=="win32")assert.equal((await stat(archive)).mode&0o777,0o600);
  const file=await readFile(archive);
  assert.equal(file.includes(Buffer.from("synthetic_only")),false);
});

test("Stage 129: isolated restore target is always a NEW named scratch database",()=>{
  assert.equal(recoveryDatabaseName("family_lab_restore_20261015_a","family_lab_lis"),
    "family_lab_restore_20261015_a");
  for(const value of ["family_lab_lis","family_lab_restore_a","family_lab_restore_../prod",
    "family_lab_restore_20261015;DROP","production"]){
    assert.throws(()=>recoveryDatabaseName(value,"family_lab_lis"),/RESTORE_DATABASE_NOT_ISOLATED/);
  }
});
