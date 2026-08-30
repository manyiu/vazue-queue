---
"@yiu/queue-cdk": patch
---

Lean buffered EnrollFn cold start: skip DynamoDB and signing-secret init on the SQS accept path, with matching CDK env/IAM slimming and updated enroll Lambda binaries.
