<script setup lang="ts">
const steps = [
  {
    n: '1',
    title: 'Visitors enroll',
    body: 'Browser calls POST /enroll and receives a FIFO position. Same session always maps to the same place in line.',
  },
  {
    n: '2',
    title: 'Queue advances fairly',
    body: 'Serving counter moves at throughput_per_minute. Adaptive polling keeps API cost down — back-of-queue visitors poll less often.',
  },
  {
    n: '3',
    title: 'Admit token unlocks the origin',
    body: 'GET /status returns a signed JWT when admitted. The origin verifies it — or Lambda@Edge blocks traffic without one.',
  },
];

const useCases = [
  {
    title: 'Ticket & drop sales',
    body: 'Flash traffic spikes without taking down checkout. Throttle entry, not the payment flow.',
  },
  {
    title: 'Product launches',
    body: 'Hype builds while DynamoDB and Lambda absorb the queue — idle cost stays near zero between events.',
  },
  {
    title: 'Regulated or invite-only drops',
    body: 'Invite codes, dress rehearsal mode, and admin live overrides without redeploying infrastructure.',
  },
];
</script>

<template>
  <div class="vq-home">
    <section class="vq-section">
      <h2>How it works</h2>
      <p class="vq-lead">
        Same model as enterprise waiting rooms — enroll, poll, admit — with operator ownership of the stack and the AWS bill.
      </p>
      <div class="vq-steps">
        <article v-for="step in steps" :key="step.n" class="vq-step">
          <div class="vq-step-n">{{ step.n }}</div>
          <h3>{{ step.title }}</h3>
          <p>{{ step.body }}</p>
        </article>
      </div>
      <p class="vq-link-row">
        <a href="/docs/concepts/visitor-flow.html">Visitor flow diagram →</a>
        <a href="/docs/concepts/architecture.html">Architecture →</a>
      </p>
    </section>

    <section class="vq-section vq-compare">
      <h2>Why engineers pick Vazue Queue</h2>
      <p class="vq-lead">
        This is not a generic message queue — it provides <strong>visitor fairness</strong> at the application edge.
        Comparison against common alternatives:
      </p>
      <div class="vq-table-wrap">
        <table class="vq-table">
          <thead>
            <tr>
              <th></th>
              <th>Vazue Queue (OSS)</th>
              <th>Managed waiting room</th>
              <th>Custom build</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Deploy target</td>
              <td><strong>Operator AWS account</strong> via CDK</td>
              <td>Vendor cloud</td>
              <td>Self-managed infra</td>
            </tr>
            <tr>
              <td>Cost model</td>
              <td><strong>AWS serverless</strong> — spikes only</td>
              <td>Per-visitor / event pricing</td>
              <td>Always-on infra + eng time</td>
            </tr>
            <tr>
              <td>Fairness &amp; UI</td>
              <td><strong>FIFO + waiting room</strong> included</td>
              <td>Included</td>
              <td>Must be implemented</td>
            </tr>
            <tr>
              <td>Origin protection</td>
              <td><strong>JWT + optional Lambda@Edge</strong></td>
              <td>Vendor edge</td>
              <td>Custom cookies / WAF rules</td>
            </tr>
            <tr>
              <td>Source &amp; audit</td>
              <td><strong>Apache-2.0 monorepo</strong></td>
              <td>Closed source</td>
              <td>Internal codebase</td>
            </tr>
            <tr>
              <td>Ops burden</td>
              <td>CDK deploy + AWS primitives</td>
              <td>Lowest</td>
              <td>Highest</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="vq-muted">
        Best fit: AWS teams that want commercial-grade visitor fairness without per-visitor SaaS markup and can run CDK.
        Poor fit when AWS operations must be zero — use a managed waiting room service or
        <a href="/pricing.html">managed Vazue</a> when it launches.
      </p>
      <p class="vq-link-row">
        <a href="/docs/introduction/why-vazue.html">Full comparison &amp; decision guide →</a>
      </p>
    </section>

    <section class="vq-section vq-code">
      <h2>Deploy in one command</h2>
      <p class="vq-lead">Scaffold, configure, and deploy the <code>standard</code> preset (waiting room + API + DynamoDB).</p>
      <pre class="vq-terminal"><code>npx create-vazue-queue my-queue
cd my-queue && pnpm install
npx cdk bootstrap && npm run deploy</code></pre>
      <p class="vq-muted">
        Estimate AWS cost (100K visitors × 60 min ≈ <strong>$197</strong> worst case, often less):
        <code>npx vazue-queue cost --visitors 100000 --minutes 60</code>
        · <a href="/docs/guides/cost.html">Cost guide</a>
      </p>
    </section>

    <section class="vq-section">
      <h2>Built for</h2>
      <div class="vq-cards">
        <article v-for="uc in useCases" :key="uc.title" class="vq-card">
          <h3>{{ uc.title }}</h3>
          <p>{{ uc.body }}</p>
        </article>
      </div>
    </section>

    <section class="vq-cta">
      <div class="vq-cta-inner">
        <h2>Get started</h2>
        <p>Run locally in minutes, or deploy to an AWS account with the CDK wizard.</p>
        <div class="vq-cta-actions">
          <a class="vq-btn primary" href="/docs/getting-started/local-development.html">Local dev guide</a>
          <a class="vq-btn" href="/oss.html">Self-host on AWS</a>
          <a class="vq-btn ghost" href="/docs/reference/sdks.html">SDK examples</a>
        </div>
      </div>
    </section>
  </div>
</template>
