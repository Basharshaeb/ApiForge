/**
 * Contract between the app core and tab views.
 */
export interface View {
  el: HTMLElement;
  /** Re-render after external changes (response arrived, item renamed, ...). */
  update(): void;
  destroy?(): void;
  focus?(): void;
  /** Cheap refresh of unsaved-change indicators while the user types. */
  markDirty?(): void;
  /** Set when an update happened while the tab was in the background. */
  stale?: boolean;
}

export interface ConsoleView { el: HTMLElement; update(): void }
