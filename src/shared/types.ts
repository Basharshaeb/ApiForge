/**
 * Domain types shared by the main process, the runtime worker and the
 * renderer: Postman Collection v2.1 JSON (the storage / interchange format),
 * the editor draft, environments, tabs, settings and persisted state.
 */

// ---------------------------------------------------------------------------
// Collection v2.1 JSON (subset we read and write; unknown fields are kept)
// ---------------------------------------------------------------------------
export interface DescriptionJson { content?: string; type?: string }
export type Description = string | DescriptionJson;

export interface KeyValueJson {
  key: string;
  value?: string | null;
  disabled?: boolean;
  description?: Description;
  type?: string;
}

export interface FormDataJson extends KeyValueJson { src?: string | string[] }
export interface UrlVariableJson { key: string; value?: string | null; description?: Description }

export interface UrlJson {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  port?: string;
  path?: string | Array<string | { value: string }>;
  query?: KeyValueJson[];
  variable?: UrlVariableJson[];
  hash?: string;
}

export interface AuthParamJson { key: string; value: unknown; type?: string }
/** `auth[type]` holds the parameters (an array in v2.1, an object in v2.0). */
export interface AuthJson { type: string; [params: string]: unknown }

export interface BodyJson {
  mode?: string;
  raw?: unknown;
  options?: { raw?: { language?: string } };
  urlencoded?: KeyValueJson[];
  formdata?: FormDataJson[];
  file?: { src?: string };
  graphql?: { query?: string; variables?: unknown };
  disabled?: boolean;
}

export interface RequestJson {
  method?: string;
  url?: string | UrlJson;
  header?: string | KeyValueJson[];
  body?: BodyJson;
  auth?: AuthJson;
  description?: Description;
}

export interface ScriptJson { id?: string; type?: string; exec?: string | string[] }
export interface EventJson { listen: string; script?: ScriptJson; disabled?: boolean }

