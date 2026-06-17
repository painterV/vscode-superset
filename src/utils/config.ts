/**
 * VS Code workspace configuration utilities for the Superset extension.
 *
 * Provides typed access to the `superset.*` settings namespace defined in
 * package.json `contributes.configuration`.
 */

import * as vscode from "vscode";

/** A single Superset connection configured by the user. */
export interface ConnectionConfig {
  /** Human-readable display name shown in the Connections tree view. */
  name: string;
  /** Base URL of the Superset instance (e.g. https://superset.company.com). */
  url: string;
  /** Login username for this connection. */
  username: string;
}

/** All Superset extension settings as a single typed object. */
export interface SupersetSettings {
  connections: ConnectionConfig[];
  defaultDatabase: string;
  resultPageSize: number;
  maxResultTabs: number;
  schemaCacheTtlSeconds: number;
  queryTimeoutSeconds: number;
}

/**
 * Return the list of configured Superset connections.
 *
 * Convenience wrapper around `getSettings().connections` for callers
 * that only need the connection list.
 */
export function getConnections(): ConnectionConfig[] {
  const config = vscode.workspace.getConfiguration("superset");
  return config.get<ConnectionConfig[]>("connections", []);
}

/**
 * Return all Superset extension settings with their defaults applied.
 *
 * Reads from the `superset.*` configuration namespace; VS Code falls back
 * to the defaults declared in package.json when a key is not explicitly set.
 */
export function getSettings(): SupersetSettings {
  const config = vscode.workspace.getConfiguration("superset");
  return {
    connections: config.get<ConnectionConfig[]>("connections", []),
    defaultDatabase: config.get<string>("defaultDatabase", ""),
    resultPageSize: config.get<number>("resultPageSize", 50),
    maxResultTabs: config.get<number>("maxResultTabs", 5),
    schemaCacheTtlSeconds: config.get<number>("schemaCacheTtlSeconds", 300),
    queryTimeoutSeconds: config.get<number>("queryTimeoutSeconds", 30),
  };
}
