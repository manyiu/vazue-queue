# Reserved hostnames (vazue.com)

Do not assign these as tenant slugs: `api`, `www`, `admin`, `app`, `docs`, `status`, `cdn`, `wait`, `queue`, `mail`, `smtp`.

## Production
- queue.vazue.com
- app.queue.vazue.com
- api.queue.vazue.com
- *.wait.queue.vazue.com
- docs.queue.vazue.com
- status.queue.vazue.com

## Staging / Dev
See `staging.json` and `dev.json`.

## OSS phase (early)
Prioritize `queue.vazue.com` (unified website: marketing + docs at `/docs`) before full SaaS trees.
`docs.queue.vazue.com` should redirect to `queue.vazue.com/docs`.
