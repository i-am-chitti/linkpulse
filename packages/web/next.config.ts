import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fails the build on a type error rather than shipping one, same bar as
  // the api package's tsc step. `eslint.ignoreDuringBuilds` was a next.config
  // option pre-16; linting is now solely `next lint` / the root `pnpm lint`.
  typescript: { ignoreBuildErrors: false },
  // Traces the minimal set of files `next start` actually needs into
  // .next/standalone, so the runtime image ships a pruned server rather than
  // the whole workspace's node_modules.
  output: 'standalone',
};

export default nextConfig;
