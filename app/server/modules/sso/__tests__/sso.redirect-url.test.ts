import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

test.each([
	{
		baseUrl: "https://zerobyte.example.com",
		trustProxy: "true",
		host: "zerobyte:4096",
		forwardedHost: "zerobyte.example.com",
		forwardedProto: "https",
		expectedProtocol: "https",
	},
	{
		baseUrl: "https://zerobyte.example.com",
		trustProxy: "false",
		host: "zerobyte.example.com",
		forwardedHost: "evil.example.com",
		forwardedProto: "http",
		expectedProtocol: "https",
	},
	{
		baseUrl: "http://zerobyte.example.com",
		trustProxy: "false",
		host: "zerobyte.example.com",
		forwardedHost: "evil.example.com",
		forwardedProto: "https",
		expectedProtocol: "http",
	},
	{
		baseUrl: "http://zerobyte.example.com",
		trustProxy: "true",
		host: "zerobyte:4096",
		forwardedHost: "zerobyte.example.com",
		forwardedProto: "https",
		expectedProtocol: "https",
	},
])("uses the expected public callback with BASE_URL=$baseUrl and TRUST_PROXY=$trustProxy", async (proxy) => {
	vi.stubEnv("BASE_URL", proxy.baseUrl);
	vi.stubEnv("TRUST_PROXY", proxy.trustProxy);
	vi.resetModules();

	const { db, runDbMigrations } = await import("~/server/db/db");
	const { organization, ssoProvider } = await import("~/server/db/schema");
	const { auth } = await import("~/server/lib/auth");

	await runDbMigrations();

	const organizationId = Bun.randomUUIDv7();
	await db.insert(organization).values({
		id: organizationId,
		name: "Example",
		slug: "example",
		createdAt: new Date(),
	});

	await db.insert(ssoProvider).values({
		id: Bun.randomUUIDv7(),
		providerId: "example-oidc",
		organizationId,
		issuer: "https://idp.example.com",
		domain: "example.com",
		oidcConfig: {
			clientId: "example-client",
			clientSecret: "example-secret",
			skipDiscovery: true,
			authorizationEndpoint: "https://idp.example.com/authorize",
			tokenEndpoint: "https://idp.example.com/token",
			jwksEndpoint: "https://idp.example.com/jwks",
		},
	});

	const response = await auth.handler(
		new Request("http://zerobyte:4096/api/auth/sign-in/sso", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Host: proxy.host,
				"X-Forwarded-Host": proxy.forwardedHost,
				"X-Forwarded-Proto": proxy.forwardedProto,
			},
			body: JSON.stringify({ providerId: "example-oidc", callbackURL: "/" }),
		}),
	);

	expect(response.status).toBe(200);

	const { url } = (await response.json()) as { url: string };
	const redirectUri = new URL(url).searchParams.get("redirect_uri");

	expect(redirectUri).toBe(`${proxy.expectedProtocol}://zerobyte.example.com/api/auth/sso/callback/example-oidc`);
});
