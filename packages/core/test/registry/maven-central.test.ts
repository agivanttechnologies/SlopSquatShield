// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getMavenCentralFacts } from '../../src/registry/maven-central.js';
import { server } from '../msw/server.js';

const SEARCH = 'https://search.maven.org/solrsearch/select';
const REPO = 'https://repo1.maven.org/maven2';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('getMavenCentralFacts', () => {
  it('resolves existence, first-publish date (earliest of all versions), and repo link from the latest POM', async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          response: {
            numFound: 2,
            docs: [
              { v: '3.14.0', timestamp: 1697673600000 },
              { v: '3.0', timestamp: 1000000000000 },
            ],
          },
        }),
      ),
      http.get(`${REPO}/org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.pom`, () =>
        HttpResponse.text(
          '<project><scm><url>https://github.com/apache/commons-lang</url></scm></project>',
        ),
      ),
    );

    const facts = await getMavenCentralFacts('org.apache.commons:commons-lang3');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: new Date(1000000000000).toISOString(),
      repoUrl: 'https://github.com/apache/commons-lang',
    });
  });

  it('reports exists: false when Solr search returns no docs', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ response: { numFound: 0, docs: [] } })));

    const facts = await getMavenCentralFacts('com.example:definitely-a-hallucinated-name');
    expect(facts).toEqual({ exists: false });
  });

  it('throws on a non-OK Solr response — registry-unreachable stays distinct from non-existence', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ error: 'internal' }, { status: 503 })));

    await expect(getMavenCentralFacts('com.example:flaky-registry-case')).rejects.toThrow(/503/);
  });

  it('leaves repoUrl undefined (without failing resolution) when the POM has no <scm>', async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          response: { numFound: 1, docs: [{ v: '1.0.0', timestamp: 1600000000000 }] },
        }),
      ),
      http.get(`${REPO}/com/example/some-lib/1.0.0/some-lib-1.0.0.pom`, () =>
        HttpResponse.text('<project></project>'),
      ),
    );

    const facts = await getMavenCentralFacts('com.example:some-lib');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: new Date(1600000000000).toISOString(),
      repoUrl: undefined,
    });
  });

  describe('an <scm> inherited from a <parent> POM', () => {
    const one = (v: string) =>
      HttpResponse.json({ response: { numFound: 1, docs: [{ v, timestamp: 1600000000000 }] } });

    it('is followed: a module declares its repository once, in the parent (slf4j-api, guava, …)', async () => {
      server.use(
        http.get(SEARCH, () => one('2.0.17')),
        http.get(`${REPO}/org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.pom`, () =>
          HttpResponse.text(
            '<project><parent><groupId>org.slf4j</groupId><artifactId>slf4j-parent</artifactId><version>2.0.17</version></parent></project>',
          ),
        ),
        http.get(`${REPO}/org/slf4j/slf4j-parent/2.0.17/slf4j-parent-2.0.17.pom`, () =>
          HttpResponse.text(
            '<project><scm><url>https://github.com/qos-ch/slf4j</url></scm></project>',
          ),
        ),
      );

      const facts = await getMavenCentralFacts('org.slf4j:slf4j-api');

      expect(facts.repoUrl).toBe('https://github.com/qos-ch/slf4j');
    });

    it('follows more than one level, but not forever', async () => {
      const chain = (n: number) =>
        `<project><parent><groupId>g</groupId><artifactId>p${n + 1}</artifactId><version>1</version></parent></project>`;
      server.use(
        http.get(SEARCH, () => one('1')),
        http.get(`${REPO}/g/leaf/1/leaf-1.pom`, () => HttpResponse.text(chain(0))),
        http.get(`${REPO}/g/p1/1/p1-1.pom`, () => HttpResponse.text(chain(1))),
        http.get(`${REPO}/g/p2/1/p2-1.pom`, () => HttpResponse.text(chain(2))),
        http.get(`${REPO}/g/p3/1/p3-1.pom`, () => HttpResponse.text(chain(3))),
        // p4 would carry the scm, but it is past the depth limit and must never be requested
      );

      const facts = await getMavenCentralFacts('g:leaf');

      expect(facts.repoUrl).toBeUndefined();
    });

    it('prefers the artifact’s own <scm> over its parent’s (and never fetches the parent)', async () => {
      server.use(
        http.get(SEARCH, () => one('1')),
        http.get(`${REPO}/g/own/1/own-1.pom`, () =>
          HttpResponse.text(
            '<project><scm><url>https://example.com/own</url></scm><parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version></parent></project>',
          ),
        ),
      );

      expect((await getMavenCentralFacts('g:own')).repoUrl).toBe('https://example.com/own');
    });

    it('a parent that cannot be fetched leaves the repo link undefined, without failing', async () => {
      server.use(
        http.get(SEARCH, () => one('1')),
        http.get(`${REPO}/g/orphan/1/orphan-1.pom`, () =>
          HttpResponse.text(
            '<project><parent><groupId>g</groupId><artifactId>gone</artifactId><version>1</version></parent></project>',
          ),
        ),
        http.get(`${REPO}/g/gone/1/gone-1.pom`, () => new HttpResponse(null, { status: 404 })),
      );

      const facts = await getMavenCentralFacts('g:orphan');

      expect(facts.exists).toBe(true);
      expect(facts.repoUrl).toBeUndefined();
    });
  });

  it('never includes a weeklyDownloads field — Maven Central has no public download-count API', async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          response: { numFound: 1, docs: [{ v: '1.0.0', timestamp: 1600000000000 }] },
        }),
      ),
      http.get(`${REPO}/com/example/some-lib/1.0.0/some-lib-1.0.0.pom`, () =>
        HttpResponse.text('<project></project>'),
      ),
    );

    const facts = await getMavenCentralFacts('com.example:some-lib');
    expect(facts).not.toHaveProperty('weeklyDownloads');
  });
});
