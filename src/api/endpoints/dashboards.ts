import { SupersetClient } from "../client";

export interface Dashboard {
  id: number;
  dashboard_title: string;
  url: string;
  status: string;
}

export interface DashboardDetail {
  id: number;
  dashboard_title: string;
  // Superset returns null (not "") for unset metadata/layout — callers default.
  position_json: string | null;
  json_metadata: string | null;
  css: string | null;
}

/**
 * Thin wrapper around Superset's /api/v1/dashboard/ endpoints.
 */
export class DashboardsApi {
  constructor(private readonly client: SupersetClient) {}

  /** List all dashboards accessible by the current user. */
  async list(): Promise<Dashboard[]> {
    const resp = await this.client.get<{ result: Dashboard[] }>("/api/v1/dashboard/", {
      page: 0,
      page_size: 100,
    });
    return resp.result;
  }

  /** Fetch one dashboard's detail, including position_json + json_metadata. */
  async get(id: number): Promise<DashboardDetail> {
    const resp = await this.client.get<{ result: DashboardDetail }>(`/api/v1/dashboard/${id}`);
    return resp.result;
  }

  /**
   * Create a new dashboard. Charts are NOT associated here — the caller wires
   * them from the chart side (see ChartsApi.setDashboards), because the
   * dashboard's chart M2M can't be set through position_json.
   */
  async create(opts: {
    dashboard_title: string;
    json_metadata: string;
    css: string;
  }): Promise<{ id: number }> {
    return this.client.post<{ id: number }>("/api/v1/dashboard/", opts);
  }

  /** Update a dashboard (used to set position_json with swapped chart refs). */
  async update(id: number, body: { position_json?: string }): Promise<void> {
    await this.client.put(`/api/v1/dashboard/${id}`, body);
  }

  /** Delete a dashboard by id. */
  async delete(id: number): Promise<void> {
    await this.client.del(`/api/v1/dashboard/${id}`);
  }
}
