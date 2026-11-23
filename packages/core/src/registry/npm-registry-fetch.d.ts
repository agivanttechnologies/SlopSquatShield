// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
declare module 'npm-registry-fetch' {
  function npmRegistryFetch(uri: string, opts?: Record<string, unknown>): Promise<Response>;
  namespace npmRegistryFetch {
    function json(uri: string, opts?: Record<string, unknown>): Promise<unknown>;
  }
  export default npmRegistryFetch;
}
