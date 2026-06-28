import { SupersetClient } from "../client";

export interface Dataset {
  id: number;
  table_name: string;
  schema: string | null;
  datasource_type: string;
  database: { id: number; database_name: string };
}

/** Thin wrapper around Superset's /api/v1/dataset/ endpoint. */
export class DatasetsApi {
  constructor(private readonly client: SupersetClient) {}

  /**
   * List datasets with their owning database.
   * ponytail: caps at 100 datasets; add paging only if a workspace exceeds it.
   */
  async list(): Promise<Dataset[]> {
    const resp = await this.client.get<{ result: Dataset[] }>("/api/v1/dataset/", {
      page: 0,
      page_size: 100,
    });
    return resp.result;
  }
}
