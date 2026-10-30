import { API, type Api } from "./loop";

addEventListener(
	"message",
	(event: MessageEvent<{ id: number; name: keyof Api; args: unknown[] }>) => {
		const { id, name, args } = event.data;
		const result = (API[name] as (...a: unknown[]) => unknown)(...args);
		postMessage({ id, result });
	},
);
