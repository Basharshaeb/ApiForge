/**
 * Shared context handed to the request editor panels.
 */
import type { Draft, RequestTab, VariableMap } from '../../../shared/types';
import type { VarInput } from '../../ui';

export interface RequestCtx {
  tab: RequestTab;
  draft: Draft;
  el: HTMLElement;
  header: HTMLElement;
  /** Container the active panel renders into. */
  body: HTMLElement;
  subtabsEl: HTMLElement;
  urlInput: VarInput;
  methodSelect: HTMLSelectElement;
  sendBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  getVars(): VariableMap;
  dirty(): void;
  refreshSubtabs(): void;
  renderRequestBody(): void;
}

export type Panel = (ctx: RequestCtx) => void;
