import { SupersetClient } from "../client";

export interface Dataset {
  id: number;
  table_name: string;
  schema: string | null;
  datasource_type: string;
  database: { id: number; database_name: string };
}

export interface DatasetDetail extends Dataset {
  kind: string;
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

  /** Fetch one dataset's detail (includes `kind`: physical | virtual). */
  async get(id: number): Promise<DatasetDetail> {
    const resp = await this.client.get<{ result: DatasetDetail }>(`/api/v1/dataset/${id}`);
    return resp.result;
  }

  /** Duplicate a virtual (SQL) dataset. Returns the new dataset id. */
  async duplicate(baseModelId: number, newName: string): Promise<{ id: number }> {
    return this.client.post<{ id: number }>("/api/v1/dataset/duplicate", {
      base_model_id: baseModelId,
      table_name: newName,
    });
  }

  /** Delete a dataset by id. */
  async delete(id: number): Promise<void> {
    await this.client.del(`/api/v1/dataset/${id}`);
  }
}
