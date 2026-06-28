import { SupersetClient } from "../client";

export interface Chart {
  id: number;
  slice_name: string;
  viz_type: string;
  datasource_id: number;
  datasource_type?: string;
  dashboards?: { id: number; dashboard_title: string }[];
}

export interface ChartDetail extends Chart {
  query: string;
  datasource_name_text: string;
}

/**
 * Thin wrapper around Superset's /api/v1/chart/ endpoints.
 */
export class ChartsApi {
  constructor(private readonly client: SupersetClient) {}

  /** List all charts accessible by the current user. */
  async list(): Promise<Chart[]> {
    const resp = await this.client.get<{ result: Chart[] }>("/api/v1/chart/", {
      page: 0,
      page_size: 100,
    });
    return resp.result;
  }

  /** Fetch a single chart's detail by id. */
  async get(id: number): Promise<ChartDetail> {
    const resp = await this.client.get<{ result: ChartDetail }>(`/api/v1/chart/${id}`);
    return resp.result;
  }
}
