import { Plugin } from '@opencode-ai/plugin';
import { TuiPlugin } from '@opencode-ai/plugin/tui';

declare const server: Plugin;
declare const tui: TuiPlugin;
declare const id = "opencode-cache-stats";
declare const _default: {
    id: string;
    server: Plugin;
    tui: TuiPlugin;
};

export { _default as default, id, server, tui };
