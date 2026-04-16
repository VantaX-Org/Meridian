/** API client for config-match exports and summaries.
 *
 * The backend endpoint is defined at
 * ``api/routes/config_matches.py`` and streams an xlsx workbook of every
 * standard-rule / live-config mismatch detected during the analysis.
 */

export function getConfigMatchesExportUrl(versionId: string): string {
  return `/api/v1/versions/${versionId}/config-matches/export`;
}
