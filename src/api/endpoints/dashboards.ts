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
  position_json: string;
  json_metadata: string;
  css: string;
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
   * Copy a dashboard (shares the original charts; duplicate_slices is always
   * false). The copy drops position_json — callers re-apply it via update().
   * Returns the new dashboard id.
   */
  async copy(
    id: number,
    opts: { dashboard_title: string; json_metadata: string; css: string },
  ): Promise<{ id: number }> {
    const resp = await this.client.post<{ result: { id: number } }>(
      `/api/v1/dashboard/${id}/copy/`,
      {
        dashboard_title: opts.dashboard_title,
        duplicate_slices: false,
        css: opts.css,
        json_metadata: opts.json_metadata,
      },
    );
    return resp.result;
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
