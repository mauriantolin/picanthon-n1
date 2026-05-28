import { defineManifest } from '@crxjs/vite-plugin'
import pkg from '../package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Picanthon',
  version: pkg.version,
  description: pkg.description,
  action: {
    default_title: 'Open Picanthon sidebar',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // ISOLATED world (default): reads/mutates the DOM, mounts components.
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    {
      // MAIN world, as early as possible: patches the page's fetch/XHR to buffer
      // the JSON responses it receives. No chrome.* here — talks via postMessage.
      matches: ['<all_urls>'],
      js: ['src/content/network-recorder.ts'],
      run_at: 'document_start',
      // crxjs's manifest type omits `world`, but Chrome MV3 supports it.
      // @ts-expect-error -- valid MV3 content_scripts field
      world: 'MAIN',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'tabs'],
  host_permissions: ['<all_urls>'],
})
