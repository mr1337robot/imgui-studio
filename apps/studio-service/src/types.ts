/** Stable error codes exposed by the Phase 2 HTTP boundary. */
export type ServiceErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_INVALID'
  | 'PATH_OUTSIDE_PROJECT'
  | 'FILE_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'BUILD_ALREADY_RUNNING'
  | 'BUILD_NOT_FOUND'
  | 'BUILD_FAILED'
  | 'PREVIEW_NOT_READY'
  | 'PREVIEW_IDENTITY_MISMATCH'
  | 'PREVIEW_REVISION_MISMATCH'
  | 'FRAME_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_INTERACTABLE'
  | 'INSPECTION_FAILED'
  | 'CAPTURE_FAILED'
  | 'SCENARIO_INVALID'
  | 'REFERENCE_NOT_FOUND'
  | 'ASSET_INVALID'
  | 'LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR';

/** One source file exposed through the canonical project index. */
export interface ProjectFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mediaType: 'text/x-c++src' | 'text/x-c++hdr' | 'application/json' | 'text/plain';
  readonly ownership: 'user';
}

/** Immutable view of a discovered project at one service revision. */
export interface ProjectSnapshot {
  readonly projectId: string;
  readonly name: string;
  readonly projectKey: string;
  readonly currentRevision: string;
  readonly files: readonly ProjectFile[];
  readonly lastSuccessfulBuildId: string | null;
  readonly currentPreview: PreviewIdentity | null;
}

/** Source patch accepted by the project mutation boundary. */
export interface SourcePatch {
  readonly path: string;
  readonly expectedSha256: string | null;
  readonly unifiedDiff: string;
  readonly delete?: boolean;
}

/** Canonical result of one all-or-nothing patch transaction. */
export interface PatchResult {
  readonly previousRevision: string;
  readonly revision: string;
  readonly changedPaths: readonly string[];
  readonly postimageSha256: Readonly<Record<string, string | null>>;
}

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Structured compiler diagnostic safe to display without parsing raw logs. */
export interface BuildDiagnostic {
  readonly severity: 'note' | 'warning' | 'error' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly relativePath: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly buildId: string;
}

/** Immutable terminal record, or authoritative current state, for one build attempt. */
export interface BuildRecord {
  readonly schemaVersion: 1;
  readonly buildId: string;
  readonly projectId: string;
  readonly projectRevision: string;
  readonly configuration: 'preview-debug';
  status: BuildStatus;
  readonly toolchainVersionSet: string;
  startedAt: string | null;
  completedAt: string | null;
  smokePassed: boolean | null;
  diagnostics: BuildDiagnostic[];
  rawLog: string;
  artifactDirectory: string | null;
  artifactSha256: Readonly<Record<string, string>>;
  artifactSizeBytes: Readonly<Record<string, number>>;
  phaseDurationsMs: Readonly<Record<string, number>>;
  cache: {
    projectSourcesChanged: boolean;
    stableObjectsReused: boolean;
    corruptionRecovered: boolean;
    assetBundleReused: boolean;
  };
}

/** Identity of the last smoke-passed browser preview promoted by the service. */
export interface PreviewIdentity {
  readonly previewInstanceId: string;
  readonly buildId: string;
  readonly projectRevision: string;
  readonly runtimeProtocolVersion: 1;
  readonly url: string;
}

/** Immutable identity attached to one completed deterministic preview frame. */
export interface FrameIdentity {
  readonly projectId: string;
  readonly currentProjectRevision: string;
  readonly projectRevision: string;
  readonly buildId: string;
  readonly previewInstanceId: string;
  readonly frameId: string;
  readonly stale: boolean;
}

/** Structured toggle inspection emitted by the Phase 4 vertical-slice fixture. */
export interface InspectedToggle {
  readonly widgetId: 'settings.enable';
  readonly semanticType: 'animated_toggle';
  readonly boundsPx: readonly [number, number, number, number];
  readonly hitboxPx: readonly [number, number, number, number];
  readonly visible: boolean;
  readonly clipped: boolean;
  readonly interaction: {
    readonly interactable: boolean;
    readonly disabled: boolean;
    readonly hovered: boolean;
    readonly held: boolean;
    readonly pressedThisFrame: boolean;
    readonly active: boolean;
  };
  readonly values: { readonly value: boolean };
  readonly animations: {
    readonly active: {
      readonly kind: 'float';
      readonly valueMillionths: number;
      readonly targetMillionths: number;
      readonly settled: boolean;
    };
  };
}

/** Stored frame evidence; callers receive projections without causing a rerender. */
export interface StoredFrame {
  readonly schemaVersion: 1;
  readonly identity: FrameIdentity;
  readonly frameIndex: number;
  readonly timeUs: number;
  readonly deltaUs: number;
  readonly stateDigest: string;
  readonly viewport: {
    readonly widthPx: 900;
    readonly heightPx: 600;
    readonly dpiScaleMilli: 1000;
  };
  readonly widgets: readonly InspectedToggle[];
  readonly diagnostics: readonly RuntimeFrameDiagnostic[];
  readonly imageArtifact: ImageArtifact | null;
}

/** Bounded runtime diagnostic associated with one exact stored frame. */
export interface RuntimeFrameDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly message: string;
  readonly widgetIds: readonly string[];
}

/** Authenticated image artifact descriptor that never exposes its host path. */
export interface ImageArtifact {
  readonly artifactId: string;
  readonly sha256: string;
  readonly mediaType: 'image/png';
  readonly widthPx: number;
  readonly heightPx: number;
}
