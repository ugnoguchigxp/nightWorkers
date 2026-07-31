// biome-ignore lint/suspicious/noExplicitAny: projection-only host rows stay opaque to package persistence
type HostProjectionRow = any;

export declare const activityEvents: { $inferSelect: HostProjectionRow };
export declare const taskMessages: { $inferSelect: HostProjectionRow };
