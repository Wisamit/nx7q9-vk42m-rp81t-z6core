/**
 * Resolve the root HTML document's organization and language without
 * expanding the permissions of a staff or portal session.
 *
 * Staff context wins when both session cookies are present. A portal-only
 * session must not fall back to another organization's default branding or
 * locale. This is presentation selection, not authorization.
 */
type RootActor = {organizationId:string;preferredLocale:string};
export type RootInterfaceContext = {
  organizationId:string|null;
  preferredLocale:"ar"|"en"|null;
  source:"staff"|"portal"|"public";
};

function locale(value:string):"ar"|"en" {
  return value === "ar" ? "ar" : "en";
}

export function resolveRootInterfaceContext(
  staff:RootActor|null, portal:RootActor|null,
):RootInterfaceContext {
  if(staff)return {
    organizationId:staff.organizationId,
    preferredLocale:locale(staff.preferredLocale),
    source:"staff",
  };
  if(portal)return {
    organizationId:portal.organizationId,
    preferredLocale:locale(portal.preferredLocale),
    source:"portal",
  };
  return {organizationId:null,preferredLocale:null,source:"public"};
}
