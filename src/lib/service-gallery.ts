export const SERVICE_PORTFOLIO_LIMIT = 10;

export function serviceListingOwnerWhere(id: string, providerId: string) {
  return { id, providerId, status: { not: "REMOVED" as const } };
}

export function servicePortfolioWhere(serviceId: string) {
  return { serviceId, ownerType: "SERVICE" as const };
}

export function canAddServicePortfolioPhotos(
  currentCount: number,
  requestedCount = 1
): boolean {
  return (
    Number.isSafeInteger(currentCount) &&
    Number.isSafeInteger(requestedCount) &&
    currentCount >= 0 &&
    requestedCount > 0 &&
    currentCount + requestedCount <= SERVICE_PORTFOLIO_LIMIT
  );
}
