import { parseLook, type Look } from '../net/look.ts';
import { store } from './dom.ts';

/** Your look on this device, edited in the Locker and sent along when you play online. */
export function loadLook(): Look {
  try {
    return parseLook(JSON.parse(store.get('ff-look') ?? 'null'));
  } catch {
    return parseLook(null);
  }
}

export function saveLook(look: Look): void {
  store.set('ff-look', JSON.stringify(look));
}

export const loadName = () => store.get('ff-name') ?? '';
export const saveName = (name: string) => store.set('ff-name', name.trim());
