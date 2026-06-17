import { SupersetClient } from "../client";

export interface SavedQuery {
  id: number;
  label: string;
  sql: string;
  db_id: number;
  schema: string;
  description: string;
}

export interface SavedQueryPayload {
  label: string;
  sql: string;
  db_id: number;
  schema?: string;
  description?: string;
}

/**
 * Thin wrapper around Superset's /api/v1/saved_query/ endpoints.
 */
export class SavedQueriesApi {
  constructor(private readonly client: SupersetClient) {}

  /** List all saved queries accessible by the current user. */
  async list(): Promise<SavedQuery[]> {
    const resp = await this.client.get<{ result: SavedQuery[] }>("/api/v1/saved_query/", {
      page: 0,
      page_size: 100,
    });
    return resp.result;
  }

  /** Fetch a single saved query by id. */
  async get(id: number): Promise<SavedQuery> {
    const resp = await this.client.get<{ result: SavedQuery }>(`/api/v1/saved_query/${id}`);
    return resp.result;
  }

  /** Create a new saved query. */
  async create(query: SavedQueryPayload): Promise<SavedQuery> {
    const resp = await this.client.post<{ result: SavedQuery }>("/api/v1/saved_query/", query);
    return resp.result;
  }

  /** Update an existing saved query. */
  async update(id: number, query: SavedQueryPayload): Promise<void> {
    await this.client.put(`/api/v1/saved_query/${id}`, query);
  }

  /** Delete a saved query by id. */
  async delete(id: number): Promise<void> {
    await this.client.del(`/api/v1/saved_query/${id}`);
  }
}
