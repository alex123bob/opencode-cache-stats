import { Plugin } from '@opencode-ai/plugin';
import { TuiPlugin } from '@opencode-ai/plugin/tui';

declare const server: Plugin;
declare const rootTui: TuiPlugin;

declare const id = "opencode-cache-stats";
declare const _default: {
    id: string;
    server: Plugin;
};

export { _default as default, id, server, rootTui as tui };
