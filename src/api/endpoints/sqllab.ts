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

/** Raw execute response: `columns` may be objects, normalized by `execute()`. */
interface RawQueryResult extends Omit<QueryResult, "columns"> {
  columns: Array<string | QueryResultColumn>;
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
    // Superset returns `columns` as objects ({column_name, name, type, ...}),
    // but data rows are keyed by `name`. Normalize to the string names the
    // rest of the extension (results table, CSV export, preview) expects.
    const raw = await this.client.post<RawQueryResult>("/api/v1/sqllab/execute/", {
      database_id: databaseId,
      sql,
      schema: schema ?? undefined,
      runAsync: false,
    });
    return {
      ...raw,
      columns: (raw.columns ?? []).map((c) =>
        typeof c === "string" ? c : c.name,
      ),
    };
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
