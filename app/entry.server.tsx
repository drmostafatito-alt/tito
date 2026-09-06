import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
// entry.server.tsx is the SSR entry (server-only, never in the client bundle), so
// it legitimately reads server state; the relative import keeps the module-boundary
// linter's `~server/*` ban scoped to real client code (app/routes + root only).
import { cspNonceContext } from "../server/csp.server";

/** Nonce shared with the root middleware so the CSP header matches the inline
 *  scripts ServerRouter emits (see server/csp.server.ts). */
type NonceProvider = { get?: (definition: typeof cspNonceContext) => string };

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	loadContext?: NonceProvider,
) {
	let shellRendered = false;
	const userAgent = request.headers.get("user-agent");
	const nonce = loadContext?.get?.(cspNonceContext);

	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
		{
			onError(error: unknown) {
				responseStatusCode = 500;
				// Log streaming rendering errors from inside the shell.  Don't log
				// errors encountered during initial shell rendering since they'll
				// reject and get logged in handleDocumentRequest.
				if (shellRendered) {
					console.error(error);
				}
			},
		},
	);
	shellRendered = true;

	// Ensure requests from bots and SPA Mode renders wait for all content to load before responding
	// https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
	if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
		await body.allReady;
	}

	responseHeaders.set("Content-Type", "text/html");
	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
