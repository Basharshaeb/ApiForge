/**
 * Tab view registry: builds the view component for a tab descriptor.
 */
import type { Tab } from '../../shared/types';
import { collectionView } from './collection';
import { environmentView } from './environment';
import { exampleView } from './request/example';
import { requestView } from './request';
import { runnerView } from './runner';
import type { View } from './types';
import { websocketView } from './websocket';

export function createView(tab: Tab): View {
  switch (tab.type) {
    case 'request': return requestView(tab);
    case 'example': return exampleView(tab);
    case 'websocket': return websocketView(tab);
    case 'environment': return environmentView(tab);
    case 'collection': return collectionView(tab);
    case 'runner': return runnerView(tab);
    default: {
      const never: never = tab;
      throw new Error(`Unknown tab type: ${(never as Tab).type}`);
    }
  }
}

export type { View } from './types';
