## blog-api

Accompanying code for my [blog website](https://blog.n4o.xyz).

Deployed on Cloudflare Workers.

## Requirements
- Node 22
- Cloudflare CLI/Wrangler
- Cloudflare account

## Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Create a new `.dev.vars` for your local environment, see secrets part below.
4. Start the local server: `npm run dev`

### Secrets
- `PLAUSIBLE_HOST`: The host of your Plausible instance.
- `PLAUSIBLE_API_KEY`: The API key for your Plausible instance.
- `PLAUSIBLE_SITE_ID`: The site ID for your Plausible instance.
- `SPOTIFY_KEY`: The client ID for your Spotify app
- `SPOTIFY_SECRET`: The client secret for your Spotify app
- `SPOTIFY_REFRESH_TOKEN`: The refresh token for your Spotify account, you can use the dev console from Spotify to get this.

## Deploying
1. Install wrangler
2. Login to your Cloudflare account: `wrangler login`
3. Add each of your `.dev.vars` to your Cloudflare account:
   ```bash
   npx wrangler secret put PLAUSIBLE_HOST <PLAUSIBLE_HOST>
   ...
4. Create a new Cloudflare KV namespace: `npx wrangler kv namespace create BLOG_KV`
5. Bind the KV namespace to your project in `wrangler.toml`:
   ```toml
   kv_namespaces = [
	 { binding = "BLOG_KV", id = "<KV_ID>" }
   ]
   ```
5. Deploy the project: `npx wrangler publish`

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
