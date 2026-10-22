export type F3ExportTargetLineageOptions={
  databaseUrl:string;organizationId:string;
  sourceSha256:string;outputPath:string;
};
export type F3ExportTargetLineageResult={
  exportedRows:number;privateFileCreated:true;
  operationalCertification:false;
};
/** Private read-only MariaDB snapshot export; never a clinical signoff. */
export function exportF3TargetLineage(
  options:F3ExportTargetLineageOptions,
):Promise<F3ExportTargetLineageResult>;
