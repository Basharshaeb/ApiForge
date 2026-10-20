/**
 * Environment and globals operations, plus import of pasted/opened files.
 */
import type { CollectionJson, Draft, Environment, ImportResult, Row } from '../../shared/types';
import * as M from '../model';
import { confirm, prompt, toast } from '../ui';
import { findCollection } from './lookups';
import { save } from './persistence';
import { app } from './state';
import { closeTabsWhere, newRequest, notify, openEnvironment } from './tabs';

const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, '_');

export async function createEnvironment(): Promise<Environment | null> {
  const name = await prompt({ title: 'New Environment', label: 'Name', value: 'New Environment', okLabel: 'Create' });
  if (!name) return null;
  const env = M.newEnvironment(name);
  app.state.environments.push(env);
  save();
  notify({ sidebar: true });
  openEnvironment(env.id);
  return env;
}

export function setActiveEnvironment(id: string | null): void {
  app.state.settings.activeEnvironmentId = id || null;
  save();
  notify({ sidebar: true, tabs: 'all' });
}

export async function renameEnvironment(env: Environment): Promise<void> {
  const name = await prompt({ title: 'Rename Environment', label: 'Name', value: env.name });
  if (!name) return;
  env.name = name;
  save();
  notify({ sidebar: true, tabs: 'all' });
}

export function duplicateEnvironment(env: Environment): void {
  const copy = M.clone(env);
  copy.id = M.uid();
  copy.name = `${env.name} Copy`;
  app.state.environments.splice(app.state.environments.indexOf(env) + 1, 0, copy);
  save();
  notify({ sidebar: true });
}

export async function deleteEnvironment(env: Environment): Promise<void> {
  const ok = await confirm({ title: 'Delete Environment', message: `Delete environment "${env.name}"?`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  app.state.environments = app.state.environments.filter((e) => e !== env);
  if (app.state.settings.activeEnvironmentId === env.id) app.state.settings.activeEnvironmentId = null;
  closeTabsWhere((t) => t.type === 'environment' && t.envId === env.id);
  save();
  notify({ sidebar: true, tabs: 'all' });
}

export async function exportEnvironment(env: Environment, scope: 'environment' | 'globals' = 'environment'): Promise<void> {
  const data = M.exportEnvironment(env, scope);
  const file = await window.apiforge.files.saveText({ defaultName: `${safeFileName(env.name)}.postman_${scope}.json`, content: JSON.stringify(data, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (file) toast(`Exported to ${file}`, 'success');
}

// Import ------------------------------------------------------------------
function importCollection(c: CollectionJson): string {
  if (findCollection(c.info._postman_id)) c.info._postman_id = M.uid();
  app.state.collections.push(c);
  app.expanded.add(c.info._postman_id);
  save();
  notify({ sidebar: true });
  return `Imported collection "${c.info.name}" (${M.countRequests(c.item)} requests)`;
}

function importEnvironment(env: Environment): string {
  app.state.environments.push(env);
  save();
  notify({ sidebar: true });
  return `Imported environment "${env.name}"`;
}

async function importGlobals(values: Row[]): Promise<string> {
  const ok = await confirm({ title: 'Replace Globals', message: 'This file contains global variables. Replace your current globals with it?', okLabel: 'Replace' });
  if (!ok) return 'Skipped globals';
  app.state.globals.values = values;
  save();
  notify({ sidebar: true, tabs: 'all' });
  return 'Imported globals';
}

function importRequest(draft: Draft): string {
  newRequest(draft);
  return 'Opened request from cURL';
}

/** Detects the format, imports it and returns a human-readable summary. */
export async function importFromText(text: string): Promise<string> {
  const result: ImportResult = M.importText(text);
  switch (result.kind) {
    case 'collection': return importCollection(result.value);
    case 'environment': return importEnvironment(result.value);
    case 'globals': return importGlobals(result.value);
    case 'request': return importRequest(result.value);
    default: return 'Nothing imported';
  }
}
