# Family Lab Analyzer Bridge — staged interface adapter

This is a **separate Node.js service**, not a Next.js route or in-process
network listener. It must run near the laboratory instrument, under a process
supervisor, with its own persistent disk and restricted operating-system user.
Its role is to retain complete original input, normalize only approved
vendor fields, and queue data for **manual LIS review**. It never verifies,
releases, amends, or sends a diagnostic report.

## Supported engineering adapters

- **HL7 v2 ORU^R01, MLLP/TCP listener**: `mllp-listener.mjs` validates a
  conservative segment subset, writes a synchronized `.ready` file, and only
  then replies with HL7 `MSA|AA`. This ACK means **locally queued**, not
  clinically accepted. Invalid frames are negatively acknowledged.
- **HL7 v2 ORU^R01, file adapter**: `file-worker.mjs` reads atomically
  renamed `.ready` files and persists retries across process restarts.
- **ASTM E1394 record-level subset**, via validated `.ready` files:
  `protocols.mjs` requires explicit field positions and an approved profile.
  It **does not** implement ASTM E1381 serial handshaking, frame checksums,
  bidirectional orders or instrument-specific proprietary extensions. A
  separate transport adapter must verify frames before creating a ready file.
- Other protocols, code formats, result data types, checksum variants and
  vendor exceptions are rejected unless a device-approved adapter is added.

MLLP framing uses VT `0x0B` at start and FS+CR `0x1C 0x0D` at end.
ASTM E1381 and E1394 are distinct link/message-layer responsibilities.
This bridge does not silently treat one as the other.

## Configuration

Example file `bridge-config.example.json` is illustrative. Copy it **outside
the Git repository** and replace every path, UUID, protocol and field
selection using the actual approved manufacturer interface specification.
Never commit real bridge tokens. Do not auto-enable an AST breakpoint,
interpretation or clinical approval policy.

```json
{
  "analyzerId": "00000000-0000-4000-8000-000000000001",
  "lisOrigin": "https://familylab.example.com",
  "protocol": "HL7_V2",
  "profile": { "barcodeSource": "OBR_3" },
  "inputDir": "C:/family-lab-bridge/inbox",
  "archivedDir": "C:/family-lab-bridge/archive",
  "rejectedDir": "C:/family-lab-bridge/quarantine",
  "listenHost": "127.0.0.1",
  "listenPort": 2575
}
```

Use `SPM_2` instead of `OBR_3` **only if confirmed** by the actual
instrument/vendor. Identifier and result fields may differ among vendors.
MLLP defaults to loopback only. Exposing to a dedicated laboratory VLAN
requires explicit `allowRemote: true`, a non-loopback `listenHost`,
an `allowedAddresses` IP allowlist and firewall restrictions.

Run each process under its own supervisor (two services can share the **same
input spool**, but exactly **one** file worker may process that spool).

```powershell
$env:ANALYZER_BRIDGE_TOKEN = "<a separately issued per-analyzer bridge token>"
node bridge/mllp-listener.mjs C:\config\family-lab-bridge.json
node bridge/file-worker.mjs C:\config\family-lab-bridge.json
```

Configure the token as a service secret rather than leaving it in shell
history. The `LIS` origin must be HTTPS except loopback-only development.
Each retry sends the same message/control ID. LIS stores authenticated raw
messages and requires approved analyzer mappings before staging any result.
`archive` means **successfully transferred to LIS staging**, not clinically
approved or physically printed. `quarantine` stores rejected raw files
for authorized investigation; never make these directories web-accessible.
Apply filesystem ACLs, disk encryption, retention policy and backup.

## Integration/clinical acceptance still required

The following cannot be marked passed without the real instrument and
laboratory owner:

- Manufacturer, model, firmware, exact HL7/ASTM/proprietary message profile,
  sample barcode field, units, accession reconciliation and QC flags.
- Serial device adapter (baud, parity, timeout, E1381 ENQ/ACK/NAK/EOT and
  checksum), proprietary TCP variants, outbound/bidirectional order queries.
- Device-specific network timeout/retry semantics, multi-frame messages,
  encoded textual flags and abnormal/critical interpretation.
- Real-device test vectors, failure injection, branch handover and disconnect
  recovery, QC disposition, operator review and clinical sign-off.

Do not enable an unsupported interface or claim routine patient-care readiness
from protocol unit tests alone.
