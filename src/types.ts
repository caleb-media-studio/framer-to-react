/** Portable archive contracts. SDK-provided attributes are open-ended and validated at use sites. */
export type ArchiveFiles = Record<string, string | Uint8Array>
export type Attributes = Record<string, any>
export type JsonObject = Record<string, any>
export interface Rect { x:number; y:number; width:number; height:number }
export interface DesignNode {
  id: string
  kind: string
  attributes?: Attributes
  children?: DesignNode[]
  text?: string | null
  richTextHTML?: string | null
  rect?: Rect | null
  layerPath?:string
  reference?: NodeReference
  [extra:string]: unknown
}
export interface Snapshot {
  roots: DesignNode[]
  truncated?: boolean
  warnings?: string[]
  pagePath?: string
  nodeCount?: number
  diagnostics?: DiagnosticIssue[]
  [extra:string]: unknown
}
export interface Breakpoint { id: string; directory: string; width?: string | number | null; name?: string; primary?: boolean }
export interface PageRecord { warnings?:string[];nodeCount?:number;type?:string;id?: string; path: string; directory: string; breakpoints?: Breakpoint[]; truncated?: boolean; [extra:string]: unknown }
export interface Manifest { format: string; pages?: PageRecord[]; projectName?: string; requestedPages?: number; failures?: unknown[]; [extra:string]: unknown }
export interface Issue {stage: string; severity: string; message?: string; route?: string; code?: string; count?: number;nodeId?:string}
export interface Provenance {source?:string; url?:string; viewport?:{width?:number;height?:number}; capturedAt?:string; responseSha256?:string; [extra:string]:unknown}
export interface InlineTextRun {text:string;style:Record<string,string>}
export interface TextEvidence {nodeId:string;confidence:string;framerName?:string;method?:string;domPath?:string;style?:Record<string,string>;hardBreakText?:string;inlineRuns?:InlineTextRun[];vector?:unknown;[extra:string]:unknown}
export interface ReferenceDocument {breakpointId?:string|null;provenance?:Provenance;vectorProvenance?:Provenance;evidence?:TextEvidence[];vectors?:TextEvidence[];unmatchedArchive?:string[];unmatchedLive?:{name?:string;text?:string}[];[extra:string]:unknown}
export interface Evidence {route:string;doc:ReferenceDocument;file?:string}
export interface NodeReference {textStyle?:Record<string,string>;tag?:string;hardBreakText?:string;inlineRuns?:InlineTextRun[];vector?:unknown;provenance?:Provenance}
export interface LayoutVariant {id:string;width:number;mediaQuery?:unknown;root:DesignNode}
export interface LayoutTemplate {id:string;name?:string;variants:LayoutVariant[]}
export interface LayoutBinding {id:string;path:string;layout?:string|null;controls?:unknown}
export interface LayoutSource {format:string;templates:LayoutTemplate[];bindings:LayoutBinding[];assets:ArchiveFiles;issues:Issue[]}
export interface CaptureDiagnostics {summary?:Record<string,number>;groups?:Issue[]}
export interface CodeFile {id:string;path:string;source:string;exports:unknown[]}
export interface CodeImport {exportName:string;importPath:string}
export type Axis = 'grid'|'row'|'column'|null
export type CSSProperties = Record<string,string>
export interface ReusableBlock {id:number;kind:'component'|'layout';name?:string;identity:string;markup:string}
export interface ReusableVariant {path:string;route:string;tsx:string;blocks:ReusableBlock[]}
export interface RenderOptions {
  layoutSlot?:boolean
  resolveCapturedIcon?:(node:DesignNode)=>string|null
  resolveCapturedColor?:import('./design-tokens.ts').ColorResolver
  collectReusable?:boolean
  referenceOverlay?:Overlay|null
  resolveCodeComponent?:(identifier:unknown)=>CodeImport|null
  resolveCanvasComponent?:(identifier:unknown)=>DesignNode|null
}
export interface NativeField {id:string;label:string;type:string;placeholder:string}
export interface OverlayRow {route:string;width:number|null;breakpointId:string|null;high:number;medium:number;low:number;applied:number;appliedFields:number;foreignNode:number;unmatchedArchive:number;unmatchedLive:number;status:string;consensus?:number;vectors?:number;[key:string]:string|number|null|undefined}
export interface OverlayConflict {route:string;width:number|null;nodeId:string;field:string;editor:unknown;reference:unknown;kept:string}
export interface Overlay {format:string;nodes:Record<string,NodeReference>;conflicts:OverlayConflict[];coverage:OverlayRow[];skippedEvidence?:unknown[]}
export const textFile = (files:ArchiveFiles,key:string,fallback=''):string => typeof files[key]==='string' ? files[key] as string : fallback

export interface SDKNode {
  id?:string; type?:string; name?:string
  getChildren?:()=>Promise<SDKNode[]>; getText?:()=>Promise<string|null>; getHTML?:()=>Promise<string|null>
  getSVG?:()=>Promise<string|null>; getRect?:()=>Promise<Rect|null>
  navigateTo?:(options:{select:boolean;zoomIntoView:boolean})=>Promise<unknown>
  [key:string]:any
}
export interface SDKClient {
  getSelection?:()=>Promise<SDKNode[]>
  getNodesWithType?:(type:any)=>Promise<SDKNode[]>
  [method:string]:any
}
export interface CaptureState {count:number;maxNodes:number;warnings:Set<string>}
export interface HydrationOptions {timeoutMs?:number;pollMs?:number}
export interface PageInput {id?:string;path:string;type?:string;pathIsInferred?:boolean}
export interface PageDescriptor extends PageInput {id:string;title:string;type:string;node:SDKNode;pathIsInferred:boolean}
export interface Folder<T extends {path:string}> {type:string;name:string;path:string;children:Folder<T>[];pages:T[]}
export interface URLReference {url:string;usedBy:string[]}
export interface InlineSVG {source:string;usedBy:string;path?:string;nodeId?:string|null;nodeName?:string|null}
export interface FontDescriptor {family:string;url?:string;weight?:number|string;style?:string}
export interface AssetReferences {urls:URLReference[];inlineSvg:InlineSVG[];fontFamilies?:string[];fontDescriptors?:FontDescriptor[]}
export interface AssetRecord {url?:string;usedBy:string[];path?:string;bundled:boolean;type?:string;nodeId?:string|null;nodeName?:string|null;reason?:string}
export interface LibraryResult {files:ArchiveFiles;componentSnapshots:Snapshot[];warnings:string[];summary:Record<string,number>;limitations:string[]}
export interface AssetResult {files:ArchiveFiles;manifest:AssetRecord[];warnings:string[];totalBytes:number}
export type Severity='error'|'warning'|'review'|'info'
export interface DiagnosticLocation {page?:string;layerPath?:string;nodeName?:string;nodeId?:string|null;nodeType?:string;componentIdentifier?:string|null;componentName?:string|null;capturedProperties?:string[];assetUrl?:string;usedBy?:string[];affectedInstances?:DiagnosticLocation[]}
export interface DiagnosticIssue extends DiagnosticLocation {source:string;severity:Severity;code:string;message:string;fix?:string}
export interface DiagnosticGroup {code:string;severity:Severity;title:string;message:string;fix?:string;count:number;affectedPages:string[];examples:DiagnosticIssue[];locations:DiagnosticIssue[]}
export interface InventoryEntry {identifier:string;name:string;kind:string;count:number;pages:Set<string>;instances:DiagnosticLocation[]}
export const errorMessage=(error:unknown):string=>String(error && typeof error==='object' && 'message' in error && error.message || error)
