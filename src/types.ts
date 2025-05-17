export type Environment = {
	PLAUSIBLE_HOST?: string;
	PLAUSIBLE_API_KEY?: string;
	PLAUSIBLE_SITE_ID?: string;
	SPOTIFY_KEY?: string;
	SPOTIFY_SECRET?: string;
	SPOTIFY_REFRESH_TOKEN?: string;
	BLOG_KV: KVNamespace;
};

export type CFArgs = [Environment, ExecutionContext];