export interface CookieJson {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string | null;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface ExampleJson {
  id: string;
  name: string;
  originalRequest?: RequestJson;
  status?: string;
  code?: number;
  _postman_previewlanguage?: string;
  header?: KeyValueJson[];
  cookie?: CookieJson[];
  body?: string;
}

export interface ProtocolProfileBehavior {
  followRedirects?: boolean;
  followOriginalHttpMethod?: boolean;
  strictSSL?: boolean;
  disableCookies?: boolean;
  disableUrlEncoding?: boolean;
  maxRedirects?: number;
}

export interface ItemJson {
  id: string;
  name: string;
  request?: string | RequestJson;
  response?: ExampleJson[];
  event?: EventJson[];
  description?: Description;
  protocolProfileBehavior?: ProtocolProfileBehavior;
  item?: undefined;
}

export interface FolderJson {
  id: string;
  name: string;
  item: NodeJson[];
  description?: Description;
  auth?: AuthJson;
  event?: EventJson[];
  request?: undefined;
}

export type NodeJson = ItemJson | FolderJson;

export interface VariableJson { key: string; value?: unknown; type?: string; disabled?: boolean }
export interface CollectionInfo { _postman_id: string; name: string; schema?: string; description?: Description }

export interface CollectionJson {
  info: CollectionInfo;
  item: NodeJson[];
  variable?: VariableJson[];
  auth?: AuthJson;
  event?: EventJson[];
}

/** Postman v1 collection export (legacy import format). */
export interface V1Request {
  id: string;
  name?: string;
  url?: string;
  method?: string;
  headers?: string;
  description?: string;
  dataMode?: string;
  rawModeData?: string;
  data?: Array<{ key: string; value?: string; type?: string; enabled?: boolean }>;
  preRequestScript?: string;
  tests?: string;
}
export interface V1Collection {
  name?: string;
  description?: string;
  order?: string[];
  folders?: Array<{ name?: string; description?: string; order?: string[] }>;
  requests?: V1Request[];
}

// ---------------------------------------------------------------------------
// Editor draft
// ---------------------------------------------------------------------------
export interface Row {
  key: string;
  /** `null` marks a query parameter without `=`. */
  value: string | null;
  enabled: boolean;
  description?: string;
  type?: string;
  src?: string;
}

export interface PathVar { key: string; value: string; description: string }
export interface AuthDraft { type: string; params: Record<string, unknown> }
export interface GraphqlDraft { query: string; variables: string }
export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';

export interface BodyDraft {
  mode: BodyMode;
  raw: string;
  language: string;
  urlencoded: Row[];
  formdata: Row[];
  file: string;
  graphql: GraphqlDraft;
}

export interface ScriptsDraft { prerequest: string; test: string }
export type ScriptTarget = keyof ScriptsDraft;
export type RequestSettings = ProtocolProfileBehavior;

export interface Draft {
  name: string;
  method: string;
  url: string;
  params: Row[];
  pathVars: PathVar[];
  headers: Row[];
  body: BodyDraft;
  auth: AuthDraft;
  scripts: ScriptsDraft;
  description: string;
  settings: RequestSettings;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
export interface Environment { id: string; name: string; values: Row[] }
export interface ScopeValue { key: string; value: unknown; type?: string; disabled?: boolean }
export interface Scope { values: ScopeValue[] }
export interface VariableInfo { value: string; source: string; secret: boolean }
export type VariableMap = Map<string, VariableInfo>;
export interface ScopeInput { source: string; values: Array<Pick<Row, 'key' | 'value' | 'enabled'> & { type?: string; disabled?: boolean }> }

export interface EnvironmentExport {
  id: string;
  name: string;
  values: Array<{ key: string; value: string | null; type: string; enabled: boolean }>;
  _postman_variable_scope: string;
  _postman_exported_using: string;
}

export type ImportResult =
  | { kind: 'collection'; value: CollectionJson }
  | { kind: 'environment'; value: Environment }
  | { kind: 'globals'; value: Row[] }
  | { kind: 'request'; value: Draft };

// ---------------------------------------------------------------------------
// Settings & persisted state
// ---------------------------------------------------------------------------
export interface ProxySettings {
  enabled: boolean;
  host: string;
  port: string | number;
  username: string;
  password: string;
  bypass: string;
}

export interface ClientCertificate { host: string; certPath: string; keyPath: string; pfxPath: string; passphrase: string }
export type Theme = 'dark' | 'light';

export interface Settings {
  activeEnvironmentId: string | null;
  strictSSL: boolean;
  followRedirects: boolean;
  requestTimeout: number;
  theme: Theme;
  historyLimit: number;
  proxy?: ProxySettings;
  ignoreProxyEnv?: boolean;
  certificates?: ClientCertificate[];
  caCertPath?: string;
  codegenLanguage?: string;
}

export interface HistoryEntry {
  id: string;
  ts: number;
  method: string;
  url: string;
  name: string;
  status: number | null;
  time: number | null;
  error: string | null;
  draft: Draft;
  collectionId: string | null;
  itemId: string | null;
}

export type SidebarSection = 'collections' | 'environments' | 'history';

export interface UiState {
  tabs: StoredTab[];
  activeTabId: string | null;
  sidebar: SidebarSection;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  expanded: string[];
  consoleHeight: number;
}

/** What the renderer loads and saves (the cookie jar stays in the main process). */
export interface RendererState {
  collections: CollectionJson[];
  environments: Environment[];
  globals: { values: Row[] };
  history: HistoryEntry[];
  settings: Settings;
  ui: Partial<UiState>;
}

export interface StoredState extends RendererState {
  version: number;
  cookieJar: unknown;
}

// ---------------------------------------------------------------------------
// Runtime results as seen by the renderer
// ---------------------------------------------------------------------------
export interface SerializedError { name: string; message: string; code?: string | null }
export interface SerializedHeader { key: string; value: string; disabled?: boolean }

export interface ResponseTimings {
  dns?: number;
  tcp?: number;
  secureHandshake?: number;
  firstByte?: number;
  download?: number;
  total?: number;
}

export interface SerializedResponse {
  code: number;
  status: string;
  responseTime: number | null;
  contentType: string;
  headers: SerializedHeader[];
  size: { body: number; header: number; total: number };
  body: string | null;
  bodyBase64: string | null;
  truncated: boolean;
  timings?: ResponseTimings | null;
}

export interface SerializedRequest { method: string; url: string; headers: SerializedHeader[]; body: string }
export type SerializedCookie = CookieJson;
export interface Assertion { name: string; passed: boolean; skipped: boolean; error: SerializedError | null }
export interface ScriptError extends SerializedError { target: ScriptTarget }
export interface VisualizerResult { error: SerializedError | null; processedTemplate: string | null; data: unknown }

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export type RequestSubtab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings';
export type ResponseSubtab = 'body' | 'cookies' | 'headers' | 'tests' | 'visualize';
export type BodyView = 'pretty' | 'raw' | 'preview';

/** Response-viewer state; request tabs carry it directly. */
export interface ResponseViewState {
  response: SerializedResponse | null;
  error: SerializedError | null;
  running?: string | null;
  tests: Assertion[];
  scriptErrors: ScriptError[];
  cookies: SerializedCookie[];
  visualizer: VisualizerResult | null;
  respTab: ResponseSubtab;
  bodyView?: BodyView;
  bodyLang?: string;
  wrap?: boolean;
}

export interface RequestTab extends ResponseViewState {
  id: string;
  type: 'request';
  collectionId: string | null;
  itemId: string | null;
  draft: Draft;
  /** Stable JSON of the draft as last saved; null for unsaved requests. */
  saved: string | null;
  subtab: RequestSubtab;
  reqPaneHeight?: number;
  scriptTab?: ScriptTarget;
  requestSent: SerializedRequest | null;
  running: string | null;
}

export interface ExampleTab { id: string; type: 'example'; collectionId: string; itemId: string; exampleId: string }

export type WsMessageKind = 'in' | 'out' | 'sys' | 'err';
export interface WsMessage { ts: number; kind: WsMessageKind; text: string; detail?: string; size?: number; expanded?: boolean }
export type WsStatus = 'disconnected' | 'connecting' | 'connected';

export interface WebSocketTab {
  id: string;
  type: 'websocket';
  url: string;
  headers: Row[];
  protocols: string;
  subtab: 'message' | 'headers' | 'settings';
  messages: WsMessage[];
  status: WsStatus;
  connId: string | null;
  filter?: 'all' | 'in' | 'out';
  compose?: string;
  format?: 'text' | 'json';
}

export interface EnvironmentTab { id: string; type: 'environment'; envId: string }
export type CollectionSubtab = 'overview' | 'auth' | 'scripts' | 'variables';
export interface CollectionTab { id: string; type: 'collection'; collectionId: string; nodeId: string | null; subtab: CollectionSubtab; scriptTab?: ScriptTarget }

export interface RunnerConfig {
  folderId: string;
  iterations: number;
  delay: number;
  data: Record<string, unknown>[] | null;
  dataName: string;
  stopOnError: boolean;
  persist: boolean;
}

export interface RunItemResult {
  ref: string;
  iteration: number;
  name: string;
  id: string | null;
  method: string;
  url?: string;
  status: 'running' | 'done' | 'cancelled';
  assertions: Assertion[];
  errors: string[];
  response: { code: number; status: string; time: number | null; size: number } | null;
  error: SerializedError | null;
  startedAt: number;
  expanded?: boolean;
}

export interface RunResult {
  startedAt: number;
  finishedAt: number | null;
  items: RunItemResult[];
  byRef: Record<string, RunItemResult>;
  total: number;
  iterations: number;
  aborted: boolean;
  error: SerializedError | null;
  errors: string[];
}

export interface RunnerTab { id: string; type: 'runner'; collectionId: string; config: Partial<RunnerConfig>; result: RunResult | null; running: string | null }

export type Tab = RequestTab | ExampleTab | WebSocketTab | EnvironmentTab | CollectionTab | RunnerTab;
export type TabType = Tab['type'];

/** Persisted shape of a tab: transient fields stripped. */
export type StoredTab = { id: string; type: TabType } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'warning' | 'error';

export interface NetworkConsoleEntry {
  id?: string;
  type: 'network';
  ts: number;
  method: string;
  url: string;
  pending: boolean;
  status?: number | null;
  statusText?: string | null;
  time?: number | null;
  size?: number | null;
  error?: SerializedError | null;
  request?: SerializedRequest | null;
  response?: SerializedResponse | null;
  tabId?: string;
  expanded?: boolean;
}

export interface LogConsoleEntry { type: ConsoleLevel; ts: number; messages: string[]; tabId?: string }
export type ConsoleEntry = NetworkConsoleEntry | LogConsoleEntry;
