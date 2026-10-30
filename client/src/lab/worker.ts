import { hunt, machines, report, rowFor, shrinkKill } from "./court-api";

export const API = {
	machines,
	report,
	row: rowFor,
	shrink: shrinkKill,
	hunt,
} as const;
export type Api = typeof API;

addEventListener(
	"message",
	(event: MessageEvent<{ id: number; name: keyof Api; args: unknown[] }>) => {
		const { id, name, args } = event.data;
		try {
			const result = (API[name] as (...a: unknown[]) => unknown)(...args);
			postMessage({ id, result });
		} catch (error) {
			postMessage({ id, result: null, error: String(error) });
		}
	},
);
