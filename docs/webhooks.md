# Webhook subscriptions

Tenant-scoped webhook subscriptions are exposed under `/api/webhooks`.

## Endpoints

- `POST /api/webhooks?orgId=<orgId>` creates a subscription
- `GET /api/webhooks?orgId=<orgId>` lists subscriptions for the current organization
- `GET /api/webhooks/:id?orgId=<orgId>` returns a single subscription
- `POST /api/webhooks/:id/rotate-secret?orgId=<orgId>` rotates the secret and returns it once
- `DELETE /api/webhooks/:id?orgId=<orgId>` deletes a subscription

## Request shape

```json
{
  "url": "https://example.com/webhook",
  "events": ["vault_created"],
  "active": true
}
```

The `url` must be a permitted public HTTP(S) URL. Secrets are returned only on creation and rotation.
