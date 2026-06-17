import { SupersetClient } from "../client";

export interface Dashboard {
  id: number;
  dashboard_title: string;
  url: string;
  status: string;
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
}
