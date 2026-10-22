import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseLegacySourceCoverage, LEGACY_COVERAGE_MAX_BYTES,
} from "../../src/lib/legacy-source-coverage.ts";
import {
  parseLegacyRowManifest, LEGACY_ROW_LINEAGE_MAX_BYTES,
} from "../../src/lib/catalog-legacy-row-lineage.ts";
import {
  verifyLegacyEvidenceManifestPackage,
} from "../../src/lib/legacy-evidence-package-review.ts";

/** Private local check. No raw MDB rows or personal data leave this process. */
async function safeJson(path, maxBytes) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
    throw new Error("evidence_file_invalid");
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadLineagePages(pageDirectory) {
  const stat = await lstat(pageDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("evidence_directory_invalid");
  const names = await readdir(pageDirectory);
  if (names.length < 1 || names.length > 6000 ||
      names.some(name => !/^legacy-row-hashes-[A-Za-z0-9_]+-[0-9]{5}\.json$/.test(name)))
    throw new Error("unexpected_evidence_page_name");
  const lineage = [];
  for (const name of names) {
    const page = parseLegacyRowManifest(
      await safeJson(join(pageDirectory, name), LEGACY_ROW_LINEAGE_MAX_BYTES));
    const expectedName = "legacy-row-hashes-" +
      page.tableName.replace(/[^A-Za-z0-9]/g, "_") + "-" +
      String(page.chunkIndex).padStart(5, "0") + ".json";
    if (name !== expectedName) throw new Error("evidence_page_filename_mismatch");
    lineage.push(page);
  }
  return lineage;
}

export async function checkPrivateLegacyEvidencePackage(
  mdbPath, coveragePath, pageDirectory, replayDirectory,
) {
  if (!/\.mdb$/i.test(basename(mdbPath))) throw new Error("mdb_extension_invalid");
  const start = await lstat(mdbPath);
  if (!start.isFile() || start.isSymbolicLink() || start.size < 4096 ||
      start.size > 1_000_000_000) throw new Error("mdb_file_invalid");
  const file = await open(mdbPath, "r");
  try {
    const buffer = Buffer.alloc(20);
    await file.read(buffer, 0, 20, 0);
    if (buffer.subarray(4, 19).toString("ascii") !== "Standard Jet DB")
      throw new Error("mdb_header_invalid");
  } finally { await file.close(); }
  const hasher = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(mdbPath)) {
    bytes += chunk.byteLength;
    if (bytes > 1_000_000_000) throw new Error("mdb_too_large");
    hasher.update(chunk);
  }
  const end = await lstat(mdbPath);
  if (bytes !== start.size || start.size !== end.size ||
      start.mtimeMs !== end.mtimeMs || start.ctimeMs !== end.ctimeMs ||
      start.ino !== end.ino || start.dev !== end.dev)
    throw new Error("mdb_changed_during_read");
  const source = {
    sourceName: basename(mdbPath), sourceSha256: hasher.digest("hex"),
    sourceBytes: bytes,
  };
  const coverage = parseLegacySourceCoverage(
    await safeJson(coveragePath, LEGACY_COVERAGE_MAX_BYTES));
  const lineage = await loadLineagePages(pageDirectory);
  const replayedLineage = replayDirectory === undefined
    ? undefined : await loadLineagePages(replayDirectory);
  const review = verifyLegacyEvidenceManifestPackage({
    source, coverage, lineage, replayedLineage,
  });
  return {
    ...review,
    localMdbBytesHashMatched: true,
    sourceRowsIndependentlyRecomputedFromMdb: false,
    sameExtractorAceReplayMatched: review.sourceHmacAceReplayMatches,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (![6, 8].includes(args.length) || args[0] !== "--mdb" ||
      args[2] !== "--coverage" || args[4] !== "--lineage-dir" ||
      (args.length === 8 && args[6] !== "--ace-replay-dir")) {
    process.stderr.write("Usage: node --experimental-strip-types scripts/legacy/verify-evidence-package.mjs --mdb SOURCE.mdb --coverage COVERAGE.json --lineage-dir PRIVATE_DIRECTORY [--ace-replay-dir FRESH_PRIVATE_PAGES]\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await checkPrivateLegacyEvidencePackage(args[1], args[3], args[5], args[7]);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } catch (error) {
      // Deliberately don't print the source path, HMAC key or row content.
      const nativeCode = error && typeof error === "object" && "code" in error
        ? String(error.code) : "";
      const safeCode = /^(?:legacy_|invalid_|unexpected_)[a-z0-9_]+$/.test(nativeCode)
        ? nativeCode
        : error instanceof Error && /^(?:mdb_|evidence_|unexpected_)[a-z0-9_]+$/.test(error.message)
          ? error.message : "legacy_evidence_rejected";
      process.stderr.write("Evidence package rejected: " + safeCode + "\n");
      process.exitCode = 1;
    }
  }
}
