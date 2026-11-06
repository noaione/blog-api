import { Router, IRequest } from 'itty-router';
import { getFirstOne, isEnvEmpty, JSONResponse, TextResponse, walkJson } from './utils';
import { CFArgs } from './types';
import { fetchNowPlaying, fetchSpotifyShields } from './spotify';
import { getCurrentSplashImage } from './shuffler';
import { parseUserCardData, renderUserCard, UserCardInputError } from './userCard';

// now let's create a router (note the lack of "new")
const router = Router<IRequest, CFArgs>();

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
};
const MAX_USER_CARD_REQUEST_BYTES = 1_000_000;

// Handle CORS preflight requests
router.options('*', (request, env) => {
    if (
        request.headers.get('Origin') !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null
    ) {
        // Handle CORS preflight requests.
        return new Response(null, {
            headers: {
                ...corsHeaders,
                'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? '',
            },
        });
    } else {
        // Handle standard OPTIONS request.
        return new Response(null, {
            headers: {
                Allow: 'GET, HEAD, POST, OPTIONS',
            },
        });
    }
});

router.get('/', () => TextResponse('</> made by @noaione </>', 200, corsHeaders));

// Spotify related
router.get('/spotify/now', async (_, env) => {
    const { SPOTIFY_KEY, SPOTIFY_SECRET, SPOTIFY_REFRESH_TOKEN } = env;

    if (isEnvEmpty(SPOTIFY_KEY) || isEnvEmpty(SPOTIFY_SECRET) || isEnvEmpty(SPOTIFY_REFRESH_TOKEN)) {
        return JSONResponse({ playing: false, error: 'Spotify credentials not set' }, 503, corsHeaders);
    }

    return fetchNowPlaying(env, corsHeaders);
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
        site_id: preferSiteId,
        metrics: ['visits'],
        date_range: 'all',
        filters: [['is', 'event:page', [decodedSlug]]],
    };

    try {
        const respData = await fetch(apiUrl.toString(), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.PLAUSIBLE_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestParams),
        });

        if (!respData.ok) {
            return JSONResponse({ error: 'Error fetching data from Plausible' }, 500, corsHeaders);
        }

        const decodedData = await respData.json<Record<string, unknown>>();

        const walkedData = walkJson(decodedData, 'results.0.metrics.0');
        if (typeof walkedData === 'number') {
            return JSONResponse({ hits: walkedData });
        }
        return JSONResponse({ error: 'Invalid data from Plausible' }, 500, corsHeaders);
    } catch (error) {
        return JSONResponse({ error: 'Error fetching data from Plausible' }, 500, corsHeaders);
    }
});

// Shields related
router.get('/shields/spotify', async (_, env) => {
    const { SPOTIFY_KEY, SPOTIFY_SECRET, SPOTIFY_REFRESH_TOKEN } = env;

    if (isEnvEmpty(SPOTIFY_KEY) || isEnvEmpty(SPOTIFY_SECRET) || isEnvEmpty(SPOTIFY_REFRESH_TOKEN)) {
        return JSONResponse(
            {
                schemaVersion: 1,
                label: 'Spotify',
                namedLogo: 'spotify',
                color: '#a62828',
                message: 'Spotify credentials not set',
                labelColor: '#181818',
                isError: true,
            },
            503,
            corsHeaders
        );
    }

    return fetchSpotifyShields(env, corsHeaders);
});

router.get('/image-splash', (req) => {
    const selectedIndex = getFirstOne(req.query.num);
    // Parse as number
    const imageIndex = selectedIndex ? parseInt(selectedIndex, 10) : null;

    const imgUrl = getCurrentSplashImage(imageIndex);
    return new Response(null, {
        status: 302,
        headers: {
            Location: imgUrl,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
            ...corsHeaders,
        },
    });
});

// User card image generation
router.post('/user-card', async (req, env) => {
	const contentType = req.headers.get('content-type') ?? '';
	if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
		return JSONResponse({ error: 'Content-Type must be application/json' }, 415, corsHeaders);
	}

	const declaredLength = Number(req.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_USER_CARD_REQUEST_BYTES) {
		return JSONResponse({ error: 'Request body is too large' }, 413, corsHeaders);
	}

	let requestData: unknown;
	try {
		const body = await req.text();
		if (new TextEncoder().encode(body).byteLength > MAX_USER_CARD_REQUEST_BYTES) {
			return JSONResponse({ error: 'Request body is too large' }, 413, corsHeaders);
		}
		requestData = JSON.parse(body);
	} catch {
		return JSONResponse({ error: 'Request body must contain valid JSON' }, 400, corsHeaders);
	}

	let cardData;
	try {
		cardData = parseUserCardData(requestData);
	} catch (error) {
		if (error instanceof UserCardInputError) {
			return JSONResponse({ error: error.message }, 400, corsHeaders);
		}
		return JSONResponse({ error: 'Invalid user card data' }, 400, corsHeaders);
	}

	try {
		const image = await renderUserCard(cardData, env.BLOG_BROWSER);
		const headers = new Headers(image.headers);
		for (const [name, value] of Object.entries(corsHeaders)) {
			headers.set(name, value);
		}
		return new Response(image.body, { status: image.status, headers });
	} catch (error) {
		console.error('Failed to render user card', error);
		return JSONResponse({ error: 'Failed to render user card' }, 502, corsHeaders);
	}
});

// 404 for everything else
router.all('*', () => TextResponse('Not found', 404, corsHeaders));

export default router;
