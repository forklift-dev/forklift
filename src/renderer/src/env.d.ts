/// <reference types="vite/client" />

import type { ForkliftBridge } from '../../shared/bridge';

declare global {
  interface Window {
    forklift: ForkliftBridge;
  }
}
