import { Router, IRequest } from 'itty-router';
import { getFirstOne, isEnvEmpty, JSONResponse, TextResponse, walkJson } from './utils';
import { CFArgs } from './types';
import { fetchNowPlaying } from './spotify';

// now let's create a router (note the lack of "new")
const router = Router<IRequest, CFArgs>();

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
	"Access-Control-Max-Age": "86400",
};

// Handle CORS preflight requests
router.options('*', (request, env) => {
	if (
		request.headers.get("Origin") !== null &&
		request.headers.get("Access-Control-Request-Method") !== null &&
		request.headers.get("Access-Control-Request-Headers") !== null
	) {
		// Handle CORS preflight requests.
		return new Response(null, {
			headers: {
				...corsHeaders,
				"Access-Control-Allow-Headers": request.headers.get(
					"Access-Control-Request-Headers",
				) ?? "",
			},
		});
	} else {
		// Handle standard OPTIONS request.
		return new Response(null, {
			headers: {
				Allow: "GET, HEAD, POST, OPTIONS",
			},
		});
	}
})

router.get('/', () => TextResponse('</> made by @noaione </>', 200, corsHeaders));

// Spotify related
router.get('/spotify/now', async (_, env) => {
	const { SPOTIFY_KEY, SPOTIFY_SECRET, SPOTIFY_REFRESH_TOKEN } = env;

	if (isEnvEmpty(SPOTIFY_KEY) || isEnvEmpty(SPOTIFY_SECRET) || isEnvEmpty(SPOTIFY_REFRESH_TOKEN)) {
		return JSONResponse({ playing: false, error: 'Spotify credentials not set' }, 503, corsHeaders);
	}

	return fetchNowPlaying(env, corsHeaders)
});

// Plausible hits
router.get('/stats/hits', async (req, env) => {
	// Check query params
	const slug = getFirstOne(req.query.slug);
	if (isEnvEmpty(slug)) {
		return JSONResponse({ error: 'Missing slug' }, 400);
	}

	const siteId = getFirstOne(req.query.siteId);

	if (isEnvEmpty(env.PLAUSIBLE_HOST) || isEnvEmpty(env.PLAUSIBLE_API_KEY)) {
		return JSONResponse({ error: 'Plausible credentials not set' }, 503, corsHeaders);
	}

	const preferSiteId = isEnvEmpty(siteId) ? env.PLAUSIBLE_SITE_ID : siteId;
	if (isEnvEmpty(preferSiteId)) {
		return JSONResponse({ error: 'Missing siteId' }, 400, corsHeaders);
	}

	if (!URL.canParse(env.PLAUSIBLE_HOST!)) {
		return JSONResponse({ error: 'Invalid Plausible host' }, 503, corsHeaders);
	}

	const apiUrl = new URL(env.PLAUSIBLE_HOST!);
	apiUrl.pathname = '/api/v2/query';

	// Decode slug
	let decodedSlug = decodeURIComponent(slug!);
    if (!decodedSlug.startsWith('/')) {
		decodedSlug = '/' + decodedSlug;
    }

	const requestParams = {
		"site_id": preferSiteId,
		"metrics": ["visits"],
		"date_range": "all",
		"filters": [
			["is", "event:page", [decodedSlug]],
		],
	};

	try {
		const respData = await fetch(apiUrl.toString(), {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${env.PLAUSIBLE_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestParams),
		});

		if (!respData.ok) {
			return JSONResponse({ error: 'Error fetching data from Plausible' }, 500, corsHeaders);
		}

		const decodedData = await respData.json<Record<string, unknown>>();

		const walkedData = walkJson(decodedData, "results.0.metrics.0");
		if (typeof walkedData === 'number') {
			return JSONResponse({ hits: walkedData });
		}
		return JSONResponse({ error: 'Invalid data from Plausible' }, 500, corsHeaders);
	} catch (error) {
		return JSONResponse({ error: 'Error fetching data from Plausible' }, 500, corsHeaders);
	}
})

// 404 for everything else
router.all('*', () => TextResponse('Not found', 404, corsHeaders));

export default router;
