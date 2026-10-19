# Hostinger deployment failure — bounded Next.js build workers (2026-10-19)

## Evidence and impact

- Production hosting: Hostinger, not Vercel.
- Last owner-confirmed successful deployment: `354fd1d9203745ef5926c9e769101065601e01ab`.
- Owner reported that Hostinger failed twice while deploying `116fd723ef40aa34c4c6d085f45d09482a430d4d`, while exact-main GitHub CI #1795 succeeded.
- The owner's Hostinger diagnostic excerpt identifies the **Next.js page-data collection** step displaying `Collecting page data using 63 workers`, followed by a Tokio thread-spawn failure (`OS can't spawn worker thread: Resource temporarily unavailable (os error 11)`) and `SIGABRT`. The complete Hostinger raw log is not accessible to this repository or CI.
- This is evidence of OS process/thread resource exhaustion during the Hostinger build, not proof of a clinical application or database failure. The status of the existing live application was not established.

## Narrow mitigation

- Set `experimental.cpus: 2` in `next.config.ts` so Next.js uses at most two build workers in the affected page-data collection phase instead of the host-advertised 63.
- Preserve existing HTTP security headers and all clinical, financial, and database behavior.
- Add `tests/hostinger-build-worker-cap.test.ts` to `npm run test:safety`, which is included in branch and main CI. The existing CI also runs Prisma, integration tests, TypeScript, lint, RTL/i18n checks and the real `next build`.
- Avoid speculative `NODE_OPTIONS=--max-old-space-size=4096` changes, additional memory allocation, dependencies, schema changes, and database rollbacks.
- `experimental.cpus` limits Next.js build worker concurrency; it **does not** raise Hostinger's container process/thread or memory limits.

## Release verification gate

1. Require GitHub branch CI to finish successfully on the final feature SHA, then merge through PR with expected-head SHA, and require independent `main` CI on the exact merge commit.
2. Owner redeploys the new `main` SHA on Hostinger. Confirm the build log now reports `Collecting page data using 2 workers`, proceeds past page-data collection, and reaches successful deployment/health checks. A green GitHub Actions run is not a Hostinger deployment success.
3. If Hostinger still shows `os error 11` with the worker cap, capture the first concrete error; request hosting-provider process/thread quota diagnosis without changing clinical or database data.
4. Record the exact Hostinger outcome before marking this incident closed. Keep final release issues #250 and #265 OPEN until qualified real-world acceptance.

**Current record:** mitigation candidate only; Hostinger redeploy result not yet confirmed.
