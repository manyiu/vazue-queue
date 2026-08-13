import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lambda from 'aws-cdk-lib/aws-lambda';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'lambda');

export interface ResolvedLambdaCode {
  code: lambda.Code;
  runtime: lambda.Runtime;
  handler: string;
  usingRustAsset: boolean;
}

/**
 * Prefer cargo-lambda zip at assets/lambda/{name}.zip (bootstrap + PROVIDED_AL2023).
 * Fall back to a Node 501 placeholder so synth/tests work before CI publishes artifacts.
 */
export function resolveLambdaCode(binaryName: string): ResolvedLambdaCode {
  const zip = join(assetsDir, `${binaryName}.zip`);
  if (existsSync(zip)) {
    return {
      code: lambda.Code.fromAsset(zip),
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      usingRustAsset: true,
    };
  }
  const placeholder = lambda.Code.fromInline(`
exports.handler = async () => ({
  statusCode: 501,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    error: 'Rust cargo-lambda artifact missing',
    binary: ${JSON.stringify(binaryName)},
    hint: 'Run scripts/build-lambda-assets.sh or wait for rust-lambda CI',
  }),
});
`);
  return {
    code: placeholder,
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: 'index.handler',
    usingRustAsset: false,
  };
}
