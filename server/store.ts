import { DatabaseSync } from 'node:sqlite';
import type { Dataset, Evidence, SolveParams, SolveResult } from '../shared/types.ts';
import { computeRequestHash, solve } from '../shared/solver.ts';
import { CURRENT_RULES_VERSION } from '../shared/rules.ts';

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (dataset_id) REFERENCES datasets(id)
      );
      CREATE TABLE IF NOT EXISTS solves (
        request_hash TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        rules_version TEXT NOT NULL,
        params TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  createDataset(id: string, name: string, imageStars: Dataset['imageStars'], catalogStars: Dataset['catalogStars'], createdAt: string): Dataset {
    const payload = JSON.stringify({ imageStars, catalogStars });
    this.db
      .prepare('INSERT INTO datasets (id, name, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, payload, createdAt);
    return this.getDataset(id)!;
  }

  getDataset(id: string): Dataset | null {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as
      | { id: string; name: string; payload: string; created_at: string }
      | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payload) as { imageStars: Dataset['imageStars']; catalogStars: Dataset['catalogStars'] };
    const evidenceRows = this.db
      .prepare('SELECT payload FROM evidence WHERE dataset_id = ? ORDER BY created_at, id')
      .all(id) as Array<{ payload: string }>;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      imageStars: payload.imageStars,
      catalogStars: payload.catalogStars,
      evidence: evidenceRows.map((r) => JSON.parse(r.payload) as Evidence),
    };
  }

  listDatasets(): Array<{ id: string; name: string; createdAt: string; imageCount: number; catalogCount: number }> {
    const rows = this.db.prepare('SELECT id, name, payload, created_at FROM datasets ORDER BY id').all() as Array<{
      id: string;
      name: string;
      payload: string;
      created_at: string;
    }>;
    return rows.map((r) => {
      const p = JSON.parse(r.payload) as { imageStars: unknown[]; catalogStars: unknown[] };
      return { id: r.id, name: r.name, createdAt: r.created_at, imageCount: p.imageStars.length, catalogCount: p.catalogStars.length };
    });
  }

  addEvidence(datasetId: string, evidence: Evidence): Evidence {
    const exists = this.db.prepare('SELECT 1 FROM datasets WHERE id = ?').get(datasetId);
    if (!exists) throw new Error(`dataset not found: ${datasetId}`);
    this.db
      .prepare('INSERT INTO evidence (id, dataset_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(evidence.id, datasetId, JSON.stringify(evidence), evidence.createdAt);
    return evidence;
  }

  runSolve(datasetId: string, params: SolveParams, now: () => string): { result: SolveResult; cached: boolean } {
    const dataset = this.getDataset(datasetId);
    if (!dataset) throw new Error(`dataset not found: ${datasetId}`);
    const requestHash = computeRequestHash(datasetId, params);
    const existing = this.db.prepare('SELECT result FROM solves WHERE request_hash = ?').get(requestHash) as
      | { result: string }
      | undefined;
    if (existing) {
      return { result: JSON.parse(existing.result) as SolveResult, cached: true };
    }
    const result = solve(dataset, params);
    result.createdAt = now();
    this.db
      .prepare(
        'INSERT INTO solves (request_hash, dataset_id, rules_version, params, result, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(requestHash, datasetId, result.rulesVersion, JSON.stringify(params), JSON.stringify(result), result.createdAt);
    return { result, cached: false };
  }

  getSolve(requestHash: string): SolveResult | null {
    const row = this.db.prepare('SELECT result FROM solves WHERE request_hash = ?').get(requestHash) as
      | { result: string }
      | undefined;
    return row ? (JSON.parse(row.result) as SolveResult) : null;
  }

  replaySolve(datasetId: string, rulesVersion: string, params: SolveParams): SolveResult {
    if (rulesVersion !== CURRENT_RULES_VERSION) {
      throw new Error(`unknown rules version: ${rulesVersion}`);
    }
    const dataset = this.getDataset(datasetId);
    if (!dataset) throw new Error(`dataset not found: ${datasetId}`);
    return solve(dataset, params);
  }

  listSolves(datasetId: string): Array<{ requestHash: string; rulesVersion: string; createdAt: string; params: SolveParams; status: string }> {
    const rows = this.db
      .prepare('SELECT request_hash, rules_version, params, result, created_at FROM solves WHERE dataset_id = ? ORDER BY created_at')
      .all(datasetId) as Array<{ request_hash: string; rules_version: string; params: string; result: string; created_at: string }>;
    return rows.map((r) => {
      const result = JSON.parse(r.result) as SolveResult;
      return {
        requestHash: r.request_hash,
        rulesVersion: r.rules_version,
        createdAt: r.created_at,
        params: JSON.parse(r.params) as SolveParams,
        status: result.status,
      };
    });
  }
}
