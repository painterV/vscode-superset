import { SupersetClient } from "../client";

export interface Database {
  id: number;
  database_name: string;
  backend: string;
}

export interface TableInfo {
  value: string;
  type: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Thin wrapper around Superset's /api/v1/database/ endpoints.
 */
export class DatabasesApi {
  constructor(private readonly client: SupersetClient) {}

  /** List all databases the current user can access. */
  async list(): Promise<Database[]> {
    const resp = await this.client.get<{ result: Database[] }>("/api/v1/database/", {
      page: 0,
      page_size: 100,
    });
    return resp.result;
  }

  /** List schemas available in the given database. */
  async schemas(dbId: number): Promise<string[]> {
    const resp = await this.client.get<{ result: string[] }>(`/api/v1/database/${dbId}/schemas/`);
    return resp.result;
  }

  /**
   * List tables in the given database + schema.
   * Superset expects the schema as a Rison-encoded query param in the URL path itself.
   */
  async tables(dbId: number, schema: string): Promise<TableInfo[]> {
    const resp = await this.client.get<{ result: TableInfo[] }>(
      `/api/v1/database/${dbId}/tables/?q=${encodeURIComponent(`(schema_name:'${schema}')`)}`
    );
    return resp.result;
  }

  /** List columns for the given table + schema in the given database. */
  async columns(dbId: number, table: string, schema: string): Promise<ColumnInfo[]> {
    const resp = await this.client.get<{ columns: ColumnInfo[] }>(
      `/api/v1/database/${dbId}/table/${table}/${schema}/`
    );
    return resp.columns;
  }
}
