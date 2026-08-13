# JWT key lifecycle

Admit JWTs prove a visitor was allowed through the queue.

1. **Cold start:** Lambda `GetSecretValue` once; cache PEM/HMAC in memory.
2. **Warm admit/status:** sign in-process (no Secrets Manager, no KMS Sign per token).
3. **KMS:** optional key ceremony / rotation only.
4. **Verify:** edge connector and origin SDK use public key / shared HMAC.
5. **Local:** `VAZUE_LOCAL_MODE` + HMAC secret env (default in local-server).

Cost: ~$0.40/secret/month + pennies for cold-start API calls.
