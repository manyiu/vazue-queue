---
"@yiu/queue-cdk": minor
---

Remove SaaS-only DynamoDB tables (Tenants, UsageDaily, Tokens), stripe feature flag, and VAZUE_DEPLOYMENT_PROFILE env var. Redeploy existing stacks to apply the CloudFormation change.
