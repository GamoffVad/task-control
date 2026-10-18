/** Настройки сервера приложения; пароль никогда не возвращается клиенту. */
export type DatabaseConnection = {
  server: string;
  database: string;
  auth: 'windows' | 'sql';
  username: string;
  port?: number;
  encrypt: boolean;
  trustServerCertificate: boolean;
};
export type DatabaseConnectionDraft = DatabaseConnection & { password?: string };
export type DatabaseConnectionView = DatabaseConnection & { hasPassword: boolean; saved: boolean };
export type DatabaseProbe = { version: string; edition: string; databaseExists: boolean };
