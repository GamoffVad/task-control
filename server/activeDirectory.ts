import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DirectoryUser } from '../src/lib/types';
import { searchDemoDirectory } from '../src/lib/staff';

const run = promisify(execFile);

export type ActiveDirectory = {
  search(query: string): Promise<DirectoryUser[]>;
};

/** Local-only directory so the autocomplete can be exercised without a domain controller. */
export const demoActiveDirectory: ActiveDirectory = {
  async search(query) {
    return searchDemoDirectory(query);
  },
};

const psLiteral = (value: string) => value.replaceAll("'", "''");
const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/**
 * Uses the Windows RSAT ActiveDirectory module already installed in the corporate network.
 * No LDAP or internet package is loaded by the application.
 */
export const activeDirectoryFromEnv = (env: Record<string, string | undefined>): ActiveDirectory | undefined => {
  if (env.AD_SEARCH_ENABLED !== 'true') return undefined;
  const executable = env.AD_POWERSHELL_PATH || 'powershell.exe';
  const searchBase = env.AD_SEARCH_BASE?.trim();
  return {
    async search(rawQuery) {
      const query = rawQuery.replace(/[^\p{L}\p{N}' -]/gu, '').trim().slice(0, 80);
      if (query.length < 2) return [];
      const filter = psLiteral(`${query}*`);
      const base = searchBase ? ` -SearchBase '${psLiteral(searchBase)}'` : '';
      const script = [
        "$ErrorActionPreference = 'Stop'",
        'Import-Module ActiveDirectory',
        `Get-ADUser -Filter "Surname -like '${filter}' -or DisplayName -like '${filter}'"${base} -Properties GivenName,Surname,DisplayName,SamAccountName,UserPrincipalName,mail,Title |`,
        '  Sort-Object Surname,GivenName |',
        '  Select-Object -First 20 @{n=\'fullName\';e={$_.DisplayName}},@{n=\'surname\';e={$_.Surname}},@{n=\'givenName\';e={$_.GivenName}},@{n=\'patronymic\';e={if ($_.DisplayName -and $_.Surname -and $_.GivenName) { ($_.DisplayName -replace (\'^\' + [regex]::Escape($_.Surname) + \'\\s+\' + [regex]::Escape($_.GivenName) + \'\\s*\'), \'\') } else { \'\' } }},@{n=\'login\';e={$_.SamAccountName}},@{n=\'email\';e={if ($_.mail) {$_.mail} else {$_.UserPrincipalName}}},@{n=\'position\';e={$_.Title}} |',
        '  ConvertTo-Json -Compress',
      ].join('\n');
      const { stdout } = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encode(script)], {
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 512 * 1024,
      });
      if (!stdout.trim()) return [];
      const parsed = JSON.parse(stdout) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((row): DirectoryUser => ({
        fullName: String(row.fullName ?? '').trim(),
        surname: String(row.surname ?? '').trim(),
        givenName: String(row.givenName ?? '').trim(),
        patronymic: String(row.patronymic ?? '').trim(),
        login: String(row.login ?? '').trim(),
        email: String(row.email ?? '').trim(),
        position: String(row.position ?? '').trim(),
      })).filter((row) => row.fullName && row.login);
    },
  };
};
