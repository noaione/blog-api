import { Environment } from "./types";
import { isEnvEmpty, JSONResponse } from "./utils";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing";

type CachedToken = {
	currentToken: string | null;
	ttl: number; // Time to live in milliseconds
}

const cachedToken: CachedToken = {
	currentToken: null,
	ttl: -1,
};

type TokenResponse = {
	access_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
};

type SimpleSpotifyResponse = {
	playing: boolean;
	data?: {
		title: string
		album: {
			name: string;
			date: string;
			cover?: string;
			url: string;
		};
		artist: {
			id: string;
			name: string;
			url?: string;
		}[];
		url: string;
		progress?: number;
		duration: number;
	};
	error?: string;
	statusCode?: number;
}

interface SimpleSpotifyNowPlayingResponse {
	is_playing: boolean;
	progress_ms?: number;
	currently_playing_type: string;
	item: {
		name: string;
		album: {
			name: string;
			images: { url: string }[];
			release_date: string;
			external_urls: {
				spotify: string;
			};
		};
		external_urls: {
			spotify: string;
		};
		artists: {
			id: string;
			name: string;
			external_urls?: {
				spotify: string;
			};
		}[];
		duration_ms: number;
	}
}

function makeAuthBasic(env: Environment): string | null {
	if (isEnvEmpty(env.SPOTIFY_KEY) || isEnvEmpty(env.SPOTIFY_SECRET)) {
		return null;
	}

	return btoa(`${env.SPOTIFY_KEY}:${env.SPOTIFY_SECRET}`);
}

async function getFromKVCache(env: Environment): Promise<string | null | false> {
	if (isEnvEmpty(env.SPOTIFY_KEY)) {
		return false;
	}

	try {
		const value = await env.BLOG_KV.get<CachedToken>(`spotify-cache-${env.SPOTIFY_KEY!}`, 'json');
		// Check TTL and return value
		if (value && value.ttl > Date.now()) {
			cachedToken.currentToken = value.currentToken;
			cachedToken.ttl = value.ttl;
			return value.currentToken;
		}
	} catch (error) {
		// Check error code
		if (error instanceof Error) {
			console.error("Spotify.now(): Error fetching token from KV:", error.message);
		} else {
			console.error("Spotify.now(): Error fetching token from KV:", error);
		}
	}
	return null;
}

async function fetchAccessToken(env: Environment): Promise<string | null | false> {
	const currentTime = Date.now();
	if (!cachedToken.currentToken) {
		const cachedValue = await getFromKVCache(env);
		if (cachedValue === false) {
			return null;
		}
		if (cachedValue) {
			return cachedValue;
		}
	}

	if (cachedToken.ttl > currentTime) {
		return cachedToken.currentToken;
	}

	const auth = makeAuthBasic(env);
	if (!auth) {
		return null;
	}

	const refreshToken = env.SPOTIFY_REFRESH_TOKEN
	if (isEnvEmpty(refreshToken)) {
		return null;
	}

	console.log('Spotify.now(): Fetching new token');
	const params = new URLSearchParams();
	params.append("grant_type", "refresh_token");
	params.append("refresh_token", refreshToken!);

	try {
		const response = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params,
		});

		if (!response.ok) {
			console.error("Spotify.now(): Error fetching token:", response.statusText);
			return false;
		}

		const data = await response.json<TokenResponse>();
		cachedToken.currentToken = data.access_token;
		cachedToken.ttl = currentTime + data.expires_in * 1000 - 60000; // 1 minute buffer

		// Save to KV
		await env.BLOG_KV.put(
			`spotify-cache-${env.SPOTIFY_KEY!}`,
			JSON.stringify({
				currentToken: data.access_token,
				ttl: cachedToken.ttl,
			})
		);

		return data.access_token;
	} catch (error) {
		// Check error code
		if (error instanceof Error) {
			console.error("Spotify.now(): Error fetching token:", error.message);
		} else {
			console.error("Spotify.now(): Error fetching token:", error);
		}

		return false;
	}
}

async function getLatestNowPlaying(env: Environment): Promise<SimpleSpotifyResponse> {
	const accessToken = await fetchAccessToken(env);
	if (accessToken === false) {
		return {
			playing: false,
			error: "Error fetching access token",
		}
	}

	if (!accessToken) {
		return {
			playing: false,
			error: "Not ready",
			statusCode: 503,
		};
	}

	try {
		const response = await fetch(NOW_PLAYING_ENDPOINT, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			console.error("Spotify.now(): Error fetching now playing:", response.statusText);
			return {
				playing: false,
				error: "Error fetching now playing",
				statusCode: 503,
			};
		}

		if (response.status === 204) {
			return {
				playing: false,
				statusCode: 200,
			}
		}

		const jsonData = await response.json<SimpleSpotifyNowPlayingResponse>();
		const { is_playing, item, currently_playing_type } = jsonData;
		if (currently_playing_type !== "track") {
			return {
				playing: false,
				error: "Not a track",
				statusCode: 200,
			}
		}

		const data = {
			url: item.external_urls.spotify,
			title: item.name,
			album: {
				name: item.album.name,
				date: item.album.release_date,
				cover: item.album.images?.[0].url,
				url: item.album.external_urls.spotify,
			},
			artist: item.artists.map((p) => {
				return {
					id: p.id,
					name: p.name,
					url: p.external_urls?.spotify,
				};
			}),
			progress: jsonData.progress_ms,
			duration: item.duration_ms,
		};

		return {
			playing: is_playing,
			data,
			statusCode: 200,
		}
	} catch (error) {
		// Check error code
		if (error instanceof Error) {
			console.error("Spotify.now(): Error fetching now playing:", error.message);
		} else {
			console.error("Spotify.now(): Error fetching now playing:", error);
		}
		return {
			playing: false,
			error: "Error fetching now playing",
			statusCode: 500,
		};
	}
}

export async function fetchNowPlaying(env: Environment, corsHeaders: Record<string, string>): Promise<Response | null> {
	const results = await getLatestNowPlaying(env);
	return JSONResponse(results, results.statusCode || 200, corsHeaders);
}

export async function fetchSpotifyShields(env: Environment, corsHeaders: Record<string, string>): Promise<Response | null> {
	const results = await getLatestNowPlaying(env);

	if (results.error) {
		console.error("Spotify.shields(): Error fetching now playing:", results.error);
		return JSONResponse(
			{
				schemaVersion: 1,
				label: "Spotify",
				namedLogo: "spotify",
				color: "#a62828",
				message: "An error occurred when fetching tracks!",
				labelColor: "#181818",
				isError: true,
			},
			200,
			corsHeaders
		);
	}

	const shieldsData = {
		schemaVersion: 1,
		label: "listening to",
		namedLogo: "spotify",
		color: "#1DB954",
		message: "nothing",
		labelColor: "#181818",
	};
	if (results.playing && results.data?.title) {
		shieldsData.message = results.data.title;
	}

	return JSONResponse(shieldsData, 200, corsHeaders);
}
