declare const __TIREKICK_VERSION__: string;

/** Package version, inlined by tsup at build time (see tsup.config.ts). */
export const VERSION: string = typeof __TIREKICK_VERSION__ === "string" ? __TIREKICK_VERSION__ : "0.0.0-dev";
