import type { PaymentProvider } from "./provider";
import { peachProvider } from "./peach";

/**
 * Single switch point for the active provider. PAYMENT_PROVIDER defaults to "peach".
 * To replace Peach, add another PaymentProvider implementation and map it here.
 */
const providers: Record<string, PaymentProvider> = { peach: peachProvider };

export function getPaymentProvider(): PaymentProvider {
  return providers[process.env.PAYMENT_PROVIDER ?? "peach"] ?? peachProvider;
}

export function getProviderById(id: string): PaymentProvider | undefined {
  return providers[id];
}
