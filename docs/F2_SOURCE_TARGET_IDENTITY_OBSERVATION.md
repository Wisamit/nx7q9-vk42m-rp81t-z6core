# F2 — Source-to-target identity observation (read-only)

## Purpose and limitation

This is the **next bounded F2 checkpoint**, following the ten-class source field
risk taxonomy and qualified independent original-source gate. The existing
CONFIG_BUNDLE_REVIEW path still requires the same organization and current
locally accessible UUIDs at staging time. **The V1 export does NOT record an
independently provable source deployment/installation ID**, even when its
organization UUID, HMAC and local master UUIDs match.

Therefore no observer, administrator or future apply worker may infer
"same installed database", portable target identity, or permission to import
a foreign-database UUID merely from matching ID or code. A foreign-institution
or foreign-instance source requires a future *explicit*, separately approved,
versioned mapping procedure; do not fall back to matching by name or first
catalog code.

## Implemented observational contract

`src/lib/catalog-bundle-target-identity.ts` consumes a tenant/branch/dept/
tariff-scoped live record and the persisted source JSON **inside the existing
read-only drift transaction**, and emits only:

- `LOCAL_IDENTITY_OBSERVED`: source UUID, code and the class-specific
  target identity/parent links currently match locally. Does not prove export
  installation identity, approval or permitted mapping.
- `MAPPING_REQUIRED`: source/local record IDs, natural code, parent test or
  analyte, scoped tariff/branch/currency, or entire composite membership
  differ, are missing or malformed.
- A bounded list of categorical reasons, never source/live clinical or price
  values, patient identifiers, target IDs, or sensitive private linkage data.
- Irrespective of status: `sourceInstanceProven: false`,
  `portableSourceIds: false`, `mappingApproved: false`,
  `reviewOnly: true`, `autoApplyAllowed: false`.

The observer compares **all ten** native classes:

| Source classes | Identity evidence |
| --- | --- |
| TEST | ID, code, department/specimen/container/method/default-unit identifiers |
| COMPONENT | ID/code, test, unit, result-section links plus associated test/unit codes |
| UNIT / CONTAINER | ID/code and unit UCUM identity when present |
| PANEL / PACKAGE | ID/code and all test members, their linked codes/display ordering; PANEL required flags |
| REFERENCE_INTERVAL | ID, component/test links and codes, branch, method, analyzer, specimen type |
| PRICE_LIST | ID/code, branch/organization scope, currency, all private tariff links null |
| PRICE_LIST_ITEM | ID, test/list parent identifiers and codes, branch scope and parent currency |
| PRICE_LIST_PACKAGE_ITEM | ID, package/list parent identifiers and codes, branch scope and parent currency |

Changes to prices, range values, method metadata, translations or effective
windows still appear separately through the full source-to-live drift
comparison and the F2 field risk taxonomy. They are **not automatically
accepted** because these particular fields are not target identity keys.

The bilingual drift UI validates all non-authorization booleans, shows only
the categorical status/reasons, and makes no additional branch permissions
or master mutations. The generic legacy commit route still refuses both
`CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW`.

## Tests and boundaries

- `tests/f2-target-identity-mapping.test.ts`: ten positive local
  observations plus renamed/reassigned test links, panel/package duplicate
  and changed memberships, tariff currency/branch/private client changes,
  invalid and foreign/mismatched UUIDs, sensitive data non-disclosure.
- `tests/f2-target-identity-mariadb.integration.test.ts`: synthetic
  independently connected writer/reader, real MariaDB FK and SQL branch/
  membership joins, one unchanged local observation, writer-induced
  same-UUID panel membership / price list currency or branch drift / price
  item test reassignment, and restore. No real laboratory data.
- `ci.yml` includes the MariaDB test in the normal feature PR workflow.

## Open / blocked

A **portable source-instance identity trust model**, independently approved
foreign source-to-target mapping, signed mapping decisions, qualified medical
and finance signers, actual effective-dated versioned application/reversal,
and export → approved apply → re-export parity are **NOT implemented**.
They remain within F2 scope / BLOCKED_EXTERNAL as appropriate.
F2 is **IN PROGRESS**. F3 is not started. PR #334 stays DRAFT.
No merge/deployment/restart under Hostinger HOLD.
