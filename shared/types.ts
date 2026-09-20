export type RaDeg = number;
export type DecDeg = number;

export interface ImageStar {
  id: string;
  x: number;
  y: number;
  flux: number;
  saturated?: boolean;
}

export interface CatalogStar {
  id: string;
  ra: RaDeg;
  dec: DecDeg;
  mag: number;
}

export interface Pair {
  imageId: string;
  catalogId: string;
}

export type EvidenceKind = 'lock' | 'mask-saturated' | 'mask-star' | 'mask-region';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  createdAt: string;
  pair?: Pair;
  starId?: string;
  reason?: string;
  polygon?: Array<{ x: number; y: number }>;
}

export interface SolveParams {
  fovMinDeg: number;
  fovMaxDeg: number;
  maxRotationDeg: number;
  allowMirror: boolean;
  distortionOrder: 0 | 1 | 2 | 3;
  tolerancePx: number;
  mismatchCost: number;
  topK: number;
}

export interface SolveRequest {
  datasetId: string;
  params: SolveParams;
}

export type Status = 'ok' | 'underdetermined' | 'error';

export interface MatchedPair {
  imageId: string;
  catalogId: string;
  dx: number;
  dy: number;
  residualPx: number;
  angularArcsec: number;
}

export type RejectReason = 'unmatched-image' | 'unmatched-catalog' | 'outlier' | 'masked' | 'locked';

export interface RejectedStar {
  imageId?: string;
  catalogId?: string;
  reason: RejectReason;
  detail: string;
  x?: number;
  y?: number;
}

export interface TransformModel {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  coeffP: number[];
  coeffQ: number[];
  ra0: number;
  dec0: number;
  order: number;
  scaleArcsecPerPx: number;
  rotationDeg: number;
  mirror: boolean;
  fovDiagDeg: number;
}

export interface Candidate {
  rank: number;
  signature: string;
  status: Status;
  underdeterminedReason?: string;
  model: TransformModel;
  matches: MatchedPair[];
  rejected: RejectedStar[];
  rmsPx: number;
  maxResidualPx: number;
  mismatchPenalty: number;
  cost: number;
  inlierCount: number;
  parameterCorrelation: number[][];
  parameterNames: string[];
  quadSeeds: string[];
}

export interface SolveResult {
  requestHash: string;
  rulesVersion: string;
  status: Status;
  underdeterminedReason?: string;
  candidates: Candidate[];
  activeImageIds: string[];
  activeCatalogIds: string[];
  locks: Pair[];
  evidenceSummary: Array<{ kind: EvidenceKind; count: number }>;
  createdAt: string;
}

export interface RuleSpec {
  version: string;
  description: string;
  numerical: {
    tolInclusion: 'inclusive';
    boundaryEps: number;
    angleWrapDeg: number;
  };
}

export interface Dataset {
  id: string;
  name: string;
  imageStars: ImageStar[];
  catalogStars: CatalogStar[];
  evidence: Evidence[];
  createdAt: string;
}

export interface DatasetInput {
  name?: string;
  imageStars: ImageStar[];
  catalogStars: CatalogStar[];
}
