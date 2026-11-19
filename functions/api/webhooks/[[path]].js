// POST /api/webhooks/<server>/<webhook>/<token>: a webhook posting a message into a Frixion channel (v4.69, request 50),
// with JSON shaped like Discord's: { "content": "hi", "username": "...", "avatar_url": "https://..." }. The work happens
// in functions/api/admin/[[path]].js (webhookPost), next to the database code it needs; this only hands the request on.
import { onRequest as admin } from '../admin/[[path]].js';

export const onRequest = ctx => admin({ ...ctx, params: { path: ['hook', ...[].concat(ctx.params.path || [])] } });
