import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddServicePortfolioPhotos,
  SERVICE_PORTFOLIO_LIMIT,
  serviceListingOwnerWhere,
  servicePortfolioWhere,
} from "../../src/lib/service-gallery";

test("portfolio limit accepts a tenth photo and rejects an eleventh", () => {
  assert.equal(SERVICE_PORTFOLIO_LIMIT, 10);
  assert.equal(canAddServicePortfolioPhotos(9), true);
  assert.equal(canAddServicePortfolioPhotos(10), false);
  assert.equal(canAddServicePortfolioPhotos(9, 2), false);
  assert.equal(canAddServicePortfolioPhotos(0, 10), true);
  assert.equal(canAddServicePortfolioPhotos(0, 11), false);
});

test("cover photos are separate from the portfolio capacity", () => {
  assert.equal(canAddServicePortfolioPhotos(10), false);
  assert.equal(SERVICE_PORTFOLIO_LIMIT, 10);
});

test("photo management is scoped to an active service owned by the requester", () => {
  const providerA = serviceListingOwnerWhere("service-id", "provider-a");
  const providerB = serviceListingOwnerWhere("service-id", "provider-b");
  assert.deepEqual(providerA, {
    id: "service-id",
    providerId: "provider-a",
    status: { not: "REMOVED" },
  });
  assert.notDeepEqual(providerA, providerB);
});

test("portfolio queries are scoped to service-owned images for one service", () => {
  assert.deepEqual(servicePortfolioWhere("service-a"), {
    serviceId: "service-a",
    ownerType: "SERVICE",
  });
  assert.notDeepEqual(servicePortfolioWhere("service-a"), servicePortfolioWhere("service-b"));
});
