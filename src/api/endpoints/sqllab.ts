import { SupersetClient } from "../client";

export interface QueryResultColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  status: string;
  data: Record<string, unknown>[];
  columns: string[];
  selected_columns: QueryResultColumn[];
  query: { rows: number; duration: string };
}

export interface EstimateResult {
  result: Array<{ End_time: string; Start_time: string; Total_extra_info: string }>;
}

/**
 * Thin wrapper around Superset's /api/v1/sqllab/ endpoints.
 */
export class SqlLabApi {
  constructor(private readonly client: SupersetClient) {}

  /** Execute a SQL query synchronously. */
  async execute(databaseId: number, sql: string, schema?: string): Promise<QueryResult> {
    return this.client.post<QueryResult>("/api/v1/sqllab/execute/", {
      database_id: databaseId,
      sql,
      schema: schema ?? undefined,
      runAsync: false,
    });
  }

  /** Estimate the cost of running a SQL query. */
  async estimate(databaseId: number, sql: string, schema?: string): Promise<EstimateResult> {
    return this.client.post<EstimateResult>("/api/v1/sqllab/estimate/", {
      database_id: databaseId,
      sql,
      schema: schema ?? undefined,
    });
  }

  /** Format a SQL string using Superset's server-side formatter. */
  async formatSql(sql: string): Promise<string> {
    const resp = await this.client.post<{ result: string }>("/api/v1/sqllab/format_sql/", { sql });
    return resp.result;
  }
}
