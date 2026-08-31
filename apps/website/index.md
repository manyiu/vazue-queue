---
layout: home

hero:
  name: Vazue Queue
  text: A fair line for flash demand — on the AWS bill.
  tagline: Open source virtual waiting room. Deploy with CDK, protect origins with admit tokens, and pay serverless rates instead of per-visitor SaaS markup.
  actions:
    - theme: brand
      text: Deploy in 10 minutes
      link: /docs/getting-started/quickstart
    - theme: alt
      text: Why Vazue Queue?
      link: /docs/introduction/why-vazue
    - theme: alt
      text: View on GitHub
      link: https://github.com/manyiu/vazue-queue

features:
  - icon: 🎯
    title: Fair FIFO — not fastest refresh
    details: Atomic position assignment and a serving counter. Visitors advance in order; refreshing does not skip the line.
  - icon: 📦
    title: Full stack, not just an API
    details: Waiting room UI, queue API, admin portal, and optional Lambda@Edge gate — three CDK presets from minimal to full.
  - icon: 📊
    title: Published load tests
    details: In-region benchmarks with formulas and raw records — capacity is governed by AWS quotas and stack config, not a product ceiling.
  - icon: 🔓
    title: Apache-2.0, operator-owned
    details: Auditable source. Data stays in the operator AWS account. No per-visitor vendor lock-in.
---
